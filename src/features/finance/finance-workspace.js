/* One server snapshot for money, funded obligations and the payment calendar. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(n)||0),number=n=>Number(n)||0;
let tab='overview',modal=null,busy=false,refreshing=null,renderQueued=false,lastRead=0;
const owner=()=>typeof isOwner==='function'&&isOwner(),snapshot=()=>state.financialJournal?.workspace;
const enabled=()=>owner()&&snapshot()?.version===2;
function validWorkspace(j){
 const s=j?.workspace;if(!ARHITTEKJournal.valid(j)||s?.version!==2||s.active!==j.active||s.revision!==j.revision||!Array.isArray(s.wallets)||!Array.isArray(s.items)||!Array.isArray(s.forecast)||s.forecast.length!==91)return false;
 const minor=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12?Math.round(v*100):NaN;
 const sum=values=>values.reduce((a,v)=>a+minor(v),0);
 return minor(s.cash)===sum(Object.values(j.balances))&&minor(s.cash)===sum(s.wallets.map(w=>w.balance))&&minor(s.reserve)===minor(j.balances.reserve||0)&&s.as_of===String(s.as_of).match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
}
const ready=()=>enabled()&&validWorkspace(state.financialJournal)&&state.financialDataReady&&!state.financialDataError&&!loadAllInFlight;
const pendingKey=()=> 'arhittek_finance_pending_v2_'+session.employeeId;
const pending=()=>{try{return JSON.parse(sessionStorage.getItem(pendingKey())||'null')}catch(_){return null}};
const btn=(label,action,id='',disabled=false)=>'<button type="button" class="btn btn-secondary" data-fw="'+action+'" data-id="'+esc(id)+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
const journalBtn=(label,action,id='')=>'<button type="button" class="btn btn-secondary" data-journal="'+action+'" data-id="'+esc(id)+'" '+(!ready()?'disabled':'')+'>'+esc(label)+'</button>';
const row=(label,value)=>'<div class="fw-row"><span>'+esc(label)+'</span><strong>'+money(value)+'</strong></div>';
function accountName(key){if(key==='reserve')return 'Свободный резерв';if(key==='amortization')return 'Амортизация';if(key.startsWith('obligation:'))return 'Начисленный долг · '+(snapshot()?.items?.find(x=>x.funding===key)?.label||'обязательство');const [kind,p,e]=key.split(':');const project=(state.financialProjects||state.projects||[]).find(x=>x.id===p)?.name||p;return (kind==='project'?'Деньги проекта':kind==='team'?'Гонорар '+((state.employees||[]).find(x=>x.id===e)?.name||''):'Расходы')+' · '+project;}
function accepted(j,actor){
 if(!owner()||actor.token!==session?.token||actor.id!==session?.employeeId||!validWorkspace(j)) return false;
 const old=state.financialJournal;if(old?.revision>j.revision||old?.revision===j.revision&&old.workspace?.as_of>j.workspace.as_of)return false;
 state.financialJournal=j;lastRead=Date.now();return true;
}
async function refresh(){
 if(refreshing||!owner()||loadAllInFlight)return refreshing;
 const actor={token:session.token,id:session.employeeId};refreshing=(async()=>{try{const r=await sb.rpc('get_financial_journal');if(r.error)throw r.error;if(r.data?.revision!==state.financialJournal?.revision||r.data?.workspace?.as_of!==snapshot()?.as_of){await loadAll();lastRead=Date.now();return;}if(accepted(r.data,actor)){state.financialLoadedAt=new Date().toISOString();if(state.financialDataReady)state.financialDataError=null;render();}}catch(e){if(actor.token===session?.token){state.financialDataError=e.message||'Журнал не обновлён';render();}}finally{refreshing=null;}})();return refreshing;
}
function schedule(){if(renderQueued)return;renderQueued=true;setTimeout(()=>{renderQueued=false;render();},0);}
// Actual flows are dated. Outstanding project work spans all contract dates.
function constructionIds(s,projects){
 return new Set(projects.filter(p=>ARHITTEKCash.constructionProject(s,p)).map(p=>p.id));
}
function monthActuals(s,workspace,construction){
 const minor=v=>Math.round(Number(v||0)*100);
 const asOf=workspace.as_of,from=[asOf.slice(0,7)+'-01',workspace.start_date||''].sort().at(-1);
 let revenue=0,expense=0;
 for(const event of ARHITTEKCash.cashEvents(s)){
  const r=event.row;
  if(r.received_before_start||event.date<from||event.date>asOf||construction.has(r.project_id)||ARHITTEKCash.isAdjustment(r)||ARHITTEKCash.isImportedExpense(r))continue;
  if(r.type==='withdrawal'||r.category==='Вывод средств')continue;
  if(event.amount>0||r.type==='client_refund')revenue+=minor(event.amount);
  else expense-=minor(event.amount);
 }
 return {revenue:revenue/100,expense:expense/100,net:(revenue-expense)/100,from};
}
function managementSummary(s,workspace){
 const minor=v=>Math.round(Number(v||0)*100);
 const projects=getFinancialProjects(),construction=constructionIds(s,projects);
 const actuals=monthActuals(s,workspace,construction);
 const asOf=workspace.as_of,budget=ARHITTEKBudget.calculate(s,asOf,{includeAllProjects:true});
 let forecast=0;
 const details=[];
 for(const p of projects){
  if(construction.has(p.id))continue;
  const invoices=(s.invoices||[]).filter(i=>i.project_id===p.id&&!i.deleted_at&&!i.paid_by_client);
  const invoiceDue=invoices.reduce((sum,i)=>sum+minor(ARHITTEKCash.invoicePaymentState(s,i,asOf).remaining),0);
  const obligations=workspace.items.filter(i=>i.project_id===p.id&&i.direction==='expense');
  const team=new Map(),heldTeam=new Map();
  for(const fee of ARHITTEKCash.forecastProject(p,budget).payouts)team.set(fee.id,minor(fee.amount));
  let heldCosts=0,plannedCosts=0;
  for(const item of obligations){
   if(item.origin==='funded'&&item.employee_id)heldTeam.set(item.employee_id,(heldTeam.get(item.employee_id)||0)+minor(item.remaining));
   else if(item.origin==='funded')heldCosts+=minor(item.remaining);
   else plannedCosts+=minor(item.remaining);
  }
  for(const [employee,held] of heldTeam)team.set(employee,Math.max(team.get(employee)||0,held));
  const costs=Math.max(invoiceDue,heldCosts)+plannedCosts+[...team.values()].reduce((a,b)=>a+b,0);
  const debt=p.deleted_at?0:minor(ARHITTEKCash.expected(p));
  if(debt||costs)details.push({name:p.name,debt:debt/100,costs:costs/100});
  forecast+=debt-costs;
 }
 return {...actuals,forecast:forecast/100,details};
}
// The system wallet is identified by the server flag, including snapshots made before the rename.
function walletName(wallet){return wallet.is_default===true?'Сейф':wallet.name;}
function walletOptionsFor(workspace){
 return workspace.wallets.filter(w=>w.active).sort((a,b)=>Number(b.is_default===true)-Number(a.is_default===true))
  .map(w=>[w.id,walletName(w)+' · '+money(w.balance)]);
}
function walletField(label,options){
 if(options.length===1){
  const [id,description]=options[0];
  return '<div class="fw-wallet-fixed"><span>'+esc(label)+'</span><strong>'+esc(description)+'</strong><input name="wallet_id" type="hidden" value="'+esc(id)+'"></div>';
 }
 return select(label,'wallet_id',options);
}
function normalizeHistoryText(value){
 return value.trim().toLocaleLowerCase('ru').replace(/\s+/g,' ')
  .replace(/(\d) (?=\d)/g,'$1').replace(/№ /g,'№').replace(/−/g,'-');
}
function render(){
 const view=$('view-finance');if(!view)return;
 if(!enabled()){view.classList.remove('finance-unified');$('financeWorkspace')?.remove();if(!owner())clear();return;}
 view.classList.add('finance-unified');let root=$('financeWorkspace');if(!root){root=document.createElement('section');root.id='financeWorkspace';view.appendChild(root);}
 const retainHeadingFocus=root.querySelector('h1')===document.activeElement;
 const s=snapshot(),j=state.financialJournal,balances=s.balances||{},locked=!ready()||busy,zero=s.opening_mode==='zero';
 if(!validWorkspace(j)){root.innerHTML='<article class="fw-card">Не удалось загрузить все финансовые данные. '+btn('Обновить','refresh')+'</article>';bind(root,retainHeadingFocus);return;}
 

 const safe=s.wallets.find(w=>w.is_default===true);
 const storageTitle=safe?'Сейф':'Места хранения';
 const names = {more:'Операции и планы', calendar:'Платёжный календарь', history:'История операций', accounts:storageTitle, settings:'Регулярные платежи', forecast:'Прогноз по проектам', archive:'Архив операций'};
 const navigate = (key,label) => '<button type="button" class="fw-route" data-fw-tab="'+key+'">'+label+'</button>';
 const group = (title,actions) => '<section class="fw-group"><h2>'+title+'</h2><div>'+actions+'</div></section>';
 let html='<div class="fw-page-head"><div>';
 if(tab!=='overview'){
  html+='<nav aria-label="Путь в финансах" class="fw-path">'+navigate('overview','Финансы')+(tab==='more'?'':'<span aria-hidden="true">/</span>'+navigate('more','Операции и планы'))+'</nav>';
 }
 html+='<h1>'+(names[tab]||'Финансы')+'</h1></div>'+btn('Обновить','refresh')+'</div>';
 if(pending())html+='<div class="fw-warning">Операция ожидает подтверждения. '+btn('Проверить','retry')+'</div>';
 if(tab==='overview')html+=navigate('more','Операции и планы');
 if(zero&&!s.active)html+='<article class="fw-card"><h2>'+(s.active?'Учёт с нуля':'Запланирован старт с нуля')+'</h2><p>С '+esc(fmtDate(s.start_date))+' · резерв, амортизация и остатки счетов на старте — 0 ₽. Начальная сверка не требуется. Прежние операции сохранены отдельно и не переносятся в новые остатки.</p></article>';
 if(!s.active&&!zero){html+='<article class="fw-card"><h2>Нужна начальная сверка</h2><p>Пересчитайте наличные в сейфе и проверьте обязательства перед заказчиками и командой. После подтверждения общий остаток будет распределён внутри журнала. Неподтверждённые цифры не выдаются за точный резерв.</p>'+journalBtn('Сверить и включить журнал','activate')+'<p>Старые оклады, неоплаченные счета и обязательства, отсутствующие в карточках, добавьте в платёжный календарь. Гонорары из сверки появятся автоматически.</p></article>';}
 if(!state.financialDataReady||state.financialDataError){root.innerHTML=html+'<article class="fw-card">Остатки требуют обновления. Денежные действия временно недоступны.</article>';bind(root,retainHeadingFocus);return;}
 if(!s.active&&zero&&['overview','forecast'].includes(tab)){root.innerHTML=html+'<article class="fw-card"><h2>Начальные остатки — 0 ₽</h2><p>Учёт включится автоматически с '+esc(fmtDate(s.start_date))+' по московскому времени. Поступления и расходы до этой даты останутся в прежнем периоде. Можно заранее внести будущие платежи и регулярные расходы.</p></article>';bind(root,retainHeadingFocus);return;}
 if(!s.active&&['overview','forecast'].includes(tab)){root.innerHTML=html+'<article class="fw-card">Точные остатки и прогноз появятся после начальной сверки. Для планирования откройте «Операции и планы».</article>';bind(root,retainHeadingFocus);return;}
 if(tab==='overview'){
  const month=s.as_of.slice(0,7);
  const expected=s.items.filter(item=>item.direction==='income'&&item.due_date?.startsWith(month))
    .reduce((sum,item)=>sum+Math.round(number(item.remaining)*100),0)/100;
  const tile=(label,value)=>'<article><span>'+esc(label)+'</span><strong>'+money(value)+'</strong></article>';
  root.innerHTML='<h1>Финансы</h1>'+(pending()?'<div class="fw-warning">Операция ожидает подтверждения '+btn('Проверить','retry')+'</div>':'')+
    '<div class="studio-money-grid">'+tile(safe?'Сейф':'Всего денег',safe?safe.balance:s.cash)+tile('Расходы за месяц',monthActuals(state,s,constructionIds(state,getFinancialProjects())).expense)+
    tile('Ожидаем до конца месяца',expected)+'<button type="button" data-fw-tab="more"><b>···</b>Ещё</button></div>';
  bind(root,retainHeadingFocus);return;
 }
 if(tab==='more'||tab==='forecast'){
  const kpi=(label,value,note)=>'<article class="fw-card"><small>'+label+'</small><strong class="fw-amount">'+money(value)+'</strong><p>'+note+'</p></article>';
  if(tab==='more'){
   const m=monthActuals(state,s,constructionIds(state,getFinancialProjects()));
   const period=esc(fmtDate(m.from))+' — '+esc(fmtDate(s.as_of));
   html+='<div class="fw-directory">'+
    group('Записать операцию',btn('Записать поступление','record-income','',locked||!s.active)+btn('Записать расход','record-expense','',locked||!s.active))+
    group('Найти операцию',navigate('history','История операций')+(zero?navigate('archive','Архив до начала учёта'):''))+
    group('Запланировать',navigate('calendar','Платёжный календарь')+navigate('forecast','Прогноз по проектам'))+
    group('Настроить',navigate('accounts',storageTitle)+navigate('settings','Регулярные платежи'))+'</div>';
   html+='<details class="fw-card fw-report" data-fw-section="month-report"><summary>Отчёт за месяц</summary><div class="fw-grid">'+kpi('Выручка',m.revenue,'Получено за '+period+', за вычетом возвратов.')+kpi('Расход',m.expense,'Фактические оплаты компании и проектного отдела за тот же период.')+kpi('Чистый доход',m.net,'Выручка минус расход за период.')+'</div></details>';
  }else{
   const m=managementSummary(state,s);
   html+='<article class="fw-card"><h2>Итого по проектам</h2>'+row('Ожидаемый чистый остаток',m.forecast)+'<p>По всем срокам, включая договоры без графика оплаты.</p></article>';
   for(const project of m.details)html+='<article class="fw-card"><h3>'+esc(project.name)+'</h3>'+row('Долг клиента',project.debt)+row('Предстоит оплатить',project.costs)+row('Прогноз',project.debt-project.costs)+'</article>';
  }
 }else if(tab==='calendar'){
  html+='<div class="fw-actions">'+btn('Запланировать поступление','income','',locked)+btn('Запланировать расход','expense','',locked)+btn('Запланировать распределение','release','',locked)+'</div>';
  const items=[...(s.items||[])].sort((a,b)=>String(a.due_date||'').localeCompare(String(b.due_date||'')));
  html+=items.map(x=>'<article class="fw-card"><div class="fw-row"><h3>'+esc(x.label)+'</h3><b>'+money(x.remaining)+'</b></div><p>'+esc(x.direction==='income'?'Ожидается поступление':x.direction==='release'?'Распределение внутри денег':'Осталось оплатить')+' · '+(x.due_date?esc(fmtDate(x.due_date)):'Без срока')+(x.due_date&&x.due_date<s.as_of?' · просрочено':'')+' · '+esc(accountName(x.funding))+'</p><p>'+esc(x.certainty==='confirmed'?'Подтверждено':'Требует согласования')+'</p><div class="fw-actions">'+btn(x.direction==='income'?'Получил оплату':x.direction==='release'?'Подтвердить распределение':'Оплатить частично / полностью','pay',x.key,locked||!s.active)+btn('Перенести срок','reschedule',x.key,locked)+(x.origin==='plan'?btn('Отменить остаток плана','cancel',x.id,locked):'')+'</div></article>').join('')||'<article class="fw-card">В календаре пока нет платежей.</article>';
  if(s.unmatched?.length)html+='<details class="fw-card" data-fw-section="unmatched"><summary>Оплаты, внесённые вне календаря</summary><p>Выберите оплату и укажите, какой платёж она погашает.</p>'+(s.unmatched||[]).map(o=>'<div class="fw-row"><span>'+esc(o.reason)+' · '+money(o.remaining)+'</span>'+btn('Связать с планом','link',o.id,locked)+'</div>').join('')+'</details>';
  if(s.unscheduled_projects?.length)html+='<article class="fw-card"><h2>Поступления без графика</h2><p>Укажите согласованную с клиентом дату оплаты.</p>'+(s.unscheduled_projects||[]).map(p=>'<div class="fw-row"><span>'+esc(p.name)+' · '+money(p.remaining)+'</span>'+btn('Указать график','project-plan',p.id,locked)+'</div>').join('')+'</article>';
 }else if(tab==='accounts'){
  const wallets=s.wallets||[],activeWallets=wallets.filter(w=>w.active);
  const singleSafe=safe&&activeWallets.length===1&&activeWallets[0].id===safe.id;
  if(safe)html+='<article class="fw-card">'+row('Деньги в сейфе',safe.balance)+btn(singleSafe?'Сверить сейф':'Сверить остаток','wallet-reconcile','',locked)+'</article>';
  for(const wallet of wallets.filter(w=>w!==safe)){
   html+='<article class="fw-card"><h2>'+esc(wallet.name)+'</h2>'+(s.active?row('Остаток',wallet.balance):'<p>Начальный остаток ещё не подтверждён.</p>')+'</article>';
  }
  if(wallets.length>1)html+='<article class="fw-card">'+row('Всего денег компании',s.cash)+'</article>';
  html+='<details class="fw-card" data-fw-section="storage-settings"><summary>Другие места хранения</summary><div class="fw-actions">'+btn('Добавить место хранения','wallet','',locked)+
   (activeWallets.length>1?btn('Перевести деньги','wallet-transfer','',locked||!s.active):'')+
   (!safe?btn('Сверить остаток','wallet-reconcile','',locked):'')+'</div></details>';
  html+=journalBtn('Распределить деньги','transfer');
  html+='<details class="fw-card" data-fw-section="project-closing"><summary>Подтвердить финансовое закрытие проектов</summary>'+(state.projects||[]).filter(p=>/заверш/i.test(findStatus(p.status_id)?.name||'')&&!ARHITTEKCash.constructionProject(state,p)).map(p=>'<div class="fw-row"><span>'+esc(p.name)+'</span>'+journalBtn('Проверить закрытие','close',p.id)+'</div>').join('')+'</details>';
 }else if(tab==='settings'){
  html+='<article class="fw-card"><h2>Регулярные поступления и расходы</h2><p>Новую сумму можно установить с выбранного месяца.</p>'+btn('+ Регулярный платёж','rule','',locked)+'</article>'+(s.rules||[]).map(r=>'<article class="fw-card"><h3>'+esc(r.label)+'</h3>'+row(r.direction==='income'?'Поступление в месяц':'Расход в месяц',r.amount)+'<p>До '+r.due_day+' числа · с '+esc(String(r.start_month).slice(0,7))+(r.end_month?' по '+esc(String(r.end_month).slice(0,7)):'')+'</p>'+btn('Новая сумма с нового месяца','replace-rule',r.id,locked)+btn('Остановить после этого месяца','stop-rule',r.id,locked)+'</article>').join('');
  html+='<article class="fw-card"><h2>Оклады из карточек сотрудников</h2><p>Проверьте оклад и добавьте его в календарь выплат. Изменения в карточке сотрудника обновляйте здесь отдельно.</p>'+(state.employees||[]).filter(e=>e.is_salaried&&e.active!==false&&!e.deleted_at).map(e=>'<div class="fw-row"><span>'+esc(e.name)+' · '+money(e.fixed_salary)+'</span>'+btn('Внести оклад в календарь','salary-rule',e.id,locked)+'</div>').join('')+'</article>';
 }else if(tab==='archive'){
  const events=ARHITTEKCash.cashEvents(state).filter(x=>x.date<s.start_date);
  html+='<article class="fw-card"><h2>Операции до '+esc(fmtDate(s.start_date))+'</h2><p>Сохранённая история прежнего учёта. Эти записи не меняют новый резерв, амортизацию или остатки счетов. При необходимости прежний долг можно отдельно внести в платёжный календарь.</p></article>'+events.slice(0,100).map(x=>'<article class="fw-card"><p>'+esc(fmtDate(x.date))+' · '+esc(x.row.description||x.row.category||x.row.type||'Операция')+'</p>'+row(x.amount>0?'Поступление':'Расход',Math.abs(x.amount))+'</article>').join('')+(events.length>100?'<p>Показаны последние 100 архивных операций; остальные записи сохранены в исходных разделах.</p>':'');
 }else{
  const ops=[...(j.operations||[]),...(j.history||[])],reversed=new Set(ops.map(x=>x.reverses).filter(Boolean));
  html+='<label class="fw-search">Поиск по загруженным операциям<input type="search" data-fw-search placeholder="Название, дата или сумма"></label><p data-fw-no-match hidden>Операций по запросу нет.</p>';
  const receipts=(state.ledger||[]).filter(x=>!x.deleted_at&&['advance','final_payment','income','materials_budget','construction_budget'].includes(x.type));
  const receiptCorrections=receipts.length?'<details class="fw-card" data-fw-section="receipt-corrections"><summary>Исправить дату или учёт оплаты клиента</summary><p>Оплата до начала текущего учёта сохраняется в проекте, но не прибавляется к уже подтверждённому начальному остатку. Каждое исправление требует причины.</p>'+receipts.map(x=>'<div class="fw-row"><span>'+esc((state.projects||[]).find(p=>p.id===x.project_id)?.name||'Оплата клиента')+' · '+money(x.amount)+' · '+esc(x.received_before_start?'Ранее получено, дата неизвестна':fmtDate(x.entry_date))+'</span>'+btn('Исправить оплату','correct-receipt',x.id,locked)+'</div>').join('')+'</details>':'';
  if(!ops.length)html+='<p class="fw-empty" data-fw-empty>В истории пока нет подтверждённых операций.</p>';
  html+=ops.map(o=>'<article class="fw-card" data-fw-operation data-fw-delta="'+esc(o.cash_delta)+'"><h3>'+esc(o.reason)+'</h3><p>'+esc(new Date(o.created_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))+' · №'+o.revision+'</p>'+row(o.cash_delta<0?'Расход':o.cash_delta>0?'Поступление':'Движение денег',Math.abs(number(o.cash_delta)))+row('Резерв после операции',o.balances_after?.reserve)+(!['activate','obligation','obligation_release','receipt_correction','historical_receipt'].includes(o.kind)&&!o.reverses&&!o.is_reversed&&!reversed.has(o.id)?journalBtn('Отменить с причиной','reverse',o.id):'')+'</article>').join('')+btn('Более ранние операции','history','',locked)+receiptCorrections+btn('Корректировать резерв','reserve-adjust','',locked);
  if(s.links?.length)html+='<details class="fw-card" data-fw-section="payment-links"><summary>Связи ранее внесённых оплат</summary>'+(s.links||[]).map(l=>'<div class="fw-row"><span>'+esc(l.reason)+' · '+money(l.amount)+'</span>'+btn('Отменить связь','unlink',l.id,locked)+'</div>').join('')+'</details>';
  if(s.changes?.length)html+='<details class="fw-card" data-fw-section="plan-history"><summary>История планов и переводов</summary>'+(s.changes||[]).map(h=>'<div class="fw-card"><b>'+esc(h.after_value?.label||h.after_value?.reason||({plan:'План платежа',pay:'Фактическая оплата',rule:'Регулярное обязательство',wallet_transfer:'Перевод между счетами',reschedule:'Перенос срока',cancel:'Отмена остатка плана',wallet:'Новый счёт',stop_rule:'Остановка регулярного платежа'}[h.entity]||'Финансовое действие'))+'</b><p>'+esc(new Date(h.created_at).toLocaleString('ru-RU'))+'</p>'+(h.before_value?.amount?row('Сумма до',h.before_value.amount):'')+(h.after_value?.amount?row('Сумма после / операции',h.after_value.amount):'')+'<p>Прежний срок: '+esc(h.before_value?.due_date||'—')+' · Новый срок: '+esc(h.after_value?.due_date||'—')+'</p></div>').join('')+'</details>';
 }
 const activeAction=root.contains(document.activeElement)?document.activeElement.dataset.fw:null;
 const activeId=document.activeElement?.dataset.id;
 const openSections = new Set(Array.from(root.querySelectorAll("details[data-fw-section][open]"), element => element.dataset.fwSection));
 const search=root.querySelector('[data-fw-search]');
 const query=search?.value||'';
 const searchFocused=search&&document.activeElement===search;
 root.innerHTML=html;
 const searchField=root.querySelector('[data-fw-search]');
 if(searchField){
  searchField.value=query;
  const entries=Array.from(root.querySelectorAll('[data-fw-operation]'),card=>{
   // Index the operation itself. Balance after posting and action buttons are separate information.
   const movement=card.querySelector('.fw-row');
   const fields=[card.querySelector('h3').textContent,card.querySelector('p').textContent,
    movement.querySelector('span').textContent,movement.querySelector('strong').textContent,card.dataset.fwDelta];
   return {card,fields:fields.map(normalizeHistoryText)};
  });
  searchField.oninput=()=>{
   const needle=normalizeHistoryText(searchField.value);
   for(const {card,fields} of entries)card.hidden=!fields.some(field=>field.includes(needle));
   const empty=root.querySelector('[data-fw-empty]');
   if(empty)empty.hidden=!!needle;
   root.querySelector('[data-fw-no-match]').hidden=!needle||entries.some(({card})=>!card.hidden);
  };
  searchField.oninput();
  if(searchFocused)searchField.focus({preventScroll:true});
 }
 for (const section of root.querySelectorAll("details[data-fw-section]")) section.open = openSections.has(section.dataset.fwSection);
 bind(root,retainHeadingFocus);
 if(activeAction){
  const restored=[...root.querySelectorAll('[data-fw]')].find(button=>button.dataset.fw===activeAction&&button.dataset.id===activeId);
  restored?.focus({preventScroll:true});
 }
}
function focusPageTitle(root){
 const heading=root.querySelector('h1');
 if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
}
function bind(root,retainHeadingFocus){
 if(retainHeadingFocus)focusPageTitle(root);
 for(const button of root.querySelectorAll('[data-fw-tab]')){
  button.onclick=()=>{
   tab=button.dataset.fwTab;
   render();
   focusPageTitle(root);
   root.scrollIntoView?.({block:'start'});
  };
 }
 for(const button of root.querySelectorAll('[data-fw]')){
  button.onclick=()=>act(button.dataset.fw,button.dataset.id).catch(error=>showToast(error.message));
 }
}
function input(label,name,value='',type='text'){return '<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="0.01" step="0.01"':'')+'></label>';}
function select(label,name,options,value=''){return '<label>'+esc(label)+'<select name="'+name+'">'+options.map(([id,label])=>'<option value="'+esc(id)+'" '+(String(id)===String(value)?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';}
function form(title,html,build,options={}){
 if(!ready())throw new Error('Сначала обновите подтверждённые данные');modal?.remove();modal=document.createElement('div');modal.id='financeWorkspaceModal';modal.className='sheet-overlay active';
 const reasonField=options.reasonFromLabel?'':input('Основание операции','reason');
 const opener=document.activeElement;
 modal.innerHTML='<form class="sheet fw-form" role="dialog" aria-modal="true" aria-labelledby="fw-form-title"><h2 id="fw-form-title" tabindex="-1">'+esc(title)+'</h2>'+html+reasonField+'<p class="fw-form-error" role="alert"></p><button class="btn btn-primary" type="submit">'+esc(options.submit||'Подтвердить')+'</button><button class="btn btn-secondary" data-close type="button">Закрыть</button></form>';
 $('toast')?.classList.remove('show');
 document.body.appendChild(modal);
 modal.querySelector('h2').focus();
 const close=()=>{
  modal?.remove();modal=null;
  const restored=opener?.isConnected?opener:[...document.querySelectorAll('#financeWorkspace [data-fw]')].find(b=>b.dataset.fw===opener?.dataset.fw&&b.dataset.id===opener?.dataset.id);
  restored?.focus();
 };
 modal.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.stopPropagation();if(!busy)close();return;}
  if(event.key!=='Tab')return;
  const stops=[...modal.querySelectorAll('input,select,button,summary,textarea')].filter(el=>!el.disabled&&el.getClientRects().length);
  const first=stops[0],last=stops.at(-1);
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal.querySelector('h2'))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 });
 modal.querySelector('[name="funding"]')?.addEventListener('change',e=>{const parts=e.target.value.split(':');if(parts[0]==='team'||parts[0]==='costs'){const project=modal.querySelector('[name="project_id"]'),employee=modal.querySelector('[name="employee_id"]');if(project)project.value=parts[1];if(employee)employee.value=parts[0]==='team'?parts[2]:'';}});
 const reasonError=options.reasonFromLabel?'Уточните назначение платежа (минимум 3 символа)':'Укажите основание';
 modal.querySelector('form').addEventListener('input',event=>{
  if(!['reason','label'].includes(event.target.name))return;
  const fields=event.currentTarget.elements;
  const value=fields.reason?.value.trim()||(options.reasonFromLabel?fields.label?.value.trim():'');
  const alert=event.currentTarget.querySelector('[role="alert"]');
  if(value?.length>=3&&alert.textContent===reasonError)alert.textContent='';
 });
 const actor=session.token;modal.querySelector('[data-close]').onclick=()=>{if(!busy)close();};
 modal.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy||actor!==session?.token||!owner())return;const f=Object.fromEntries(new FormData(e.target));try{if(options.reasonFromLabel&&!f.reason?.trim())f.reason=f.label.trim();if(f.reason.trim().length<3)throw new Error(reasonError);const command=build(f);await send(command.command,command.payload);if(actor===session?.token)close();}catch(error){if(actor===session?.token&&modal)modal.querySelector('[role="alert"]').textContent=error.message;}};
}
async function send(command,payload,restore=null){
 if(busy||!ready())throw new Error('Дождитесь обновления финансов');const old=pending();if(old&&!restore)throw new Error('Сначала повторите подтверждение предыдущей отправки');
 const request=restore||{command,payload,operation:crypto.randomUUID(),revision:state.financialJournal.revision};sessionStorage.setItem(pendingKey(),JSON.stringify(request));busy=true;const actor={token:session.token,id:session.employeeId},key=pendingKey();
 try{const r=await sb.rpc('confirm_finance_workspace',{p_command:request.command,p_payload:request.payload,p_operation:request.operation,p_revision:request.revision});if(r.error){if(/^(22|23|40|42)/.test(String(r.error.code||''))||r.error.code==='PGRST202'){sessionStorage.removeItem(key);}throw new Error(r.error.message||'Операция не подтверждена');}if(!accepted(r.data,actor))throw new Error('Сервер вернул устаревшую версию. Обновите журнал.');sessionStorage.removeItem(key);await loadAll();showToast('Финансовые данные подтверждены');}
 finally{busy=false;render();}
}
function correctReceipt(id){
 if(!ready())throw new Error('Обновите финансовые данные');
 const e=(state.ledger||[]).find(x=>x.id===id);if(!e)return;
 form('Исправить оплату клиента',row('Оплата клиента',e.amount)+
 select('Как получены деньги','mode',[['date','Известна фактическая дата'],['before','До начала текущего учёта · дата неизвестна']])+
 input('Фактическая дата получения','date',e.entry_date,'date')+
 '<p>До '+esc(fmtDate(snapshot().start_date))+' — прежняя оплата: долг клиента уменьшится, но текущие деньги и выручка не увеличатся. Сумма и проект не меняются.</p>',
 f=>({command:'correct_receipt',payload:{source:id,date:f.mode==='date'?f.date:null,before_start:f.mode==='before',reason:f.reason}}));
 const mode=modal.querySelector('[name="mode"]'),date=modal.querySelector('[name="date"]');
 mode.value=e.received_before_start?'before':'date';date.max=snapshot().as_of;
 const sync=()=>{date.disabled=mode.value==='before';};mode.onchange=sync;sync();
}
async function act(action,id){
 if(!owner())return;
 if(action==='correct-receipt'){correctReceipt(id);return;}
 if(action==='refresh'){await loadAll();lastRead=Date.now();render();return;}if(['overview','calendar','forecast'].includes(action)){tab=action;render();return;}
 if(action==='retry'){const p=pending();if(p)await send(p.command,p.payload,p);return;}
 if(!ready())throw new Error('Сначала обновите данные');const s=snapshot();
 const projects=[['','Без проекта'],...(state.financialProjects||state.projects||[]).filter(p=>!p.deleted_at).map(p=>[p.id,p.name])],employees=[['','Без сотрудника'],...(state.employees||[]).filter(e=>!e.deleted_at).map(e=>[e.id,e.name])];
 const walletOptions=walletOptionsFor(s);
 const funding=[['reserve','Свободный резерв'],...Object.keys(s.balances||{}).filter(k=>k!=='reserve'&&!k.startsWith('obligation:')).map(k=>[k,accountName(k)])];
 if(['income','expense','release','project-plan','record-income','record-expense'].includes(action)){
  const project=s.unscheduled_projects.find(p=>p.id===id),record=action.startsWith('record-'),direction=action==='project-plan'?'income':action.replace('record-','');
  const income=direction==='income',release=direction==='release';
  const title=record?(income?'Записать поступление':'Записать расход'):(income?'Запланировать поступление':release?'Запланировать распределение':'Запланировать расход');
  const label=input(release?'На что распределить деньги':income?'За что поступление':'На что расход','label',project?'Оплата · '+project.name:'');
  const amount=input('Сумма, ₽','amount',project?.remaining||'','number');
  const timing=record?input('Дата оплаты','date',s.as_of,'date')+walletField(income?'Куда поступили деньги':'Откуда оплатили',walletOptions):input('Плановая дата (если известна)','due_date','','date');
  const projectField=select('Проект','project_id',projects,project?.id);
  const debt=direction==='expense'&&!record?select('Вид платежа','obligation',[['false','Запланированный расход'],['true','Начисленный долг — зарезервировать сумму']]):'';
  const details=select('Сотрудник','employee_id',employees)+input('Месяц начисления','payroll_month','','month')+
   (direction==='expense'?select('Источник средств','funding',funding):'')+
   (record?'<input type="hidden" name="certainty" value="confirmed">':select('Согласование','certainty',[['confirmed','Согласовано'],['expected','Требует уточнения']],project?'expected':'confirmed'))+
   input('Отдельный комментарий для журнала','reason');
  const extra='<details class="fw-extra"><summary>Сотрудник, '+(direction==='expense'?'источник средств и ':'')+'другие реквизиты</summary>'+details+'</details>';
  form(title,label+amount+timing+projectField+debt+extra,f=>({command:record?'record':'plan',payload:{...f,amount:number(f.amount),obligation:f.obligation==='true',direction,funding:direction==='income'||direction==='release'?f.project_id?'project:'+f.project_id:'reserve':f.funding,terms:{payroll_month:f.payroll_month||null,recorded_at:new Date().toISOString(),basis:f.reason,employee:f.employee_id?(state.employees||[]).filter(e=>e.id===f.employee_id).map(e=>({id:e.id,role:e.role,fixed_salary:e.fixed_salary}))[0]:null}}}),{reasonFromLabel:true,submit:record?'Записать оплату':'Добавить в план'});
  const fields=modal.querySelector('form').elements;
  fields.label.required=true;
  fields.label.minLength=2;
  fields.label.maxLength=180;
  fields.amount.required=true;
  if(record){fields.date.required=true;fields.date.max=s.as_of;fields.wallet_id.required=true;}

 }else if(action==='wallet-reconcile'||action==='reserve-adjust'){
  const title=action==='reserve-adjust'?'Корректировать свободный резерв':walletOptions.length===1&&s.wallets.some(w=>w.active&&w.is_default)?'Сверка сейфа':'Сверка остатка';
  form(title,walletField('Где пересчитали деньги',walletOptions)+input(action==='reserve-adjust'?'Новый свободный резерв':'Сколько денег при пересчёте','target',action==='reserve-adjust'?s.reserve:'','number').replace('min="0.01"',action==='reserve-adjust'?'':'min="0"')+'<p>Разница будет отдельной записью с причиной. Деньги проектов и обязательства сохраняются. Перед подтверждением сверьте введённую сумму с фактическим остатком.</p><label class="fw-count-confirmation"><input name="confirmed" type="checkbox" required> Фактическую сумму проверил</label>',f=>{if(f.target==='')throw new Error('Введите фактическую сумму');return {command:action==='reserve-adjust'?'reserve_adjust':'wallet_reconcile',payload:{...f,target:number(f.target),confirmed:f.confirmed==='on'}};});
 }else if(action==='pay'){
  const item=s.items.find(x=>x.key===id);if(!item)throw new Error('Обязательство уже изменено');
  form(item.direction==='income'?'Подтвердить поступление':item.direction==='release'?'Подтвердить распределение':'Подтвердить фактическую выплату','<p>'+esc(item.label)+' · '+esc(accountName(item.funding))+'</p>'+input('Сумма фактической оплаты','amount',item.remaining,'number')+input('Дата','date',s.as_of,'date')+walletField('Место оплаты',walletOptions),f=>({command:'pay',payload:{...f,key:id,amount:number(f.amount)}}));
 }else if(action==='reschedule'){
  const item=s.items.find(x=>x.key===id);
  if(!item)throw new Error('Обязательство уже изменено');
  const currentDate=item.due_date?fmtDate(item.due_date):'Без срока';
  const details='<p><strong>'+esc(item.label)+'</strong> · '+money(item.remaining)+'</p><p>Текущий срок: '+esc(currentDate)+'</p>';
  form('Перенести срок',details+input('Новая дата','due_date',item.due_date||'','date'),f=>({command:'reschedule',payload:{...f,key:id}}));
 }else if(action==='cancel')form('Отменить неоплаченный остаток плана','<p>Фактические оплаты и история сохранятся.</p>',f=>({command:'cancel',payload:{...f,id}}));
 else if(action==='wallet')form('Добавить место хранения',input('Название','name')+select('Тип','kind',[['cash','Наличные'],['bank','Банковский счёт']]),f=>({command:'wallet',payload:f}));
 else if(action==='wallet-transfer')form('Перевести деньги',select('Откуда','from',walletOptions)+select('Куда','to',walletOptions,walletOptions[1]?.[0])+input('Сумма','amount','','number')+'<p>Движение между своими счетами не создаёт доход и не уменьшает резерв.</p>',f=>({command:'wallet_transfer',payload:{...f,amount:number(f.amount)}}));
 else if(['rule','replace-rule','salary-rule'].includes(action)){
  const old=s.rules.find(x=>x.id===id),employee=action==='salary-rule'?(state.employees||[]).find(e=>e.id===id):null;
  if(employee&&s.rules.some(r=>r.employee_id===employee.id&&!r.end_month))throw new Error('Оклад уже есть в регулярных обязательствах. Измените его с нового месяца.');
  const d=new Date(s.as_of.slice(0,7)+'-01T12:00:00Z');if(action==='replace-rule'||employee)d.setUTCMonth(d.getUTCMonth()+1);const month=[d.toISOString().slice(0,7),s.opening_mode==='zero'?String(s.start_date||'').slice(0,7):''].sort().at(-1);
  form('Регулярный платёж',input('Название','label',employee?'Оклад · '+employee.name:old?.label||'')+select('Направление','direction',[['expense','Расход'],['income','Поступление']],old?.direction||'expense')+input('Сумма в месяц','amount',employee?.fixed_salary||old?.amount||'','number')+input('Первый месяц оплаты','start_month',month,'month')+input('До какого числа (1–28)','due_day',old?.due_day||10,'number')+'<p>Укажите месяц срока выплаты. Например, оклад за октябрь со сроком в ноябре начинается с ноября. Уже оплаченные суммы первого месяца не вносите повторно: проверьте исходный остаток обязательств.</p>',f=>({command:'rule',payload:{...f,amount:number(f.amount),due_day:number(f.due_day),start_month:f.start_month+'-01',certainty:'confirmed',...(action==='replace-rule'?{replace_id:id}:{}),employee_id:employee?.id||old?.employee_id||null,terms:{salary:employee?{employee_id:employee.id,amount:employee.fixed_salary,role:employee.role}:old?.terms||null,as_of:s.as_of}}}));
 }else if(action==='stop-rule')form('Остановить регулярный платёж','<p>Этот месяц остаётся в календаре. Новые месяцы создаваться не будут.</p>',f=>({command:'stop_rule',payload:{...f,id}}));
 else if(action==='link'){
  const source=s.unmatched.find(x=>x.id===id);
  if(!source)throw new Error('Оплата изменилась. Обновите журнал.');
  let projectId=null,employeeId=null;
  if(source.source_table==='ledger_entries'){
   const payment=(state.ledger||[]).find(x=>x.id===source.source_id&&!x.deleted_at);
   if(!payment)throw new Error('Исходная оплата не загружена. Обновите журнал.');
   projectId=payment.project_id||null;
   employeeId=payment.payee_employee_id||null;
  }else if(!['company_income','company_expenses'].includes(source.source_table)){
   throw new Error('Обновите журнал для проверки исходной оплаты.');
  }
  const items=s.items.filter(x=>x.origin!=='funded'&&x.direction!=='release'&&
   (source.cash_delta>0)===(x.direction==='income')&&
   (x.project_id||null)===projectId&&(x.employee_id||null)===employeeId);
  if(!items.length)throw new Error('Нет неоплаченного плана для этого сотрудника и проекта. Создайте соответствующий план.');
  form('Связать ранее внесённую оплату',select('Какой план погашает оплата','key',items.map(x=>[x.key,x.label+' · '+money(x.remaining)]))+input('Связываемая часть оплаты','amount',Math.min(source.remaining,items[0].remaining),'number')+'<p>Денежный остаток не изменится. При отмене исходной оплаты остаток плана восстановится автоматически.</p>',f=>({command:'link',payload:{...f,source:id,amount:number(f.amount)}}));
 }else if(action==='unlink')form('Отменить связь оплаты с планом','<p>Сама денежная операция сохранится. Неоплаченная часть плана восстановится.</p>',f=>({command:'unlink',payload:{...f,id}}));
 else if(action==='history'){
  const j=state.financialJournal,ops=[...j.operations,...(j.history||[])],actor=session.token;const r=await sb.rpc('get_financial_journal_history',{p_before:ops.length?Math.min(...ops.map(o=>o.revision)):null});if(r.error)throw r.error;if(actor!==session?.token||!owner())return;const seen=new Set(ops.map(o=>o.id));j.history=[...(j.history||[]),...(r.data||[]).filter(o=>!seen.has(o.id))];render();
 }
}
const moneyForms=new Set(['companyExpenseSheetOverlay','companyIncomeSheetOverlay','paymentSheetOverlay','salaryPaymentSheetOverlay','cashInvoiceOverlay']);
function attachWallet(overlay){
 if(!enabled()||!snapshot().active||!moneyForms.has(overlay.id)||!overlay.classList.contains('active'))return;
 const sheet=overlay.querySelector('.sheet')||overlay;
 let picker=sheet.querySelector('.fw-wallet-picker');
 const previous=picker?.querySelector('[name="wallet_id"]')?.value||overlay.dataset.financeWallet;
 if(!picker){
  picker=document.createElement('div');picker.className='field fw-wallet-picker';
  const target=sheet.querySelector('input[type="number"]')?.closest('.field');
  if(target)target.after(picker);else sheet.appendChild(picker);
 }
 const options=walletOptionsFor(snapshot());
 picker.innerHTML=walletField('Место оплаты',options);
 const control=picker.querySelector('[name="wallet_id"]');
 control.classList.add('fw-wallet-select');
 if(previous&&options.some(([id])=>id===previous))control.value=previous;
 control.onchange=()=>overlay.dataset.financeWallet=control.value;
}
function observeMoneyForm(overlay){if(!moneyForms.has(overlay.id))return;new MutationObserver(()=>attachWallet(overlay)).observe(overlay,{attributes:true,attributeFilter:['class'],childList:true});attachWallet(overlay);}
function selectedWallet(){if(!enabled()||!snapshot().active)return null;return [...document.querySelectorAll('.sheet-overlay.active .fw-wallet-select')].find(el=>el.closest('.fw-wallet-picker')?.getClientRects().length)?.value||null;}
for(const id of moneyForms){if($(id))observeMoneyForm($(id));}
new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node.nodeType===1)observeMoneyForm(node);}).observe(document.body,{childList:true});
function clear(){document.querySelectorAll('.fw-wallet-picker').forEach(el=>el.remove());for(const id of moneyForms)if($(id))delete $(id).dataset.financeWallet;modal?.remove();modal=null;$('financeWorkspace')?.remove();document.getElementById('view-finance')?.classList.remove('finance-unified');}
const style=document.createElement('style');style.textContent=`#view-finance.finance-unified>:not(#financeWorkspace){display:none!important}#financeWorkspace{max-width:1100px;margin:auto;color:var(--text)}.fw-head,.fw-row,.fw-actions{display:flex;justify-content:space-between;align-items:center;gap:12px}.fw-head h1{margin:0;font-size:28px}.fw-head p,.fw-card p,.fw-status{font-size:13px;line-height:1.6;color:var(--text-dim)}.fw-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.fw-tabs button{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;padding:12px;min-height:44px;cursor:pointer}.fw-tabs .active{background:var(--blue);color:white}.fw-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.fw-card{background:var(--card);border:1px solid var(--line);padding:20px;border-radius:14px;margin-bottom:14px;min-width:0}.fw-card h2{font-size:19px;margin-top:0}.fw-card h3{font-size:16px;margin:0}.fw-amount{display:block;font-size:26px;margin-top:12px}.fw-row{padding:10px 0;border-bottom:1px solid var(--line);align-items:flex-start}.fw-row>span{min-width:0;overflow-wrap:anywhere}.fw-row>strong{flex-shrink:0}.fw-actions{justify-content:flex-start;flex-wrap:wrap;margin:12px 0}.fw-card .btn,.fw-actions .btn,.fw-head .btn,.fw-warning .btn,#financeWorkspace>.btn{width:auto;min-height:44px;padding:11px 14px}.fw-warning{padding:14px;border:1px solid var(--line);border-radius:10px;line-height:1.5;margin:10px 0;color:var(--text)}.fw-form label{display:grid;gap:7px;margin:14px 0;font-size:13px}.fw-form input,.fw-form select{font:inherit;width:100%;box-sizing:border-box;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:11px;background:var(--card);color:var(--text)}.fw-form{max-width:700px}.fw-wallet-fixed{display:grid;gap:5px;margin:14px 0;font-size:13px}.fw-wallet-fixed strong{font-weight:600}.fw-form-error{color:var(--red)}.fw-table{overflow:auto}.fw-table table{border-collapse:collapse;width:100%;font-size:13px}.fw-table td,.fw-table th{padding:10px;border-bottom:1px solid var(--line);white-space:nowrap}@media(max-width:600px){.fw-grid{grid-template-columns:1fr}.fw-row{flex-wrap:wrap}.fw-head{align-items:flex-start}.fw-tabs button{flex:1 0 27%}.fw-card{padding:16px}.fw-amount{font-size:24px}}`;document.head.appendChild(style);
style.textContent += `
.fw-form .fw-count-confirmation{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer}
.fw-form .fw-count-confirmation input{width:20px;height:20px;min-height:0;padding:0;margin:0;flex:none}
#financeWorkspace .fw-page-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 20px}
#financeWorkspace .fw-page-head h1{margin:4px 0;font-size:clamp(23px,3vw,32px);line-height:1.18}
#financeWorkspace .fw-page-head .btn{width:auto;flex:none}
#financeWorkspace .fw-path{display:flex;align-items:center;gap:8px;color:var(--text-dim)}
#financeWorkspace .fw-path .fw-route{background:none;border:0;padding:7px 0;color:var(--blue);font:inherit;font-size:13px;min-height:44px;cursor:pointer}
#financeWorkspace .fw-directory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:16px}
#financeWorkspace .fw-group{min-width:0;border:1px solid var(--line);background:var(--card);border-radius:16px;padding:16px 20px}
#financeWorkspace .fw-group h2{margin:0 0 6px;font-size:17px;line-height:1.35}
#financeWorkspace .fw-group .btn,#financeWorkspace .fw-group .fw-route{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;min-height:44px;padding:10px 0;background:none;border:none;border-radius:0;color:var(--text);text-align:left;cursor:pointer;font:inherit;font-size:15px}
#financeWorkspace .fw-group button + button{border-top:1px solid var(--line)}
#financeWorkspace .fw-group button::after{content:'';width:7px;height:7px;border:solid var(--blue);border-width:1.5px 1.5px 0 0;transform:rotate(45deg);margin-right:3px;flex:none}
#financeWorkspace .fw-group button:disabled{opacity:.45;cursor:default}
#financeWorkspace .fw-report .fw-grid{margin-top:14px;grid-template-columns:repeat(3,minmax(0,1fr))}
@media(max-width:740px){#financeWorkspace .fw-report .fw-grid{grid-template-columns:1fr}}
#financeWorkspace details>summary{cursor:pointer;min-height:44px;align-content:center}
#financeWorkspace .fw-search{display:grid;gap:6px;margin:12px 0 18px;font-size:14px;font-weight:600}
#financeWorkspace .fw-search input{width:100%;min-height:44px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);font:inherit}
#financeWorkspace [hidden]{display:none!important}
@media(max-width:640px){#financeWorkspace .fw-directory{grid-template-columns:1fr;gap:10px}#financeWorkspace .fw-group{padding:12px 16px}#financeWorkspace .fw-page-head{margin-bottom:12px}}
`;
for(const name of ['renderAll','renderCashFinance']){const old=window[name];if(typeof old==='function')window[name]=function(){const r=old.apply(this,arguments);schedule();return r;};}
for(const name of ['renderAnalytics','renderFinanceSalaries']){const old=window[name];if(typeof old==='function')window[name]=function(){if(enabled())return schedule();return old.apply(this,arguments);};}
const oldClear=ARHITTEKJournal.clear;ARHITTEKJournal.clear=function(){clear();oldClear();};
window.ARHITTEKFinanceWorkspace={correctReceipt,enabled,render,schedule,refresh,accepted,clear,selectedWallet,managementSummary};
document.querySelector('.nav-btn[data-view="view-finance"]')?.addEventListener('click',()=>{schedule();if(enabled()&&Date.now()-lastRead>15000)void refresh();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&enabled()&&Date.now()-lastRead>30000)void refresh();});
setInterval(()=>{if(enabled()&&!document.hidden&&(snapshot().as_of!==ARHITTEKCash.day()||document.getElementById('view-finance')?.classList.contains('active')&&Date.now()-lastRead>25000))void refresh();},30000);
render();
})();
