// ============================================================
// ОБЩИЙ БЮДЖЕТ КОМПАНИИ («котёл») — резерв и амортизация
// ------------------------------------------------------------
// ИСПРАВЛЕНО (сентябрь 2026, после замечания пользователя): раньше здесь
// суммировался ВЕСЬ денежный поток объекта стройки (аванс/оплата остатка/
// бюджет материалов) как будто это доход компании — это неверно: в бюджет
// стройки заходят деньги клиента на материалы/работы, это отражается только
// в карточке объекта, компании реально остаётся только прибыль (после вычета
// расходов объекта и гонорара исполнителя). То же для проектов — цена
// проекта не равна прибыли компании, пока не вычтены расходы и гонорар.
//
// Поэтому здесь используется computeFinancePeriod() — та же функция, что
// считает уже проверенный блок «Приход/расход/прибыль» выше (revenue минус
// расходы проектов/стройки минус реально выплаченные ЗП/гонорары минус
// постоянные издержки = netProfit). К netProfit добавляется доход от аренды
// помещений (не завязан на проекты).
//
// Пока считается по той же базе, что и «Приход/расход/прибыль» — по
// завершённым проектам/дате сдачи, а не по кассовому методу (по факту
// оплаты). Строгий кассовый метод по датам платежей — отдельная, более
// аккуратная переделка, чтобы не наступить на те же грабли ещё раз.
function renderCompanyBudget(from, to){
  const el = document.getElementById('companyBudgetBlock');
  if(!el) return;

  const fromStr = from instanceof Date ? from.toISOString().slice(0,10) : from;
  const toStr = to instanceof Date ? to.toISOString().slice(0,10) : to;
  const fin = computeFinancePeriod(fromStr, toStr);
  const extraIncome = (state.companyIncome||[])
    .filter(i=>isOperationalCompanyIncome(i) && i.income_date && (!fromStr||i.income_date>=fromStr) && (!toStr||i.income_date<=toStr))
    .reduce((s,i)=>s+(Number(i.amount)||0),0);
  const periodResult = fin.netProfit + extraIncome;
  const amortizationReference = periodResult > 0 ? periodResult * 0.1 : 0;
  const reserve = getCompanyReserveBalance();
  const withdrawals = getCompanyWithdrawals(fromStr,toStr);
  const withdrawnPeriod = withdrawals.reduce((s,i)=>s+(Number(i.amount)||0),0);
  const color = v => v >= 0 ? 'var(--green)' : 'var(--red)';

  el.innerHTML = `
    <div class="fee-row total">
      <div class="fl">Учётный резерв компании</div>
      <div class="fv" style="color:var(--gold);font-size:17px;">${fmtMoney(reserve)}</div>
    </div>
    <div class="fee-row">
      <div class="fl">Выведено денег за период</div>
      <div class="fv" style="color:var(--red);">−${fmtMoney(withdrawnPeriod)}</div>
    </div>
    <div class="note" style="margin-top:10px;">
      Стартовый учётный резерв: ${fmtMoney(RESERVE_OPENING_BALANCE)} на ${RESERVE_OPENING_DATE}.
      Резерв можно корректировать по фактическому остатку. Вывод денег уменьшает резерв, но не искажает операционные расходы компании.
    </div>
  `;

  renderCompanyIncomeList();
}
function renderFeeCalc(){
  const list = document.getElementById('feeCalcList');
  if(!list) return;
  // Only show projects with price > 0
  const projects = state.projects.filter(p=>Number(p.price) > 0);
  if(!projects.length){
    list.innerHTML = '<div class="empty-state">Нет проектов для расчёта</div>';
    return;
  }
  list.innerHTML = projects.map(p=>{
    const f = getProjectFee(p);
    const cat = findCategory(p.category_id);
    const emp = findEmployee(p.employee_id);
    const baseLabel = f.feeBase === 'expenses' ? '% от расходов' : '% от цены';
    return `<div class="fee-card">
      <div style="font-weight:700; font-size:13.5px; margin-bottom:2px;">${escapeHtml(p.name)}</div>
      <div class="li-meta" style="margin-bottom:8px;">${cat?escapeHtml(cat.name):''}${emp?' · '+escapeHtml(emp.name):''}</div>
      <div class="fee-row"><div class="fl">Цена проекта</div><div class="fv">${fmtMoney(p.price)}</div></div>
      <div class="fee-row"><div class="fl">Расходы</div><div class="fv">${fmtMoney(getProjectExpenses(p))}</div></div>
      <div class="fee-row"><div class="fl">Прибыль</div><div class="fv">${fmtMoney(f.profit)}</div></div>
      <div class="fee-row"><div class="fl">Ставка (${baseLabel})</div><div class="fv">${f.feePercent}%</div></div>
      <div class="fee-row total"><div class="fl">Гонорар начислен</div><div class="fv">${fmtMoney(f.feeAmount)}</div></div>
      <div class="fee-row"><div class="fl">Уже выплачено</div><div class="fv">${fmtMoney(f.paid)}</div></div>
      <div class="fee-row remaining"><div class="fl">Осталось выплатить</div><div class="fv">${fmtMoney(f.remaining)}</div></div>
    </div>`;
  }).join('');
}

