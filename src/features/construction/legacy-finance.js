// ============================================================
// CONSTRUCTION OBJECTS (Строительный отдел)
// ============================================================
// ============================================================
// ЕДИНЫЙ РАСЧЁТ ФИНАНСОВ СТРОИТЕЛЬНОГО ОБЪЕКТА
// ============================================================
const CONSTRUCTION_INCOME_TYPES = ['advance','final_payment','materials_budget','construction_budget','income'];

function isConstructionProject(p){
  if(!p) return false;
  const cat = findCategory(p.category_id);
  const constrDept = state.departments.find(d=>d.name==='Строительный отдел');
  if(cat){
    if(constrDept && cat.department_id === constrDept.id) return true;
    const nm = (cat.name||'').toLowerCase();
    if(nm.includes('строительств') || nm.includes('ремонт') || nm.includes('монтаж')) return true;
  }
  return (state.invoices||[]).some(inv=>inv.project_id===p.id&&!inv.deleted_at);
}

function getConstructionReceived(projectId, ledgerOverride=null){
  const ledger = ledgerOverride || state.ledger || [];
  return ledger
    .filter(e => e.project_id === projectId && CONSTRUCTION_INCOME_TYPES.includes(e.type) && !e.deleted_at)
    .reduce((s,e) => s + Number(e.amount||0), 0);
}

function getConstructionExpenses(p, ledgerOverride=null){
  const today=financeToday();
  const projInvoices = (state.invoices||[]).filter(inv=>inv.project_id===p.id && !inv.deleted_at && (!inv.invoice_date||inv.invoice_date<=today));
  const matTotal = projInvoices
    .filter(i=>['Материал','Инструмент','Расходник','Доставка'].includes(i.item_type))
    .reduce((s,i)=>s+Number(i.amount||0),0);
  const workTotal = projInvoices
    .filter(i=>i.item_type==='Работа')
    .reduce((s,i)=>s+Number(i.amount||0),0);
  const otherTotal = projInvoices
    .filter(i=>!['Материал','Инструмент','Расходник','Доставка','Работа'].includes(i.item_type))
    .reduce((s,i)=>s+Number(i.amount||0),0);
  const directPaid = projInvoices.filter(i=>i.paid_by_client).reduce((sum,i)=>sum+Number(i.amount||0),0);
  const manualTotal = (ledgerOverride||state.ledger||[])
    .filter(e=>e.project_id===p.id && !e.deleted_at && (!e.entry_date||e.entry_date<=today) && (['expense','project_expense'].includes(e.type)||(e.type==='payment'&&!e.payee_employee_id)) && !['client_refund','cash_handover','company_fee_expense'].includes(e.purpose) && e.funding_source!=='company_fee' && !isInvoiceLinkedExpense(e))
    .reduce((s,e)=>s+Number(e.amount||0),0);
  return {matTotal, workTotal, otherTotal, manualTotal, directPaid, expenses: matTotal + workTotal + otherTotal + manualTotal};
}

function constructionAmount(value){
  return value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2});
}
function constructionMoney(value){return constructionAmount(value)+(value===null||value===undefined?'':' ₽');}
function constructionCompanyMarkup(p,costBase){
  const raw=p.fee_percent,number=Number(raw);
  const rate=raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(number)&&number>=0&&number<=100&&Math.abs(number*100-Math.round(number*100))<0.000001?number:null;
  const cost=Number(costBase??0),roundedMinor=Number.isFinite(cost)&&cost>=0?Math.round(cost*100):null;
  const minor=Number.isSafeInteger(roundedMinor)?roundedMinor:null;
  const base=minor===null?null:minor/100;
  const feeMinor=rate===null||minor===null?null:Number((BigInt(minor)*BigInt(Math.round(rate*100))+5000n)/10000n);
  const amount=feeMinor===null?null:feeMinor/100;
  return {companyMarkupRate:rate,companyMarkupBase:base,companyMarkupAmount:amount,
    totalWithMarkup:amount===null||!Number.isSafeInteger(minor+feeMinor)?null:(minor+feeMinor)/100,
    companyMarkupRecordedPaid:Math.max(0,Number(p.fee_paid)||0)};
}

