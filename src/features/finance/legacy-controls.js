/* ARHITTEK FINANCE CONTROLS V3 */
(()=>{
'use strict';
const view=document.getElementById('view-finance');
if(!view || window.__arhittekFinanceControlsV3) return;
window.__arhittekFinanceControlsV3=true;
const $=id=>document.getElementById(id);
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const money=v=>{try{return fmtMoney(Math.round(num(v)));}catch(e){return Math.round(num(v)).toLocaleString('ru-RU')+' ₽';}};
const esc=v=>{try{return escapeHtml(v);}catch(e){return String(v??'');}};
const isAdmin=()=>!!window.session?.isAdmin || !!session?.isAdmin;
let editingBonusId=null;

function financeSheet(){
  let o=$('financeControlSheetOverlay');
  if(o) return o;
  o=document.createElement('div');
  o.className='sheet-overlay';
  o.id='financeControlSheetOverlay';
  o.innerHTML=`
    <div class="sheet finance-control-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title"><span id="financeControlTitle">Финансовая операция</span><button class="sheet-close" type="button" id="financeControlClose">✕</button></div>
      <div id="financeControlBody"></div>
    </div>`;
  document.body.appendChild(o);
  $('financeControlClose').onclick=closeFinanceControl;
  return o;
}
function closeFinanceControl(){
  $('financeControlSheetOverlay')?.classList.remove('active');
  editingBonusId=null;
}
window.closeFinanceControl=closeFinanceControl;

function activeEmployees(){
  return (state.employees||[]).filter(e=>e.active!==false&&!e.deleted_at);
}
function bonusEntries(){
  return (state.ledger||[]).filter(l=>l.type==='bonus'&&!l.deleted_at).sort((a,b)=>String(b.entry_date||'').localeCompare(String(a.entry_date||'')));
}
function findBonus(id){return bonusEntries().find(x=>String(x.id)===String(id));}

window.openFinanceBonusSheet=function(id=null){
  if(!isAdmin()){showToast('Требуются права администратора');return;}
  editingBonusId=id;
  const row=id?findBonus(id):null;
  const o=financeSheet();
  $('financeControlTitle').textContent=row?'Редактировать премию':'Назначить премию';
  $('financeControlBody').innerHTML=`
    <div class="field"><label>Сотрудник</label><select id="finance-bonus-employee">${activeEmployees().map(e=>`<option value="${e.id}">${esc(e.name)}${e.role?' · '+esc(e.role):''}</option>`).join('')}</select></div>
    <div class="field-row">
      <div class="field"><label>Сумма, ₽</label><input id="finance-bonus-amount" type="number" min="1" step="500" placeholder="0"></div>
      <div class="field"><label>Дата начисления</label><input id="finance-bonus-date" type="date"></div>
    </div>
    <div class="field"><label>За что премия</label><input id="finance-bonus-desc" type="text" placeholder="например: за сдачу проекта раньше срока"></div>
    <button type="button" class="btn btn-primary" id="finance-bonus-save">${row?'Сохранить изменения':'Назначить премию'}</button>
    ${row?'<button type="button" class="btn btn-danger finance-control-danger" id="finance-bonus-delete">Удалить премию</button>':''}
  `;
  if(row){
    $('finance-bonus-employee').value=row.payee_employee_id||'';
    $('finance-bonus-amount').value=row.amount||'';
    $('finance-bonus-date').value=row.entry_date||'';
    $('finance-bonus-desc').value=row.description||'';
  }else{
    $('finance-bonus-date').value=financeToday();
  }
  $('finance-bonus-save').onclick=saveFinanceBonus;
  if(row) $('finance-bonus-delete').onclick=deleteFinanceBonus;
  o.classList.add('active');
};

async function saveFinanceBonus(){
  if(!isAdmin()) return;
  const employee=$('finance-bonus-employee')?.value;
  const amount=num($('finance-bonus-amount')?.value);
  const entry_date=$('finance-bonus-date')?.value;
  const description=($('finance-bonus-desc')?.value||'').trim();
  if(!employee){showToast('Выберите сотрудника');return;}
  if(amount<=0){showToast('Укажите сумму премии');return;}
  if(!entry_date){showToast('Укажите дату');return;}
  try{
    const payload={type:'bonus',project_id:null,payee_employee_id:employee,amount,entry_date,description:description||'Премия',received_by:session?.employeeId||null};
    let q;
    if(editingBonusId) q=await sb.from('ledger_entries').update(payload).eq('id',editingBonusId);
    else q=await sb.from('ledger_entries').insert(payload);
    if(q.error) throw q.error;
    closeFinanceControl();
    showToast(editingBonusId?'Премия изменена':'Премия назначена');
    await loadAll();
    try{renderTimesheet();}catch(e){}
    try{renderFinanceVisualPanels();}catch(e){}
  }catch(e){console.error(e);showToast('Не удалось сохранить премию');}
}
async function deleteFinanceBonus(){
  if(!editingBonusId||!confirm('Удалить эту премию?')) return;
  try{
    const {error}=await sb.from('ledger_entries').delete().eq('id',editingBonusId);
    if(error) throw error;
    closeFinanceControl();
    showToast('Премия удалена');
    await loadAll();
  }catch(e){console.error(e);showToast('Ошибка удаления премии');}
}

window.openReserveCorrection=function(){
  if(!isAdmin()){showToast('Требуются права администратора');return;}
  const current=typeof getCompanyReserveBalance==='function'?getCompanyReserveBalance():190000;
  const o=financeSheet();
  $('financeControlTitle').textContent='Корректировать резерв';
  $('financeControlBody').innerHTML=`
    <div class="finance-current-balance"><span>Сейчас в резерве</span><strong>${money(current)}</strong></div>
    <div class="field"><label>Фактический остаток резерва, ₽</label><input id="finance-reserve-target" type="number" min="0" step="1000" value="${Math.round(current)}"></div>
    <div class="field"><label>Комментарий</label><input id="finance-reserve-comment" type="text" placeholder="например: сверка кассы и счетов"></div>
    <button type="button" class="btn btn-primary" id="finance-reserve-save">Сохранить фактический резерв</button>
  `;
  $('finance-reserve-save').onclick=saveReserveCorrection;
  o.classList.add('active');
};
async function saveReserveCorrection(){
  const current=typeof getCompanyReserveBalance==='function'?getCompanyReserveBalance():190000;
  const target=num($('finance-reserve-target')?.value);
  const comment=($('finance-reserve-comment')?.value||'').trim();
  if(target<0){showToast('Резерв не может быть отрицательным');return;}
  const delta=Math.round(target-current);
  if(delta===0){closeFinanceControl();showToast('Резерв уже совпадает');return;}
  const today=financeToday();
  try{
    if(delta>0){
      const {error}=await sb.from('company_income').insert({category:RESERVE_INCREASE_CATEGORY,amount:delta,income_date:today,description:comment||'Корректировка фактического резерва'});
      if(error) throw error;
    }else{
      const {error}=await sb.from('company_expenses').insert({category:RESERVE_DECREASE_CATEGORY,amount:Math.abs(delta),expense_date:today,description:comment||'Корректировка фактического резерва'});
      if(error) throw error;
    }
    closeFinanceControl();showToast('Резерв скорректирован');await loadAll();
  }catch(e){console.error(e);showToast('Не удалось скорректировать резерв');}
}

window.openCompanyWithdrawal=function(){
  if(!isAdmin()){showToast('Требуются права администратора');return;}
  try{openCompanyExpenseSheet(null,COMPANY_WITHDRAWAL_CATEGORY);}catch(e){console.error(e);}
};

function renderFinanceControls(){
  const team=document.querySelector('.finance-visual-panel[data-fin-panel="team"]');
  const expense=document.querySelector('.finance-visual-panel[data-fin-panel="expense"]');
  const reserve=document.querySelector('.finance-visual-panel[data-fin-panel="reserve"]');
  const teamVisual=$('financeTeamVisual');
  const expenseVisual=$('financeExpenseVisual');
  const reserveVisual=$('financeReserveVisual');
  if(!team||!expense||!reserve) return;

  let bonusActions=$('financeBonusActions');
  if(!bonusActions){
    bonusActions=document.createElement('div');
    bonusActions.id='financeBonusActions';
    bonusActions.className='finance-management-actions';
    teamVisual?.insertAdjacentElement('afterend',bonusActions);
  }
  const bonuses=bonusEntries();
  const {from,to}=(()=>{try{return financeCurrentRange();}catch(e){return {from:'0000-01-01',to:'9999-12-31'};}})();
  const periodBonuses=bonuses.filter(b=>(b.entry_date||'')>=from&&(b.entry_date||'')<=to);
  bonusActions.innerHTML=`
    ${isAdmin()?'<button type="button" class="btn btn-primary" onclick="openFinanceBonusSheet()">+ Назначить премию</button>':''}
    <details class="finance-visual-disclosure finance-bonus-history" ${periodBonuses.length?'':'open'}>
      <summary>Премии за период · ${periodBonuses.length}</summary>
      <div class="finance-management-list">
      ${periodBonuses.length?periodBonuses.map(b=>{
        const emp=(state.employees||[]).find(e=>e.id===b.payee_employee_id);
        return `<div class="finance-management-row"><div><strong>${esc(emp?.name||'Сотрудник')}</strong><small>${esc(b.entry_date||'')}${b.description?' · '+esc(b.description):''}</small></div><div><b>${money(b.amount)}</b>${isAdmin()?`<button type="button" class="icon-btn" onclick="openFinanceBonusSheet('${b.id}')">✎</button>`:''}</div></div>`;
      }).join(''):'<div class="finance-v-empty">Премий за выбранный период нет.</div>'}
      </div>
    </details>`;

  let expenseManage=$('financeExpenseManage');
  if(!expenseManage){
    expenseManage=document.createElement('div');
    expenseManage.id='financeExpenseManage';
    expenseManage.className='finance-management-block';
    expenseVisual?.insertAdjacentElement('afterend',expenseManage);
  }
  const operational=(state.companyExpenses||[]).filter(x=>!x.deleted_at&&(typeof isOperationalCompanyExpense!=='function'||isOperationalCompanyExpense(x))).sort((a,b)=>String(b.expense_date||'').localeCompare(String(a.expense_date||'')));
  expenseManage.innerHTML=`
    ${isAdmin()?'<div class="finance-quick-actions"><button type="button" onclick="openCompanyExpenseSheet(null,\'Кофе / вода / офис\')">+ Кофе / офис</button><button type="button" onclick="openCompanyExpenseSheet(null,\'Топливо / авто\')">+ Топливо / авто</button></div>':''}
    <details class="finance-visual-disclosure">
      <summary>Управление расходами · ${operational.length}</summary>
      <div class="finance-management-list">
      ${operational.length?operational.slice(0,30).map(x=>`<div class="finance-management-row"><div><strong>${esc(x.category||'Расход')}</strong><small>${esc(x.expense_date||'')}${x.description?' · '+esc(x.description):''}</small></div><div><b class="negative">−${money(x.amount)}</b>${isAdmin()?`<button type="button" class="icon-btn" onclick="openCompanyExpenseSheet('${x.id}')">✎</button>`:''}</div></div>`).join(''):'<div class="finance-v-empty">Расходов пока нет.</div>'}
      </div>
    </details>`;

  const actualReserve=typeof getCompanyReserveBalance==='function'?getCompanyReserveBalance():190000;
  if(reserveVisual){
    const withdrawals=(state.companyExpenses||[]).filter(x=>!x.deleted_at&&x.category===COMPANY_WITHDRAWAL_CATEGORY).sort((a,b)=>String(b.expense_date||'').localeCompare(String(a.expense_date||'')));
    const corrections=[
      ...(state.companyIncome||[]).filter(x=>!x.deleted_at&&x.category===RESERVE_INCREASE_CATEGORY).map(x=>({...x,_dir:1,_date:x.income_date})),
      ...(state.companyExpenses||[]).filter(x=>!x.deleted_at&&x.category===RESERVE_DECREASE_CATEGORY).map(x=>({...x,_dir:-1,_date:x.expense_date}))
    ].sort((a,b)=>String(b._date||'').localeCompare(String(a._date||'')));
    reserveVisual.innerHTML=`
      <div class="finance-v-hero reserve-hero"><span>Фактический резерв компании</span><strong>${money(actualReserve)}</strong><small>Старт: 190 000 ₽ на 23.09.2026 · корректируется вручную по фактическому остатку</small></div>
      ${isAdmin()?'<div class="finance-management-actions reserve-actions"><button type="button" class="btn btn-primary" onclick="openReserveCorrection()">Корректировать резерв</button><button type="button" class="btn btn-secondary" onclick="openCompanyWithdrawal()">Вывести деньги</button></div>':''}
      <div class="finance-reserve-cards"><div><span>Выводов за всё время</span><strong>${money(withdrawals.reduce((s,x)=>s+num(x.amount),0))}</strong></div><div><span>Корректировок</span><strong>${corrections.length}</strong></div></div>
      <details class="finance-visual-disclosure"><summary>История резерва и выводов</summary><div class="finance-management-list">
        <div class="finance-management-row finance-opening-row"><div><strong>Стартовый резерв</strong><small>23.09.2026 · зафиксированный фактический остаток</small></div><div><b>+${money(190000)}</b></div></div>
        ${[...withdrawals.map(x=>({...x,_kind:'Вывод',_dir:-1,_date:x.expense_date})),...corrections].sort((a,b)=>String(b._date||'').localeCompare(String(a._date||''))).map(x=>`<div class="finance-management-row"><div><strong>${esc(x._kind||'Корректировка')}</strong><small>${esc(x._date||'')}${x.description?' · '+esc(x.description):''}</small></div><div><b class="${x._dir<0?'negative':''}">${x._dir<0?'−':'+'}${money(x.amount)}</b>${x._kind==='Вывод'&&isAdmin()?`<button type="button" class="icon-btn" title="Редактировать вывод" onclick="openCompanyExpenseSheet('${x.id}')">✎</button>`:''}</div></div>`).join('')}
      </div></details>`;
  }
  const flowReserve=document.querySelector('.finance-flow-node.reserve');
  if(flowReserve) flowReserve.innerHTML=`<span>Резерв компании</span><strong>${money(actualReserve)}</strong><small>Фактический остаток</small>`;
}
window.renderFinanceControls=renderFinanceControls;

const oldVisual=window.renderFinanceVisualPanels;
if(typeof oldVisual==='function'){
  window.renderFinanceVisualPanels=function(){
    const r=oldVisual.apply(this,arguments);
    try{renderFinanceControls();}catch(e){console.warn('[Finance controls]',e);}
    return r;
  };
}
const oldAll=window.renderAll;
if(typeof oldAll==='function'){
  window.renderAll=function(){
    const r=oldAll.apply(this,arguments);
    setTimeout(()=>{try{renderFinanceControls();}catch(e){}},0);
    return r;
  };
}
setTimeout(()=>{try{renderFinanceControls();}catch(e){console.warn('[Finance controls init]',e);}},1050);
})();



