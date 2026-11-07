// Monthly financial forecast: active projects, fixed costs, Reels and debt plan.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const view=$('view-finance');
if(!view || window.__arhittekForecastInstalled) return;
window.__arhittekForecastInstalled=true;

const style=document.createElement('style');
style.textContent=`
.forecast-wrap{margin-bottom:18px}.forecast-hero{border:1px solid var(--line);border-radius:16px;padding:18px;background:linear-gradient(135deg,rgba(0,113,235,.10),rgba(255,255,255,.92));box-shadow:0 10px 24px -16px rgba(22,35,58,.25)}
.forecast-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}.forecast-title{font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700}.forecast-sub{font-size:11px;color:var(--text-dim);margin-top:4px;line-height:1.45}
.forecast-result{font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;line-height:1}.forecast-result.pos{color:var(--green)}.forecast-result.neg{color:var(--red)}
.forecast-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.forecast-metric{background:rgba(255,255,255,.82);border:1px solid var(--line);border-radius:12px;padding:12px}.forecast-metric span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:5px}.forecast-metric strong{font-family:'Space Grotesk',sans-serif;font-size:15px}
.forecast-line{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}.forecast-line:last-child{border-bottom:0}.forecast-line b{font-family:'Space Grotesk',sans-serif}.forecast-line.total{font-size:13px;font-weight:700}
.forecast-project{padding:10px 0;border-bottom:1px solid var(--line)}.forecast-project:last-child{border-bottom:0}.forecast-project-top{display:flex;justify-content:space-between;gap:10px;font-size:12px;font-weight:600}.forecast-project small{display:block;color:var(--text-dim);margin-top:3px;line-height:1.4}
.forecast-controls{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}.forecast-controls .field{margin:0}.forecast-note{font-size:10px;color:var(--text-dim);line-height:1.5;margin-top:10px}
@media(max-width:370px){.forecast-grid,.forecast-controls{grid-template-columns:1fr}}
`;
document.head.append(style);

const wrap=document.createElement('section');
wrap.className='forecast-wrap';
wrap.innerHTML=`
  <div class="section-label" style="margin-top:4px"><span class="lbl-text">Прогноз</span><span class="section-label-line"></span></div>
  <div id="forecastMain"></div>
  <details class="finance-disclosure">
    <summary>Показать расчёт прогноза и проекты</summary>
    <div class="section-label finance-inner-label"><span class="lbl-text">Из чего складывается прогноз</span><span class="section-label-line"></span></div>
    <div class="card" id="forecastBreakdown"></div>
    <div class="section-label finance-inner-label"><span class="lbl-text">Проекты в прогнозе</span><span class="section-label-line"></span></div>
    <div class="card" id="forecastProjects"></div>
  </details>
`;
const first=view.querySelector('.workspace-head')?.nextSibling || view.firstChild;
view.insertBefore(wrap, first);