function getConstructionFinancials(p, ledgerOverride=null){
  const {matTotal, workTotal, otherTotal, manualTotal, directPaid, expenses: directCosts} = getConstructionExpenses(p,ledgerOverride);
  const today=financeToday(),ledger = (ledgerOverride || state.ledger || []).filter(e=>!e.deleted_at&&(!e.entry_date||e.entry_date<=today));
  const received = getConstructionReceived(p.id, ledger);
  const rolePayouts = ledger
    .filter(e=>e.project_id===p.id && e.type==='role_payout' && !e.deleted_at)
    .reduce((s,e)=>s+Number(e.amount||0),0);
  // Документ и начисление описывают стоимость/обязательство, а не выплату.
  // Прямая оплата клиента не проходит через кассу компании.
  const totalCosts = directCosts + rolePayouts;
  const outgoingTypes=['expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund'];
  const paidRows=ledger.filter(e=>e.project_id===p.id&&outgoingTypes.includes(e.type)&&
    !(e.type==='project_expense'&&(e.description==='Ранее внесённые расходы'||String(e.description||'').startsWith('[cash:historical-expense]'))));
  const cashOutgoing=Math.round(paidRows.reduce((s,e)=>s+Number(e.amount||0),0)*100)/100;
  const balance = Math.round((received-cashOutgoing)*100)/100;
  const projectInvoices=(state.invoices||[]).filter(i=>i.project_id===p.id&&!i.deleted_at&&!i.paid_by_client&&(!i.invoice_date||i.invoice_date<=today));
  const unpaidInvoices=Math.round(projectInvoices.reduce((sum,i)=>sum+(window.ARHITTEKCash?.invoicePaymentState({ledger},i,today).remaining??Number(i.amount||0)),0)*100)/100;
  const undatedCashRows=ledger.filter(e=>e.project_id===p.id&&!e.entry_date&&(CONSTRUCTION_INCOME_TYPES.includes(e.type)||outgoingTypes.includes(e.type))).length;
  const pct = received > 0 ? Math.max(0,Math.min(100,Math.round(cashOutgoing/received*100))) : cashOutgoing>0?100:0;
  const markup=constructionCompanyMarkup(p,directCosts);
  // A document-based advance calculation is separate from cash history. A
  // direct client purchase funds the same document without entering our cash.
  const costFromAdvance=markup.companyMarkupBase===null?null:Math.round((markup.companyMarkupBase-directPaid)*100)/100;
  const calculatedAdvanceBalance=markup.companyMarkupAmount===null||costFromAdvance===null?null:Math.round((received-costFromAdvance-markup.companyMarkupAmount)*100)/100;
  const countedAgainstAdvance=markup.companyMarkupAmount===null||costFromAdvance===null?null:costFromAdvance+markup.companyMarkupAmount;
  const documentaryPct=countedAgainstAdvance===null?null:received>0?Math.max(0,Math.min(100,Math.round(countedAgainstAdvance/received*100))):countedAgainstAdvance>0?100:0;
  return {received, directPaid, matTotal, workTotal, otherTotal, manualTotal, rolePayouts,
    directCosts, expenses: totalCosts, cashOutgoing, unpaidInvoices, undatedCashRows,
    balance, pct, isOverspent: balance < 0,...markup,costFromAdvance,calculatedAdvanceBalance,documentaryPct,
    isCalculatedDeficit:calculatedAdvanceBalance!==null&&calculatedAdvanceBalance<0};
}

function syncConstructionProjectBalance(p, ledgerOverride=null){
  if(!p || !isConstructionProject(p)) return null;
  const f = getConstructionFinancials(p, ledgerOverride);
  return f;
}

function calcConstrFee(p){
  // Строительный процент — открытая наценка компании. Наличие исполнителя
  // не превращает эту сумму в его личное начисление. Выплаты за работы
  // учитываются отдельными записями, существующие условия/суммы не меняем.
  const price = Number(p.price)||0;
  const expenses = Number(p.expenses)||0;
  const profit = price - expenses;
  return {feePercent:0,feeBase:'expenses',coFeePercent:0,profit,feeAmount:0,paid:0,remaining:0,
    mainFeeAmount:0,coFeeAmount:0,mainPaid:0,coPaid:0,grossMainFee:0,companyExpenseShare:0,
    ...constructionCompanyMarkup(p,expenses)};
}

function getConstrProjects(){
  return state.projects.filter(p=>isConstructionProject(p));
}

let activeConstrStatusFilter = 'all';
let constrSearchQuery = '';

