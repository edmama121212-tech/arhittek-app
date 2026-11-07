// ============================================================
// LEDGER
// ============================================================
const ledgerTypeLabels = {
  expense: {label:'Расход', cls:'var(--red)', sign:'−'},
  income: {label:'Доход', cls:'var(--green)', sign:'+'},
  advance: {label:'Аванс получен', cls:'var(--green)', sign:'+'},
  payment: {label:'Выплата мастеру', cls:'var(--red)', sign:'−'},
  final_payment: {label:'Оплата остатка', cls:'var(--green)', sign:'+'},
  materials_budget: {label:'Бюджет на материалы', cls:'var(--green)', sign:'+'},
  construction_budget: {label:'Бюджет строительства', cls:'var(--green)', sign:'+'},
  fee_payment: {label:'Выплата сотруднику по проекту', cls:'var(--red)', sign:'−'},
  withdrawal: {label:'Вывод средств', cls:'var(--red)', sign:'−'},
  client_refund: {label:'Возврат заказчику', cls:'var(--red)', sign:'−'},
  project_expense: {label:'Расход по проекту', cls:'var(--red)', sign:'−'},
  role_payout: {label:'Начисление исполнителю (м²)', cls:'var(--gold)', sign:'−'},
  bonus: {label:'Премия сотруднику', cls:'var(--gold)', sign:'−'},
  salary_payment: {label:'Выплата зарплаты', cls:'var(--green)', sign:'−'},
};

function renderFeeSummaryForProject(p){
  const el = document.getElementById('pf-compensation-summary');
  if(!el || !p) return;
  const f = getProjectFee(p);
  const baseLabel = f.feeBase === 'expenses' ? '% от прямых расходов' : f.feeBase === 'profit' ? '% после прямых расходов' : '% от выручки';
  const hasCoExec = !!p.co_employee_id;
  const expensesNote = '';
  el.innerHTML = `
    <div style="font-weight:700; font-size:13px; margin-bottom:6px;">Гонорар (${baseLabel})</div>
    <div class="fee-row"><div class="fl">Исполнитель — ${f.feePercent}%</div><div class="fv">${fmtMoney(f.mainFeeAmount)}</div></div>
    ${hasCoExec ? `<div class="fee-row"><div class="fl">Соисполнитель — ${f.coFeePercent}%</div><div class="fv">${fmtMoney(f.coFeeAmount)}</div></div>` : ''}
    ${expensesNote}
    <div class="fee-row"><div class="fl">Начислено всего</div><div class="fv">${fmtMoney(f.feeAmount)}</div></div>
    <div class="fee-row"><div class="fl">Выплачено всего</div><div class="fv">${fmtMoney(f.paid)}</div></div>
    <div class="fee-row remaining"><div class="fl">Осталось выплатить</div><div class="fv">${fmtMoney(Math.max(0,f.remaining))}</div></div>
  `;
}

function renderPaymentHistory(projectId){
  const container = document.getElementById('pf-payment-history');
  if(!container) return;
  const paymentTypes = ['advance','final_payment','materials_budget','construction_budget','income','fee_payment','withdrawal'];
  const entries = state.ledger
    .filter(l=>l.project_id===projectId && paymentTypes.includes(l.type))
    .sort((a,b)=> new Date(b.entry_date) - new Date(a.entry_date) || new Date(b.created_at) - new Date(a.created_at));

  if(!entries.length){
    container.innerHTML = '<div class="empty-state">Платежей пока нет</div>';
    return;
  }

  container.innerHTML = `<div class="section-label" style="margin:10px 0 8px;"><span class="lbl-text">История платежей</span><span class="section-label-line"></span></div>` +
    entries.map(e=>{
      const t = ledgerTypeLabels[e.type] || {label:e.type, cls:'var(--text)', sign:''};
      const emp = e.received_by ? findEmployee(e.received_by) : null;
      return `<div class="list-item">
        <div>
          <div class="li-name">${t.label} — <span style="color:${t.cls}">${t.sign}${fmtMoney(e.amount)}</span></div>
          <div class="li-meta">${fmtDate(e.entry_date)}${emp?' · принял: '+escapeHtml(emp.name):''}${e.description && e.description!==t.label?' · '+escapeHtml(e.description):''}</div>
        </div>
        <div class="li-actions">
          <button class="icon-btn danger" title="Отменить платёж" onclick="cancelPayment('${e.id}')">↩</button>
        </div>
      </div>`;
    }).join('');
}

