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
 const incoming=new Set(['advance','final_payment','income','materials_budget','construction_budget']),outgoing=new Set(['expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund']);
 (s.ledger||[]).forEach(r=>{if(incoming.has(r.type))add(r,'ledger',r.entry_date,n(r.amount));else if(outgoing.has(r.type))add(r,'ledger',r.entry_date,-n(r.amount));});
 return out.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function bookBalance(s,until=day()){if(until<OPENING_DAY)return null;return rounded(OPENING+total(cashEvents(s).filter(x=>x.afterSnapshot&&x.date<=until)));}
function cashCount(s,until=day()){
 const now=new Date().getTime(),rows=[];
 for(const row of s.cashCounts||[]){
  const value=row.changes?.cash_count?.new,at=Date.parse(value?.counted_at);
  if(row.entity_type!=='reserve'||row.action!=='cash_count'||value?.version!==1||typeof value.total!=='number'||!Number.isFinite(value.total)||value.total<0||!Number.isFinite(at)||at>now)continue;
  const countedDay=day(new Date(at));if(countedDay>until||countedDay<OPENING_DAY)continue;
  rows.push({id:row.id,total:rounded(value.total),at,countedAt:value.counted_at,day:countedDay,note:String(value.note||''),recordedAt:row.created_at||'',bookBalanceAtCount:n(value.book_balance)});
 }
 return rows.sort((a,b)=>b.at-a.at||String(b.recordedAt).localeCompare(String(a.recordedAt))||String(b.id).localeCompare(String(a.id)))[0]||null;
}
function afterCashCount(event,count){
 if(isAdjustment(event.row)||isImportedExpense(event.row)||isCountedNote(event.row.description,count))return false;
 const created=Date.parse(event.row.created_at);
 return Number.isFinite(created)&&(event.date>count.day||(event.date===count.day&&created>count.at));
}
function isCountedNote(note,count){return !!count&&String(note||'').includes('[cash:counted:'+encodeURIComponent(count.id)+']');}
function displayNote(note){return String(note||'').replace(/\s*\[funded:[^\]]+\]/g,'').replace(/\s*\[cash:counted:[^\]]+\]/g,'').trim();}
function balance(s,until=day()){
 if(s.financialJournal?.active&&until===day())return ARHITTEKJournal.budget(s).cashBalance;
 if(until<OPENING_DAY)return null;
 const count=cashCount(s,until);if(!count)return bookBalance(s,until);
 return rounded(count.total+total(cashEvents(s).filter(event=>event.date<=until&&afterCashCount(event,count))));
}
function cashStatus(s,until=day()){
 const count=cashCount(s,until),book=bookBalance(s,until),actual=balance(s,until);
 return {count,bookBalance:book,cashBalance:actual,difference:count?rounded(book-actual):0};
}
function constructionProject(s,p){
 if(!p)return false;
 const category=(s.categories||[]).find(c=>c.id===p.category_id),department=(s.departments||[]).find(d=>d.id===category?.department_id);
 if(category&&(department?.name==='Строительный отдел'||/строительств|ремонт|монтаж/i.test(category.name||'')))return true;
 return typeof isConstructionProject==='function'&&isConstructionProject(p);
}
function amortEvents(s,until=day(),construction=p=>constructionProject(s,p)){
 const projects=window.ARHITTEKBudget.projectRows(s);
 // A client's construction advance is entrusted money, not company revenue.
 return cashEvents(s).filter(x=>x.afterSnapshot&&x.date<=until&&x.amount>0&&!isAdjustment(x.row)&&
   !(x.kind==='ledger'&&construction(projects.find(p=>p.id===x.row.project_id))))
   .map(x=>({...x,allocation:Math.round(x.amount*5)/100}));
}
function amortization(s,until=day(),construction){if(s.financialJournal?.active&&until===day())return Number(s.financialJournal.balances.amortization)||0;return rounded(amortEvents(s,until,construction).reduce((sum,x)=>sum+x.allocation,0));}
function projectBudget(s,until=day(),hooks){if(s.financialJournal?.active&&until===day())return ARHITTEKJournal.budget(s);return window.ARHITTEKBudget.calculate(s,until,hooks);}
function available(s,until=day()){return projectBudget(s,until).available;}
function monthSummary(s,month){const current=day().slice(0,7),events=cashEvents(s).filter(x=>x.date.slice(0,7)===month&&x.date<=day()),accounted=events.filter(x=>x.afterSnapshot),previous=shift(month,-1),[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),prevLast=new Date(Date.UTC(Number(previous.slice(0,4)),Number(previous.slice(5)),0)).toISOString().slice(0,10),until=month===current?day():last;
 const movements=month<OPENING_DAY.slice(0,7)?events:accounted;
 const incoming=total(movements.filter(x=>x.amount>0)),outgoing=Math.abs(total(movements.filter(x=>x.amount<0))),opening=month>current?null:month===OPENING_DAY.slice(0,7)?OPENING:balance(s,prevLast),closing=month>current?null:balance(s,until),reconciliation=opening===null||closing===null?0:rounded(closing-opening-incoming+outgoing);
 return {month,status:month<current?'Прошедший':month===current?'Текущий':'План',incoming,outgoing,events,accounted,until,opening,closing,reconciliation,available:month>current?null:available(s,until),amortization:month>current?null:amortization(s,until)};}
