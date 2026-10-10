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
function amortEvents(s,until=day()){return cashEvents(s).filter(x=>x.afterSnapshot&&x.date<=until&&x.amount>0&&!/корректиров|сверка|пополнение резерва/i.test((x.row.category||'')+' '+(x.row.description||''))).map(x=>({...x,allocation:Math.round(x.amount*5)/100}));}
function amortization(s,until=day()){return amortEvents(s,until).reduce((sum,x)=>sum+x.allocation,0);}
function available(s,until=day()){const total=balance(s,until);return total===null?null:Math.round((total-amortization(s,until))*100)/100;}
function monthSummary(s,month){const current=day().slice(0,7),events=cashEvents(s).filter(x=>x.date.slice(0,7)===month&&x.date<=day()),incoming=events.filter(x=>x.amount>0).reduce((a,x)=>a+x.amount,0),outgoing=-events.filter(x=>x.amount<0).reduce((a,x)=>a+x.amount,0),previous=shift(month,-1),[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),prevLast=new Date(Date.UTC(Number(previous.slice(0,4)),Number(previous.slice(5)),0)).toISOString().slice(0,10);
 return {month,status:month<current?'Закрыт':month===current?'Текущий':'План',incoming,outgoing,events,opening:month==='2026-10'?OPENING:balance(s,prevLast),closing:month>current?null:balance(s,month===current?day():last)};}
