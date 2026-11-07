// ============================================================
// РАСХОДЫ КОМПАНИИ (аренда, коммунальные, уборка и т.п.)
// ============================================================
let editingCompanyExpenseId = null;
const COMPANY_WITHDRAWAL_CATEGORY = 'Вывод средств';
const RESERVE_INCREASE_CATEGORY = 'Корректировка резерва (+)';
const RESERVE_DECREASE_CATEGORY = 'Корректировка резерва (−)';
const RESERVE_OPENING_BALANCE = 190000;
const RESERVE_OPENING_DATE = '23.09.2026';

const COMPANY_EXPENSE_CATEGORIES = [
  'Аренда',
  'Коммунальные',
  'Уборка',
  'Связь и интернет',
  'Кофе / вода / офис',
  'Топливо / авто',
  'Такси / логистика',
  'Хозтовары',
  'Техника / подписки',
  'Реклама / продвижение',
  'Питание/нужды офиса',
  'Топливо/логистика',
  'Форс-мажор (переделка)',
  'Прочее',
  COMPANY_WITHDRAWAL_CATEGORY
];
const FORCE_MAJEURE_CATEGORY = 'Форс-мажор (переделка)';
const COMPANY_INCOME_CATEGORIES = ['Аренда помещений', 'Прочий доход'];

function isReserveSystemIncome(row){
  return !!row && row.category === RESERVE_INCREASE_CATEGORY;
}
function isReserveSystemExpense(row){
  return !!row && (row.category === RESERVE_DECREASE_CATEGORY || row.category === COMPANY_WITHDRAWAL_CATEGORY);
}
function isOperationalCompanyIncome(row){
  return !!row && !row.deleted_at && !isReserveSystemIncome(row);
}
function isOperationalCompanyExpense(row){
  return !!row && !row.deleted_at && !isReserveSystemExpense(row);
}
function getCompanyReserveBalance(){
  const added = (state.companyIncome||[])
    .filter(i=>!i.deleted_at && i.category===RESERVE_INCREASE_CATEGORY)
    .reduce((s,i)=>s+(Number(i.amount)||0),0);
  const correctedDown = (state.companyExpenses||[])
    .filter(i=>!i.deleted_at && i.category===RESERVE_DECREASE_CATEGORY)
    .reduce((s,i)=>s+(Number(i.amount)||0),0);
  const withdrawn = (state.companyExpenses||[])
    .filter(i=>!i.deleted_at && i.category===COMPANY_WITHDRAWAL_CATEGORY)
    .reduce((s,i)=>s+(Number(i.amount)||0),0);
  return Math.max(0, RESERVE_OPENING_BALANCE + added - correctedDown - withdrawn);
}
function getCompanyWithdrawals(from, to){
  return (state.companyExpenses||[]).filter(i=>
    !i.deleted_at &&
    i.category===COMPANY_WITHDRAWAL_CATEGORY &&
    (!from || (i.expense_date||'')>=from) &&
    (!to || (i.expense_date||'')<=to)
  );
}

function renderCompanyExpensesList(){
  const el = document.getElementById('companyExpensesList');
  if(!el) return;
  const list = (state.companyExpenses||[]).filter(isOperationalCompanyExpense).slice().sort((a,b)=>(b.expense_date||'').localeCompare(a.expense_date||''));
  if(!list.length){
    el.innerHTML = '<div class="empty-state">Расходов пока нет</div>';
    return;
  }
  el.innerHTML = list.map(ex=>`
    <div class="list-item">
      <div>
        <div class="li-name">${escapeHtml(ex.category)}${ex.description?' — '+escapeHtml(ex.description):''}</div>
        <div class="li-meta">${fmtDate(ex.expense_date)}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="proj-sum" style="color:var(--red);">${fmtMoney(ex.amount)}</div>
        <button class="icon-btn" onclick="openCompanyExpenseSheet('${ex.id}')">✎</button>
      </div>
    </div>`).join('');
}

