// ============================================================
// P&L — Финансы компании
// ============================================================
let plPeriod = 'month';

function renderPL(){
    const el = document.getElementById('plBlock');
    if(!el) return;
    if(!session || (!session.isAdmin && !canSeeConstruction())){ el.innerHTML = ''; return; }

    const now = new Date();
    let fromDate;
    if(plPeriod === 'month'){
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if(plPeriod === 'quarter'){
          const q = Math.floor(now.getMonth() / 3);
          fromDate = new Date(now.getFullYear(), q * 3, 1);
  } else if(plPeriod === 'year'){
      fromDate = new Date(now.getFullYear(), 0, 1);
  } else {
        fromDate = new Date('2000-01-01');
  }

            const labels = {month:'Месяц', quarter:'Квартал', year:'Год', all:'Всё время'};

    const periodLedger = state.ledger.filter(e => {
      if(!e.entry_date) return false;
      return new Date(e.entry_date) >= fromDate;
  });

    const constrDept = state.departments.find(d=>d.name==='Строительный отдел');
    const constrProjects = state.projects.filter(p=>{
          const cat = state.categories.find(c=>c.id===p.category_id);
      if(!cat) return false;
      if(constrDept && cat.department_id===constrDept.id) return true;
      return (cat.name||'').toLowerCase().includes('строительств');
  });
    const constrIds = new Set(constrProjects.map(p=>p.id));

    const isProjectEntry = e => !constrIds.has(e.project_id);

    const projectIncome = periodLedger
      .filter(e => isProjectEntry(e) && ['advance','final_payment','income'].includes(e.type))
      .reduce((s,e) => s + (Number(e.amount)||0), 0);

    const materialsBudget = periodLedger
      .filter(e => isProjectEntry(e) && e.type === 'materials_budget')
      .reduce((s,e) => s + (Number(e.amount)||0), 0);

    const withdrawals = periodLedger
      .filter(e => isProjectEntry(e) && e.type === 'withdrawal')
      .reduce((s,e) => s + (Number(e.amount)||0), 0);

    const workerPayments = periodLedger
      .filter(e => isProjectEntry(e) && e.type === 'payment')
      .reduce((s,e) => s + (Number(e.amount)||0), 0);

    const otherExpenses = periodLedger
      .filter(e => isProjectEntry(e) && e.type === 'expense')
          .reduce((s,e) => s + (Number(e.amount)||0), 0);

    const totalExpenses = workerPayments + otherExpenses + withdrawals;

    const profit = projectIncome - totalExpenses;
    const profitColor = profit >= 0 ? 'var(--green)' : 'var(--red)';
    const profitSign = profit >= 0 ? '+' : '';

    const constrIncome = periodLedger
      .filter(e => constrIds.has(e.project_id) && ['advance','final_payment','income','materials_budget','construction_budget'].includes(e.type))
      .reduce((s,e) => s + (Number(e.amount)||0), 0);

    // Строительный: расходы фильтруем по тому же периоду что и приход (по invoice_date)
    const constrExpensesPeriod = state.invoices
      .filter(inv => {
        if(!constrIds.has(inv.project_id)) return false;
        if(plPeriod === 'all') return true;
        if(!inv.invoice_date) return false;
        return new Date(inv.invoice_date) >= fromDate;
      })
      .reduce((s,inv) => s + (Number(inv.amount)||0), 0);

    // Полные расходы по накладным (всё время) — для справки
    const constrExpensesAll = state.invoices
      .filter(inv => constrIds.has(inv.project_id))
      .reduce((s,inv) => s + (Number(inv.amount)||0), 0);

    const constrExpenses = constrExpensesPeriod;

    const constrProfit = constrIncome - constrExpenses;
    const constrProfitColor = constrProfit >= 0 ? 'var(--green)' : 'var(--red)';
    const constrProfitSign = constrProfit >= 0 ? '+' : '';

    const totalProfit = profit + constrProfit;
    const totalProfitColor = totalProfit >= 0 ? 'var(--green)' : 'var(--red)';
    const totalProfitSign = totalProfit >= 0 ? '+' : '';

    const totalDebt = state.projects
      .filter(p => !isConstructionProject(p) && Number(p.balance) > 0)
      .reduce((s,p) => s + (Number(p.balance)||0), 0);

    const constrBudgetLeft = constrProjects.reduce((s,p) => s + getConstructionFinancials(p).balance, 0);

    el.innerHTML = `
                                                  <div class="card" style="margin-bottom:10px;">

            <div style="display:flex; gap:6px; margin-bottom:14px; flex-wrap:nowrap; overflow-x:auto;">
          ${['month','quarter','year','all'].map(period=>`
            <div onclick="plPeriod='${period}'; renderPL();" style="
              flex:1; min-width:56px; text-align:center; padding:7px 4px;
              border-radius:8px; cursor:pointer; font-size:11px; font-weight:700;
              font-family:'Space Grotesk',sans-serif; white-space:nowrap;
              background:${plPeriod===period ? 'var(--blue-soft)' : 'rgba(22,35,58,0.05)'};
              color:${plPeriod===period ? 'var(--blue)' : 'var(--text-dim)'};
              border:1px solid ${plPeriod===period ? 'rgba(0,113,235,0.4)' : 'var(--line-strong)'};
            ">${labels[period]}</div>
          `).join('')}
</div>

        <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:var(--blue); font-weight:700; margin-bottom:8px;">▦ Проектный отдел</div>
        <div class="fee-row">
          <div class="fl">Получено от клиентов</div>
          <div class="fv" style="color:var(--green);">+${fmtMoney(projectIncome)}</div>
</div>
        ${materialsBudget > 0 ? `<div class="fee-row">
          <div class="fl" style="color:var(--text-dim);">Бюджет на материалы (проходные)</div>
          <div class="fv" style="color:var(--text-dim);">+${fmtMoney(materialsBudget)}</div>
                      </div>` : ''}
        ${workerPayments > 0 ? `<div class="fee-row">
                <div class="fl">Выплаты мастерам</div>
                        <div class="fv" style="color:var(--red);">−${fmtMoney(workerPayments)}</div>
</div>` : ''}
        ${otherExpenses > 0 ? `<div class="fee-row">
          <div class="fl">Прочие расходы</div>
                  <div class="fv" style="color:var(--red);">−${fmtMoney(otherExpenses)}</div>
</div>` : ''}
        ${withdrawals > 0 ? `<div class="fee-row">
          <div class="fl">Выводы средств</div>
                  <div class="fv" style="color:var(--text-dim);">−${fmtMoney(withdrawals)}</div>
</div>` : ''}
        <div class="fee-row total" style="border-top:1px solid var(--line-strong); margin-top:4px; padding-top:8px;">
          <div class="fl">Прибыль · ${labels[plPeriod]}</div>
            <div class="fv" style="color:${profitColor};">${profitSign}${fmtMoney(profit)}</div>
</div>

        ${constrProjects.length > 0 ? `
              <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:var(--blue); font-weight:700; margin:14px 0 8px;">🏗 Строительный отдел</div>
        <div class="fee-row">
          <div class="fl">Получено от заказчиков${plPeriod!=='all' ? ' · '+labels[plPeriod] : ''}</div>
          <div class="fv" style="color:var(--green);">+${fmtMoney(constrIncome)}</div>
                    </div>
                          <div class="fee-row">
          <div class="fl">Расход по накладным${plPeriod!=='all' ? ' · '+labels[plPeriod] : ' · всё время'}</div>
          <div class="fv" style="color:var(--red);">−${fmtMoney(constrExpenses)}</div>
                                          </div>
                                                <div class="fee-row">
          <div class="fl">Остатки бюджетов (текущие)</div>
                  <div class="fv" style="color:var(--gold);">${fmtMoney(constrBudgetLeft)}</div>
</div>
        <div class="fee-row total" style="border-top:1px solid var(--line-strong); margin-top:4px; padding-top:8px;">
                <div class="fl">Прибыль стройки (приход − расход)</div>
                        <div class="fv" style="color:${constrProfitColor};">${constrProfitSign}${fmtMoney(constrProfit)}</div>
</div>
        ${plPeriod !== 'all' ? `<div class="note" style="margin-top:4px; font-size:10.5px; color:var(--text-dim);">⚠ Накладные без даты не попадают в период — проверьте что даты заполнены. Итого по всем накладным за всё время: ${fmtMoney(constrExpensesAll)}.</div>` : ''}
        ` : ''}

        <div style="border-top:2px solid var(--line-strong); margin-top:14px; padding-top:10px;">
          <div class="fee-row total">
            <div class="fl" style="font-weight:700;">Общая прибыль компании</div>
            <div class="fv" style="color:${totalProfitColor}; font-size:16px;">${totalProfitSign}${fmtMoney(totalProfit)}</div>
</div>
</div>

        <div style="border-top:1px solid var(--line); margin-top:10px; padding-top:10px;">
          <div class="fee-row">
            <div class="fl" style="color:var(--text-dim);">Долг клиентов · Проектный</div>
            <div class="fv" style="color:var(--gold);">${fmtMoney(state.projects.filter(p=>!constrIds.has(p.id)).reduce((s,p)=>s+Math.max(0,Number(p.balance)||0),0))}</div>
          </div>
          ${constrProjects.length > 0 ? `<div class="fee-row">
            <div class="fl" style="color:var(--text-dim);">Долг клиентов · Строительный</div>
            <div class="fv" style="color:var(--gold);">${fmtMoney(Math.max(0, constrProjects.reduce((s,p)=>s+getConstructionFinancials(p).balance,0)))}</div>
          </div>` : ''}
          <div class="fee-row total" style="border-top:1px solid var(--line); margin-top:4px; padding-top:6px;">
            <div class="fl" style="color:var(--text-dim); font-weight:700;">Итого долг клиентов</div>
            <div class="fv" style="color:var(--gold); font-weight:700;">${fmtMoney(totalDebt)}</div>
          </div>
        </div>

        </div>
        `;
  }
  

