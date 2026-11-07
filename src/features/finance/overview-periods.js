// ============================================================
// АНАЛИТИКА — График P&L по месяцам (SVG)
// ============================================================
// ============================================================
// ФИНАНСЫ КОМПАНИИ (Обзор) — приход/расход/прибыль за период с разбивкой
// по направлениям и статьям расходов. Заменяет прежний график по месяцам.
// ============================================================
let financePeriodMode = 'month'; // 'month' | 'quarter' | 'year' | 'range'
let financeMonthValue = null;    // 'YYYY-MM'
let financeRangeFrom = null;
let financeRangeTo = null;
let financeExpanded = false;

function financeCurrentRange(){
  const today = new Date();
  if(financePeriodMode === 'range' && financeRangeFrom && financeRangeTo){
    return {from: financeRangeFrom, to: financeRangeTo};
  }
  if(financePeriodMode === 'quarter'){
    const q = Math.floor(today.getMonth()/3);
    const from = `${today.getFullYear()}-${String(q*3+1).padStart(2,'0')}-01`;
    const toMonth = q*3+3;
    const lastDay = new Date(today.getFullYear(), toMonth, 0).getDate();
    const to = `${today.getFullYear()}-${String(toMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    return {from, to};
  }
  if(financePeriodMode === 'year'){
    return {from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31`};
  }
  // month (по умолчанию)
  if(!financeMonthValue) financeMonthValue = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  return timesheetMonthRange(financeMonthValue);
}

function computeFinancePeriod(from, to){
  const {employees: earnedMap, revenue, projectCosts, byDeptProfit} = completedProjectEarningsForRange(from, to);
  const {payrollPaidOut, companyRetained} = splitPayrollByEmployee(earnedMap);

  let overhead = 0;
  const overheadByCat = {};
  (state.companyExpenses||[]).forEach(ex=>{
    if(!isOperationalCompanyExpense(ex)) return;
    if(!ex.expense_date || ex.expense_date < from || ex.expense_date > to) return;
    overhead += Number(ex.amount) || 0;
    overheadByCat[ex.category] = (overheadByCat[ex.category]||0) + (Number(ex.amount)||0);
  });

  const totalExpenses = projectCosts + payrollPaidOut + overhead;
  const netProfit = revenue - totalExpenses;

  return {revenue, projectCosts, byDeptProfit, payrollPaidOut, companyRetained, overhead, overheadByCat, totalExpenses, netProfit};
}

// Быстрая проверка финансовой целостности данных. Не изменяет БД — только
// сообщает о потенциальных расхождениях, чтобы их можно было исправить вручную.
function auditFinancialIntegrity(){
  const issues=[];
  (state.projects||[]).filter(p=>!p.deleted_at).forEach(p=>{
    const direct=getProjectExpenses(p);
    if(Number(p.expenses||0) < 0) issues.push(`Проект «${p.name}»: отрицательные расходы`);
    if(Number(p.price||0) < 0) issues.push(`Проект «${p.name}»: отрицательная цена`);
    if(Number(p.advance||0) > Number(p.price||0) && !isConstructionProject(p)) issues.push(`Проект «${p.name}»: аванс больше цены`);
    if(isConstructionProject(p)){
      const f=getConstructionFinancials(p);
      if(Math.abs(Number(p.expenses||0)-Number(f.directCosts||0))>0.01) issues.push(`Проект «${p.name}»: сохранённые расходы не совпадают с прямыми расходами`);
    } else if(Math.abs(Number(p.expenses||0)-Number(direct||0))>0.01 && (state.ledger||[]).some(e=>e.project_id===p.id && e.type==='project_expense' && !e.deleted_at)){
      issues.push(`Проект «${p.name}»: projects.expenses не совпадает с журналом расходов`);
    }
  });
  (state.ledger||[]).filter(e=>!e.deleted_at && e.type==='role_payout').forEach(e=>{
    if(!e.payee_employee_id) issues.push(`Начисление ${e.id}: не указан сотрудник`);
    if(Number(e.amount||0)<=0) issues.push(`Начисление ${e.id}: сумма должна быть больше нуля`);
  });
  return issues;
}

