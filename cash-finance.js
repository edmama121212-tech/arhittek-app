/* Cash accounting: calendar months, confirmed operations, explicit opening snapshot. */
(()=>{
'use strict';
const OPENING=20000,CUTOFF='2026-10-05T19:26:53.000Z',OPENING_DAY='2026-10-05',n=v=>Number.isFinite(Number(v))?Number(v):0;
function day(d=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function shift(month,delta){const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-1+delta,1));return d.toISOString().slice(0,7);}
function period(row){return (String(row.description||'').match(/\[cash:(?:rent|internet|sublease):(\d{4}-\d{2})\]/)||[])[1]||(String(row.description||'').match(/период\s+(\d{4}-\d{2})/i)||[])[1]||String(row.expense_date||row.income_date||'').slice(0,7);}
function cashEvents(s){
 const out=[],add=(r,kind,date,amount)=>{if(!r.deleted_at&&n(amount)!==0&&date)out.push({row:r,kind,date,amount:n(amount),afterSnapshot:!!r.created_at&&Date.parse(r.created_at)>Date.parse(CUTOFF)});};
 (s.companyIncome||[]).forEach(r=>add(r,'income',r.income_date,n(r.amount)));
 (s.companyExpenses||[]).forEach(r=>add(r,'expense',r.expense_date,-n(r.amount)));
 const incoming=new Set(['advance','final_payment','income','materials_budget','construction_budget']),outgoing=new Set(['expense','payment','withdrawal','fee_payment','salary_payment']);
 (s.ledger||[]).forEach(r=>{if(incoming.has(r.type))add(r,'ledger',r.entry_date,n(r.amount));else if(outgoing.has(r.type))add(r,'ledger',r.entry_date,-n(r.amount));});
 return out.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function balance(s,until=day()){if(until<OPENING_DAY)return null;return OPENING+cashEvents(s).filter(x=>x.afterSnapshot&&x.date<=until).reduce((sum,x)=>sum+x.amount,0);}
function monthSummary(s,month){const current=day().slice(0,7),events=cashEvents(s).filter(x=>x.date.slice(0,7)===month&&x.date<=day()),incoming=events.filter(x=>x.amount>0).reduce((a,x)=>a+x.amount,0),outgoing=-events.filter(x=>x.amount<0).reduce((a,x)=>a+x.amount,0),previous=shift(month,-1),[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),prevLast=new Date(Date.UTC(Number(previous.slice(0,4)),Number(previous.slice(5)),0)).toISOString().slice(0,10);
 return {month,status:month<current?'Закрыт':month===current?'Текущий':'План',incoming,outgoing,events,opening:month==='2026-10'?OPENING:balance(s,prevLast),closing:month>current?null:balance(s,month===current?day():last)};}
function expected(p){return Math.max(0,n(p.price)-n(p.advance));}
function dueProjects(s,month){return (s.projects||[]).filter(p=>!p.deleted_at&&String(p.end_date||'').slice(0,7)===month).filter(p=>{const status=(s.statuses||[]).find(x=>x.id===p.status_id);return !/заморож|отмен/i.test(status?.name||'');});}
window.ARHITTEKCash={day,shift,period,cashEvents,balance,monthSummary,expected,dueProjects,opening:OPENING,cutoff:CUTOFF};
if(typeof document==='undefined')return;
const $=id=>document.getElementById(id),esc=v=>escapeHtml(String(v??'')),money=v=>v===null?'—':fmtMoney(n(v));let selected=day().slice(0,7),following=true,busy=false,lastDay=day();
const recurring={rent:{label:'Аренда офиса',category:'Аренда',amount:110000,table:'company_expenses'},internet:{label:'Интернет',category:'Связь и интернет',amount:2500,table:'company_expenses'},sublease:{label:'Сдача помещения',category:'Аренда помещений',amount:20000,table:'company_income'}};
function recurringState(kind,month){const def=recurring[kind],list=kind==='sublease'?state.companyIncome:state.companyExpenses,rows=(list||[]).filter(r=>!r.deleted_at&&r.category===def.category&&period(r)===month),paid=rows.reduce((a,r)=>a+n(r.amount),0),plan=kind==='sublease'?20000:Math.max(0,n(localStorage.getItem('forecast_'+kind)??def.amount));return {...def,rows,paid,plan,left:Math.max(0,plan-paid)};}
function btn(label,action,id=''){return '<button type="button" class="btn btn-secondary" data-cash-action="'+action+'" data-id="'+esc(id)+'" style="width:auto">'+label+'</button>';}
function eventsHTML(events){return events.length?events.map(x=>{const r=x.row,p=(state.projects||[]).find(p=>p.id===r.project_id),label=p?.name||r.category||(r.type==='salary_payment'?'Зарплата · '+(findEmployee(r.payee_employee_id)?.name||''):ledgerTypeLabels[r.type]?.label)||'Операция';return '<div class="list-item"><div><div class="li-name">'+esc(label)+'</div><div class="li-meta">'+fmtDate(x.date)+' · '+esc(r.description||'')+(!x.afterSnapshot?' · до сверки остатка':'')+'</div></div><div class="cash-actions"><b style="color:'+(x.amount>0?'var(--green)':'var(--red)')+'">'+(x.amount>0?'+':'−')+money(Math.abs(x.amount))+'</b>'+btn('Редактировать','edit',x.kind+':'+r.id)+'</div></div>';}).join(''):'<div class="empty-state">Подтверждённых операций нет</div>';}
function panel(id,html){const p=document.querySelector('.finance-visual-panel[data-fin-panel="'+id+'"]');if(!p)return;let el=$('cash-panel-'+id);if(!el){el=document.createElement('section');el.id='cash-panel-'+id;el.className='cash-panel';p.appendChild(el);}p.classList.add('cash-managed');el.innerHTML=html;}
function render(){
 if(!session?.isAdmin||!$('view-finance'))return;
 const tabs=$('financeVisualTabs');if(!tabs)return;
 let picker=$('cashMonthPicker');if(!picker){picker=document.createElement('div');picker.id='cashMonthPicker';picker.className='cash-month';tabs.before(picker);}
 const summary=monthSummary(state,selected),all=balance(state),events=summary.events,rent=recurringState('rent',selected),internet=recurringState('internet',selected),sublease=recurringState('sublease',selected);
 picker.innerHTML='<label>Месяц <input type="month" id="cashMonth" value="'+selected+'"></label><span>'+summary.status+' · московское время</span>'+btn('Текущий месяц','current');
 $('cashMonth').onchange=e=>{if(e.target.value){selected=e.target.value;following=selected===day().slice(0,7);render();}};
 const kpi=(label,value)=>'<div class="finance-kpi"><span>'+label+'</span><strong>'+money(value)+'</strong></div>';
 panel('overview','<div class="finance-kpi-grid">'+kpi('Баланс сейчас',all)+kpi('Получено за месяц',summary.incoming)+kpi('Оплачено за месяц',summary.outgoing)+'</div><div class="card" style="margin-top:16px"><div class="fee-row"><div class="fl">'+(selected==='2026-10'?'Остаток после сверки 05.10.2026':'Остаток на начало месяца')+'</div><div class="fv">'+money(summary.opening)+'</div></div><div class="fee-row total"><div class="fl">Остаток '+(summary.status==='Закрыт'?'на конец месяца':'сейчас')+'</div><div class="fv">'+money(summary.closing)+'</div></div><div class="note">Баланс начинается с 20 000 ₽ на 05.10.2026, 22:26 МСК. Старые операции показаны в истории, но повторно в этот остаток не включаются. Планы и начисления деньги не списывают.</div></div>');
 panel('income','<div class="card"><h3>Сдача помещения · '+esc(ruMonthLabel(selected))+'</h3><div class="fee-row"><div class="fl">Подтверждено получено</div><div class="fv">'+money(sublease.paid)+'</div></div>'+(sublease.left?btn('Подтвердить получение '+money(sublease.left),'confirm','sublease'): '<div class="note">Доход за месяц подтверждён</div>')+'</div><div class="section-label">Фактические поступления за месяц</div><div class="card">'+eventsHTML(events.filter(x=>x.amount>0))+'</div>'+btn('Добавить другой доход','income'));
 panel('expense',[rent,internet].map((x,i)=>'<div class="card" style="margin-bottom:12px"><h3>'+esc(x.label)+'</h3><div class="fee-row"><div class="fl">Оплачено</div><div class="fv">'+money(x.paid)+'</div></div><div class="fee-row"><div class="fl">Осталось по плану</div><div class="fv">'+money(x.left)+'</div></div>'+(x.left?btn('Подтвердить оплату '+money(x.left),'confirm',i?'internet':'rent'):'<div class="note">Оплачено за месяц</div>')+btn('Частичная оплата','partial',i?'internet':'rent')+'</div>').join('')+'<div class="card">'+eventsHTML(events.filter(x=>x.amount<0))+'</div>'+btn('Добавить расход','expense'));
 panel('reserve','<div class="finance-v-hero reserve-hero"><span>Фактический баланс компании</span><strong>'+money(all)+'</strong><small>20 000 ₽ после сверки + новые поступления − новые оплаты</small></div>'+btn('Редактировать баланс','balance')+btn('Вывести деньги','withdraw')+'<div class="note">Корректировка сохраняется отдельной операцией. Прибыль по договорам не прибавляется к балансу.</div>');
 let payroll=$('cashPayrollLink');const team=document.querySelector('.finance-visual-panel[data-fin-panel="team"]');if(team){if(!payroll){payroll=document.createElement('div');payroll.id='cashPayrollLink';team.prepend(payroll);}payroll.innerHTML='<div class="note">Зарплата за '+esc(ruMonthLabel(selected))+'. Начисления не списывают деньги: баланс меняется только после записи фактической выплаты.</div>'+btn('Открыть табель этого месяца','payroll');}
 renderForecast();
 // Hide obsolete accrued-finance summaries; keep the previous tabs and payroll UI.
 const old=$('financeObligationsWrap');if(old)old.hidden=true;
}
function renderForecast(){
 const current=day().slice(0,7);let running=balance(state),html='<div class="note">Ожидаемые остатки оплаты — по срокам проектов. Прогноз не меняет фактический баланс. Доход от сдачи помещения планируется, но признаётся только после подтверждения.</div>';
 for(let i=0;i<6;i++){
 const month=shift(current,i),projects=dueProjects(state,month),income=projects.reduce((a,p)=>a+expected(p),0),lease=recurringState('sublease',month),rent=recurringState('rent',month),internet=recurringState('internet',month);
 const range=timesheetMonthRange(month),earned=completedProjectEarningsForRange(range.from,range.to).employees,split=splitPayrollByEmployee(earned).result;
 let salaries=(state.employees||[]).filter(e=>!e.deleted_at&&e.active!==false).reduce((s,e)=>s+salaryPaymentState(e.id,month,n(split[e.id]?.payout)).remaining,0);
 projects.filter(p=>!/заверш/i.test(findStatus(p.status_id)?.name||'')).forEach(p=>{try{salaries+=Math.max(0,n(getProjectFee(p).feeAmount));}catch(_){} });
 const out=rent.left+internet.left+salaries,inc=income+lease.left;running+=inc-out;
 html+='<div class="card" style="margin-bottom:14px"><h3>'+esc(ruMonthLabel(month))+'</h3><div class="fee-row"><div class="fl">От проектов</div><div class="fv">'+money(income)+'</div></div><div class="fee-row"><div class="fl">Сдача помещения — ожидается</div><div class="fv">'+money(lease.left)+'</div></div><div class="fee-row"><div class="fl">Зарплаты, аренда, интернет — ожидается</div><div class="fv">'+money(out)+'</div></div><div class="fee-row total"><div class="fl">Прогноз остатка</div><div class="fv" style="color:'+(running<0?'var(--red)':'var(--green)')+'">'+money(running)+'</div></div><details><summary>Проекты и расчёт</summary>'+projects.map(p=>'<div class="fee-row"><div class="fl">'+esc(p.name)+' · '+fmtDate(p.end_date)+'</div><div class="fv">'+money(expected(p))+'</div></div>').join('')+'<div class="note">Зарплаты '+money(salaries)+' · аренда '+money(rent.left)+' · интернет '+money(internet.left)+'. Не включает будущие расходы на материалы без указанного графика оплаты.</div></details></div>';
 }
 panel('forecast',html);
}
async function confirmRecurring(kind){
 if(busy||!session?.isAdmin)return;busy=true;const x=recurringState(kind,selected);if(!x.left){busy=false;return;}
 try{
 const description='[cash:'+kind+':'+selected+'] период '+selected;
 const check=await sb.from(x.table).select('*').is('deleted_at',null).eq('category',x.category);if(check.error)throw check.error;
 const paid=(check.data||[]).filter(r=>period(r)===selected).reduce((a,r)=>a+n(r.amount),0),amount=Math.max(0,x.plan-paid);if(!amount){await loadAll();return;}
 const payload={category:x.category,amount,description,[kind==='sublease'?'income_date':'expense_date']:day()};
 const result=await sb.from(x.table).insert(payload);if(result.error)throw result.error;await loadAll();render();showToast('Оплата подтверждена');
 }catch(e){console.error(e);showToast('Не удалось сохранить оплату');}finally{busy=false;}
}
function editBalance(){
 let overlay=$('cashBalanceOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='cashBalanceOverlay';overlay.className='sheet-overlay';overlay.innerHTML='<div class="sheet"><h3>Фактический баланс</h3><div class="field"><label>Остаток денег, ₽</label><input id="cashBalanceValue" type="number" step="0.01"></div><div class="field"><label>Комментарий</label><input id="cashBalanceNote"></div><button class="btn btn-primary" id="cashBalanceSave">Сохранить</button><button class="btn btn-secondary" id="cashBalanceCancel">Отмена</button></div>';document.body.appendChild(overlay);$('cashBalanceCancel').onclick=()=>overlay.classList.remove('active');$('cashBalanceSave').onclick=async()=>{if(busy||!session?.isAdmin)return;const target=Number($('cashBalanceValue').value);if(!$('cashBalanceValue').value||!Number.isFinite(target)){showToast('Укажите остаток');return;}const diff=target-balance(state);if(!diff){overlay.classList.remove('active');return;}busy=true;try{const payload={category:diff>0?RESERVE_INCREASE_CATEGORY:RESERVE_DECREASE_CATEGORY,amount:Math.abs(diff),description:'Сверка фактического баланса · '+$('cashBalanceNote').value,[diff>0?'income_date':'expense_date']:day()};const r=await sb.from(diff>0?'company_income':'company_expenses').insert(payload);if(r.error)throw r.error;await loadAll();overlay.classList.remove('active');render();}catch(e){showToast('Ошибка сохранения');}finally{busy=false;}};}
 $('cashBalanceValue').value=balance(state);$('cashBalanceNote').value='';overlay.classList.add('active');
}
async function editEvent(id){
 const [kind,key]=id.split(':');if(kind==='income'){openCompanyIncomeSheet(key);return;}if(kind==='expense'){openCompanyExpenseSheet(key);return;}
 const row=(state.ledger||[]).find(r=>r.id===key);if(!row)return;
 if(row.type==='salary_payment'){const month=(String(row.description||'').match(/\[salary:(\d{4}-\d{2})\]/)||[])[1];if(month){openSalaryPaymentSheet(row.payee_employee_id,month);$('salaryPaymentHistory')?.querySelector('[data-edit-salary-payment="'+key+'"]')?.click();}return;}
 // Project payment editing stays in its existing project history to preserve receipt totals.
 if(row.project_id){openProjectSheet(row.project_id);showToast('Оплата в истории платежей проекта');}else showToast('Редактируйте запись в журнале операций');
}
function act(action,id){if(!session?.isAdmin)return;
 if(action==='current'){selected=day().slice(0,7);following=true;render();}
 if(action==='confirm'){if(selected>day().slice(0,7)){showToast('Будущий месяц — только прогноз');return;}confirmRecurring(id);}
 if(action==='partial'){const x=recurringState(id,selected);openCompanyExpenseSheet(null,x.category);$('cex-date').value=day();$('cex-desc').value='[cash:'+id+':'+selected+'] период '+selected;}
 if(action==='income')openCompanyIncomeSheet(null);if(action==='expense')openCompanyExpenseSheet(null);
 if(action==='balance')editBalance();if(action==='withdraw')openCompanyWithdrawal();if(action==='edit')editEvent(id);
 if(action==='payroll'){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$('view-timesheet').classList.add('active');$('ts-month').value=selected;renderTimesheet();}
}
getCompanyReserveBalance=()=>balance(state);window.openReserveCorrection=editBalance;
const style=document.createElement('style');style.textContent='.cash-managed>:not(.cash-panel){display:none!important}.cash-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cash-month{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.cash-month label{display:flex;gap:8px;align-items:center}.cash-month input{padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text)}.cash-panel h3{font-size:16px}.cash-panel .card{padding:16px}.cash-panel .btn{margin:8px 6px 8px 0}.cash-panel .list-item{gap:12px;flex-wrap:wrap}#financeObligationsWrap{display:none!important}';document.head.appendChild(style);
$('view-finance')?.addEventListener('click',e=>{const b=e.target.closest('[data-cash-action]');if(b)act(b.dataset.cashAction,b.dataset.id);});
for(const name of ['renderAll','renderAnalytics','renderFinanceVisualPanels','renderCompanyBudget','renderCompanyIncomeList','renderCompanyExpensesList','renderTimesheet']){const old=window[name];if(typeof old==='function')window[name]=function(){const r=old.apply(this,arguments);setTimeout(render,0);return r;};}
window.renderCashFinance=render;
setInterval(()=>{const now=day();if(now!==lastDay){lastDay=now;if(following)selected=now.slice(0,7);render();}},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(following)selected=day().slice(0,7);render();}});setTimeout(render,1600);
})();