// A new money entry owns one UUID until the server confirms that exact row.
// Keep uncertain attempts across a reload; do not turn a retry into new money.
const companyMoneyForms={expense:null,income:null};
const companyMoneyPending=new Map();
let companyMoneyGeneration=0;
function companyMoneyConfig(kind){
  return kind==='expense'
    ? {table:'company_expenses',prefix:'cex',date:'expense_date',overlay:'companyExpenseSheetOverlay',title:'companyExpenseSheetTitle',noun:'Расход',entity:'company_expense'}
    : {table:'company_income',prefix:'cin',date:'income_date',overlay:'companyIncomeSheetOverlay',title:'companyIncomeSheetTitle',noun:'Доход',entity:'company_income'};
}
function companyMoneyPayload(kind){
  const c=companyMoneyConfig(kind),value=id=>document.getElementById(c.prefix+'-'+id).value;
  let description=value('desc').trim();
  if(window.ARHITTEKCash?.operationDescription)description=ARHITTEKCash.operationDescription(c.prefix+'-desc',description);
  return {category:value('category'),amount:parseFloat(value('amount'))||0,[c.date]:value('date'),description};
}
function companyMoneyMatches(kind,row,payload){
  const c=companyMoneyConfig(kind);
  return !!row&&Number(row.amount)===Number(payload.amount)&&String(row.category||'')===String(payload.category||'')&&String(row[c.date]||'')===String(payload[c.date]||'')&&String(row.description||'')===String(payload.description||'');
}
function companyMoneyStorageKey(kind){return 'arhittek_company_money_pending_v1:'+session.employeeId+':'+kind;}
function companyMoneyReadPending(key,kind){
  try{
    const value=companyMoneyPending.get(key)||JSON.parse(sessionStorage.getItem(key)||'null'),c=companyMoneyConfig(kind);
    if(value?.version===1&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)&&typeof value.payload?.category==='string'&&Number.isFinite(value.payload.amount)&&value.payload.amount>0&&typeof value.payload[c.date]==='string'&&typeof value.payload.description==='string')return value;
  }catch(e){console.warn('Не удалось прочитать незавершённую денежную запись',e);}
  return null;
}
function companyMoneyRemember(form,payload){
  form.attemptPayload={...payload};
  const value={version:1,id:form.id,payload:form.attemptPayload};companyMoneyPending.set(form.key,value);
  try{sessionStorage.setItem(form.key,JSON.stringify(value));}catch(e){console.warn('Черновик денежной записи сохранён только до закрытия страницы',e);}
}
function companyMoneyForget(form){
  const pending=companyMoneyReadPending(form.key,form.kind);
  if(pending?.id!==form.id)return;
  companyMoneyPending.delete(form.key);
  try{sessionStorage.removeItem(form.key);}catch(e){console.warn('Не удалось удалить подтверждённый черновик',e);}
}
function companyMoneyNotice(kind,text){
  const c=companyMoneyConfig(kind),button=document.getElementById(c.prefix+'-save');
  let note=document.getElementById(c.prefix+'-save-status');
  if(!note){note=document.createElement('div');note.id=c.prefix+'-save-status';note.className='note';note.setAttribute('role','status');button.before(note);}
  note.textContent=text||'';note.hidden=!text;
}
function beginCompanyMoneyForm(kind,id,record){
  const c=companyMoneyConfig(kind),key=companyMoneyStorageKey(kind),pending=id?null:companyMoneyReadPending(key,kind);
  const form={kind,key,generation:++companyMoneyGeneration,id:id||pending?.id||crypto.randomUUID(),entityId:id||null,base:record?{...record}:null,attemptPayload:pending?.payload||null};
  companyMoneyForms[kind]=form;
  if(pending){
    const payload=pending.payload,category=document.getElementById(c.prefix+'-category');
    if(!Array.from(category.options).some(o=>o.value===payload.category))category.add(new Option(payload.category,payload.category));
    category.value=payload.category;document.getElementById(c.prefix+'-amount').value=payload.amount;document.getElementById(c.prefix+'-date').value=payload[c.date];document.getElementById(c.prefix+'-desc').value=payload.description;
  }
  companyMoneyNotice(kind,pending?'Предыдущая попытка не подтверждена. «Сохранить» сначала проверит её, чтобы не создать повторную запись.':'');
  document.getElementById(c.prefix+'-save').disabled=kind==='expense'?companyExpenseSaveInFlight:companyIncomeSaveInFlight;
  return form;
}
async function companyMoneyReadRow(form){
  const c=companyMoneyConfig(form.kind),r=await sb.from(c.table).select('id,category,amount,'+c.date+',description,deleted_at').eq('id',form.id).maybeSingle();
  if(r.error)throw new Error('Не удалось проверить денежную запись. Повторите сохранение после восстановления связи.');
  if(r.data&&r.data.id!==form.id)throw new Error('Не удалось подтвердить номер денежной записи');
  return r.data;
}
function checkCompanyMoneyWithdrawal(form,payload){
  if(form.kind!=='expense'||payload.category!==COMPANY_WITHDRAWAL_CATEGORY)return;
  let available=typeof getCompanyAvailableCash==='function'?getCompanyAvailableCash():getCompanyReserveBalance();
  if(form.entityId&&form.base?.category===COMPANY_WITHDRAWAL_CATEGORY)available+=Number(form.base.amount)||0;
  if(payload.amount>available)throw new Error('Недостаточно средств в резерве. Доступно: '+fmtMoney(available));
}
async function insertCompanyMoneyDraft(form,payload){
  const c=companyMoneyConfig(form.kind);
  if(form.attemptPayload){const existing=await companyMoneyReadRow(form);if(existing)return existing;}
  checkCompanyMoneyWithdrawal(form,payload);
  companyMoneyRemember(form,payload);
  let saved=null,saveError=null;
  try{
    const r=await sb.from(c.table).insert({id:form.id,...payload}).select('id,category,amount,'+c.date+',description,deleted_at').single();
    saved=r.data;saveError=r.error;
  }catch(e){saveError=e;}
  if(saved&&!saveError&&saved.id===form.id)return saved;
  const existing=await companyMoneyReadRow(form);
  if(existing)return existing;
  throw new Error('Ошибка сохранения. Запись пока не подтверждена; повтор сохранит тот же номер операции.');
}
async function updateCompanyMoneyForm(form,payload){
  const c=companyMoneyConfig(form.kind),base=form.base||{},fields=['category','amount',c.date,'description'];
  const current=await companyMoneyReadRow(form);
  if(current&&!current.deleted_at&&companyMoneyMatches(form.kind,current,payload))return current;
  checkCompanyMoneyWithdrawal(form,payload);
  let query=sb.from(c.table).update(payload).eq('id',form.id).is('deleted_at',null);
  for(const field of fields)query=base[field]==null?query.is(field,null):query.eq(field,base[field]);
  let saved=null;
  try{const r=await query.select('id,category,amount,'+c.date+',description,deleted_at').maybeSingle();if(!r.error)saved=r.data;}catch(e){console.error(e);}
  if(saved)return saved;
  const existing=await companyMoneyReadRow(form);
  if(existing&&!existing.deleted_at&&companyMoneyMatches(form.kind,existing,payload))return existing;
  throw new Error('Запись изменена или недоступна. Обновите её перед повтором; текущие поля не сохранены.');
}
async function commitCompanyMoneyForm(form,payload){
  const kind=form.kind,c=companyMoneyConfig(kind),wasEditing=!!form.entityId,before=form.base;
  const saved=wasEditing?await updateCompanyMoneyForm(form,payload):await insertCompanyMoneyDraft(form,payload);
  if(saved.deleted_at)throw new Error('Предыдущая запись находится в корзине. Повторная операция не создана; проверьте историю.');
  const matches=companyMoneyMatches(kind,saved,payload);
  if(!wasEditing)companyMoneyForget(form);
  form.entityId=saved.id;form.base={...saved};form.attemptPayload=null;
  if(!form.auditDone||wasEditing){
    form.auditDone=true;
    await logAudit(c.entity,saved.id,saved.category+(saved.description?' — '+saved.description:''),wasEditing?'update':'create',{
      category:{old:before?.category||null,new:saved.category},amount:{old:Number(before?.amount)||0,new:Number(saved.amount)},
      [c.date]:{old:before?.[c.date]||null,new:saved[c.date]},description:{old:before?.description||'',new:saved.description||''}
    });
  }
  const current=companyMoneyForms[kind]===form&&document.getElementById(c.overlay).classList.contains('active');
  const unchanged=current&&matches&&companyMoneyMatches(kind,companyMoneyPayload(kind),payload);
  if(unchanged){
    if(kind==='expense')closeCompanyExpenseSheet();else closeCompanyIncomeSheet();
  }else if(current){
    if(kind==='expense')editingCompanyExpenseId=saved.id;else editingCompanyIncomeId=saved.id;
    document.getElementById(c.title).textContent=kind==='expense'?'Редактировать сохранённый расход':'Редактировать сохранённый доход';
    document.getElementById(c.prefix+'-delete').style.display='';
    companyMoneyNotice(kind,'Подтверждена запись на '+fmtMoney(saved.amount)+'. Текущие изменения ещё не сохранены. Нажмите «Сохранить», чтобы изменить именно эту запись.');
  }
  showToast(current&&!unchanged?'Предыдущая запись подтверждена; текущие изменения ещё не сохранены':c.noun+' сохранён'+(current?'':' · предыдущая форма'));
  await loadAll();financeExpanded=true;renderAnalytics();
}