function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function money(v){try{return fmtMoney(Math.round(num(v)));}catch(e){return Math.round(num(v)).toLocaleString('ru-RU')+' ₽';}}
function monthKey(d=new Date()){return d.toISOString().slice(0,7);}
function inMonth(date,key){return !!date && String(date).slice(0,7)===key;}
function monthBounds(key){
 const [y,m]=key.split('-').map(Number);
 const start=new Date(y,m-1,1), end=new Date(y,m,0);
 return {start,end,days:end.getDate()};
}
function endOfMonthISO(key){const b=monthBounds(key);return b.end.toISOString().slice(0,10);}
function activeEmployees(){return (state.employees||[]).filter(e=>e.active!==false && !e.deleted_at);}
function salaryTotal(){
 const rows=activeEmployees().filter(e=>e.is_salaried);
 const detected=rows.reduce((s,e)=>s+num(e.salary ?? e.fixed_salary ?? e.monthly_salary),0);
 return detected>0?detected:100000;
}
function projectTeamCost(p){
 try{
  if(p.fee_base==='m2'){
    return (projectRolePayoutEntries(p.id)||[]).reduce((s,e)=>s+num(e.amount),0);
  }
  const f=getProjectFee(p)||{};
  return num(f.mainFeeAmount)+num(f.coFeeAmount);
 }catch(e){return 0;}
}
function isConstruction(p){
 try{return isConstructionCategory(p.category_id);}catch(e){
  const n=((findCategory?.(p.category_id)?.name)||'').toLowerCase();
  return n.includes('строит')||n.includes('ремонт');
 }
}
function projectDueThisMonth(p,key){
 const end=String(p.end_date||'');
 const status=(typeof findStatus==='function'?findStatus(p.status_id)?.name:'')||'';
 const completed=status==='Завершён';
 const frozen=status==='Заморожен';
 if(frozen || p.deleted_at) return false;
 if(inMonth(end,key)) return true;
 // Просроченный долг клиента также должен попасть в ближайший текущий прогноз.
 if(key===monthKey() && end && end<monthBounds(key).start.toISOString().slice(0,10) && num(p.price)>num(p.advance) && !completed) return true;
 return false;
}
function projectRows(key){
 return (state.projects||[]).filter(p=>!isConstruction(p) && projectDueThisMonth(p,key)).map(p=>{
   const price=num(p.price), received=num(p.advance), expected=Math.max(0,price-received);
   const direct=Math.max(0,num(p.expenses));
   const team=Math.max(0,projectTeamCost(p));
   return {p,expected,direct,team,net:expected-direct-team};
 }).filter(r=>r.expected||r.direct||r.team);
}
function recurringIncome(key){
 const operationalIncome=i=>!i.deleted_at && (typeof isOperationalCompanyIncome!=='function' || isOperationalCompanyIncome(i));
 const entered=(state.companyIncome||[]).filter(i=>operationalIncome(i) && inMonth(i.income_date,key)).reduce((s,i)=>s+num(i.amount),0);
 // Если аренда за месяц уже занесена в доходы, второй раз 20 000 ₽ не добавляем.
 const hasRent=(state.companyIncome||[]).some(i=>operationalIncome(i) && inMonth(i.income_date,key) && String(i.category||'').toLowerCase().includes('аренд'));
 return {entered,autoRent:hasRent?0:20000};
}
function settings(){
 if(localStorage.getItem('finance_debt_zero_20260923')!=='1'){
   localStorage.setItem('forecast_debt_payment','0');
   localStorage.setItem('forecast_debt_workers','0');
   localStorage.setItem('forecast_debt_furniture','0');
   localStorage.setItem('finance_debt_zero_20260923','1');
 }
 return {
  rent: num(localStorage.getItem('forecast_rent') ?? 110000),
  internet: num(localStorage.getItem('forecast_internet') ?? 2500),
  reelsUnit: num(localStorage.getItem('forecast_reels_unit') ?? 2000),
  debtPayment: num(localStorage.getItem('forecast_debt_payment') ?? 0),
  debtWorkers: num(localStorage.getItem('forecast_debt_workers') ?? 0),
  debtFurniture: num(localStorage.getItem('forecast_debt_furniture') ?? 0)
 };
}
function renderForecast(){
 const key=$('forecast-month')?.value || monthKey();
 const set=settings(), bounds=monthBounds(key);
 const reelsDays=Math.ceil(bounds.days/2), reels=reelsDays*set.reelsUnit;
 const salaries=salaryTotal();
 const bonuses=(state.ledger||[]).filter(l=>!l.deleted_at && l.type==='bonus' && inMonth(l.entry_date,key)).reduce((s,l)=>s+num(l.amount),0);
 const officeRows=(state.companyExpenses||[]).filter(x=>!x.deleted_at && inMonth(x.expense_date,key) && (typeof isOperationalCompanyExpense!=='function' || isOperationalCompanyExpense(x)));
 const recordedRent=officeRows.filter(x=>String(x.category||'').toLowerCase().includes('аренд')).reduce((s,x)=>s+num(x.amount),0);
 const recordedInternet=officeRows.filter(x=>/интернет|связь/i.test(String(x.category||''))).reduce((s,x)=>s+num(x.amount),0);
 const officeExtras=officeRows.filter(x=>!/аренд|интернет|связь|реклам|продвиж/i.test(String(x.category||''))).reduce((s,x)=>s+num(x.amount),0);
 const rentCost=recordedRent||set.rent;
 const internetCost=recordedInternet||set.internet;
 const rows=projectRows(key);
 const projectsIncome=rows.reduce((s,r)=>s+r.expected,0);
 const direct=rows.reduce((s,r)=>s+r.direct,0);
 const team=rows.reduce((s,r)=>s+r.team,0);
 const extra=recurringIncome(key);
 const income=projectsIncome+extra.entered+extra.autoRent;
 const fixed=rentCost+internetCost+salaries+bonuses+reels+officeExtras;
 const operating=income-fixed-direct-team;
 const debtTotal=set.debtWorkers+set.debtFurniture;
 const plannedDebtPayment=debtTotal>0?Math.min(set.debtPayment,debtTotal):0;
 const afterDebt=operating-plannedDebtPayment;
 const remainingDebt=Math.max(0,debtTotal-plannedDebtPayment);
 const cls=afterDebt>=0?'pos':'neg';
 const label=afterDebt>=0?'Ожидаемый плюс':'Ожидаемый минус';
 $('forecastMain').innerHTML=`
 <div class="forecast-hero">
   <div class="forecast-head">
     <div><div class="forecast-title">${label}</div><div class="forecast-sub">Прогноз на месяц по текущим проектам и обязательным расходам.</div></div>
     <div style="min-width:126px"><div class="field" style="margin:0"><label>Месяц</label><input type="month" id="forecast-month" value="${key}"></div></div>
   </div>
   <div class="forecast-result ${cls}">${money(afterDebt)}</div>
   <div class="forecast-grid forecast-grid-simple">
     <div class="forecast-metric"><span>Поступления</span><strong>${money(income)}</strong></div>
     <div class="forecast-metric"><span>Расходы</span><strong>${money(fixed+direct+team)}</strong></div>
     <div class="forecast-metric"><span>Результат месяца</span><strong>${money(operating)}</strong></div>
   </div>
 </div>`;

 $('forecastBreakdown').innerHTML=`
   ${debtTotal>0?`<div class="forecast-controls">
     <div class="field"><label>Платёж по долгам в этом месяце, ₽</label><input type="number" id="forecast-debt-payment" min="0" step="1000" max="${debtTotal}" value="${plannedDebtPayment}"></div>
     <div class="field"><label>Долг после этого платежа</label><input type="text" readonly value="${money(remainingDebt)}"></div>
   </div>
   <div class="forecast-note">Текущий долг: ${money(debtTotal)}. После планового платежа останется ${money(remainingDebt)}.</div>`:`<div class="forecast-note forecast-note-ok">Долгов компании сейчас нет.</div>`}
   <div class="forecast-note">Reels: ${reelsDays} выходов × ${money(set.reelsUnit)} = ${money(reels)}.</div>
   <div class="forecast-line"><span>Остатки оплат по проектам месяца</span><b>+${money(projectsIncome)}</b></div>
   <div class="forecast-line"><span>Прочие доходы, уже внесённые</span><b>+${money(extra.entered)}</b></div>
   <div class="forecast-line"><span>Субаренда, если ещё не внесена</span><b>+${money(extra.autoRent)}</b></div>
   <div class="forecast-line"><span>Аренда офиса</span><b>−${money(rentCost)}</b></div>
   <div class="forecast-line"><span>Интернет / связь</span><b>−${money(internetCost)}</b></div>
   <div class="forecast-line"><span>Фиксированные зарплаты</span><b>−${money(salaries)}</b></div>
   <div class="forecast-line"><span>Премии сотрудникам</span><b>−${money(bonuses)}</b></div>
   <div class="forecast-line"><span>Доп. расходы офиса</span><b>−${money(officeExtras)}</b></div>
   <div class="forecast-line"><span>Reels · через день</span><b>−${money(reels)}</b></div>
   <div class="forecast-line"><span>Прямые расходы проектов</span><b>−${money(direct)}</b></div>
   <div class="forecast-line"><span>Гонорары команды по проектам</span><b>−${money(team)}</b></div>
   <div class="forecast-line total"><span>Операционный итог</span><b>${money(operating)}</b></div>
   ${debtTotal>0?`<div class="forecast-line total"><span>После планового платежа по долгам</span><b>${money(afterDebt)}</b></div>`:''}`;

 $('forecastProjects').innerHTML=rows.length?rows.map(r=>`
   <div class="forecast-project">
     <div class="forecast-project-top"><span>${escapeHtml(r.p.name||'Проект')}</span><strong>+${money(r.expected)}</strong></div>
     <small>Срок: ${r.p.end_date?fmtDate(r.p.end_date):'не указан'} · расходы ${money(r.direct)} · команда ${money(r.team)} · вклад до общих расходов ${money(r.net)}</small>
   </div>`).join(''):'<div class="note">На выбранный месяц нет проектных поступлений, которые приложение может уверенно отнести к прогнозу. Укажите сроки проектов — и они появятся здесь автоматически.</div>';

 $('forecast-month')?.addEventListener('change',renderForecast,{once:true});
 $('forecast-debt-payment')?.addEventListener('change',e=>{localStorage.setItem('forecast_debt_payment',String(Math.max(0,num(e.target.value))));renderForecast();},{once:true});
}
window.renderFinancialForecast=renderForecast;

const oldRenderAll=window.renderAll;
if(typeof oldRenderAll==='function'){
 window.renderAll=function(){const r=oldRenderAll.apply(this,arguments);try{renderForecast();}catch(e){console.warn('[Forecast]',e);}return r;};
}
const oldFinance=window.renderFinance;
if(typeof oldFinance==='function'){
 window.renderFinance=function(){const r=oldFinance.apply(this,arguments);try{renderForecast();}catch(e){console.warn('[Forecast]',e);}return r;};
}
setTimeout(()=>{try{renderForecast();}catch(e){console.warn('[Forecast init]',e);}},700);
})();