function flowGroup(event){const row=event.row;if(isAdjustment(row))return 'adjustments';if(event.amount>0)return event.kind==='ledger'&&row.project_id?'clients':'otherIncome';if(['salary_payment','fee_payment'].includes(row.type)||(row.type==='payment'&&row.payee_employee_id))return 'team';if(row.type==='withdrawal'||row.category==='Вывод средств')return 'withdrawals';if(row.project_id)return 'projects';return 'company';}
function flowSummary(events){const groups={clients:0,otherIncome:0,team:0,projects:0,company:0,withdrawals:0,adjustments:0};events.forEach(event=>{const key=flowGroup(event);groups[key]=rounded(groups[key]+(key==='adjustments'?event.amount:Math.abs(event.amount)));});return groups;}
function invoicePaymentId(row){return (String(row.description||'').match(/\[invoice-payment:([^\]]+)\]/)||[])[1]||null;}
function invoicePaymentState(s,invoice,until=day()){const rows=(s.ledger||[]).filter(r=>invoice.id&&invoice.project_id&&!r.deleted_at&&r.project_id===invoice.project_id&&['expense','project_expense','payment'].includes(r.type)&&invoicePaymentId(r)===invoice.id),paid=rounded(rows.filter(r=>r.entry_date<=until).reduce((sum,r)=>sum+n(r.amount),0));return {rows,paid,remaining:Math.max(0,rounded(n(invoice.amount)-paid)),overpaid:Math.max(0,rounded(paid-n(invoice.amount)))};}
function auditData(s){
 const pick=(rows,keys)=>(rows||[]).map(row=>Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])));
 return {version:4,financialJournal:s.financialJournal||null,constructionPolicy:'client_funds_held_until_explicit_allocation',exportedAt:new Date().toISOString(),asOf:day(),lastSuccessfulLoad:s.financialLoadedAt||null,loadError:s.financialDataError||null,openingSnapshot:{kind:'company-reserve',amount:OPENING,at:CUTOFF,projectAdvancesExcluded:true},calculation:{balance:balance(s),...cashStatus(s),...projectBudget(s)},cashCounts:pick(s.cashCounts,['id','entity_type','entity_name','action','changes','created_at']),
  projects:pick(window.ARHITTEKBudget.projectRows(s),['id','name','category_id','status_id','price','advance','balance','expenses','employee_id','co_employee_id','fee_base','fee_percent','co_fee_percent','fee_paid','co_fee_paid','end_date','created_at','deleted_at']),
  employees:pick(s.employees,['id','name','role','active','is_salaried','fixed_salary']),categories:pick(s.categories,['id','name','fee_base','fee_percent','department_id']),departments:pick(s.departments,['id','name']),statuses:pick(s.statuses,['id','name']),
  ledger:pick(s.ledger,['id','project_id','type','amount','entry_date','created_at','description','payee_employee_id','deleted_at']),
  companyIncome:pick(s.companyIncome,['id','category','amount','income_date','created_at','description','deleted_at']),companyExpenses:pick(s.companyExpenses,['id','category','amount','expense_date','created_at','description','deleted_at']),
  invoices:pick(s.invoices,['id','project_id','amount','invoice_date','created_at','item_type','description','paid_by_client','deleted_at']),timesheetPayments:pick(s.timesheetPayments,['id','employee_id','month','paid','paid_at'])};
}
function expected(p){const received=typeof isConstructionProject==='function'&&isConstructionProject(p)&&typeof getConstructionFinancials==='function'?getConstructionFinancials(p).received:p.advance;return Math.max(0,n(p.price)-n(received));}
function dueProjects(s,month){return (s.projects||[]).filter(p=>!p.deleted_at&&String(p.end_date||'').slice(0,7)===month).filter(p=>{const status=(s.statuses||[]).find(x=>x.id===p.status_id);return !/заморож|отмен/i.test(status?.name||'');});}
window.ARHITTEKCash={day,shift,period,constructionProject,cashEvents,balance,bookBalance,cashCount,cashStatus,isCountedNote,displayNote,amortEvents,amortization,projectBudget,available,monthSummary,flowGroup,flowSummary,isAdjustment,isImportedExpense,invoicePaymentId,invoicePaymentState,auditData,expected,dueProjects,opening:OPENING,cutoff:CUTOFF};
if(typeof document==='undefined')return;
const $=id=>document.getElementById(id),esc=v=>escapeHtml(String(v??'')),money=v=>v===null?'—':fmtMoney(n(v));let selected=day().slice(0,7),following=true,busy=false,lastDay=day();
function attachCountField(fieldId){
 const field=$(fieldId);if(!field)return;
 const count=cashCount(state),id='counted-before-'+fieldId;let box=$(id);
 if(!count){box?.closest('.cash-count-field')?.remove();return;}
 if(!box){const label=document.createElement('label');label.className='cash-count-field note';label.style.cssText='display:flex;gap:8px;align-items:flex-start;margin:10px 0';box=document.createElement('input');box.type='checkbox';box.id=id;box.style.cssText='width:18px;height:18px;flex:0 0 auto';const text=document.createElement('span');label.append(box,text);(field.closest('.field')||field).after(label);}
 box.nextElementSibling.textContent='Эти деньги уже входили в фактическую сверку '+fmtDate(count.day)+' (восстанавливаю старую операцию)';
 box.checked=isCountedNote(field.value,count);field.value=displayNote(field.value);
}
function operationDescription(fieldId,note){
 const count=cashCount(state),box=$('counted-before-'+fieldId);
 if(!count||!box)return note;
 const text=displayNote(note);return box.checked?(text?text+' ':'')+'[cash:counted:'+encodeURIComponent(count.id)+']':text;
}
window.ARHITTEKCash.attachCountField=attachCountField;window.ARHITTEKCash.operationDescription=operationDescription;
const recurring={rent:{label:'Аренда офиса',category:'Аренда',amount:110000,table:'company_expenses'},internet:{label:'Интернет',category:'Связь и интернет',amount:2500,table:'company_expenses'},sublease:{label:'Сдача помещения',category:'Аренда помещений',amount:20000,table:'company_income'}};
function recurringState(kind,month){const def=recurring[kind],list=kind==='sublease'?state.companyIncome:state.companyExpenses,rows=(list||[]).filter(r=>!r.deleted_at&&r.category===def.category&&period(r)===month&&(r.income_date||r.expense_date)<=day()),paid=rounded(rows.reduce((a,r)=>a+n(r.amount),0)),plan=kind==='sublease'?20000:Math.max(0,n(localStorage.getItem('forecast_'+kind)??def.amount));return {...def,rows,paid,plan,left:Math.max(0,plan-paid)};}
function btn(label,action,id=''){return '<button type="button" class="btn btn-secondary" data-cash-action="'+action+'" data-id="'+esc(id)+'" style="width:auto">'+label+'</button>';}
function eventsHTML(events){return events.length?events.map(x=>{
 const r=x.row,p=(state.projects||[]).find(p=>p.id===r.project_id),team=flowGroup(x)==='team',employee=team?findEmployee(r.payee_employee_id||p?.employee_id):null;
 const payrollMonth=(String(r.description||'').match(/\[salary:(\d{4}-\d{2})\]/)||[])[1];
 const kind=r.type==='salary_payment'?(employee?.is_salaried?'Зарплата':/менеджер/i.test(employee?.role||'')?'Комиссия':'Проектный гонорар'):'Гонорар';
 const label=team?kind+' · '+(employee?.name||'Сотрудник не указан'):p?.name||r.category||ledgerTypeLabels[r.type]?.label||'Операция';
 const note=displayNote(r.description).replace(/^\[salary:\d{4}-\d{2}\]\s*/,'');
 return '<div class="list-item"><div><div class="li-name">'+esc(label)+'</div><div class="li-meta">'+fmtDate(x.date)+(payrollMonth?' · за '+esc(ruMonthLabel(payrollMonth)):'')+(employee?.role?' · '+esc(employee.role):'')+(note?' · '+esc(note):'')+(!x.afterSnapshot?' · '+esc(x.excludedReason):'')+(isCountedNote(r.description,cashCount(state))?' · уже входило в сверку':'')+'</div></div><div class="cash-actions"><b style="color:'+(x.amount>0?'var(--green)':'var(--red)')+'">'+(x.amount>0?'+':'−')+money(Math.abs(x.amount))+'</b>'+btn('Редактировать','edit',x.kind+':'+r.id)+'</div></div>';
 }).join(''):'<div class="empty-state">Подтверждённых операций нет</div>';}