function openCompanyExpenseSheet(id, presetCategory){
  editingCompanyExpenseId = id;
  const overlay = document.getElementById('companyExpenseSheetOverlay');
  const title = document.getElementById('companyExpenseSheetTitle');
  const deleteBtn = document.getElementById('cex-delete');
  const catSel = document.getElementById('cex-category');
  catSel.innerHTML = COMPANY_EXPENSE_CATEGORIES.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if(id){
    const ex = (state.companyExpenses||[]).find(x=>x.id===id);
    if(!ex) return;
    if(ex.category && !COMPANY_EXPENSE_CATEGORIES.includes(ex.category)) catSel.add(new Option(ex.category,ex.category));
    title.textContent = 'Редактировать расход';
    deleteBtn.style.display = '';
    catSel.value = ex.category || COMPANY_EXPENSE_CATEGORIES[0];
    document.getElementById('cex-amount').value = ex.amount ?? '';
    document.getElementById('cex-date').value = ex.expense_date || '';
    document.getElementById('cex-desc').value = ex.description || '';
  }else{
    title.textContent = 'Новый расход';
    deleteBtn.style.display = 'none';
    catSel.value = (presetCategory && COMPANY_EXPENSE_CATEGORIES.includes(presetCategory)) ? presetCategory : COMPANY_EXPENSE_CATEGORIES[0];
    title.textContent = presetCategory===COMPANY_WITHDRAWAL_CATEGORY ? 'Вывод денег' : 'Новый расход';
    document.getElementById('cex-amount').value = '';
    document.getElementById('cex-date').value = financeToday();
    document.getElementById('cex-desc').value = '';
  }
  beginCompanyMoneyForm('expense',id,(state.companyExpenses||[]).find(x=>x.id===id));
  overlay.classList.add('active');
  window.ARHITTEKCash?.attachCountField('cex-desc');
}