function renderConstrStatusFilters(){
  const el = document.getElementById('constrStatusFilters');
  if(!el) return;
  let html = `<div class="filter-chip ${activeConstrStatusFilter==='all'?'active':''}" data-cst="all">Все</div>`;
  state.statuses.forEach(s=>{
    html += `<div class="filter-chip ${activeConstrStatusFilter===s.id?'active':''}" data-cst="${s.id}">${escapeHtml(s.name)}</div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('.filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      activeConstrStatusFilter = chip.dataset.cst;
      renderConstrStatusFilters();
      renderConstruction();
    });
  });
}

function renderConstruction(){
  const list = document.getElementById('constructionList');
  let projects = getConstrProjects();

  if(session && !session.isAdmin) projects = projects.filter(p=>isProjectMember(p.id));
  const completedStatus = state.statuses.find(s=>s.name==='Завершён');
  if(activeConstrStatusFilter !== 'all') projects = projects.filter(p=>p.status_id === activeConstrStatusFilter);
  else if(completedStatus) projects = projects.filter(p=>p.status_id !== completedStatus.id);
  if(constrSearchQuery.trim()){
    const q = constrSearchQuery.trim().toLowerCase();
    projects = projects.filter(p=>(p.name||'').toLowerCase().includes(q) || (p.address||'').toLowerCase().includes(q));
  }

  if(!projects.length){
    const isFiltered = activeConstrStatusFilter !== 'all' || constrSearchQuery.trim();
    list.innerHTML = `<div class="empty-state">${isFiltered ? 'Нет объектов по этому фильтру' : '<div style="font-size:32px;margin-bottom:10px;">🏗</div><div>Объектов строительства пока нет</div><button class="btn btn-primary" style="margin-top:14px;width:auto;padding:10px 24px;" onclick="document.querySelector(\'.fab\').click()">+ Добавить объект</button>'}</div>`;
    return;
  }

  const showFinance = !session || session.isAdmin;

  list.innerHTML = projects.map(p=>{
    const st = findStatus(p.status_id);
    const fin = getConstructionFinancials(p);
    const {received, directPaid, matTotal, workTotal, otherTotal, manualTotal, expenses, cashOutgoing, unpaidInvoices, balance, pct, isOverspent} = fin;

    if(!showFinance){
      return `<div class="obj-card" onclick="openObjectView('${p.id}')">
        <div class="obj-head"><div><div class="obj-title">${escapeHtml(p.name)}</div><div class="obj-sub">${escapeHtml(p.address||'Нажмите для просмотра')}</div></div><div class="obj-chevron">›</div></div>
        ${st ? `<div class="status-chip" data-status="${escapeHtml(st.name)}" style="margin-top:8px; display:inline-block;">${escapeHtml(st.name)}</div>` : ''}
        <div class="obj-bar" style="margin-top:10px;"><i style="width:${pct}%"></i></div>
        <div class="obj-bar-lbl"><span>Выплачено ${pct}%</span><span>${(state.invoices||[]).filter(i=>i.project_id===p.id&&!i.deleted_at).length} записей</span></div>
      </div>`;
    }

    return `<div class="obj-card" onclick="openObjectView('${p.id}')">
      <div class="obj-head"><div><div class="obj-title">${escapeHtml(p.name)}</div><div class="obj-sub">${escapeHtml(p.address||'')}</div></div><div style="display:flex; align-items:center; gap:6px;">${st ? `<span class="status-chip" data-status="${escapeHtml(st.name)}">${escapeHtml(st.name)}</span>` : ''}<div class="obj-chevron">›</div></div></div>
      <div class="obj-bar" style="margin-bottom:4px;"><i style="width:${pct}%; background:${pct>90?'var(--red)':pct>70?'var(--gold)':'var(--blue)'};"></i></div>
      <div class="obj-bar-lbl"><span>Выплачено ${pct}% от полученного</span><span style="color:${isOverspent?'var(--red)':''}">${isOverspent ? '⚠ Недостаток: '+fmtMoney(Math.abs(balance)) : 'Деньги: '+fmtMoney(balance)}</span></div>
      <div style="margin-top:12px;">
        <div class="fee-row" style="padding:5px 0;"><div class="fl">💰 Приход от заказчика</div><div class="fv" style="color:var(--green);">${fmtMoney(received)}</div></div>
        <div class="fee-row" style="padding:5px 0;"><div class="fl">📦 Накладные на материалы</div><div class="fv">${fmtMoney(matTotal)}</div></div>
        <div class="fee-row" style="padding:5px 0;"><div class="fl">🔨 Накладные на работы</div><div class="fv">${fmtMoney(workTotal)}</div></div>
        ${otherTotal>0?`<div class="fee-row" style="padding:5px 0;"><div class="fl">Прочие накладные</div><div class="fv">${fmtMoney(otherTotal)}</div></div>`:''}
        ${manualTotal>0?`<div class="fee-row" style="padding:5px 0;"><div class="fl">Расходы без накладной</div><div class="fv">${fmtMoney(manualTotal)}</div></div>`:''}
        ${directPaid > 0 ? `<div class="fee-row" style="padding:5px 0;"><div class="fl">🤝 Оплачено заказчиком напрямую</div><div class="fv" style="color:var(--text-dim);">${fmtMoney(directPaid)}</div></div>` : ''}
        <div class="fee-row" style="padding:5px 0; border-top:1px solid var(--line); margin-top:2px;"><div class="fl">Выплачено из денег объекта</div><div class="fv" style="color:var(--red);">${fmtMoney(cashOutgoing)}</div></div>
        <div class="fee-row" style="padding:5px 0;"><div class="fl">Оплата накладных не подтверждена</div><div class="fv">${fmtMoney(unpaidInvoices)}</div></div>
        <div class="fee-row" style="padding:5px 0;"><div class="fl">Наценка ARHITTEK ${fin.companyMarkupRate===null?'не задана':constructionAmount(fin.companyMarkupRate)+'%'} по документам</div><div class="fv" style="color:var(--blue);">${constructionMoney(fin.companyMarkupAmount)}</div></div>
        <div class="fee-row" style="padding:5px 0;"><div class="fl">Расходы с наценкой</div><div class="fv">${constructionMoney(fin.totalWithMarkup)}</div></div>
      </div>
    </div>`;
  }).join('');
}

