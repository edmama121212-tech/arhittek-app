// ============================================================
// OVERVIEW
// ============================================================
// ============================================================
// СВОДКА ПО СТРОИТЕЛЬНЫМ ОБЪЕКТАМ (Обзор)
// ============================================================
function renderConstrSummary(){
  const el = document.getElementById('constrSummaryBlock');
  if(!el) return;

  const projects = getConstrProjects().filter(p=>findStatus(p.status_id)?.name!=='Завершён' && !isFrozen(p));
  if(!projects.length){
    el.innerHTML = '<div class="empty-state" style="padding:16px;">Нет строительных объектов</div>';
    return;
  }

  const rows = projects.map(p => {
    const fin = getConstructionFinancials(p);
    const st = findStatus(p.status_id);
    const invoicesTotal = Math.round((fin.matTotal + fin.workTotal + fin.otherTotal)*100)/100;
    return {p, ...fin, invoicesTotal, st};
  });

  const totExpenses = rows.reduce((s,r)=>s+r.cashOutgoing,0);
  const totReceived = rows.reduce((s,r)=>s+r.received,0);
  const totLeft = rows.reduce((s,r)=>s+r.cashRemaining,0);
  const totOverspend = rows.reduce((s,r)=>s+r.cashOverspend,0);
  const totInvoices = rows.reduce((s,r)=>s+r.invoicesTotal,0);
  const totUnpaid = rows.reduce((s,r)=>s+r.unpaidInvoices,0);
  const money = value => (Number(value)||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';

  const overspendNote = amount => amount > 0 ? '<div style="color:var(--red);font-size:11px">Перерасход: '+money(amount)+'</div>' : '';

  const rowsHtml = rows.map(({p, received, cashOutgoing, directPaid, cashRemaining, cashOverspend, isOverspent, invoicesTotal, unpaidInvoices, st}) => `
    <tr data-key-activate tabindex="0" onclick="openObjectView('${p.id}')" style="cursor:pointer;" class="constr-sum-row">
      <td>
        <div class="entity-name" title="${escapeHtml(p.name)}" style="font-weight:600; font-size:13px; color:var(--text);">${escapeHtml(p.name)}</div>
        ${st ? `<div style="font-size:10px; color:var(--text-dim); margin-top:2px;">${escapeHtml(st.name)}</div>` : ''}
      </td>
      <td style="color:${isOverspent ? 'var(--red)' : 'var(--text)'}; font-weight:${isOverspent ? '700' : '400'};" title="По денежному журналу объекта; прямые оплаты заказчика сюда не входят">${money(cashRemaining)}${directPaid > 0 ? ' 🤝' : ''}${overspendNote(cashOverspend)}</td>
      <td style="color:var(--red);">${money(cashOutgoing)}</td>
      <td style="color:var(--green);">${money(received)}</td>
      <td style="color:var(--text);" title="Стоимость накладных; наличие документа не подтверждает оплату">${money(invoicesTotal)}</td>
      <td style="color:${unpaidInvoices>0?'var(--gold)':'var(--text-dim)'};" title="Остаток накладных без подтверждённой оплаты">${money(unpaidInvoices)}</td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
    <table class="constr-sum-table">
      <thead><tr><th>Объект</th><th>Деньги по журналу</th><th>Выплачено</th><th>Получено</th><th>Накладные</th><th>Не оплачено</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td style="font-weight:700; color:var(--text);">Итого</td>
          <td style="font-weight:700; color:var(--gold);">${money(totLeft)}${overspendNote(totOverspend)}</td>
          <td style="font-weight:700; color:var(--red);">${money(totExpenses)}</td>
          <td style="font-weight:700; color:var(--green);">${money(totReceived)}</td>
          <td style="color:var(--text); font-weight:700;">${money(totInvoices)}</td>
          <td style="color:var(--gold); font-weight:700;">${money(totUnpaid)}</td>
        </tr>
      </tfoot>
    </table></div>
    <div class="note" style="padding:10px 14px;">Накладные — стоимость документов, а не подтверждённая выплата. «Не оплачено» — остаток накладных без оплаты. Если выплаты превышают поступления по объекту, разница показана как перерасход.</div>
  `;
}

function renderOverview(){
  document.getElementById('overviewLoading').style.display = 'none';
  document.getElementById('overviewContent').style.display = '';

  const doneStatus = state.statuses.find(s=>s.name==='Завершён');
  // Активные — не завершённые и не замороженные
  const activeProjects = state.projects.filter(p=>(!doneStatus || p.status_id !== doneStatus.id) && !isFrozen(p));
  const doneProjects = state.projects.filter(p=>doneStatus && p.status_id === doneStatus.id);

  // Реальный долг — только проектный отдел (архитектура/дизайн/ландшафт).
  // У строительных объектов остаток (balance) — это НЕ долг клиента, а ещё не
  // потраченный бюджет объекта (выделен заказчиком на материалы/работы),
  // поэтому такие объекты в «Должны клиенты» не входят.
  const totalDebt = state.projects
    .filter(p => Number(p.balance) > 0 && !isConstructionCategory(p.category_id))
    .reduce((s,p)=>s + (Number(p.balance)||0), 0);

  // overdue: end_date in the past and status not done (замороженные не считаются просроченными)
  const overdue = state.projects.filter(p=>{
    if(!p.end_date) return false;
    if(isFrozen(p)) return false;
    if(doneStatus && p.status_id === doneStatus.id) return false;
    const d = daysUntil(p.end_date);
    return d !== null && d < 0;
  });

  // Расхождение: статус «Оплачен» но balance > 0 (только проектный отдел, см. totalDebt выше)
  const mismatchCount = state.projects.filter(p=>Number(p.balance) > 0 && p.payment_status === 'Оплачен' && !isConstructionCategory(p.category_id)).length;

  const kpiGrid = document.getElementById('kpiGrid');
  kpiGrid.innerHTML = `
    <div data-key-activate tabindex="0" role="button" class="kpi accent-red" style="cursor:pointer;" onclick="document.getElementById('debtCard').scrollIntoView({behavior:'smooth'})">
      <div class="big" data-countup="${overdue.length}">0</div>
      <div class="lbl">Просрочки</div>
    </div>
    <div data-key-activate tabindex="0" role="button" class="kpi accent-gold" style="cursor:pointer;" onclick="document.getElementById('debtCard').scrollIntoView({behavior:'smooth'})">
      <div class="big">${fmt(totalDebt)} ₽</div>
      <div class="lbl">Должны клиенты${mismatchCount > 0 ? ` <span style="color:var(--red);">⚠${mismatchCount}</span>` : ''}</div>
    </div>
    <div class="kpi">
      <div class="big" data-countup="${activeProjects.length}">0</div>
      <div class="lbl">В работе</div>
    </div>
    <div class="kpi accent-green">
      <div class="big" data-countup="${doneProjects.length}">0</div>
      <div class="lbl">Завершено</div>
    </div>
  `;
  kpiGrid.querySelectorAll('[data-countup]').forEach(animateCountUp);

  // Долги и выручка — один объединённый список: проекты где balance > 0
  // (проектный отдел; строительные объекты не входят — там остаток это бюджет
  // объекта, а не долг клиента). Статус «Оплачен» но balance > 0 — расхождение,
  // помечается отдельно, но участвует в тех же итогах.
  const debts = state.projects
    .filter(p=>Number(p.balance) > 0 && p.payment_status !== 'Оплачен' && !isConstructionCategory(p.category_id))
    .sort((a,b)=>b.balance-a.balance);
  const mismatch = state.projects
    .filter(p=>Number(p.balance) > 0 && p.payment_status === 'Оплачен' && !isConstructionCategory(p.category_id));

  const debtCard = document.getElementById('debtCard');
  if(!debts.length && !mismatch.length){
    debtCard.innerHTML = '<div class="empty-state">Все проекты оплачены полностью</div>';
  }else{
    const rows = [...debts, ...mismatch].map(p=>{
      const balance = Number(p.balance) || 0;
      const expenses = getProjectExpenses(p);
      const f = getProjectFee(p);
      // Contract margin is independent of the client's outstanding debt.
      const feeTotal=f.feeAmount||0;
      const net=(Number(p.price)||0)-expenses-feeTotal;
      const isMismatch = p.payment_status === 'Оплачен';
      return {p, balance, expenses, net, feeTotal, isMismatch};
    }).sort((a,b)=>b.balance-a.balance);

    const totalBalance  = rows.reduce((s,r)=>s+r.balance,0);
    const totalNet      = rows.reduce((s,r)=>s+r.net,0);
    const totalFee      = rows.reduce((s,r)=>s+r.feeTotal,0);
    const totalExpenses = rows.reduce((s,r)=>s+r.expenses,0);

    const rowsHtml = rows.map(({p, balance, expenses, net, feeTotal, isMismatch})=>{
      const netColor = net < 0 ? 'var(--red)' : 'var(--green)';
      return `<tr data-key-activate tabindex="0" onclick="openProjectSheet('${p.id}')" style="cursor:pointer;" class="constr-sum-row">
        <td>
          <div class="entity-name" title="${escapeHtml(p.name)}" style="font-weight:600; font-size:12px; color:var(--text);">${escapeHtml(p.name)}</div>
          ${isMismatch ? `<div style="font-size:9px; color:var(--gold); margin-top:1px;">⚠ статус «Оплачен»</div>` : ''}
        </td>
        <td style="color:var(--gold);">${fmtMoney(balance)}</td>
        <td style="color:${netColor};">${fmtMoney(net)}</td>
        <td style="color:var(--blue);">${feeTotal > 0 ? fmtMoney(feeTotal) : '—'}</td>
        <td style="color:var(--text-dim);">${fmtMoney(expenses)}</td>
      </tr>`;
    }).join('');

    debtCard.innerHTML = `
      <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
      <table class="constr-sum-table">
        <thead>
          <tr>
            <th>Проект</th>
            <th>Долг</th>
            <th>Маржа проекта</th>
            <th>Начисления команде</th>
            <th>Затраты</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td style="font-weight:700; color:var(--text);">Итого</td>
            <td style="color:var(--gold);">${fmtMoney(totalBalance)}</td>
            <td style="color:${totalNet<0?'var(--red)':'var(--green)'};">${fmtMoney(totalNet)}</td>
            <td style="color:var(--blue);">${fmtMoney(totalFee)}</td>
            <td style="color:var(--text-dim);">${fmtMoney(totalExpenses)}</td>
          </tr>
        </tfoot>
      </table>
      </div><div class="note" style="padding:12px 18px">Маржа = цена проекта − прямые расходы − начисления команде. Оклады и общие издержки — в финансах компании.</div>`;
  }

  // Active projects with deadlines, sorted by days left
  const withDeadline = activeProjects.filter(p=>p.end_date).map(p=>({p, d:daysUntil(p.end_date)})).sort((a,b)=>a.d-b.d);
  const withoutDeadline = activeProjects.filter(p=>!p.end_date);
  const activeCard = document.getElementById('activeProjectsCard');
  if(!activeProjects.length){
    activeCard.innerHTML = '<div class="empty-state">Нет активных проектов</div>';
  }else{
    let html = '';
    withDeadline.forEach(({p,d})=>{
      const st = findStatus(p.status_id);
      let dateTxt, dateColor;
      if(d < 0){ dateTxt = `просрочен на ${Math.abs(d)} дн.`; dateColor = 'var(--red)'; }
      else if(d <= 7){ dateTxt = `${d} дн. до сдачи`; dateColor = 'var(--gold)'; }
      else { dateTxt = `${d} дн. до сдачи`; dateColor = 'var(--text-dim)'; }
      html += `<div data-key-activate tabindex="0" role="button" class="list-item" onclick="openProjectSheet('${p.id}')" style="cursor:pointer;">
        <div>
          <div class="li-name">${escapeHtml(p.name)}</div>
          <div class="li-meta">${st ? escapeHtml(st.name) : ''} · сдача ${fmtDate(p.end_date)}</div>
        </div>
        <div style="text-align:right;">
          <div class="proj-sum" style="font-size:12px; color:${dateColor};">${dateTxt}</div>
        </div>
      </div>`;
    });
    withoutDeadline.forEach(p=>{
      const st = findStatus(p.status_id);
      html += `<div data-key-activate tabindex="0" role="button" class="list-item" onclick="openProjectSheet('${p.id}')" style="cursor:pointer;">
        <div>
          <div class="li-name">${escapeHtml(p.name)}</div>
          <div class="li-meta">${st ? escapeHtml(st.name) : ''}</div>
        </div>
        <div class="proj-sum" style="font-size:12px; color:var(--text-dim);">без срока</div>
      </div>`;
    });
    activeCard.innerHTML = html;
  }

  // ---- Overdue stages notification block (admin only) ----
  const stagesNotifEl = document.getElementById('stagesNotifBlock');
  if(stagesNotifEl){
    const overdueStages = state.projectStages.filter(s=>{
      if(s.done || !s.due_date || daysUntil(s.due_date) >= 0) return false;
      const pr = state.projects.find(x=>x.id===s.project_id);
      if(!pr || isFrozen(pr) || findStatus(pr.status_id)?.name==='Завершён') return false;
      return true;
    });
    if(!overdueStages.length){
      stagesNotifEl.innerHTML = '';
    }else{
      stagesNotifEl.innerHTML = `
        <div class="section-label"><span class="lbl-text">⚠ Просроченные этапы</span><span class="section-label-line"></span></div>
        <div class="card">
          ${overdueStages.map(s=>{
            const p = state.projects.find(x=>x.id===s.project_id);
            return `<div data-key-activate tabindex="0" role="button" class="list-item" onclick="openProjectSheet('${s.project_id}')" style="cursor:pointer;">
              <div>
                <div class="li-name">${escapeHtml(s.name)}</div>
                <div class="li-meta" style="color:var(--red);">${p ? escapeHtml(p.name) : ''} · срок был ${fmtDate(s.due_date)} · ${Math.abs(daysUntil(s.due_date))} дн. назад</div>
              </div>
              <div class="status-chip overdue">просрочен</div>
            </div>`;
          }).join('')}
        </div>`;
    }
  }

  // ---- Сводка по стройке ----
  renderConstrSummary();

  // ---- Активные проекты: Дизайн / Архитектура (вместо P&L на Обзоре) ----
  renderActiveDeptSplit();
  renderAnalytics();
}