function closeCompanyExpenseSheet(){
  document.getElementById('companyExpenseSheetOverlay').classList.remove('active');
  editingCompanyExpenseId = null;
}

let companyExpenseSaveInFlight=false;
async function saveCompanyExpense(){
  if(companyExpenseSaveInFlight) return;
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  const form=companyMoneyForms.expense;
  if(!form||!document.getElementById('companyExpenseSheetOverlay').classList.contains('active'))return;
  const payload=companyMoneyPayload('expense'),{category,amount,expense_date,description}=payload;
  if(!Number.isFinite(amount) || amount <= 0){ showToast('Укажите сумму'); return; }
  if(!category){ showToast('Выберите категорию'); return; }
  if(!expense_date){ showToast('Укажите дату'); return; }
  if(category === COMPANY_WITHDRAWAL_CATEGORY){
    if(!document.getElementById('cex-desc').value.trim()){ showToast('Укажите назначение вывода денег'); return; }
  }
  companyExpenseSaveInFlight=true;
  document.getElementById('cex-save').disabled=true;
  try{
    await commitCompanyMoneyForm(form,payload);
  }catch(e){
    console.error(e);
    const current=companyMoneyForms.expense===form&&document.getElementById('companyExpenseSheetOverlay').classList.contains('active');
    if(current)companyMoneyNotice('expense',e.message||'Ошибка сохранения. Проверьте связь перед повтором.');
    showToast((current?'':'Предыдущая форма: ')+(e.message||'Ошибка сохранения расхода'));
  }finally{
    companyExpenseSaveInFlight=false;
    document.getElementById('cex-save').disabled=false;
  }
}

async function deleteCompanyExpense(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  if(!editingCompanyExpenseId) return;
  if(!confirm('Удалить этот расход? Его можно будет восстановить из корзины.')) return;
  try{
    const before=(state.companyExpenses||[]).find(x=>x.id===editingCompanyExpenseId);
    const {error} = await sb.from('company_expenses').update({deleted_at: new Date().toISOString()}).eq('id', editingCompanyExpenseId);
    if(error) throw error;
    await logAudit('company_expense',editingCompanyExpenseId,before?((before.category||'Расход')+(before.description?' — '+before.description:'')):'Расход компании','delete',{});
    showToast('Расход перемещён в корзину');
    closeCompanyExpenseSheet();
    await loadAll();
    financeExpanded = true;
    renderAnalytics();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }
}

