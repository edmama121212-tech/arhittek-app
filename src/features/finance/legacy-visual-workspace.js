/* ARHITTEK FINANCE VISUAL WORKSPACE V2 */
(()=>{
'use strict';

const view=document.getElementById('view-finance');
if(!view || window.__arhittekFinanceVisualV2) return;
window.__arhittekFinanceVisualV2=true;

const byId=id=>document.getElementById(id);
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const cash=v=>{try{return fmtMoney(Math.round(n(v)));}catch(e){return Math.round(n(v)).toLocaleString('ru-RU')+' ₽';}};
const esc=v=>{try{return escapeHtml(v);}catch(e){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}};
const inRange=(d,from,to)=>!!d && (!from||d>=from) && (!to||d<=to);

function period(){
  try{return financeCurrentRange();}catch(e){
    const d=new Date(), y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0');
    const last=new Date(y,d.getMonth()+1,0).getDate();
    return {from:`${y}-${m}-01`,to:`${y}-${m}-${String(last).padStart(2,'0')}`};
  }
}
function periodName(from,to){
  try{return financePeriodLabel(from,to);}catch(e){return `${from||''} — ${to||''}`;}
}
function completedRows(from,to){
  return (state.projects||[]).filter(p=>{
    if(p.deleted_at) return false;
    const st=typeof findStatus==='function'?findStatus(p.status_id):null;
    if(!st || st.name!=='Завершён') return false;
    const d=typeof timesheetProjectRefDate==='function'?timesheetProjectRefDate(p):(p.end_date||'');
    return inRange(d,from,to);
  }).map(p=>{
    let revenue=0, cost=0;
    try{
      if(isConstructionCategory(p.category_id)){
        const f=getConstructionFinancials(p);
        revenue=n(f.received)+n(f.directPaid);
        cost=n(f.directCosts);
      }else{
        revenue=n(p.price);
        cost=n(getProjectExpenses(p));
      }
    }catch(e){revenue=n(p.price);cost=n(p.expenses);}
    let dept='Проекты';
    try{dept=financeDeptOf(p)||dept;}catch(e){}
    return {p,revenue,cost,dept};
  }).sort((a,b)=>b.revenue-a.revenue);
}
function payrollRows(from,to){
  try{
    const earned=completedProjectEarningsForRange(from,to).employees;
    const split=splitPayrollByEmployee(earned).result;
    return payrollEmployees().filter(e=>e.active!==false&&!e.deleted_at || n(split[e.id]?.payout)>0).map(e=>{
      const row=split[e.id]||{salary:0,earned:0,payout:0};
      const method=n(row.salary)>0?'Оклад'+(n(row.earned)>0?' + проекты':''):(n(row.earned)>0?'По проектам':'Без начислений');
      return {employee:e,salary:n(row.salary),earned:n(row.earned),payout:n(row.payout),method};
    }).sort((a,b)=>b.payout-a.payout);
  }catch(e){return [];}
}
function removeLabelBefore(el){
  const prev=el?.previousElementSibling;
  if(prev?.classList?.contains('section-label')) prev.remove();
}
function moveWithLabelRemoved(el,target){
  if(!el||!target) return;
  removeLabelBefore(el);
  target.appendChild(el);
}

const oldHeader=byId('financeBack')?.parentElement;
if(oldHeader) oldHeader.style.display='none';
view.querySelector('.finance-intro')?.remove();

const tabs=document.createElement('div');
tabs.id='financeVisualTabs';
tabs.className='finance-visual-tabs';
tabs.setAttribute('role','tablist');
tabs.innerHTML=[
  ['overview','Обзор'],
  ['income','Доходы'],
  ['expense','Расходы'],
  ['team','Команда'],
  ['forecast','Прогноз'],
  ['reserve','Резерв'],
  ['amortization','Амортизация']
].map(([id,label])=>`<button type="button" role="tab" data-fin-tab="${id}">${label}</button>`).join('');

const workspaceHead=view.querySelector('.workspace-head');
if(workspaceHead) workspaceHead.insertAdjacentElement('afterend',tabs);
else view.prepend(tabs);

const panels=document.createElement('div');
panels.className='finance-visual-panels';
tabs.insertAdjacentElement('afterend',panels);

function makePanel(id){
  const el=document.createElement('section');
  el.className='finance-visual-panel';
  el.dataset.finPanel=id;
  el.hidden=true;
  panels.appendChild(el);
  return el;
}
const overview=makePanel('overview');
const income=makePanel('income');
const expense=makePanel('expense');
const team=makePanel('team');
const forecast=makePanel('forecast');
const reserve=makePanel('reserve');
makePanel('amortization');

const analytics=byId('analyticsBlock');
moveWithLabelRemoved(analytics,overview);
const flow=document.createElement('div');
flow.id='financeFlowMap';
overview.appendChild(flow);

const incomeVisual=document.createElement('div');
incomeVisual.id='financeIncomeVisual';
income.appendChild(incomeVisual);
const companyIncome=byId('companyIncomeList');
moveWithLabelRemoved(companyIncome,income);
const incomeButton=[...view.querySelectorAll('button')].find(b=>(b.getAttribute('onclick')||'').includes('openCompanyIncomeSheet'));
if(incomeButton) income.appendChild(incomeButton);

const expenseVisual=document.createElement('div');
expenseVisual.id='financeExpenseVisual';
expense.appendChild(expenseVisual);
const expenseButton=document.createElement('button');
expenseButton.type='button';
expenseButton.className='btn btn-secondary finance-add-action';
expenseButton.textContent='+ Добавить расход';
expenseButton.onclick=()=>{try{openCompanyExpenseSheet(null);}catch(e){}};
expense.appendChild(expenseButton);

const teamVisual=document.createElement('div');
teamVisual.id='financeTeamVisual';
team.appendChild(teamVisual);
const salaryCard=byId('finSalariesCard');
if(salaryCard){
  removeLabelBefore(salaryCard);
  const details=document.createElement('details');
  details.className='finance-visual-disclosure';
  details.innerHTML='<summary>Показать только фиксированные оклады</summary>';
  details.appendChild(salaryCard);
  team.appendChild(details);
}

const forecastWrap=view.querySelector('.forecast-wrap');
if(forecastWrap) forecast.appendChild(forecastWrap);

const reserveVisual=document.createElement('div');
reserveVisual.id='financeReserveVisual';
reserve.appendChild(reserveVisual);
const budget=byId('companyBudgetBlock');
moveWithLabelRemoved(budget,reserve);

function setTab(id,remember=true){
  const valid=['overview','income','expense','team','forecast','reserve','amortization'];
  if(!valid.includes(id)) id='overview';
  tabs.querySelectorAll('[data-fin-tab]').forEach(b=>{
    const on=b.dataset.finTab===id;
    b.classList.toggle('active',on);
    b.setAttribute('aria-selected',on?'true':'false');
  });
  panels.querySelectorAll('.finance-visual-panel').forEach(p=>p.hidden=p.dataset.finPanel!==id);
  if(remember){try{sessionStorage.setItem('arhittek_finance_tab',id);}catch(e){}}
  if(id==='forecast'){try{window.renderFinancialForecast?.();}catch(e){}}
  if(id==='reserve'){try{const r=period();renderCompanyBudget?.(r.from,r.to);}catch(e){}}
}
tabs.addEventListener('click',e=>{
  const b=e.target.closest('[data-fin-tab]');
  if(b) setTab(b.dataset.finTab);
});
window.setFinanceVisualTab=setTab;

function renderVisuals(){
  const {from,to}=period();
  let f;
  try{f=computeFinancePeriod(from,to);}catch(e){return;}
  const extras=(state.companyIncome||[]).filter(i=>!i.deleted_at && (typeof isOperationalCompanyIncome!=='function' || isOperationalCompanyIncome(i)) && inRange(i.income_date,from,to));
  const extraTotal=extras.reduce((s,i)=>s+n(i.amount),0);
  const totalIncome=n(f.revenue)+extraTotal;
  const totalExpense=n(f.totalExpenses);
  const result=n(f.netProfit)+extraTotal;
  const amort=result>0?result*.10:0;
  const rows=completedRows(from,to);
  const payRows=payrollRows(from,to);
  const label=periodName(from,to);

  const kpiGrid=analytics?.querySelector('.finance-kpi-grid');
  if(kpiGrid){
    let reserveKpi=kpiGrid.querySelector('.finance-kpi-reserve');
    if(!reserveKpi){
      reserveKpi=document.createElement('div');
      reserveKpi.className='finance-kpi finance-kpi-reserve';
      kpiGrid.appendChild(reserveKpi);
    }
    reserveKpi.innerHTML=`<span>Амортизация</span><strong>${cash(amort)}</strong><small>10% положительного результата</small>`;
  }

  if(flow) flow.innerHTML=`
    <div class="finance-visual-title"><div><span>Движение денег</span><strong>Как формируется результат</strong></div><small>${esc(label)}</small></div>
    <div class="finance-flow-map">
      <div class="finance-flow-node income">
        <span>Выручка</span><strong>${cash(totalIncome)}</strong><small>Проекты + прочие доходы</small>
      </div>
      <div class="finance-flow-connector down"></div>
      <div class="finance-flow-split">
        <div class="finance-flow-node cost"><span>Прямые расходы</span><strong>−${cash(f.projectCosts)}</strong><small>Расходы проектов</small></div>
        <div class="finance-flow-node cost"><span>Команда</span><strong>−${cash(f.payrollPaidOut)}</strong><small>Оклады и гонорары</small></div>
        <div class="finance-flow-node cost"><span>Компания</span><strong>−${cash(f.overhead)}</strong><small>Офис и прочие расходы</small></div>
      </div>
      <div class="finance-flow-merge"></div>
      <div class="finance-flow-node result ${result<0?'negative':''}">
        <span>Осталось компании</span><strong>${cash(result)}</strong><small>${esc(label)}</small>
      </div>
      <div class="finance-flow-tail">
        <div class="finance-flow-node reserve"><span>Амортизация</span><strong>${cash(amort)}</strong><small>10% результата</small></div>
        <button type="button" class="finance-flow-more" onclick="setFinanceVisualTab('reserve')">Резерв подробнее →</button>
      </div>
    </div>`;

  if(incomeVisual){
    const projectItems=rows.length?rows.map(r=>`
      <div class="finance-v-list-row" onclick="try{openProjectSheet('${r.p.id}')}catch(e){}">
        <div><strong>${esc(r.p.name||'Проект')}</strong><small>${esc(r.dept)}</small></div>
        <b>+${cash(r.revenue)}</b>
      </div>`).join(''):'<div class="finance-v-empty">Нет завершённых проектов за выбранный период.</div>';
    const extraItems=extras.length?extras.sort((a,b)=>String(b.income_date||'').localeCompare(String(a.income_date||''))).map(i=>`
      <div class="finance-v-list-row">
        <div><strong>${esc(i.category||i.description||'Прочий доход')}</strong><small>${esc(i.income_date||'')}</small></div>
        <b>+${cash(i.amount)}</b>
      </div>`).join(''):'<div class="finance-v-empty">Прочих доходов за период нет.</div>';
    incomeVisual.innerHTML=`
      <div class="finance-v-hero income-hero"><span>Общий доход</span><strong>${cash(totalIncome)}</strong><small>${esc(label)}</small></div>
      <div class="finance-v-sections">
        <section><div class="finance-v-section-head"><strong>По проектам</strong><span>${cash(f.revenue)}</span></div><div class="finance-v-list">${projectItems}</div></section>
        <section><div class="finance-v-section-head"><strong>Прочие доходы</strong><span>${cash(extraTotal)}</span></div><div class="finance-v-list">${extraItems}</div></section>
      </div>`;
  }

  if(expenseVisual){
    const overheadCats=Object.entries(f.overheadByCat||{}).sort((a,b)=>n(b[1])-n(a[1]));
    const companyExpenses=(state.companyExpenses||[]).filter(x=>!x.deleted_at&&(typeof isOperationalCompanyExpense!=='function'||isOperationalCompanyExpense(x))&&inRange(x.expense_date,from,to)).sort((a,b)=>String(b.expense_date||'').localeCompare(String(a.expense_date||'')));
    const max=Math.max(1,n(f.projectCosts),n(f.payrollPaidOut),n(f.overhead));
    const categoryBars=[
      ['Прямые расходы проектов',n(f.projectCosts)],
      ['Зарплаты и гонорары',n(f.payrollPaidOut)],
      ['Постоянные и прочие расходы',n(f.overhead)]
    ].map(([name,val])=>`
      <div class="finance-expense-bar"><div><span>${esc(name)}</span><b>${cash(val)}</b></div><i><u style="width:${Math.max(3,Math.min(100,val/max*100))}%"></u></i></div>`).join('');
    const details=companyExpenses.length?companyExpenses.map(x=>`
      <div class="finance-v-list-row"><div><strong>${esc(x.category||'Расход')}</strong><small>${esc(x.expense_date||'')}${x.description?' · '+esc(x.description):''}</small></div><b class="negative">−${cash(x.amount)}</b></div>`).join(''):'<div class="finance-v-empty">Дополнительных расходов компании за период нет.</div>';
    const cats=overheadCats.length?overheadCats.map(([name,val])=>`<span class="finance-expense-chip">${esc(name)} · ${cash(val)}</span>`).join(''):'';
    expenseVisual.innerHTML=`
      <div class="finance-v-hero expense-hero"><span>Общие расходы</span><strong>${cash(totalExpense)}</strong><small>${esc(label)}</small></div>
      <div class="finance-expense-bars">${categoryBars}</div>
      ${cats?`<div class="finance-expense-chips">${cats}</div>`:''}
      <div class="finance-v-section-head finance-expense-history-head"><strong>Записи расходов компании</strong><span>${companyExpenses.length}</span></div>
      <div class="finance-v-list">${details}</div>`;
  }

  if(teamVisual){
    const total=payRows.reduce((s,r)=>s+r.payout,0);
    const list=payRows.length?payRows.map(r=>`
      <div class="finance-team-row">
        <div class="finance-team-avatar">${esc((r.employee.name||'?').trim().charAt(0).toUpperCase())}</div>
        <div class="finance-team-main"><strong>${esc(r.employee.name||'Сотрудник')}</strong><small>${esc(r.employee.role||r.method)}</small></div>
        <div class="finance-team-money"><small>${esc(r.method)}</small><strong>${cash(r.payout)}</strong></div>
      </div>`).join(''):'<div class="finance-v-empty">Нет начислений команде за выбранный период.</div>';
    teamVisual.innerHTML=`
      <div class="finance-v-hero team-hero"><span>Всего начислено команде</span><strong>${cash(total)}</strong><small>${esc(label)}</small></div>
      <div class="finance-team-list">${list}</div>`;
  }

  if(reserveVisual){
    const reserveBalance=typeof getCompanyReserveBalance==='function'?getCompanyReserveBalance():190000;
    reserveVisual.innerHTML=`
      <div class="finance-v-hero reserve-hero"><span>Резерв компании</span><strong>${cash(reserveBalance)}</strong><small>Указанный остаток средств · с учётом корректировок и выводов</small></div>`;
    if(typeof window.renderFinanceControls==='function') window.renderFinanceControls();
  }
}
window.renderFinanceVisualPanels=renderVisuals;

const oldAnalytics=window.renderAnalytics;
if(typeof oldAnalytics==='function'){
  window.renderAnalytics=function(){
    const r=oldAnalytics.apply(this,arguments);
    try{renderVisuals();}catch(e){console.warn('[Finance visual]',e);}
    return r;
  };
}
const oldFinance=window.renderFinance;
if(typeof oldFinance==='function'){
  window.renderFinance=function(){
    const r=oldFinance.apply(this,arguments);
    try{renderVisuals();}catch(e){console.warn('[Finance visual]',e);}
    return r;
  };
}
const oldAll=window.renderAll;
if(typeof oldAll==='function'){
  window.renderAll=function(){
    const r=oldAll.apply(this,arguments);
    try{renderVisuals();}catch(e){console.warn('[Finance visual]',e);}
    return r;
  };
}

let initial='overview';
try{initial=sessionStorage.getItem('arhittek_finance_tab')||'overview';}catch(e){}
setTab(initial,false);
setTimeout(()=>{try{renderVisuals();}catch(e){console.warn('[Finance visual init]',e);}},850);
})();