function rowHTML(label,amount){return '<div class="fee-row"><div class="fl">'+esc(label)+'</div><div class="fv">'+money(amount)+'</div></div>';}
function cashPositionHTML(until=day()){
 const status=cashStatus(state,until),b=projectBudget(state,until);
 if(!status.count)return '<div class="card"><h3>Деньги по журналу</h3>'+rowHTML('Денежный остаток по журналу',status.bookBalance)+'<div class="note">Это расчёт от прежней стартовой суммы, а не подтверждённые деньги на руках. Для точного остатка нужна сверка наличных и счетов. Закрытие проекта не добавляет сюда старый аванс.</div>'+btn('Сверить все деньги компании','balance')+'</div>';
 const difference=status.difference;
 return '<div class="card"><h3>Все деньги компании</h3><strong data-company-total>'+money(status.cashBalance)+'</strong><div class="note">Сверка '+fmtDate(status.count.day)+' и новые оплаты после неё. В этой сумме уже находятся деньги проектов, команды и амортизация.</div>'+rowHTML('Резерв вместе с амортизацией',b.companyReserve+b.amortization)+(difference?'<div data-cash-discrepancy="'+difference+'">'+rowHTML('По денежному журналу',status.bookBalance)+rowHTML('Расхождение, требующее проверки',difference)+'<div class="note" style="color:var(--red)">Журнал и фактические деньги не совпадают. Сверка сохраняет этот вопрос открытым; сумма расхождения не записывается расходом или доходом.</div></div>':'<div class="note">Денежный журнал совпадает со сверкой.</div>')+(status.count.note?'<div class="note">'+esc(status.count.note)+'</div>':'')+'</div>';
}
function budgetHTML(b){return '<div class="card"><h3>Распределение денег</h3>'+rowHTML(b.countedCash?'Все деньги по фактической сверке и новым оплатам':'Денежный остаток по журналу · до фактической сверки',b.cashBalance)+rowHTML('− Средства проектов и заказчиков стройки',b.projectsHeld)+rowHTML('− Команде по завершённым проектам',b.teamHeld)+rowHTML('− Неоплаченные расходы завершённых проектов',b.costsHeld)+rowHTML('− Амортизация',b.amortization)+rowHTML('= Расчётный свободный резерв',b.companyReserve)+(!b.countedCash&&b.releasedOpeningFunds?'<div class="note">В истории завершённых проектов есть старые авансы '+money(b.releasedOpeningFunds)+'. Они не являются новым приходом и не прибавлены к деньгам. Их остаток требует фактической сверки.</div>':'')+'<div class="note">Распределение рассчитано по обязательствам текущего журнала с 05.10.2026. Старые авансы и выплаты до этой даты требуют отдельной сверки; свободный резерв пока расчётный. Аванс остаётся в бюджете проекта. Доля команды и амортизация выделены внутри общих денег. При фактической сверке старый аванс уже входит в общий остаток. Выплата удержанного гонорара уменьшает деньги и долг одновременно. Общие расходы уменьшают резерв напрямую.</div></div>';}
function projectBudgetsHTML(b){return '<details class="card"><summary>Распределение по проектам</summary>'+b.projects.map(d=>'<div class="card"><strong>'+esc(d.name)+'</strong>'+(d.archived?'<div class="note">Проект в корзине. Его денежные операции и обязательства сохранены.</div>':'')+'<div class="note">'+(d.construction?'Деньги заказчика удерживаются независимо от статуса объекта':d.completed?'Завершён · доля распределена компании':'Деньги остаются у проекта')+'</div>'+rowHTML('Аванс до 05.10.2026 · история',d.openingProjectFunds)+rowHTML('Поступило по журналу с 05.10.2026',d.receivedAfterSnapshot)+rowHTML('Прямые расходы по журналу с 05.10.2026',d.directPaidAfterSnapshot)+rowHTML('Команде по журналу с 05.10.2026',d.teamPaidAfterSnapshot)+rowHTML('Амортизация из этих поступлений',d.amortization)+rowHTML(d.construction?'Средства заказчика стройки · по журналу':'Осталось у незавершённого проекта',d.projectHeld)+d.team.map(t=>rowHTML((findEmployee(t.employeeId)?.name||'Сотрудник')+' · '+t.month+' · осталось выплатить',t.remaining)).join('')+(d.costsHeld?rowHTML('Зарезервировано на прямые расходы',d.costsHeld):'')+(d.completed&&!d.construction?rowHTML('Доля компании по новым операциям · без старых авансов',d.companyContribution):'')+(d.construction?'<div class="note">Накладные и наценка сами по себе не переводят деньги в резерв. Для перечисления вознаграждения компании нужна отдельная подтверждённая операция распределения.</div>':'')+'</div>').join('')+'<div class="note">Начальные 20 000 ₽ — резерв компании. Исторические авансы показаны для проверки. Они не прибавляются к общему остатку при завершении и не отменяют реальные списания. До фактической сверки суммы по прежней стартовой базе предварительные. На амортизацию выделяется 5% поступлений проектного отдела и прочих доходов компании. Авансы на строительство полностью остаются деньгами заказчика; с них амортизация не удерживается. Оклады, премии и будущие гонорары показаны в команде и прогнозе.</div></details>';}
function flowHTML(events){const f=flowSummary(events);return '<div class="card"><h3>Куда движутся деньги</h3>'+rowHTML('+ От клиентов',f.clients)+rowHTML('+ Доходы компании',f.otherIncome)+rowHTML('− Команде: зарплата и гонорары',f.team)+rowHTML('− По проектам: закупки и прямые расходы',f.projects)+rowHTML('− Компания: офис, связь и прочее',f.company)+rowHTML('− Вывод денег',f.withdrawals)+rowHTML('Сверка остатка',f.adjustments)+'</div>';}
function payrollHTML(events){
 const payments=events.filter(x=>flowGroup(x)==='team');
 let html='<div class="card"><h3>Деньги, выданные команде в этом месяце</h3>'+rowHTML('Фактические выплаты',Math.abs(total(payments)))+'<div class="note">По дате выдачи денег. Начисление за проект само по себе не является выплатой. Реклама учитывается отдельно в расходах компании и не погашает комиссию менеджера.</div>'+eventsHTML(payments)+'</div>';
 if(typeof salaryPaymentState==='function'){
  const range=timesheetMonthRange(selected),earned=completedProjectEarningsForRange(range.from,range.to).employees,split=splitPayrollByEmployee(earned).result;
  const employees=(state.employees||[]).map(e=>({employee:e,payment:salaryPaymentState(e.id,selected,n(split[e.id]?.payout))})).filter(x=>x.payment.due||x.payment.paid);
  html+='<div class="card"><h3>Начисления за '+esc(ruMonthLabel(selected))+'</h3><div class="note">Оклад, проектная часть и премии. Это обязательства перед командой; они меняют кассу после фактической выплаты.</div>'+employees.map(({employee:e,payment:p})=>'<div class="card"><strong>'+esc(e.name)+'</strong><div class="note">'+esc(e.role||'Сотрудник')+(e.is_salaried?' · оклад':' · проектное вознаграждение')+'</div>'+rowHTML('Начислено',p.due)+rowHTML(p.legacyMarked?'По прежней отметке оплаты':'Выплачено за этот расчётный месяц',p.paid)+rowHTML('Осталось выплатить',p.remaining)+(p.overpaid>0.009?'<div class="note" style="color:var(--red)">Сверх начисления: '+money(p.overpaid)+'</div>':'')+(p.legacyMarked?'<div class="note">Отдельной денежной записи нет: сверьте старую историю перед новой выплатой.</div>':'')+btn('Выплатить / история','salary',e.id)+'</div>').join('')+'</div>';
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
 if(state.financialDataReady===false){['overview','income','expense','reserve','team','amortization','forecast'].forEach(id=>panel(id,'<div class="card">'+(state.financialDataError?'Не удалось обновить операции. Остаток пока не подтверждён.':'Загружаются финансовые операции…')+'</div>'));return;}
 let picker=$('cashMonthPicker');if(!picker){picker=document.createElement('div');picker.id='cashMonthPicker';picker.className='cash-month';tabs.before(picker);}
 const finance=$('view-finance');finance.classList.add('cash-preview-style');const description=finance.querySelector('.workspace-description');if(description)description.textContent='Поступления, расходы и доля компании после распределения проектов';
 const accounted=cashEvents(state).filter(x=>x.afterSnapshot&&x.date<=day()),receipts=accounted.filter(x=>x.amount>0).reduce((sum,x)=>sum+x.amount,0),payments=-accounted.filter(x=>x.amount<0).reduce((sum,x)=>sum+x.amount,0);
 const summary=monthSummary(state,selected),budget=projectBudget(state),monthlyBudget=projectBudget(state,summary.until),events=summary.events,rent=recurringState('rent',selected),internet=recurringState('internet',selected),sublease=recurringState('sublease',selected);
 const unknown=cashEvents(state).filter(x=>x.date>=OPENING_DAY&&x.date<=day()&&x.excludedReason.startsWith('Нет даты создания'));
 const warning=(state.financialDataError?'<div class="card" style="color:var(--red)">Не удалось обновить операции. Показан остаток по последней успешной загрузке; текущие деньги требуют сверки.</div>':'')+(unknown.length?'<div class="card" style="color:var(--red)">Требуется сверка: '+unknown.length+' операций без даты создания не вошли в остаток. Нельзя подтвердить точность баланса, пока эти записи не проверены.</div>':'');
 picker.innerHTML='<label>Месяц <input type="month" id="cashMonth" value="'+selected+'"></label><span>'+summary.status+' · московское время</span>'+btn('Текущий месяц','current');
 $('cashMonth').onchange=e=>{if(e.target.value){selected=e.target.value;following=selected===day().slice(0,7);render();}};
 const kpi=(label,value)=>'<div class="finance-kpi"><span>'+label+'</span><strong>'+money(value)+'</strong></div>';
 panel('overview',warning+cashPositionHTML(summary.until)+'<div class="finance-kpi-grid">'+kpi('Доступно на расходы на '+fmtDate(summary.until),summary.available)+kpi(selected==='2026-10'?'Поступления после сверки':'Поступления за месяц',summary.incoming)+kpi(selected==='2026-10'?'Оплаты после сверки':'Оплаты за месяц',summary.outgoing)+'</div><div class="card" style="margin-top:16px"><h3>Проверка остатка</h3>'+rowHTML(selected==='2026-10'?'Остаток после сверки 05.10.2026':'Остаток на начало месяца',summary.opening)+rowHTML('+ Поступления',summary.incoming)+rowHTML('− Оплаты',summary.outgoing)+(summary.reconciliation?rowHTML('Разница фактической сверки с журналом',summary.reconciliation):'')+rowHTML('= Денежный остаток на '+fmtDate(summary.until),summary.closing)+rowHTML('В том числе амортизация · 5%',summary.amortization)+'<div class="note">Резерв начинается с 20 000 ₽ на 05.10.2026, 22:26 МСК. Денежное движение включает все новые приходы и оплаты, а распределение долей показано ниже. Старые операции доступны в истории. Прошедший месяц не является бухгалтерским закрытием.</div></div>'+budgetHTML(monthlyBudget)+flowHTML(selected<OPENING_DAY.slice(0,7)?events:summary.accounted));
 panel('income','<div class="card"><h3>Сдача помещения</h3><div class="fee-row"><div class="fl">Получено за выбранный месяц</div><div class="fv">'+money(sublease.paid)+'</div></div>'+(sublease.left?btn('Получил '+money(sublease.left),'confirm','sublease'): '<div class="note">Доход за месяц подтверждён</div>')+'</div><div class="note">Оплаты проектов автоматически поступают из карточки проекта → Деньги. Учитывается только принятая сумма.</div><div class="section-label">Фактические поступления за месяц</div><div class="card">'+eventsHTML(events.filter(x=>x.amount>0))+'</div>'+btn('Добавить другой доход','income'));
 panel('expense',[rent,internet].map((x,i)=>'<div class="card" style="margin-bottom:12px"><h3>'+esc(x.label)+'</h3><div class="fee-row"><div class="fl">Оплачено</div><div class="fv">'+money(x.paid)+'</div></div><div class="fee-row"><div class="fl">Осталось по плану</div><div class="fv">'+money(x.left)+'</div></div>'+(x.left?btn('Оплатил '+money(x.left),'confirm',i?'internet':'rent'):'<div class="note">Оплачено за месяц</div>')+btn('Частичная оплата','partial',i?'internet':'rent')+'</div>').join('')+invoicesHTML()+'<div class="card">'+eventsHTML(events.filter(x=>x.amount<0))+'</div>'+btn('Добавить расход','expense'));
 panel('reserve',cashPositionHTML()+'<div class="finance-v-hero reserve-hero"><span>Расчётный свободный резерв компании</span><strong data-company-reserve>'+money(budget.companyReserve)+'</strong><small>Доля компании после распределения проектов, команды и амортизации</small></div>'+budgetHTML(budget)+projectBudgetsHTML(budget)+btn('Сверить все деньги компании','balance')+btn('Вывести из свободного резерва','withdraw')+btn('Выгрузить операции для сверки','audit-export')+warning+'<div class="note">Прежняя стартовая база — 20 000 ₽ от 05.10.2026. Старые авансы показаны в истории проектов, но не создают новые деньги при завершении. Новая фактическая сверка включает все деньги компании и сохраняется отдельно от приходов и расходов.</div><details><summary>Расчёт денежного журнала с 05.10.2026</summary>'+rowHTML('Остаток после сверки 05.10.2026',OPENING)+rowHTML('+ Поступления после сверки',receipts)+rowHTML('− Выплаты после сверки',payments)+eventsHTML(accounted)+'<div class="note">Старые операции повторно не учитываются, даже если внесены позже.</div></details>');
 panel('amortization','<div class="finance-kpi-grid">'+kpi('Накоплено на амортизацию',amortization(state))+kpi('Отчислено за месяц',amortEvents(state).filter(x=>x.date.slice(0,7)===selected).reduce((sum,x)=>sum+x.allocation,0))+'</div><div class="note">5% фактических поступлений проектного отдела и прочих доходов компании с момента сверки. Клиентские авансы на стройку и корректировки остатка не создают амортизацию. Выделение наценки компании требует отдельного подтверждения.</div><div class="card">'+(amortEvents(state).filter(x=>x.date.slice(0,7)===selected).map(x=>'<div class="fee-row"><div class="fl">'+fmtDate(x.date)+' · приход '+money(x.amount)+'</div><div class="fv">'+money(x.allocation)+'</div></div>').join('')||'<div class="empty-state">Отчислений за месяц нет</div>')+'</div>');
 panel('team',payrollHTML(events));
 renderForecast();
 // Hide obsolete accrued-finance summaries; keep the previous tabs and payroll UI.
 const old=$('financeObligationsWrap');if(old)old.hidden=true;
 window.ARHITTEKJournal?.renderFinance();
}
function forecastProject(p,budget=projectBudget(state)){
 if(constructionProject(state,p))return {project:p,construction:true,incoming:expected(p),reserveIncoming:0,payouts:[],unpaid:0,release:0,net:0,amortization:0};
 const fees=getProjectFee(p),incoming=expected(p),allocation=budget.projects.find(d=>d.id===p.id),rows=p.fee_base==='m2'
   ? projectRolePayoutEntries(p.id).map(r=>({id:r.payee_employee_id,amount:n(r.amount)}))
   : [{id:p.employee_id,amount:n(fees.mainFeeAmount),paid:n(fees.mainPaid)},
      {id:p.co_employee_id,amount:n(fees.coFeeAmount),paid:n(fees.coPaid)}];
 const byEmployee=new Map();rows.filter(r=>r.id).forEach(r=>{const x=byEmployee.get(r.id)||{id:r.id,amount:0,paid:0};x.amount+=r.amount;x.paid+=r.paid||0;byEmployee.set(r.id,x);});
 const payouts=[...byEmployee.values()].map(r=>{
   const recorded=(state.ledger||[]).filter(x=>!x.deleted_at&&x.type==='fee_payment'&&x.project_id===p.id&&(x.payee_employee_id||p.employee_id)===r.id&&x.entry_date<=day()).reduce((a,x)=>a+n(x.amount),0);
   const allocated=allocation?.team.filter(t=>t.employeeId===r.id).reduce((a,t)=>a+t.paid,0)||0;
   return {id:r.id,amount:Math.max(0,rounded(r.amount-Math.max(r.paid,recorded,allocated)))};
 }),unpaid=payouts.reduce((sum,r)=>sum+r.amount,0),release=allocation?.projectHeld||0;
 return {project:p,incoming,payouts,unpaid,release,net:incoming+release-unpaid,amortization:Math.round(incoming*5)/100};
}
function renderForecast(){
 const current=day().slice(0,7),budget=projectBudget(state);let running=budget.available,html='<div class="note">Прогноз свободного резерва: сдача проекта АР/ДИ освобождает его долю за вычетом команды. Авансы на стройку и остаток её кассы не становятся доходом компании при завершении. Наценка по стройке здесь не прогнозируется до подтверждённого распределения. Уже зарезервированные выплаты повторно не вычитаются.</div>';
 for(let i=0;i<6;i++){
 const month=shift(current,i),projects=dueProjects(state,month),plans=projects.map(p=>forecastProject(p,budget)),income=plans.reduce((a,p)=>a+(p.reserveIncoming??p.incoming),0),clientFunding=plans.filter(p=>p.construction).reduce((a,p)=>a+p.incoming,0),lease=recurringState('sublease',month),rent=recurringState('rent',month),internet=recurringState('internet',month);
 const range=timesheetMonthRange(month),earned=completedProjectEarningsForRange(range.from,range.to).employees,split=splitPayrollByEmployee(earned).result;
 const due={};Object.entries(split).forEach(([id,row])=>due[id]=n(row.payout));
 plans.forEach(plan=>{
   const completed=/заверш/i.test(findStatus(plan.project.status_id)?.name||'');
   plan.payouts.forEach(row=>{
     // Completed project fees already belong to this month's payroll.
     if(!completed){const alreadyAccrued=(earned[row.id]?.items||[]).filter(x=>x.projectId===plan.project.id).reduce((a,x)=>a+n(x.amount),0),paidThisMonth=budget.projects.find(d=>d.id===plan.project.id)?.team.filter(t=>t.employeeId===row.id&&t.month===month).reduce((a,t)=>a+t.paid,0)||0;due[row.id]=(due[row.id]||0)+Math.max(0,row.amount-Math.max(0,alreadyAccrued-paidThisMonth));}

   });
 });
 const remainingSalaries=Object.entries(due).reduce((sum,[id,amount])=>sum+salaryPaymentState(id,month,amount).remaining,0);
 const alreadyHeld=budget.projects.filter(d=>d.completed).reduce((a,d)=>a+d.team.filter(t=>t.month===month).reduce((b,t)=>b+t.remaining,0),0);
 const salaries=Math.max(0,rounded(remainingSalaries-alreadyHeld)),release=plans.reduce((a,p)=>a+p.release,0);
 const amort=rounded(plans.reduce((sum,p)=>sum+p.amortization,0)+Math.round(lease.left*5)/100),out=rent.left+internet.left+salaries,inc=income+lease.left;
 running+=inc+release-out-amort;
 html+='<div class="card" style="margin-bottom:14px"><h3>'+esc(ruMonthLabel(month))+'</h3><div class="fee-row"><div class="fl">Остатки оплаты от клиентов</div><div class="fv">'+money(income)+'</div></div>'+(clientFunding?rowHTML('Ожидаемые пополнения стройки · не доход компании',clientFunding):'')+rowHTML('Доля проектов АР/ДИ при завершении',release)+'<div class="fee-row"><div class="fl">Сдача помещения — ожидается</div><div class="fv">'+money(lease.left)+'</div></div><div class="fee-row"><div class="fl">− Зарплаты и новые гонорары</div><div class="fv">'+money(salaries)+'</div></div><div class="fee-row"><div class="fl">− Аренда и интернет</div><div class="fv">'+money(rent.left+internet.left)+'</div></div><div class="fee-row"><div class="fl">− Амортизация · 5% ожидаемых поступлений</div><div class="fv">'+money(amort)+'</div></div><div class="fee-row total"><div class="fl">Прогноз доступного остатка</div><div class="fv" style="color:'+(running<0?'var(--red)':'var(--green)')+'">'+money(running)+'</div></div><details><summary>Проекты и расчёт</summary>'+plans.map(plan=>'<div class="card"><strong>'+esc(plan.project.name)+'</strong><div class="note">Срок: '+fmtDate(plan.project.end_date)+'</div><div class="fee-row"><div class="fl">Клиент доплатит</div><div class="fv">'+money(plan.incoming)+'</div></div>'+(plan.construction?'<div class="note">Пополнение денег заказчика. В прогноз свободного резерва не включено.</div>':'')+plan.payouts.map(row=>'<div class="fee-row"><div class="fl">− '+esc(findEmployee(row.id)?.name||'Сотрудник')+' · '+esc(findEmployee(row.id)?.role||'гонорар')+'</div><div class="fv">'+money(row.amount)+'</div></div>').join('')+'<div class="fee-row total"><div class="fl">Пополнение от проекта до амортизации</div><div class="fv">'+money(plan.net)+'</div></div></div>').join('')+'<div class="note">Уже удержанные гонорары по завершённым проектам исключены из повторного вычета. Выплаты через табель учитываются один раз. В расчёте отдельного проекта отражены гонорары за вычетом выплат, привязанных к карточке. Будущие прямые расходы без графика оплаты не включены.</div></details></div>';
 }
 panel('forecast',html);
}
window.ARHITTEKCash.forecastProject=forecastProject;

let invoicePaymentFormGeneration=0;
const invoicePaymentPending=new Map();
function invoiceDraftKey(invoice){return 'arhittek_invoice_payment_pending_v1:'+session.employeeId+':'+invoice.project_id+':'+invoice.id;}
function readInvoiceDraft(key,invoice){
 try{
  const value=invoicePaymentPending.get(key)||JSON.parse(sessionStorage.getItem(key)||'null'),p=value?.payload;
  if(value?.version===1&&['insert','link'].includes(value.mode)&&typeof value.id==='string'&&value.id&&p?.project_id===invoice.project_id&&p.type&&Number.isFinite(p.amount)&&p.amount>0&&typeof p.entry_date==='string'&&typeof p.description==='string'&&invoicePaymentId(p)===invoice.id)return value;
 }catch(error){console.warn('Не удалось прочитать черновик оплаты накладной',error);}
 return null;
}
function rememberInvoiceDraft(key,draft){
 invoicePaymentPending.set(key,draft);
 try{sessionStorage.setItem(key,JSON.stringify(draft));}catch(error){console.warn('Черновик оплаты сохранён до закрытия страницы',error);}
}
function forgetInvoiceDraft(key,id){
 if(invoicePaymentPending.get(key)?.id===id)invoicePaymentPending.delete(key);
 try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved?.id===id)sessionStorage.removeItem(key);}catch(error){console.warn('Не удалось убрать подтверждённый черновик оплаты',error);}
}
function invoiceDraftMatches(row,draft){
 const p=draft.payload;
 return !!row&&!row.deleted_at&&row.id===draft.id&&row.project_id===p.project_id&&row.type===p.type&&rounded(row.amount)===rounded(p.amount)&&row.entry_date===p.entry_date&&String(row.description||'')===p.description;
}
function invoicePaymentError(error){
 const message=String(error?.message||'');
 if(error?.code==='42501')return 'Недостаточно прав для оплаты. Обновите вход в приложение.';
 if(error?.code==='23514'&&/exceed|unpaid/i.test(message))return 'Остаток накладной уже изменился. Обновите историю оплаты; повторное списание не создано.';
 if(error?.code==='23514')return 'Накладная или связанный расход изменены. Проверьте историю перед оплатой.';
 if(error?.code==='22023')return 'Проверьте сумму, фактическую дату и выбранную накладную.';
 return /[а-яё]/i.test(message)?message:'Оплата пока не подтверждена. Повторите сохранение после восстановления связи; номер операции останется прежним.';
}
async function readInvoicePaymentRow(id){
 const result=await sb.from('ledger_entries').select('id,project_id,type,amount,entry_date,description,payee_employee_id,deleted_at').eq('id',id).maybeSingle();
 if(result.error)throw new Error('Не удалось подтвердить предыдущую оплату. Повторите после восстановления связи; новая запись не создана.');
 return result.data;
}
function openInvoicePayment(invoiceId){
 const row=(state.invoices||[]).find(i=>i.id===invoiceId&&!i.deleted_at);if(!row||row.paid_by_client)return;
 const invoice={...row},generation=++invoicePaymentFormGeneration,key=invoiceDraftKey(row);
 let attempt=readInvoiceDraft(key,invoice);
 const draftId=attempt?.id||crypto.randomUUID();
 const ownsForm=()=>generation===invoicePaymentFormGeneration;
 let overlay=$('cashInvoiceOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='cashInvoiceOverlay';overlay.className='sheet-overlay';document.body.appendChild(overlay);}
 const payment=invoicePaymentState(state,invoice),existing=(state.ledger||[]).filter(r=>!r.deleted_at&&r.project_id===invoice.project_id&&['expense','project_expense','payment'].includes(r.type)&&!r.payee_employee_id&&!invoicePaymentId(r)&&!isImportedExpense(r)&&r.entry_date<=day());
 if(attempt?.mode==='link'&&!existing.some(r=>r.id===attempt.id))existing.push({id:attempt.id,...attempt.payload});
 overlay.innerHTML='<div class="sheet"><h3>Оплата накладной</h3><p>'+esc(invoice.description||invoice.number||invoice.item_type)+'</p>'+rowHTML('Связано оплат',payment.paid)+rowHTML('Осталось подтвердить',payment.remaining)+'<div class="field"><label>Запись оплаты</label><select id="cashInvoiceExisting"><option value="">Новая фактическая оплата</option>'+existing.map(r=>'<option value="'+esc(r.id)+'">Связать: '+esc(fmtDate(r.entry_date)+' · '+money(r.amount)+' · '+r.description)+'</option>').join('')+'</select></div><div class="field"><label>Сумма оплаты, ₽</label><input id="cashInvoiceAmount" type="number" min="0.01" step="0.01" value="'+payment.remaining+'"></div><div class="field"><label>Фактическая дата оплаты</label><input id="cashInvoiceDate" type="date" value="'+day()+'"></div><div class="field"><label>Комментарий</label><input id="cashInvoiceNote"></div><button id="cashInvoiceSave" type="button" class="btn btn-primary">Сохранить оплату</button><button id="cashInvoiceClose" type="button" class="btn btn-secondary">Закрыть</button><div class="card">'+payment.rows.map(r=>'<div class="list-item"><span>'+esc(fmtDate(r.entry_date))+' · '+money(r.amount)+'</span>'+btn('Отменить оплату','cancel-invoice',r.id)+'</div>').join('')+'</div></div>';
 if(attempt){$('cashInvoiceExisting').value=attempt.mode==='link'?attempt.id:'';$('cashInvoiceAmount').value=attempt.payload.amount;$('cashInvoiceDate').value=attempt.payload.entry_date;$('cashInvoiceNote').value=attempt.note||'';const notice=document.createElement('p');notice.className='note';notice.textContent='Предыдущая попытка пока не подтверждена. Сохранение сначала проверит её номер и не спишет деньги повторно.';$('cashInvoiceSave').before(notice);}
 $('cashInvoiceExisting').onchange=()=>{const r=existing.find(r=>r.id===$('cashInvoiceExisting').value);$('cashInvoiceAmount').disabled=!!r;$('cashInvoiceDate').disabled=!!r;if(r){$('cashInvoiceAmount').value=r.amount;$('cashInvoiceDate').value=r.entry_date;}else{$('cashInvoiceAmount').value=payment.remaining;$('cashInvoiceDate').value=day();}};
 $('cashInvoiceClose').onclick=()=>{if(ownsForm()){invoicePaymentFormGeneration++;overlay.classList.remove('active');}};
 overlay.onclick=e=>{const b=e.target.closest('[data-cash-action="cancel-invoice"]');if(b)cancelInvoicePayment(b.dataset.id,invoiceId);};
 $('cashInvoiceSave').onclick=async()=>{
  if(!ownsForm()||busy||!session?.isAdmin)return;
  const linked=existing.find(r=>r.id===$('cashInvoiceExisting').value),amount=attempt?.payload.amount??(linked?n(linked.amount):n($('cashInvoiceAmount').value)),date=attempt?.payload.entry_date??(linked?linked.entry_date:$('cashInvoiceDate').value);
  const note=$('cashInvoiceNote').value.trim(),receivedBy=session.employeeId,saveButton=$('cashInvoiceSave');
  if(amount<=0||!date||date>day()){showToast('Укажите сумму и фактическую дату оплаты');return;}
  busy=true;saveButton.disabled=true;
  let persisted=false;
  try{
   const invoiceCheck=await sb.from('invoices').select('*').eq('id',invoiceId).maybeSingle();if(invoiceCheck.error)throw invoiceCheck.error;
   const currentInvoice=invoiceCheck.data;if(!currentInvoice||currentInvoice.deleted_at||currentInvoice.paid_by_client||currentInvoice.project_id!==invoice.project_id)throw new Error('Накладная изменена или удалена. Обновите историю оплаты.');
   const check=await fetchAllRows(()=>sb.from('ledger_entries').select('*',{count:'exact'}).eq('project_id',currentInvoice.project_id).is('deleted_at',null));if(check.error)throw check.error;
   let confirmed=attempt?await readInvoicePaymentRow(attempt.id):null;
   if(confirmed&&!invoiceDraftMatches(confirmed,attempt)){
    const canRetryLink=attempt.mode==='link'&&!confirmed.deleted_at&&confirmed.project_id===attempt.payload.project_id&&confirmed.type===attempt.payload.type&&rounded(confirmed.amount)===rounded(attempt.payload.amount)&&confirmed.entry_date===attempt.payload.entry_date&&(confirmed.description??null)===attempt.originalDescription;
    if(canRetryLink)confirmed=null;else throw new Error('Предыдущая запись изменена или отменена. Повторная оплата не создана; проверьте историю.');
   }
   if(!confirmed){
    const fresh=invoicePaymentState({ledger:check.data||[]},currentInvoice),effectiveAmount=attempt?.payload.amount??amount;
    if(effectiveAmount>fresh.remaining+0.009)throw new Error('Оплата больше неподтверждённого остатка');
    if(!attempt){
     const marker='[invoice-payment:'+invoiceId+']';
     if(linked){const row=(check.data||[]).find(r=>r.id===linked.id);if(!row||row.project_id!==invoice.project_id||row.payee_employee_id||invoicePaymentId(row))throw new Error('Расход уже изменён');attempt={version:1,mode:'link',id:row.id,note,payload:{type:row.type,project_id:row.project_id,amount:n(row.amount),entry_date:row.entry_date,description:marker+' '+(row.description||'Оплата накладной')},originalDescription:row.description??null};}
     else attempt={version:1,mode:'insert',id:draftId,note,payload:{type:'expense',project_id:invoice.project_id,amount,entry_date:date,description:marker+' '+(invoice.description||invoice.number||'Накладная')+(note?' · '+note:''),received_by:receivedBy}};
     rememberInvoiceDraft(key,attempt);
    }
    let saveError=null;
    try{
     // The server locks the invoice and checks the remaining amount in the
     // same transaction. Only a missing-function response uses the old path
     // while the separately deployed server update is being installed.
     let legacy=typeof sb.rpc!=='function';
     if(!legacy){
      const result=await sb.rpc('save_invoice_payment',{p_invoice_id:invoiceId,p_operation_id:attempt.id,p_amount:attempt.payload.amount,p_entry_date:attempt.payload.entry_date,p_description:attempt.payload.description,p_existing_entry_id:attempt.mode==='link'?attempt.id:null});
      if(result.error?.code==='PGRST202')legacy=true;
      else if(result.error)throw result.error;
      else if(!result.data)throw new Error('Сервер не подтвердил оплату. Повторите проверку сохранения.');
     }
     if(legacy){
      if(attempt.mode==='link'){
       let query=sb.from('ledger_entries').update({description:attempt.payload.description}).eq('id',attempt.id).eq('project_id',invoice.project_id).eq('type',attempt.payload.type).eq('amount',attempt.payload.amount).eq('entry_date',attempt.payload.entry_date).is('deleted_at',null);
       query=attempt.originalDescription==null?query.is('description',null):query.eq('description',attempt.originalDescription);
       const result=await query.select('id').maybeSingle();if(result.error)throw result.error;if(!result.data)throw new Error('Расход изменён на другом устройстве.');
      }else{const result=await sb.from('ledger_entries').insert({id:attempt.id,...attempt.payload});if(result.error)throw result.error;}
     }
    }catch(error){saveError=error;}
    confirmed=await readInvoicePaymentRow(attempt.id);
    if(!confirmed)throw new Error(invoicePaymentError(saveError));
    if(!invoiceDraftMatches(confirmed,attempt))throw new Error('Запись изменена или отменена. Повторная оплата не создана; проверьте историю.');
   }
   persisted=true;
   await logAudit('project',invoice.project_id,(state.projects||[]).find(p=>p.id===invoice.project_id)?.name||'','update',{invoice_payment:{old:null,new:(attempt.mode==='link'?'Связан расход: ':'Оплачено: ')+money(attempt.payload.amount)}});
   const refreshed=await loadAll();if(attempt.mode==='link'&&attempt.payload.type==='project_expense')await syncProjectExpensesTotal(invoice.project_id);
   forgetInvoiceDraft(key,attempt.id);
   if(ownsForm())overlay.classList.remove('active');
   render();
   showToast(refreshed===false?'Оплата записана. Не удалось обновить данные — повторите обновление':ownsForm()?(linked?'Расход связан без повторного списания':'Оплата накладной сохранена'):'Оплата накладной «'+(invoice.description||invoice.number||'Накладная')+'» сохранена');
  }catch(error){
   const message=persisted?'Оплата записана. Не удалось обновить данные — повторите обновление':error.message||'Не удалось сохранить оплату';
   showToast(ownsForm()?message:'Накладная «'+(invoice.description||invoice.number||'Накладная')+'»: '+message);
  }finally{busy=false;saveButton.disabled=false;}
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
 let overlay=$('cashBalanceOverlay');
 if(!overlay){
  overlay=document.createElement('div');overlay.id='cashBalanceOverlay';overlay.className='sheet-overlay';
  overlay.innerHTML='<div class="sheet"><h3>Сверка всех денег компании</h3><p class="note">Укажите общую сумму на счетах и наличными. Включите деньги проектов, команды и амортизацию. Сумма фиксируется отдельно от денежных оплат.</p><div class="field"><label>Всего фактически денег, ₽</label><input id="cashBalanceValue" type="number" min="0" step="0.01"></div><div class="field"><label>Комментарий</label><input id="cashBalanceNote"></div><button class="btn btn-primary" id="cashBalanceSave">Зафиксировать сумму</button><button class="btn btn-secondary" id="cashBalanceCancel">Отмена</button></div>';
  document.body.appendChild(overlay);$('cashBalanceCancel').onclick=()=>overlay.classList.remove('active');
  $('cashBalanceSave').onclick=async()=>{
   if(busy||!session?.isAdmin)return;
   const input=$('cashBalanceValue').value,target=Number(input);
   if(input===''||!Number.isFinite(target)||target<0){showToast('Укажите общую сумму денег, не меньше нуля');return;}
   if(state.financialDataReady===false||state.financialDataError){showToast('Сначала обновите финансовые операции');return;}
   busy=true;$('cashBalanceSave').disabled=true;
   try{
    const observation={version:1,total:rounded(target),counted_at:new Date().toISOString(),book_balance:bookBalance(state),note:$('cashBalanceNote').value.trim(),source:'manual-count'};
    const r=await sb.from('audit_log').insert({entity_type:'reserve',entity_id:null,entity_name:'Сверка всех денег компании',action:'cash_count',changes:{cash_count:{old:null,new:observation},_actor:session.name}});
    if(r.error)throw r.error;
    await loadAll();overlay.classList.remove('active');render();showToast('Фактическая сумма зафиксирована');
   }catch(error){showToast('Не удалось сохранить фактическую сумму');}
   finally{busy=false;if($('cashBalanceSave'))$('cashBalanceSave').disabled=false;}
  };
 }
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
getCompanyReserveBalance=()=>available(state);window.getCompanyCashBalance=()=>balance(state);window.getCompanyAvailableCash=()=>available(state);window.openReserveCorrection=()=>ARHITTEKJournal.adjustReserve().catch(e=>showToast(e.message));
const style=document.createElement('style');style.textContent='.cash-managed>:not(.cash-panel){display:none!important}.cash-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cash-month{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.cash-month label{display:flex;gap:8px;align-items:center}.cash-month input{padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text)}.cash-panel h3{font-size:16px}.cash-panel .card{padding:16px;animation:none!important}.cash-panel .btn{margin:8px 6px 8px 0}.cash-panel .list-item{gap:12px;flex-wrap:wrap}#financeObligationsWrap{display:none!important}';style.textContent+='\n#view-finance.cash-preview-style{color-scheme:light dark;--cash-bg:light-dark(#f4f6fa,#111824);--cash-surface:light-dark(#ffffff,#1b2534);--cash-text:light-dark(#16233a,#eef2f9);--cash-muted:light-dark(#627491,#b0bfd2);--cash-line:light-dark(#dce4ef,#344458);--cash-blue:light-dark(#176dea,#82b2ff);background:var(--cash-bg);color:var(--cash-text);padding:24px;border-radius:14px}\n#view-finance.cash-preview-style .workspace-head{background:transparent;border:0;box-shadow:none;padding:0;margin-bottom:20px}\n#view-finance.cash-preview-style .workspace-head h1{font:600 28px/1.3 system-ui;margin:4px 0}\n#view-finance.cash-preview-style .workspace-eyebrow,#view-finance.cash-preview-style .workspace-description{color:var(--cash-muted)}\n#view-finance.cash-preview-style .workspace-date{display:none}\n#view-finance.cash-preview-style .finance-visual-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:6px;background:var(--cash-surface);border:0;border-radius:12px;margin:18px 0;overflow:visible}\n#view-finance.cash-preview-style .finance-visual-tabs button{flex:1;min-width:90px;border:0;border-radius:8px;padding:10px 12px;background:var(--cash-surface);color:var(--cash-text);box-shadow:none;font:400 14px/1.5 system-ui;min-height:42px}\n#view-finance.cash-preview-style .finance-visual-tabs button.active{background:var(--cash-blue);color:light-dark(#ffffff,#111824)}\n#view-finance.cash-preview-style .cash-panel .card,#view-finance.cash-preview-style .finance-kpi{background:var(--cash-surface);color:var(--cash-text);border:1px solid var(--cash-line);border-radius:12px;box-shadow:none;padding:18px;margin-bottom:12px}\n#view-finance.cash-preview-style .cash-panel h3{font:600 16px/1.5 system-ui;margin:0 0 12px}\n#view-finance.cash-preview-style .cash-panel .btn,#view-finance.cash-preview-style .cash-month .btn{font:400 14px/1.5 system-ui;padding:10px 12px;background:var(--cash-surface);color:var(--cash-text);border:1px solid var(--cash-line);border-radius:8px;min-height:42px;box-shadow:none}\n#view-finance.cash-preview-style .cash-panel .fee-row{border-color:var(--cash-line);padding:12px 0}\n#view-finance.cash-preview-style .cash-panel .fl,#view-finance.cash-preview-style .cash-panel .fv{color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-month input{font:400 14px/1.5 system-ui;padding:10px;border:1px solid var(--cash-line);border-radius:8px;background:var(--cash-surface);color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-month{gap:12px;color:var(--cash-text)}\n#view-finance.cash-preview-style .cash-panel .note{color:var(--cash-muted)}\n@media(max-width:600px){#view-finance.cash-preview-style{padding:14px}#view-finance.cash-preview-style .finance-visual-tabs button{flex:1 0 28%;min-width:0}#view-finance.cash-preview-style .finance-kpi-grid{grid-template-columns:1fr}}\n';style.textContent+='\n#view-finance .cash-panel .fee-row{gap:12px;align-items:flex-start}#view-finance .cash-panel .fl{flex:1;min-width:0;overflow-wrap:anywhere}#view-finance .cash-panel .fv{flex:0 0 auto;white-space:nowrap}\n';document.head.appendChild(style);
$('view-finance')?.addEventListener('click',e=>{const b=e.target.closest('[data-cash-action]');if(b)act(b.dataset.cashAction,b.dataset.id);});
let renderTimer=null;
function scheduleRender(){if(renderTimer!==null)return;renderTimer=setTimeout(()=>{renderTimer=null;render();},0);}
for(const name of ['renderAll','renderAnalytics','renderFinanceVisualPanels','renderCompanyBudget','renderCompanyIncomeList','renderCompanyExpensesList','renderTimesheet']){const old=window[name];if(typeof old==='function')window[name]=function(){const r=old.apply(this,arguments);scheduleRender();return r;};}
window.renderCashFinance=render;
setInterval(()=>{const now=day();if(now!==lastDay){lastDay=now;if(following)selected=now.slice(0,7);render();}},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(following)selected=day().slice(0,7);render();}});setTimeout(render,1600);
})();
