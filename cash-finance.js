/* Cash accounting: calendar months, confirmed operations, explicit opening snapshot. */
(()=>{
'use strict';
const OPENING=20000,CUTOFF='2026-10-05T19:26:53.000Z',OPENING_DAY='2026-10-05',n=v=>Number.isFinite(Number(v))?Number(v):0;
function day(d=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function shift(month,delta){const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-1+delta,1));return d.toISOString().slice(0,7);}
function period(row){return (String(row.description||'').match(/\[cash:(?:rent|internet|sublease):(\d{4}-\d{2})\]/)||[])[1]||(String(row.description||'').match(/период\s+(\d{4}-\d{2})/i)||[])[1]||String(row.expense_date||row.income_date||'').slice(0,7);}
const rounded=v=>Math.round(n(v)*100)/100;
const total=events=>rounded(events.reduce((sum,event)=>sum+event.amount,0));
function isAdjustment(row){return ['Корректировка резерва (+)','Корректировка резерва (−)','Корректировка резерва (-)'].includes(row.category)||String(row.description||'').startsWith('[cash:adjustment]');}
function isImportedExpense(row){return row.type==='project_expense'&&(row.description==='Ранее внесённые расходы'||String(row.description||'').startsWith('[cash:historical-expense]'));}
function cashEvents(s){
 const out=[],add=(r,kind,date,amount)=>{if(!r.deleted_at&&n(amount)!==0&&date){const imported=isImportedExpense(r),timestamp=Date.parse(r.created_at),unknown=!Number.isFinite(timestamp);out.push({row:r,kind,date,amount:rounded(amount),afterSnapshot:!imported&&date>=OPENING_DAY&&!unknown&&timestamp>Date.parse(CUTOFF),excludedReason:imported?'Перенос старых расходов · не новая оплата':unknown?'Нет даты создания · требуется сверка':'Учтено в стартовой сверке'});}};
 (s.companyIncome||[]).forEach(r=>add(r,'income',r.income_date,n(r.amount)));
 (s.companyExpenses||[]).forEach(r=>add(r,'expense',r.expense_date,-n(r.amount)));
 const incoming=new Set(['advance','final_payment','income','materials_budget','construction_budget']),outgoing=new Set(['expense','project_expense','payment','withdrawal','fee_payment','salary_payment']);
 (s.ledger||[]).forEach(r=>{if(incoming.has(r.type))add(r,'ledger',r.entry_date,n(r.amount));else if(outgoing.has(r.type))add(r,'ledger',r.entry_date,-n(r.amount));});
 return out.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function balance(s,until=day()){if(until<OPENING_DAY)return null;return rounded(OPENING+total(cashEvents(s).filter(x=>x.afterSnapshot&&x.date<=until)));}
function amortEvents(s,until=day()){return cashEvents(s).filter(x=>x.afterSnapshot&&x.date<=until&&x.amount>0&&!isAdjustment(x.row)).map(x=>({...x,allocation:Math.round(x.amount*5)/100}));}
function amortization(s,until=day()){return rounded(amortEvents(s,until).reduce((sum,x)=>sum+x.allocation,0));}
function available(s,until=day()){const total=balance(s,until);return total===null?null:Math.round((total-amortization(s,until))*100)/100;}
function monthSummary(s,month){const current=day().slice(0,7),events=cashEvents(s).filter(x=>x.date.slice(0,7)===month&&x.date<=day()),accounted=events.filter(x=>x.afterSnapshot),previous=shift(month,-1),[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),prevLast=new Date(Date.UTC(Number(previous.slice(0,4)),Number(previous.slice(5)),0)).toISOString().slice(0,10),until=month===current?day():last;
 const movements=month<OPENING_DAY.slice(0,7)?events:accounted;
 return {month,status:month<current?'Прошедший':month===current?'Текущий':'План',incoming:total(movements.filter(x=>x.amount>0)),outgoing:Math.abs(total(movements.filter(x=>x.amount<0))),events,accounted,until,opening:month>current?null:month===OPENING_DAY.slice(0,7)?OPENING:balance(s,prevLast),closing:month>current?null:balance(s,until),available:month>current?null:available(s,until),amortization:month>current?null:amortization(s,until)};}
function flowGroup(event){const row=event.row;if(isAdjustment(row))return 'adjustments';if(event.amount>0)return event.kind==='ledger'&&row.project_id?'clients':'otherIncome';if(['salary_payment','fee_payment'].includes(row.type)||(row.type==='payment'&&row.payee_employee_id))return 'team';if(row.type==='withdrawal'||row.category==='Вывод средств')return 'withdrawals';if(row.project_id)return 'projects';return 'company';}
function flowSummary(events){const groups={clients:0,otherIncome:0,team:0,projects:0,company:0,withdrawals:0,adjustments:0};events.forEach(event=>{const key=flowGroup(event);groups[key]=rounded(groups[key]+(key==='adjustments'?event.amount:Math.abs(event.amount)));});return groups;}
function invoicePaymentId(row){return (String(row.description||'').match(/\[invoice-payment:([^\]]+)\]/)||[])[1]||null;}
function invoicePaymentState(s,invoice){const rows=(s.ledger||[]).filter(r=>!r.deleted_at&&['expense','project_expense','payment'].includes(r.type)&&invoicePaymentId(r)===invoice.id),paid=rounded(rows.filter(r=>r.entry_date<=day()).reduce((sum,r)=>sum+n(r.amount),0));return {rows,paid,remaining:Math.max(0,rounded(n(invoice.amount)-paid)),overpaid:Math.max(0,rounded(paid-n(invoice.amount)))};}
function auditData(s){
 const pick=(rows,keys)=>(rows||[]).map(row=>Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])));
 return {version:1,exportedAt:new Date().toISOString(),asOf:day(),lastSuccessfulLoad:s.financialLoadedAt||null,loadError:s.financialDataError||null,openingSnapshot:{amount:OPENING,at:CUTOFF},calculation:{balance:balance(s),amortization:amortization(s),available:available(s)},
  projects:pick(s.projects,['id','name','category_id','status_id','price','advance','balance','expenses','employee_id','co_employee_id','fee_base','fee_percent','co_fee_percent','fee_paid','co_fee_paid','end_date','created_at','deleted_at']),
  employees:pick(s.employees,['id','name','role','active','is_salaried','fixed_salary']),categories:pick(s.categories,['id','name','fee_base','fee_percent','department_id']),statuses:pick(s.statuses,['id','name']),
  ledger:pick(s.ledger,['id','project_id','type','amount','entry_date','created_at','description','payee_employee_id','deleted_at']),
  companyIncome:pick(s.companyIncome,['id','category','amount','income_date','created_at','description','deleted_at']),companyExpenses:pick(s.companyExpenses,['id','category','amount','expense_date','created_at','description','deleted_at']),
  invoices:pick(s.invoices,['id','project_id','amount','invoice_date','created_at','item_type','description','paid_by_client','deleted_at']),timesheetPayments:pick(s.timesheetPayments,['id','employee_id','month','paid','paid_at'])};
}
function expected(p){return Math.max(0,n(p.price)-n(p.advance));}
function dueProjects(s,month){return (s.projects||[]).filter(p=>!p.deleted_at&&String(p.end_date||'').slice(0,7)===month).filter(p=>{const status=(s.statuses||[]).find(x=>x.id===p.status_id);return !/заморож|отмен/i.test(status?.name||'');});}
window.ARHITTEKCash={day,shift,period,cashEvents,balance,amortEvents,amortization,available,monthSummary,flowGroup,flowSummary,isAdjustment,invoicePaymentId,invoicePaymentState,auditData,expected,dueProjects,opening:OPENING,cutoff:CUTOFF};
if(typeof document==='undefined')return;
const $=id=>document.getElementById(id),esc=v=>escapeHtml(String(v??'')),money=v=>v===null?'—':fmtMoney(n(v));let selected=day().slice(0,7),following=true,busy=false,lastDay=day();
const recurring={rent:{label:'Аренда офиса',category:'Аренда',amount:110000,table:'company_expenses'},internet:{label:'Интернет',category:'Связь и интернет',amount:2500,table:'company_expenses'},sublease:{label:'Сдача помещения',category:'Аренда помещений',amount:20000,table:'company_income'}};
function recurringState(kind,month){const def=recurring[kind],list=kind==='sublease'?state.companyIncome:state.companyExpenses,rows=(list||[]).filter(r=>!r.deleted_at&&r.category===def.category&&period(r)===month&&(r.income_date||r.expense_date)<=day()),paid=rounded(rows.reduce((a,r)=>a+n(r.amount),0)),plan=kind==='sublease'?20000:Math.max(0,n(localStorage.getItem('forecast_'+kind)??def.amount));return {...def,rows,paid,plan,left:Math.max(0,plan-paid)};}
function btn(label,action,id=''){return '<button type="button" class="btn btn-secondary" data-cash-action="'+action+'" data-id="'+esc(id)+'" style="width:auto">'+label+'</button>';}
function eventsHTML(events){return events.length?events.map(x=>{
 const r=x.row,p=(state.projects||[]).find(p=>p.id===r.project_id),team=['salary_payment','fee_payment'].includes(r.type),employee=team?findEmployee(r.payee_employee_id||p?.employee_id):null;
 const label=team?(r.type==='salary_payment'?'Зарплата':'Гонорар')+' · '+(employee?.name||'Сотрудник не указан'):p?.name||r.category||ledgerTypeLabels[r.type]?.label||'Операция';
 return '<div class="list-item"><div><div class="li-name">'+esc(label)+'</div><div class="li-meta">'+fmtDate(x.date)+' · '+esc(r.description||'')+(!x.afterSnapshot?' · '+esc(x.excludedReason):'')+'</div></div><div class="cash-actions"><b style="color:'+(x.amount>0?'var(--green)':'var(--red)')+'">'+(x.amount>0?'+':'−')+money(Math.abs(x.amount))+'</b>'+btn('Редактировать','edit',x.kind+':'+r.id)+'</div></div>';
 }).join(''):'<div class="empty-state">Подтверждённых операций нет</div>';}