function financePeriodLabel(from, to){
  if(financePeriodMode === 'month') return ruMonthLabel(financeMonthValue);
  return `${fmtDate(from)} — ${fmtDate(to)}`;
}

function ruMonthLabel(monthStr){
  if(!monthStr) return '';
  const [y,m] = monthStr.split('-').map(Number);
  const names = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `${names[m-1]} ${y}`;
}

function setFinancePeriodMode(mode){
  financePeriodMode = mode;
  renderAnalytics();
}

function renderAnalytics(){
  const el = document.getElementById('analyticsBlock');
  if(!el) return;

  const {from, to} = financeCurrentRange();
  const f = computeFinancePeriod(from, to);
  const extraIncome = (state.companyIncome||[])
    .filter(i=>isOperationalCompanyIncome(i) && i.income_date && i.income_date>=from && i.income_date<=to)
    .reduce((s,i)=>s+(Number(i.amount)||0),0);
  const totalIncome = f.revenue + extraIncome;
  const companyResult = f.netProfit + extraIncome;
  const resultColor = companyResult >= 0 ? 'var(--green)' : 'var(--red)';

  const modes = [
    {id:'month', label:'Месяц'},
    {id:'quarter', label:'Квартал'},
    {id:'year', label:'Год'},
    {id:'range', label:'Период'},
  ];

  const deptOrder = ['Дизайн интерьера','Архитектура','Ландшафт','Строительство'];
  const deptRows = deptOrder.filter(d=>f.byDeptProfit[d]!==undefined).map(d=>
    `<div class="fee-row"><div class="fl">${escapeHtml(d)}</div><div class="fv" style="color:${f.byDeptProfit[d]>=0?'var(--green)':'var(--red)'};">${fmtMoney(f.byDeptProfit[d])}</div></div>`
  ).join('');

  const overheadCats = Object.keys(f.overheadByCat);
  const overheadRows = overheadCats.length ? overheadCats.map(cat=>
    `<div class="fee-row"><div class="fl">${escapeHtml(cat)}</div><div class="fv">${fmtMoney(f.overheadByCat[cat])}</div></div>`
  ).join('') : '<div class="note">Нет дополнительных расходов за период</div>';

  el.innerHTML = `
    <div class="finance-periods">
      ${modes.map(m=>`
        <button type="button" class="finance-period-btn ${financePeriodMode===m.id?'active':''}" onclick="setFinancePeriodMode('${m.id}')">${m.label}</button>
      `).join('')}
    </div>

    ${financePeriodMode==='month' ? `
      <div class="field finance-period-input">
        <label>Какой месяц смотрим</label>
        <input type="month" id="finance-month-input" value="${financeMonthValue||''}" onchange="financeMonthValue=this.value; renderAnalytics();">
      </div>` : ''}
    ${financePeriodMode==='range' ? `
      <div class="field-row finance-period-input">
        <div class="field"><label>С</label><input type="date" id="finance-from-input" value="${financeRangeFrom||''}" onchange="financeRangeFrom=this.value; renderAnalytics();"></div>
        <div class="field"><label>По</label><input type="date" id="finance-to-input" value="${financeRangeTo||''}" onchange="financeRangeTo=this.value; renderAnalytics();"></div>
      </div>` : ''}

    <div class="finance-kpi-grid">
      <div class="finance-kpi">
        <span>Заработали</span>
        <strong style="color:var(--green);">${fmtMoney(totalIncome)}</strong>
        <small>проекты + прочие доходы</small>
      </div>
      <div class="finance-kpi">
        <span>Начисленные расходы</span>
        <strong style="color:var(--red);">${fmtMoney(f.totalExpenses)}</strong>
        <small>проекты + начисления команде + офис</small>
      </div>
      <div class="finance-kpi finance-kpi-main">
        <span>Осталось компании</span>
        <strong style="color:${resultColor};">${fmtMoney(companyResult)}</strong>
        <small>${financePeriodLabel(from,to)}</small>
      </div>
    </div>

    <div class="finance-equation" aria-label="Расчёт результата периода">
      <div><span>Выручка проектов</span><b>+${fmtMoney(f.revenue)}</b></div>
      <div><span>Прочие доходы</span><b>+${fmtMoney(extraIncome)}</b></div>
      <div><span>Прямые расходы проектов</span><b>−${fmtMoney(f.projectCosts)}</b></div>
      <div><span>Начислено команде</span><b>−${fmtMoney(f.payrollPaidOut)}</b></div>
      <div><span>Офис и прочие расходы</span><b>−${fmtMoney(f.overhead)}</b></div>
      <div class="total"><span>Итого осталось</span><b style="color:${resultColor};">${fmtMoney(companyResult)}</b></div>
    </div>

    <div class="finance-note">Результат учитывает завершённые проекты, начисления команде и уже внесённые общие расходы. Неоплаченные обязательные расходы (например, аренда и интернет) отдельно учитываются ниже в блоке «Обязательства и оплаты». Будущие поступления смотрите в «Прогнозе».</div>

    <button type="button" class="finance-details-toggle" onclick="financeExpanded=!financeExpanded; renderAnalytics();">
      ${financeExpanded ? 'Скрыть подробности' : 'Показать подробности'}
      <span>${financeExpanded?'▴':'▾'}</span>
    </button>

    ${financeExpanded ? `
      <div class="section-label finance-inner-label"><span class="lbl-text">Результат по направлениям</span><span class="section-label-line"></span></div>
      <div class="fee-card">${deptRows || '<div class="note">Нет завершённых проектов за период</div>'}</div>

      <div class="section-label finance-inner-label"><span class="lbl-text">Расходы по статьям</span><span class="section-label-line"></span></div>
      <div class="fee-card">
        <div class="fee-row"><div class="fl">Прямые расходы проектов</div><div class="fv">${fmtMoney(f.projectCosts)}</div></div>
        <div class="fee-row"><div class="fl">Начислено команде</div><div class="fv">${fmtMoney(f.payrollPaidOut)}</div></div>
        <div class="fee-row total"><div class="fl">Общие расходы компании</div><div class="fv">${fmtMoney(f.overhead)}</div></div>
        ${overheadRows}
      </div>

      <div class="section-label finance-inner-label"><span class="lbl-text">Записи общих расходов</span><span class="section-label-line"></span></div>
      <div class="card" id="companyExpensesList" style="margin-bottom:8px;"></div>
      <button class="btn btn-secondary" onclick="openCompanyExpenseSheet(null)">+ Добавить расход</button>
    ` : ''}
  `;

  if(financeExpanded) renderCompanyExpensesList();
  renderCompanyBudget(from, to);
}