function expected(p){return Math.max(0,n(p.price)-n(p.advance));}
function dueProjects(s,month){return (s.projects||[]).filter(p=>!p.deleted_at&&String(p.end_date||'').slice(0,7)===month).filter(p=>{const status=(s.statuses||[]).find(x=>x.id===p.status_id);return !/заморож|отмен/i.test(status?.name||'');});}
window.ARHITTEKCash={day,shift,period,cashEvents,balance,amortEvents,amortization,available,monthSummary,expected,dueProjects,opening:OPENING,cutoff:CUTOFF};
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
 const finance=$('view-finance');finance.classList.add('cash-preview-style');const description=finance.querySelector('.workspace-description');if(description)description.textContent='Подтверждённые поступления и оплаты';
 const summary=monthSummary(state,selected),all=balance(state),events=summary.events,rent=recurringState('rent',selected),internet=recurringState('internet',selected),sublease=recurringState('sublease',selected);
 picker.innerHTML='<label>Месяц <input type="month" id="cashMonth" value="'+selected+'"></label><span>'+summary.status+' · московское время</span>'+btn('Текущий месяц','current');
 $('cashMonth').onchange=e=>{if(e.target.value){selected=e.target.value;following=selected===day().slice(0,7);render();}};
 const kpi=(label,value)=>'<div class="finance-kpi"><span>'+label+'</span><strong>'+money(value)+'</strong></div>';
 panel('overview','<div class="finance-kpi-grid">'+kpi('Доступно на расходы',available(state))+kpi('Получено за месяц',summary.incoming)+kpi('Оплачено за месяц',summary.outgoing)+'</div><div class="card" style="margin-top:16px"><div class="fee-row"><div class="fl">'+(selected==='2026-10'?'Остаток после сверки 05.10.2026':'Остаток на начало месяца')+'</div><div class="fv">'+money(summary.opening)+'</div></div><div class="fee-row total"><div class="fl">Остаток '+(summary.status==='Закрыт'?'на конец месяца':'сейчас')+'</div><div class="fv">'+money(summary.closing)+'</div></div><div class="fee-row"><div class="fl">Амортизация · 5% поступлений</div><div class="fv">'+money(amortization(state))+'</div></div><div class="note">Баланс начинается с 20 000 ₽ на 05.10.2026, 22:26 МСК. Старые операции показаны в истории, но повторно в этот остаток не включаются. Планы и начисления деньги не списывают.</div></div>');
 panel('income','<div class="card"><h3>Сдача помещения</h3><div class="fee-row"><div class="fl">Получено за выбранный месяц</div><div class="fv">'+money(sublease.paid)+'</div></div>'+(sublease.left?btn('Получил '+money(sublease.left),'confirm','sublease'): '<div class="note">Доход за месяц подтверждён</div>')+'</div><div class="note">Оплаты проектов автоматически поступают из карточки проекта → Деньги. Учитывается только принятая сумма.</div><div class="section-label">Фактические поступления за месяц</div><div class="card">'+eventsHTML(events.filter(x=>x.amount>0))+'</div>'+btn('Добавить другой доход','income'));
 panel('expense',[rent,internet].map((x,i)=>'<div class="card" style="margin-bottom:12px"><h3>'+esc(x.label)+'</h3><div class="fee-row"><div class="fl">Оплачено</div><div class="fv">'+money(x.paid)+'</div></div><div class="fee-row"><div class="fl">Осталось по плану</div><div class="fv">'+money(x.left)+'</div></div>'+(x.left?btn('Оплатил '+money(x.left),'confirm',i?'internet':'rent'):'<div class="note">Оплачено за месяц</div>')+btn('Частичная оплата','partial',i?'internet':'rent')+'</div>').join('')+'<div class="card">'+eventsHTML(events.filter(x=>x.amount<0))+'</div>'+btn('Добавить расход','expense'));
 panel('reserve','<div class="finance-v-hero reserve-hero"><span>Фактический баланс компании</span><strong>'+money(all)+'</strong><small>20 000 ₽ после сверки + новые поступления − новые оплаты</small></div>'+'<div class="fee-row"><div class="fl">Амортизация</div><div class="fv">'+money(amortization(state))+'</div></div><div class="fee-row"><div class="fl">Доступно на расходы</div><div class="fv">'+money(available(state))+'</div></div>'+btn('Редактировать баланс','balance')+btn('Вывести деньги','withdraw')+'<div class="note">Корректировка сохраняется отдельной операцией. Прибыль по договорам не прибавляется к балансу.</div>');
 panel('amortization','<div class="finance-kpi-grid">'+kpi('Накоплено на амортизацию',amortization(state))+kpi('Отчислено за месяц',amortEvents(state).filter(x=>x.date.slice(0,7)===selected).reduce((sum,x)=>sum+x.allocation,0))+'</div><div class="note">5% каждого фактического поступления с момента сверки. Это часть денег компании, выделенная в резерв и исключённая из доступного бюджета. Корректировка остатка не является приходом.</div><div class="card">'+(amortEvents(state).filter(x=>x.date.slice(0,7)===selected).map(x=>'<div class="fee-row"><div class="fl">'+fmtDate(x.date)+' · приход '+money(x.amount)+'</div><div class="fv">'+money(x.allocation)+'</div></div>').join('')||'<div class="empty-state">Отчислений за месяц нет</div>')+'</div>');
 let payroll=$('cashPayrollLink');const team=document.querySelector('.finance-visual-panel[data-fin-panel="team"]');if(team){if(!payroll){payroll=document.createElement('div');payroll.id='cashPayrollLink';team.prepend(payroll);}payroll.innerHTML='<div class="note">Зарплата за '+esc(ruMonthLabel(selected))+'. Начисления не списывают деньги: баланс меняется только после записи фактической выплаты.</div>'+btn('Открыть табель этого месяца','payroll');}
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
     else if(plan.project.fee_base!=='m2'){
       const fees=getProjectFee(plan.project);
       const directPaid=row.id===plan.project.employee_id?n(fees.mainPaid):n(fees.coPaid);
       due[row.id]=Math.max(0,(due[row.id]||0)-directPaid);
     }
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
 if(action==='partial'){if(selected>day().slice(0,7)){showToast('Будущий месяц — только прогноз');return;}const x=recurringState(id,selected);openCompanyExpenseSheet(null,x.category);$('cex-date').value=day();$('cex-desc').value='[cash:'+id+':'+selected+'] период '+selected;}
 if(action==='income')openCompanyIncomeSheet(null);if(action==='expense')openCompanyExpenseSheet(null);
 if(action==='balance')editBalance();if(action==='withdraw')openCompanyWithdrawal();if(action==='edit')editEvent(id);
 if(action==='payroll'){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$('view-timesheet').classList.add('active');$('ts-month').value=selected;renderTimesheet();}
}
getCompanyReserveBalance=()=>available(state);window.openReserveCorrection=editBalance;
const style=document.createElement('style');style.textContent='.cash-managed>:not(.cash-panel){display:none!important}.cash-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cash-month{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.cash-month label{display:flex;gap:8px;align-items:center}.cash-month input{padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text)}.cash-panel h3{font-size:16px}.cash-panel .card{padding:16px}.cash-panel .btn{margin:8px 6px 8px 0}.cash-panel .list-item{gap:12px;flex-wrap:wrap}#financeObligationsWrap{display:none!important}';style.textContent+='\n#view-finance.cash-preview-style{color-scheme:light dark;--cash-bg:light-dark(#f4f6fa,#111824);--cash-surface:light-dark(#ffffff,#1b2534);--cash-text:light-dark(#16233a,#eef2f9);--cash-muted:light-dark(#627491,#b0bfd2);--cash-line:light-dark(#dce4ef,#344458);--cash-blue:light-dark(#176dea,#82b2ff);background:var(--cash-bg);color:var(--cash-text);padding:24px;border-radius:14px}\n#view-finance.cash-preview-style .workspace-head{background:transparent;border:0;box-shadow:none;padding:0;margin-bottom:20px}\n#view-finance.cash-preview-style .workspace-head h1{font:600 28px/1.3 system-ui;margin:4px 0}\n#view-finance.cash-preview-style .workspace-eyebrow,#view-finance.cash-preview-style .workspace-description{color:var(--cash-muted)}\n#view-finance.cash-preview-style .workspace-date{display:none}\n#view-finance.cash-preview-style .finance-visual-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:6px;background:var(--cash-surface);border:0;border-radius:12px;margin:18px 0;overflow:visible}\n#view-finance.cash-preview-style .finance-visual-tabs button{flex:1;min-width:90px;border:0;border-radius:8px;padding:10px 12px;background:var(--cash-surface);color:var(--cash-text);box-shadow:none;font:400 14px/1.5 system-ui;min-height:42px}\n#view-finance.cash-preview-style .finance-visual-tabs button.active{background:var(--cash-blue);color:light-dark(#ffffff,#111824)}\n#view-finance.cash-preview-style .cash-panel .card,#view-finance.cash-preview-style .finance-kpi{background:var(--cash-surface);color:var(--cash-text);border:1px solid var(--cash-line);border-radius:12px;box-shadow:none;padding:18px;margin-bottom:12px}\n#view-finance.cash-preview-style .cash-panel h3{font:600 16px/1.5 system-ui;margin:0 0 12px}\n#view-finance.cash-preview-style .cash-panel .btn,#view-finance.cash-preview-style .cash-month .btn{font:400 14px/1.5 system-ui;padding:10px 12px;background:var(--cash-surface);color:var(--cash-text);border:1px solid var(--cash-line);border-radius:8px;min-height:42px;box-shadow:none}\n#view-finance.cash-preview-style .cash-panel .fee-row{border-color:var(--cash-line);padding:12px 0}\n#view-finance.cash-preview-style .cash-panel .fl,#view-finance.cash-preview-style .cash-panel .fv{color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-month input{font:400 14px/1.5 system-ui;padding:10px;border:1px solid var(--cash-line);border-radius:8px;background:var(--cash-surface);color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-month{gap:12px;color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-panel .note{color:var(--cash-muted)}\n@media(max-width:600px){#view-finance.cash-preview-style{padding:14px}#view-finance.cash-preview-style .finance-visual-tabs button{flex:1 0 28%;min-width:0}#view-finance.cash-preview-style .finance-kpi-grid{grid-template-columns:1fr}}\n';document.head.appendChild(style);
$('view-finance')?.addEventListener('click',e=>{const b=e.target.closest('[data-cash-action]');if(b)act(b.dataset.cashAction,b.dataset.id);});
for(const name of ['renderAll','renderAnalytics','renderFinanceVisualPanels','renderCompanyBudget','renderCompanyIncomeList','renderCompanyExpensesList','renderTimesheet']){const old=window[name];if(typeof old==='function')window[name]=function(){const r=old.apply(this,arguments);setTimeout(render,0);return r;};}
window.renderCashFinance=render;
setInterval(()=>{const now=day();if(now!==lastDay){lastDay=now;if(following)selected=now.slice(0,7);render();}},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(following)selected=day().slice(0,7);render();}});setTimeout(render,1600);
})();