function rowHTML(label,amount){return '<div class="fee-row"><div class="fl">'+esc(label)+'</div><div class="fv">'+money(amount)+'</div></div>';}
function flowHTML(events){const f=flowSummary(events);return '<div class="card"><h3>Куда движутся деньги</h3>'+rowHTML('+ От клиентов',f.clients)+rowHTML('+ Доходы компании',f.otherIncome)+rowHTML('− Команде: зарплата и гонорары',f.team)+rowHTML('− По проектам: закупки и прямые расходы',f.projects)+rowHTML('− Компания: офис, связь и прочее',f.company)+rowHTML('− Вывод денег',f.withdrawals)+rowHTML('Сверка остатка',f.adjustments)+'</div>';}
function payrollHTML(events){
 const payments=events.filter(x=>flowGroup(x)==='team');
 let html='<div class="card"><h3>Деньги, выданные команде в этом месяце</h3>'+rowHTML('Фактические выплаты',Math.abs(total(payments)))+'<div class="note">По дате выдачи денег. Выплата за прошлый месяц входит в кассу месяца, когда её выдали.</div>'+eventsHTML(payments)+'</div>';
 if(typeof salaryPaymentState==='function'){
  const range=timesheetMonthRange(selected),earned=completedProjectEarningsForRange(range.from,range.to).employees,split=splitPayrollByEmployee(earned).result;
  const employees=(state.employees||[]).map(e=>({employee:e,payment:salaryPaymentState(e.id,selected,n(split[e.id]?.payout))})).filter(x=>x.payment.due||x.payment.paid);
  html+='<div class="card"><h3>Начисления за '+esc(ruMonthLabel(selected))+'</h3><div class="note">Оклад, проектная часть и премии. Это обязательства перед командой; они меняют кассу после фактической выплаты.</div>'+employees.map(({employee:e,payment:p})=>'<div class="card"><strong>'+esc(e.name)+'</strong>'+rowHTML('Начислено',p.due)+rowHTML(p.legacyMarked?'По прежней отметке оплаты':'Выплачено за этот расчётный месяц',p.paid)+rowHTML('Осталось выплатить',p.remaining)+(p.overpaid>0.009?'<div class="note" style="color:var(--red)">Сверх начисления: '+money(p.overpaid)+'</div>':'')+(p.legacyMarked?'<div class="note">Отдельной денежной записи нет: сверьте старую историю перед новой выплатой.</div>':'')+btn('Выплатить / история','salary',e.id)+'</div>').join('')+'</div>';
 }
 return html+btn('Открыть табель этого месяца','payroll');
}
function invoicesHTML(){
 const invoices=(state.invoices||[]).filter(i=>i.id&&!i.deleted_at&&!i.paid_by_client);
 if(!invoices.length)return '';
 return '<details class="card"><summary>Накладные: подтверждение оплаты</summary><div class="note">Накладная показывает стоимость закупки. Деньги списываются по отдельной записи оплаты. Можно связать уже внесённый расход с накладной.</div>'+invoices.map(i=>{const p=(state.projects||[]).find(p=>p.id===i.project_id),payment=invoicePaymentState(state,i);return '<div class="card"><strong>'+esc(p?.name||'Объект')+' · '+esc(i.description||i.number||i.item_type)+'</strong>'+rowHTML('Сумма накладной',i.amount)+rowHTML('Оплачено по связанным записям',payment.paid)+rowHTML('Оплата не подтверждена',payment.remaining)+(payment.overpaid>0.009?'<div class="note" style="color:var(--red)">Сверх суммы накладной: '+money(payment.overpaid)+'</div>':'')+btn(payment.remaining?'Оплатить / связать расход':'История оплаты','invoice',i.id)+'</div>';}).join('')+'</details>';
}
function panel(id,html){const p=document.querySelector('.finance-visual-panel[data-fin-panel="'+id+'"]');if(!p)return;let el=$('cash-panel-'+id);if(!el){el=document.createElement('section');el.id='cash-panel-'+id;el.className='cash-panel';p.appendChild(el);}p.classList.add('cash-managed');el.innerHTML=html;}
function render(){
 if(!session?.isAdmin||!$('view-finance'))return;
 const tabs=$('financeVisualTabs');if(!tabs)return;
 if(state.financialDataReady===false){['overview','income','expense','reserve','team','amortization','forecast'].forEach(id=>panel(id,'<div class="card">'+(state.financialDataError?'Операции не загружены. Остаток пока не подтверждён.':'Загружаются финансовые операции…')+'</div>'));return;}
 let picker=$('cashMonthPicker');if(!picker){picker=document.createElement('div');picker.id='cashMonthPicker';picker.className='cash-month';tabs.before(picker);}
 const finance=$('view-finance');finance.classList.add('cash-preview-style');const description=finance.querySelector('.workspace-description');if(description)description.textContent='Подтверждённые поступления и оплаты';
 const accounted=cashEvents(state).filter(x=>x.afterSnapshot&&x.date<=day()),receipts=accounted.filter(x=>x.amount>0).reduce((sum,x)=>sum+x.amount,0),payments=-accounted.filter(x=>x.amount<0).reduce((sum,x)=>sum+x.amount,0);
 const summary=monthSummary(state,selected),all=balance(state),events=summary.events,rent=recurringState('rent',selected),internet=recurringState('internet',selected),sublease=recurringState('sublease',selected);
 const unknown=cashEvents(state).filter(x=>x.date>=OPENING_DAY&&x.date<=day()&&x.excludedReason.startsWith('Нет даты создания'));
 const warning=(state.financialDataError?'<div class="card" style="color:var(--red)">Не удалось обновить операции. Показан остаток по последней успешной загрузке; текущие деньги требуют сверки.</div>':'')+(unknown.length?'<div class="card" style="color:var(--red)">Требуется сверка: '+unknown.length+' операций без даты создания не вошли в остаток. Нельзя подтвердить точность баланса, пока эти записи не проверены.</div>':'');
 picker.innerHTML='<label>Месяц <input type="month" id="cashMonth" value="'+selected+'"></label><span>'+summary.status+' · московское время</span>'+btn('Текущий месяц','current');
 $('cashMonth').onchange=e=>{if(e.target.value){selected=e.target.value;following=selected===day().slice(0,7);render();}};
 const kpi=(label,value)=>'<div class="finance-kpi"><span>'+label+'</span><strong>'+money(value)+'</strong></div>';
 panel('overview',warning+'<div class="finance-kpi-grid">'+kpi('Доступно на расходы на '+fmtDate(summary.until),summary.available)+kpi(selected==='2026-10'?'Поступления после сверки':'Поступления за месяц',summary.incoming)+kpi(selected==='2026-10'?'Оплаты после сверки':'Оплаты за месяц',summary.outgoing)+'</div><div class="card" style="margin-top:16px"><h3>Проверка остатка</h3>'+rowHTML(selected==='2026-10'?'Остаток после сверки 05.10.2026':'Остаток на начало месяца',summary.opening)+rowHTML('+ Поступления',summary.incoming)+rowHTML('− Оплаты',summary.outgoing)+rowHTML('= Фактический баланс на '+fmtDate(summary.until),summary.closing)+rowHTML('В том числе амортизация · 5%',summary.amortization)+'<div class="note">Баланс начинается с 20 000 ₽ на 05.10.2026, 22:26 МСК. Старые операции доступны в истории. Начисления и прогноз кассу не меняют. Прошедший месяц не является бухгалтерским закрытием.</div></div>'+flowHTML(selected<OPENING_DAY.slice(0,7)?events:summary.accounted));
 panel('income','<div class="card"><h3>Сдача помещения</h3><div class="fee-row"><div class="fl">Получено за выбранный месяц</div><div class="fv">'+money(sublease.paid)+'</div></div>'+(sublease.left?btn('Получил '+money(sublease.left),'confirm','sublease'): '<div class="note">Доход за месяц подтверждён</div>')+'</div><div class="note">Оплаты проектов автоматически поступают из карточки проекта → Деньги. Учитывается только принятая сумма.</div><div class="section-label">Фактические поступления за месяц</div><div class="card">'+eventsHTML(events.filter(x=>x.amount>0))+'</div>'+btn('Добавить другой доход','income'));
 panel('expense',[rent,internet].map((x,i)=>'<div class="card" style="margin-bottom:12px"><h3>'+esc(x.label)+'</h3><div class="fee-row"><div class="fl">Оплачено</div><div class="fv">'+money(x.paid)+'</div></div><div class="fee-row"><div class="fl">Осталось по плану</div><div class="fv">'+money(x.left)+'</div></div>'+(x.left?btn('Оплатил '+money(x.left),'confirm',i?'internet':'rent'):'<div class="note">Оплачено за месяц</div>')+btn('Частичная оплата','partial',i?'internet':'rent')+'</div>').join('')+invoicesHTML()+'<div class="card">'+eventsHTML(events.filter(x=>x.amount<0))+'</div>'+btn('Добавить расход','expense'));
 panel('reserve','<div class="finance-v-hero reserve-hero"><span>Фактический баланс компании</span><strong>'+money(all)+'</strong><small>20 000 ₽ после сверки + новые поступления − новые оплаты</small></div>'+'<div class="fee-row"><div class="fl">Амортизация</div><div class="fv">'+money(amortization(state))+'</div></div><div class="fee-row"><div class="fl">Доступно на расходы</div><div class="fv">'+money(available(state))+'</div></div>'+btn('Редактировать баланс','balance')+btn('Вывести деньги','withdraw')+btn('Выгрузить операции для сверки','audit-export')+warning+'<div class="note">Корректировка сохраняется отдельной операцией. Прибыль по договорам не прибавляется к балансу.</div><details><summary>Из чего сложился баланс</summary><div class="fee-row"><div class="fl">Остаток после сверки 05.10.2026</div><div class="fv">'+money(OPENING)+'</div></div><div class="fee-row"><div class="fl">+ Поступления после сверки</div><div class="fv">'+money(receipts)+'</div></div><div class="fee-row"><div class="fl">− Выплаты после сверки</div><div class="fv">'+money(payments)+'</div></div>'+eventsHTML(accounted)+'<div class="note">Старые операции с датой до сверки повторно не учитываются, даже если внесены позже.</div></details>');
 panel('amortization','<div class="finance-kpi-grid">'+kpi('Накоплено на амортизацию',amortization(state))+kpi('Отчислено за месяц',amortEvents(state).filter(x=>x.date.slice(0,7)===selected).reduce((sum,x)=>sum+x.allocation,0))+'</div><div class="note">5% каждого фактического поступления с момента сверки. Это часть денег компании, выделенная в резерв и исключённая из доступного бюджета. Корректировка остатка не является приходом.</div><div class="card">'+(amortEvents(state).filter(x=>x.date.slice(0,7)===selected).map(x=>'<div class="fee-row"><div class="fl">'+fmtDate(x.date)+' · приход '+money(x.amount)+'</div><div class="fv">'+money(x.allocation)+'</div></div>').join('')||'<div class="empty-state">Отчислений за месяц нет</div>')+'</div>');
 panel('team',payrollHTML(events));
 renderForecast();
 // Hide obsolete accrued-finance summaries; keep the previous tabs and payroll UI.
 const old=$('financeObligationsWrap');if(old)old.hidden=true;
}
function forecastProject(p){
 const fees=getProjectFee(p),incoming=expected(p),rows=p.fee_base==='m2'
   ? projectRolePayoutEntries(p.id).map(r=>({id:r.payee_employee_id,amount:n(r.amount)}))
   : [{id:p.employee_id,amount:Math.max(0,n(fees.mainFeeAmount)-n(fees.mainPaid))},
      {id:p.co_employee_id,amount:Math.max(0,n(fees.coFeeAmount)-n(fees.coPaid))}];
 const payouts=rows.filter(r=>r.id),unpaid=payouts.reduce((sum,r)=>sum+r.amount,0);
 return {project:p,incoming,payouts,unpaid,net:incoming-unpaid,amortization:Math.round(incoming*5)/100};
}
function renderForecast(){
 const current=day().slice(0,7);let running=available(state),html='<div class="note">По срокам проектов: оставшаяся оплата клиента минус невыплаченные гонорары по условиям карточки. Авансы повторно не учитываются. Прогноз пересчитывается при изменении стоимости, процентов и сроков; фактический баланс он не меняет.</div>';
 for(let i=0;i<6;i++){
 const month=shift(current,i),projects=dueProjects(state,month),plans=projects.map(forecastProject),income=plans.reduce((a,p)=>a+p.incoming,0),lease=recurringState('sublease',month),rent=recurringState('rent',month),internet=recurringState('internet',month);
 const range=timesheetMonthRange(month),earned=completedProjectEarningsForRange(range.from,range.to).employees,split=splitPayrollByEmployee(earned).result;
 const due={};Object.entries(split).forEach(([id,row])=>due[id]=n(row.payout));
 plans.forEach(plan=>{
   const completed=/заверш/i.test(findStatus(plan.project.status_id)?.name||'');
   plan.payouts.forEach(row=>{
     // Completed project fees already belong to this month's payroll.
     if(!completed)due[row.id]=(due[row.id]||0)+row.amount;

   });
 });
 const salaries=Object.entries(due).reduce((sum,[id,amount])=>sum+salaryPaymentState(id,month,amount).remaining,0);
 const amort=Math.round((income+lease.left)*5)/100,out=rent.left+internet.left+salaries,inc=income+lease.left;
 running+=inc-out-amort;
 html+='<div class="card" style="margin-bottom:14px"><h3>'+esc(ruMonthLabel(month))+'</h3><div class="fee-row"><div class="fl">Остатки оплаты от клиентов</div><div class="fv">'+money(income)+'</div></div><div class="fee-row"><div class="fl">Сдача помещения — ожидается</div><div class="fv">'+money(lease.left)+'</div></div><div class="fee-row"><div class="fl">− Гонорары и зарплаты к выплате</div><div class="fv">'+money(salaries)+'</div></div><div class="fee-row"><div class="fl">− Аренда и интернет</div><div class="fv">'+money(rent.left+internet.left)+'</div></div><div class="fee-row"><div class="fl">− Амортизация · 5% ожидаемых поступлений</div><div class="fv">'+money(amort)+'</div></div><div class="fee-row total"><div class="fl">Прогноз доступного остатка</div><div class="fv" style="color:'+(running<0?'var(--red)':'var(--green)')+'">'+money(running)+'</div></div><details><summary>Проекты и расчёт</summary>'+plans.map(plan=>'<div class="card"><strong>'+esc(plan.project.name)+'</strong><div class="note">Срок: '+fmtDate(plan.project.end_date)+'</div><div class="fee-row"><div class="fl">Клиент доплатит</div><div class="fv">'+money(plan.incoming)+'</div></div>'+plan.payouts.map(row=>'<div class="fee-row"><div class="fl">− '+esc(findEmployee(row.id)?.name||'Сотрудник')+' · '+esc(findEmployee(row.id)?.role||'гонорар')+'</div><div class="fv">'+money(row.amount)+'</div></div>').join('')+'<div class="fee-row total"><div class="fl">Пополнение от проекта до амортизации</div><div class="fv">'+money(plan.net)+'</div></div></div>').join('')+'<div class="note">Выплаты через табель вычитаются из общих обязательств месяца один раз. В расчёте отдельного проекта отражены гонорары за вычетом выплат, привязанных к карточке. Будущие прямые расходы без графика оплаты не включены.</div></details></div>';
 }
 panel('forecast',html);
}
window.ARHITTEKCash.forecastProject=forecastProject;