// ---- Расходы проекта (несколько записей: на что + сумма + дата) ----
let editingProjectExpenseId = null;

function editProjectExpense(entryId){
  const e=(state.ledger||[]).find(x=>x.id===entryId && x.type==='project_expense');
  if(!e) return;
  editingProjectExpenseId=entryId;
  document.getElementById('pf-expense-desc').value=e.description||'';
  document.getElementById('pf-expense-amount').value=e.amount||'';
  document.getElementById('pf-expense-date').value=e.entry_date||'';
  const btn=document.getElementById('pf-expense-add-btn');
  if(btn) btn.textContent='Сохранить изменение';
  const cancel=document.getElementById('pf-expense-cancel-edit');
  if(cancel) cancel.style.display='';
  document.getElementById('pf-expense-desc')?.focus();
}

function resetProjectExpenseEditor(){
  editingProjectExpenseId=null;
  const btn=document.getElementById('pf-expense-add-btn');
  if(btn) btn.textContent='Добавить расход';
  const cancel=document.getElementById('pf-expense-cancel-edit');
  if(cancel) cancel.style.display='none';
  ['pf-expense-desc','pf-expense-amount','pf-expense-date'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
}

function renderProjectExpenses(projectId){
  const el = document.getElementById('pf-expenses-list');
  if(!el) return;
  if(!projectId){ el.innerHTML = ''; return; }
  const items = state.ledger
    .filter(l=>l.project_id===projectId && l.type==='project_expense')
    .sort((a,b)=> new Date(b.entry_date) - new Date(a.entry_date) || new Date(b.created_at) - new Date(a.created_at));
  if(!items.length){ el.innerHTML = '<div class="empty-state" style="padding:10px;">Расходов пока нет</div>'; return; }
  const total = items.reduce((s,e)=>s+Number(e.amount||0),0);
  el.innerHTML = `<div class="card" style="margin-bottom:0;">` + items.map(e=>`
    <div class="list-item">
      <div style="min-width:0;">
        <div class="li-name">${escapeHtml(e.description||'Расход')} — <span style="color:var(--red)">−${fmtMoney(e.amount)}</span></div>
        <div class="li-meta">${fmtDate(e.entry_date)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" title="Редактировать расход" onclick="editProjectExpense('${e.id}')">✏️</button>
        <button class="icon-btn danger" title="Удалить расход" onclick="deleteProjectExpense('${e.id}','${projectId}')">🗑</button>
      </div>
    </div>`).join('') +
    `<div class="list-item" style="border-top:1px solid var(--line-strong);">
      <div class="li-name" style="font-weight:700;">Итого расходов</div>
      <div class="li-name" style="font-weight:700;color:var(--red);">−${fmtMoney(total)}</div>
    </div></div>`;
}

// Пересчёт суммы расходов проекта и синхронизация p.expenses (используется в расчёте гонорара).
// Считаем и обычные расходы (project_expense), и начисления исполнителям по м² (role_payout) —
// последние тоже уменьшают прибыль/остаток компании по проекту.
async function syncProjectExpensesTotal(projectId){
  const p = state.projects.find(x=>x.id===projectId);
  if(!p) return 0;
  // role_payout — ФОТ, а не прямой расход проекта. Не записываем его в
  // projects.expenses, иначе он попадает в себестоимость и затем повторно в ФОТ.
  const total = isConstructionProject(p)?getProjectExpenses({...p,expenses:0}):(state.ledger||[]).filter(e=>e.project_id===projectId&&e.type==='project_expense'&&!e.deleted_at).reduce((sum,e)=>sum+(Number(e.amount)||0),0);
  const {error} = await sb.from('projects')
    .update({expenses: total, updated_at:new Date().toISOString()})
    .eq('id', projectId);
  if(error) throw error;
  return total;
}