function escapeHtml(s){
  if(s==null) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// JSON string literals also need HTML attribute escaping in inline handlers.
function htmlJsArg(value){ return escapeHtml(JSON.stringify(String(value??''))); }

// Раздел «Финансы компании» → «Оклады»: сотрудники с фиксированной ЗП
// (Мансур, менеджер и т.п.) — показывает сам оклад независимо от того,
// участвует ли сотрудник в проектах (в отличие от «Табеля», где расчёт
// идёт от заработанного по проектам/начислениям).
function renderFinanceSalaries(){
  const el = document.getElementById('finSalariesCard');
  if(!el) return;
  const rows = state.employees.filter(e=>e.active!==false && e.is_salaried);
  if(!rows.length){
    el.innerHTML = '<div class="empty-state" style="padding:10px;">Нет сотрудников с фиксированной ЗП — включите «Фиксированная ЗП» в карточке сотрудника (Настройки → Сотрудники).</div>';
    return;
  }
  const total = rows.reduce((s,e)=>s+(Number(e.fixed_salary)||0),0);
  el.innerHTML = rows.map(e=>`
    <div class="list-item">
      <div class="li-name">${escapeHtml(e.name)}${e.role?' <span style="color:var(--text-dim);font-weight:400;">· '+escapeHtml(e.role)+'</span>':''}</div>
      <div class="proj-sum">${fmtMoney(Number(e.fixed_salary)||0)}</div>
    </div>`).join('') +
    `<div class="list-item" style="border-top:1px solid var(--line-strong);">
      <div class="li-name" style="font-weight:700;">Итого окладов в месяц</div>
      <div class="li-name" style="font-weight:700;">${fmtMoney(total)}</div>
    </div>`;
}