function openInvoicePayment(invoiceId){
 const invoice=(state.invoices||[]).find(i=>i.id===invoiceId&&!i.deleted_at);if(!invoice||invoice.paid_by_client)return;
 let overlay=$('cashInvoiceOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='cashInvoiceOverlay';overlay.className='sheet-overlay';document.body.appendChild(overlay);}
 const payment=invoicePaymentState(state,invoice),existing=(state.ledger||[]).filter(r=>!r.deleted_at&&r.project_id===invoice.project_id&&['expense','project_expense','payment'].includes(r.type)&&!invoicePaymentId(r)&&!isImportedExpense(r)&&r.entry_date<=day());
 overlay.innerHTML='<div class="sheet"><h3>Оплата накладной</h3><p>'+esc(invoice.description||invoice.number||invoice.item_type)+'</p>'+rowHTML('Связано оплат',payment.paid)+rowHTML('Осталось подтвердить',payment.remaining)+'<div class="field"><label>Запись оплаты</label><select id="cashInvoiceExisting"><option value="">Новая фактическая оплата</option>'+existing.map(r=>'<option value="'+esc(r.id)+'">Связать: '+esc(fmtDate(r.entry_date)+' · '+money(r.amount)+' · '+r.description)+'</option>').join('')+'</select></div><div class="field"><label>Сумма оплаты, ₽</label><input id="cashInvoiceAmount" type="number" min="0.01" step="0.01" value="'+payment.remaining+'"></div><div class="field"><label>Фактическая дата оплаты</label><input id="cashInvoiceDate" type="date" value="'+day()+'"></div><div class="field"><label>Комментарий</label><input id="cashInvoiceNote"></div><button id="cashInvoiceSave" type="button" class="btn btn-primary">Сохранить оплату</button><button id="cashInvoiceClose" type="button" class="btn btn-secondary">Закрыть</button><div class="card">'+payment.rows.map(r=>'<div class="list-item"><span>'+esc(fmtDate(r.entry_date))+' · '+money(r.amount)+'</span>'+btn('Отменить оплату','cancel-invoice',r.id)+'</div>').join('')+'</div></div>';
 $('cashInvoiceExisting').onchange=()=>{const r=existing.find(r=>r.id===$('cashInvoiceExisting').value);$('cashInvoiceAmount').disabled=!!r;$('cashInvoiceDate').disabled=!!r;if(r){$('cashInvoiceAmount').value=r.amount;$('cashInvoiceDate').value=r.entry_date;}else{$('cashInvoiceAmount').value=payment.remaining;$('cashInvoiceDate').value=day();}};
 $('cashInvoiceClose').onclick=()=>overlay.classList.remove('active');
 overlay.onclick=e=>{const b=e.target.closest('[data-cash-action="cancel-invoice"]');if(b)cancelInvoicePayment(b.dataset.id,invoiceId);};
 $('cashInvoiceSave').onclick=async()=>{
  if(busy||!session?.isAdmin)return;
  const linked=existing.find(r=>r.id===$('cashInvoiceExisting').value),amount=linked?n(linked.amount):n($('cashInvoiceAmount').value),date=linked?linked.entry_date:$('cashInvoiceDate').value;
  if(amount<=0||!date||date>day()){showToast('Укажите сумму и фактическую дату оплаты');return;}
  busy=true;$('cashInvoiceSave').disabled=true;
  try{
   const check=await sb.from('ledger_entries').select('*').eq('project_id',invoice.project_id).is('deleted_at',null);if(check.error)throw check.error;
   const fresh=invoicePaymentState({ledger:check.data||[]},invoice);
   if(amount>fresh.remaining+0.009)throw new Error('Оплата больше неподтверждённого остатка');
   const marker='[invoice-payment:'+invoiceId+']';
   if(linked){const row=(check.data||[]).find(r=>r.id===linked.id);if(!row||invoicePaymentId(row))throw new Error('Расход уже изменён');const result=await sb.from('ledger_entries').update({description:marker+' '+(row.description||'Оплата накладной')}).eq('id',row.id);if(result.error)throw result.error;}
   else{const result=await sb.from('ledger_entries').insert({type:'expense',project_id:invoice.project_id,amount,entry_date:date,description:marker+' '+(invoice.description||invoice.number||'Накладная')+($('cashInvoiceNote').value?' · '+$('cashInvoiceNote').value:''),received_by:session.employeeId});if(result.error)throw result.error;}
   await logAudit('project',invoice.project_id,(state.projects||[]).find(p=>p.id===invoice.project_id)?.name||'','update',{invoice_payment:{old:null,new:(linked?'Связан расход: ':'Оплачено: ')+money(amount)}});
   await loadAll();if(linked?.type==='project_expense')await syncProjectExpensesTotal(invoice.project_id);overlay.classList.remove('active');render();showToast(linked?'Расход связан без повторного списания':'Оплата накладной сохранена');
  }catch(error){showToast(error.message||'Не удалось сохранить оплату');}finally{busy=false;if($('cashInvoiceSave'))$('cashInvoiceSave').disabled=false;}
 };
 overlay.classList.add('active');
}
async function cancelInvoicePayment(id,invoiceId){if(busy||!session?.isAdmin||!confirm('Отменить запись оплаты накладной?'))return;busy=true;try{const result=await sb.from('ledger_entries').update({deleted_at:new Date().toISOString()}).eq('id',id);if(result.error)throw result.error;await loadAll();openInvoicePayment(invoiceId);render();}catch(e){showToast('Не удалось отменить оплату');}finally{busy=false;}}
window.openInvoicePayment=openInvoicePayment;

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
 if(state.financialDataReady===false||state.financialDataError){showToast('Сначала обновите финансовые операции');return;}
 let overlay=$('cashBalanceOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='cashBalanceOverlay';overlay.className='sheet-overlay';overlay.innerHTML='<div class="sheet"><h3>Фактический баланс</h3><div class="field"><label>Остаток денег, ₽</label><input id="cashBalanceValue" type="number" step="0.01"></div><div class="field"><label>Комментарий</label><input id="cashBalanceNote"></div><button class="btn btn-primary" id="cashBalanceSave">Сохранить</button><button class="btn btn-secondary" id="cashBalanceCancel">Отмена</button></div>';document.body.appendChild(overlay);$('cashBalanceCancel').onclick=()=>overlay.classList.remove('active');$('cashBalanceSave').onclick=async()=>{if(busy||!session?.isAdmin)return;const target=Number($('cashBalanceValue').value);if(!$('cashBalanceValue').value||!Number.isFinite(target)){showToast('Укажите остаток');return;}const diff=target-balance(state);if(!diff){overlay.classList.remove('active');return;}busy=true;try{const payload={category:diff>0?RESERVE_INCREASE_CATEGORY:RESERVE_DECREASE_CATEGORY,amount:Math.abs(diff),description:'Сверка фактического баланса · '+$('cashBalanceNote').value,[diff>0?'income_date':'expense_date']:day()};const r=await sb.from(diff>0?'company_income':'company_expenses').insert(payload);if(r.error)throw r.error;await loadAll();overlay.classList.remove('active');render();}catch(e){showToast('Ошибка сохранения');}finally{busy=false;}};}
 $('cashBalanceValue').value=balance(state);$('cashBalanceNote').value='';overlay.classList.add('active');
}
async function editEvent(id){
 const [kind,key]=id.split(':');if(kind==='income'){openCompanyIncomeSheet(key);return;}if(kind==='expense'){openCompanyExpenseSheet(key);return;}
 const row=(state.ledger||[]).find(r=>r.id===key);if(!row)return;
 if(invoicePaymentId(row)){openInvoicePayment(invoicePaymentId(row));return;}
 if(row.type==='salary_payment'){const month=(String(row.description||'').match(/\[salary:(\d{4}-\d{2})\]/)||[])[1];if(month){openSalaryPaymentSheet(row.payee_employee_id,month);$('salaryPaymentHistory')?.querySelector('[data-edit-salary-payment="'+key+'"]')?.click();}return;}
 // Project payment editing stays in its existing project history to preserve receipt totals.
 if(row.project_id){openProjectSheet(row.project_id);showToast('Оплата в истории платежей проекта');}else showToast('Редактируйте запись в журнале операций');
}
function act(action,id){if(!session?.isAdmin)return;
 if(action==='audit-export'){const url=URL.createObjectURL(new Blob([JSON.stringify(auditData(state),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='ARHITTEK-finance-'+day()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 if(action==='current'){selected=day().slice(0,7);following=true;render();}
 if(action==='confirm'){if(selected>day().slice(0,7)){showToast('Будущий месяц — только прогноз');return;}confirmRecurring(id);}
 if(action==='partial'){if(selected>day().slice(0,7)){showToast('Будущий месяц — только прогноз');return;}const x=recurringState(id,selected);openCompanyExpenseSheet(null,x.category);$('cex-date').value=day();$('cex-desc').value='[cash:'+id+':'+selected+'] период '+selected;}
 if(action==='income')openCompanyIncomeSheet(null);if(action==='expense')openCompanyExpenseSheet(null);
 if(action==='balance')editBalance();if(action==='withdraw')openCompanyWithdrawal();if(action==='edit')editEvent(id);
 if(action==='salary')openSalaryPaymentSheet(id,selected);
 if(action==='invoice')openInvoicePayment(id);
 if(action==='payroll'){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$('view-timesheet').classList.add('active');$('ts-month').value=selected;renderTimesheet();}
}
getCompanyReserveBalance=()=>balance(state);window.getCompanyAvailableCash=()=>available(state);window.openReserveCorrection=editBalance;
const style=document.createElement('style');style.textContent='.cash-managed>:not(.cash-panel){display:none!important}.cash-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cash-month{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.cash-month label{display:flex;gap:8px;align-items:center}.cash-month input{padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text)}.cash-panel h3{font-size:16px}.cash-panel .card{padding:16px}.cash-panel .btn{margin:8px 6px 8px 0}.cash-panel .list-item{gap:12px;flex-wrap:wrap}#financeObligationsWrap{display:none!important}';style.textContent+='\n#view-finance.cash-preview-style{color-scheme:light dark;--cash-bg:light-dark(#f4f6fa,#111824);--cash-surface:light-dark(#ffffff,#1b2534);--cash-text:light-dark(#16233a,#eef2f9);--cash-muted:light-dark(#627491,#b0bfd2);--cash-line:light-dark(#dce4ef,#344458);--cash-blue:light-dark(#176dea,#82b2ff);background:var(--cash-bg);color:var(--cash-text);padding:24px;border-radius:14px}\n#view-finance.cash-preview-style .workspace-head{background:transparent;border:0;box-shadow:none;padding:0;margin-bottom:20px}\n#view-finance.cash-preview-style .workspace-head h1{font:600 28px/1.3 system-ui;margin:4px 0}\n#view-finance.cash-preview-style .workspace-eyebrow,#view-finance.cash-preview-style .workspace-description{color:var(--cash-muted)}\n#view-finance.cash-preview-style .workspace-date{display:none}\n#view-finance.cash-preview-style .finance-visual-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:6px;background:var(--cash-surface);border:0;border-radius:12px;margin:18px 0;overflow:visible}\n#view-finance.cash-preview-style .finance-visual-tabs button{flex:1;min-width:90px;border:0;border-radius:8px;padding:10px 12px;background:var(--cash-surface);color:var(--cash-text);box-shadow:none;font:400 14px/1.5 system-ui;min-height:42px}\n#view-finance.cash-preview-style .finance-visual-tabs button.active{background:var(--cash-blue);color:light-dark(#ffffff,#111824)}\n#view-finance.cash-preview-style .cash-panel .card,#view-finance.cash-preview-style .finance-kpi{background:var(--cash-surface);color:var(--cash-text);border:1px solid var(--cash-line);border-radius:12px;box-shadow:none;padding:18px;margin-bottom:12px}\n#view-finance.cash-preview-style .cash-panel h3{font:600 16px/1.5 system-ui;margin:0 0 12px}\n#view-finance.cash-preview-style .cash-panel .btn,#view-finance.cash-preview-style .cash-month .btn{font:400 14px/1.5 system-ui;padding:10px 12px;background:var(--cash-surface);color:var(--cash-text);border:1px solid var(--cash-line);border-radius:8px;min-height:42px;box-shadow:none}\n#view-finance.cash-preview-style .cash-panel .fee-row{border-color:var(--cash-line);padding:12px 0}\n#view-finance.cash-preview-style .cash-panel .fl,#view-finance.cash-preview-style .cash-panel .fv{color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-month input{font:400 14px/1.5 system-ui;padding:10px;border:1px solid var(--cash-line);border-radius:8px;background:var(--cash-surface);color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-month{gap:12px;color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-panel .note{color:var(--cash-muted)}\n@media(max-width:600px){#view-finance.cash-preview-style{padding:14px}#view-finance.cash-preview-style .finance-visual-tabs button{flex:1 0 28%;min-width:0}#view-finance.cash-preview-style .finance-kpi-grid{grid-template-columns:1fr}}\n';style.textContent+='\n#view-finance .cash-panel .fee-row{gap:12px;align-items:flex-start}#view-finance .cash-panel .fl{flex:1;min-width:0;overflow-wrap:anywhere}#view-finance .cash-panel .fv{flex:0 0 auto;white-space:nowrap}\n';document.head.appendChild(style);
$('view-finance')?.addEventListener('click',e=>{const b=e.target.closest('[data-cash-action]');if(b)act(b.dataset.cashAction,b.dataset.id);});
for(const name of ['renderAll','renderAnalytics','renderFinanceVisualPanels','renderCompanyBudget','renderCompanyIncomeList','renderCompanyExpensesList','renderTimesheet']){const old=window[name];if(typeof old==='function')window[name]=function(){const r=old.apply(this,arguments);setTimeout(render,0);return r;};}
window.renderCashFinance=render;
setInterval(()=>{const now=day();if(now!==lastDay){lastDay=now;if(following)selected=now.slice(0,7);render();}},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(following)selected=day().slice(0,7);render();}});setTimeout(render,1600);
})();
