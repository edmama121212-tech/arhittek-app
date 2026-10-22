/* Server-confirmed balances and explicit owner-approved financial allocations. */
(()=>{
'use strict';
const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(n)||0);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v)||0,round=v=>Math.round(v*100)/100,$=id=>document.getElementById(id);
const active=()=>typeof state!=='undefined'&&state.financialJournal?.active===true;
const owner=()=>typeof isOwner==='function'&&isOwner();
const ready=()=>owner()&&state.financialDataReady&&!state.financialDataError&&!loadAllInFlight;
const total=b=>round(Object.values(b||{}).reduce((a,v)=>a+num(v),0));
function valid(j){return j?.version===1&&typeof j.active==='boolean'&&Number.isSafeInteger(j.revision)&&j.balances&&Array.isArray(j.operations);}
function budget(s){
 const b=s.financialJournal.balances,sum=prefix=>round(Object.entries(b).filter(([k])=>k.startsWith(prefix)).reduce((a,[,v])=>a+num(v),0));
 const projects=(s.financialProjects||s.projects||[]).map(p=>({id:p.id,name:p.name,projectHeld:num(b['project:'+p.id]),costsHeld:num(b['costs:'+p.id]),teamHeld:sum('team:'+p.id+':'),
  construction:window.ARHITTEKCash.constructionProject(s,p),completed:/заверш/i.test((s.statuses||[]).find(x=>x.id===p.status_id)?.name||''),team:Object.entries(b).filter(([k])=>k.startsWith('team:'+p.id+':')).map(([k,v])=>({employeeId:k.split(':')[2],month:k.split(':')[3],remaining:num(v),due:num(v),paid:0})),companyContribution:0,openingProjectFunds:0,receivedAfterSnapshot:0,amortization:0,directPaidAfterSnapshot:0,teamPaidAfterSnapshot:0}));
 return {cashBalance:total(b),companyReserve:num(b.reserve),available:num(b.reserve),amortization:num(b.amortization),projectsHeld:sum('project:'),teamHeld:sum('team:'),costsHeld:sum('costs:'),constructionHeld:projects.filter(p=>p.construction).reduce((a,p)=>a+p.projectHeld,0),projects,warnings:[],countedCash:true,releasedOpeningFunds:0,openingFundsUsed:0};
}
async function rpc(name,args){const r=await sb.rpc(name,args);if(r.error)throw new Error(r.error.message||'Не удалось подтвердить операцию');return r.data;}
let modal=null,busy=false;
function field(label,id,value='',type='number'){return '<label class="field">'+esc(label)+'<input id="'+id+'" type="'+type+'" '+(type==='number'?'step="0.01" min="0" ':'')+'value="'+esc(value)+'"></label>';}
function sheet(title,html,save){
 if(!ready())return showToast('Сначала обновите финансовые данные');
 if(modal)modal.remove();modal=document.createElement('div');modal.className='sheet-overlay active';modal.id='financialJournalSheet';
 modal.innerHTML='<div class="sheet" style="max-width:760px"><h3>'+esc(title)+'</h3>'+html+'<p id="journalFormError" role="alert" style="color:var(--red)"></p><button class="btn btn-primary" id="journalConfirm">Подтвердить</button><button class="btn btn-secondary" id="journalCancel">Закрыть</button></div>';
 document.body.appendChild(modal);$('journalCancel').onclick=()=>{if(!busy){modal.remove();modal=null;}};
 const operation=crypto.randomUUID();let lockedPayload=null;
 $('journalConfirm').onclick=async()=>{if(busy||!ready())return;busy=true;$('journalConfirm').disabled=true;$('journalFormError').textContent='';try{
  const proposal=await save();
  // Keep the same request through uncertain delivery; changed payload requires a new review.
  if(lockedPayload&&JSON.stringify(lockedPayload)!==JSON.stringify(proposal))throw new Error('Предыдущая отправка могла сохраниться. Закройте форму и обновите журнал перед изменением суммы.');
  lockedPayload=proposal;
  const j=await rpc('confirm_financial_operation',{p_command:proposal.command,p_payload:proposal.payload,p_operation:operation,p_revision:proposal.revision});
  if(!valid(j))throw new Error('Сервер не подтвердил полный остаток');state.financialJournal=j;
  modal.remove();modal=null;await loadAll();showToast('Финансовая операция подтверждена');
 }catch(e){if($('journalFormError'))$('journalFormError').textContent=e.message;}finally{busy=false;if($('journalConfirm'))$('journalConfirm').disabled=false;}};
}
const reasonField=()=>field('Причина / комментарий','journalReason','','text');
function positive(id){const raw=$(id).value;if(raw==='')throw new Error('Заполните все суммы');const v=Number(raw);if(!Number.isFinite(v)||v<0||Math.abs(round(v)-v)>1e-8)throw new Error('Суммы должны быть неотрицательными, до копейки');return v;}
function reason(){const s=$('journalReason').value.trim();if(s.length<3)throw new Error('Укажите причину');return s;}
function teamFields(rows,prefix){return rows.map((r,i)=>'<div class="card">'+esc(findEmployee(r.employee)?.name||'Сотрудник')+' · '+esc(r.month)+field('Осталось зарезервировать',prefix+i,r.amount)+'</div>').join('');}
function pendingButton(){return '<div class="card" id="journalPending"><h3>Переход на подтверждённый журнал</h3><p class="note">Сначала сверьте все деньги и обязательства. Показанный сейчас резерв расчётный. Новая схема начнёт работать после вашего подтверждения.</p><button class="btn btn-primary" data-journal="activate">Сверить и включить журнал</button></div>';}
async function activate(){
 if(!ready())return;
 const first=await rpc('get_financial_journal');await loadAll();const snap=state.financialJournal;
 if(!valid(first)||!valid(snap)||snap.active||first.fingerprint!==snap.fingerprint)throw new Error('Данные изменились. Обновите и повторите сверку.');
 const old=ARHITTEKBudget.calculate(state,ARHITTEKCash.day());
 const projects=(state.financialProjects||state.projects).map(p=>{const d=old.projects.find(d=>d.id===p.id);return {id:p.id,name:p.name,funds:d?.projectHeld||0,costs:d?.costsHeld||0,team:(d?.team||[]).filter(t=>t.remaining>0&&d.teamHeld>0).map(t=>({employee:t.employeeId,month:t.month,amount:t.remaining}))};});
 const html='<p>Укажите все фактические деньги на счетах и наличными, включая средства заказчиков. Ниже — предварительные обязательства из прежнего расчёта: проверьте их, в том числе старые авансы.</p>'+field('Все деньги фактически, ₽','journalCash')+field('Амортизация','journalAmort',old.amortization)+
 '<details open><summary>Деньги и обязательства по проектам</summary>'+projects.map((p,i)=>'<details class="card" '+((p.funds||p.costs||p.team.length)?'open':'')+'><summary>'+esc(p.name)+'</summary>'+field('Деньги, оставшиеся у проекта','journalFunds'+i,p.funds)+field('Неоплаченные прямые расходы','journalCosts'+i,p.costs)+teamFields(p.team,'journalTeam'+i+'-')+'</details>').join('')+'</details>'+reasonField()+'<label><input type="checkbox" id="journalChecked"> Я сверил деньги, авансы и обязательства по всем проектам</label><p id="journalOpeningPreview" class="note"></p>';
 sheet('Начальная сверка',html,async()=>{
  if(!$('journalChecked').checked)throw new Error('Подтвердите сверку денег и обязательств');
  return {command:'activate',revision:snap.revision,payload:{reason:reason(),confirmed:true,fingerprint:snap.fingerprint,cash:positive('journalCash'),amortization:positive('journalAmort'),projects:projects.map((p,i)=>({id:p.id,funds:positive('journalFunds'+i),costs:positive('journalCosts'+i),team:p.team.map((t,j)=>({...t,amount:positive('journalTeam'+i+'-'+j)}))}))}};
 });
 const preview=()=>{try{let held=positive('journalAmort');projects.forEach((p,i)=>{held+=positive('journalFunds'+i)+positive('journalCosts'+i);p.team.forEach((t,j)=>held+=positive('journalTeam'+i+'-'+j));});$('journalOpeningPreview').textContent='Свободный резерв после сверки: '+money(positive('journalCash')-held);}catch(_){$('journalOpeningPreview').textContent='Введите фактическую сумму всех денег';}};modal.addEventListener('input',preview);preview();
}
async function closeProject(id){
 const first=await rpc('review_financial_project',{p_id:id});await loadAll();const check=await rpc('review_financial_project',{p_id:id});
 if(!first||!check||first.fingerprint!==check.fingerprint||first.revision!==check.revision||check.revision!==state.financialJournal.revision)throw new Error('Данные изменились. Повторите расчёт закрытия.');
 const p=state.projects.find(p=>p.id===id);if(!p)throw new Error('Проект недоступен');
 const legacyState={...state,financialJournal:null};const d=ARHITTEKBudget.calculate(legacyState,ARHITTEKCash.day()).projects.find(p=>p.id===id);
 const b=state.financialJournal.balances,team=(d?.team||[]).map(t=>({employee:t.employeeId,month:t.month,amount:t.remaining}));
 // Keep already frozen obligations visible even if the work card was changed.
 for(const [key,value] of Object.entries(b)){const parts=key.split(':');if(parts[0]==='team'&&parts[1]===id&&!team.some(t=>t.employee===parts[2]&&t.month===parts[3]))team.push({employee:parts[2],month:parts[3],amount:num(value)});}
 sheet('Финансовое закрытие · '+p.name,'<p>Проверьте оставшиеся обязательства. Эти суммы фиксируются отдельно от статуса, сроков и дальнейших правок карточки.</p><p>Деньги проекта: <strong>'+money(b['project:'+id])+'</strong></p>'+teamFields(team,'journalCloseTeam')+field('Осталось оплатить прямые расходы','journalCloseCosts',d?.costsHeld||num(b['costs:'+id]))+reasonField()+'<p id="journalClosePreview"></p>',async()=>({command:'close',revision:check.revision,payload:{project:id,project_fingerprint:check.fingerprint,reason:reason(),costs:positive('journalCloseCosts'),team:team.map((t,i)=>({...t,amount:positive('journalCloseTeam'+i)}))}}));
 const preview=()=>{try{const existing=Object.entries(b).filter(([k])=>k==='costs:'+id||k.startsWith('team:'+id+':')).reduce((a,[,v])=>a+num(v),0);const held=positive('journalCloseCosts')+team.reduce((a,t,i)=>a+positive('journalCloseTeam'+i),0);$('journalClosePreview').textContent='Изменение свободного резерва: '+money(num(b['project:'+id])+existing-held)+'. Общая сумма денег не изменится.';}catch(_){}};modal.addEventListener('input',preview);preview();
}
function accountName(k){if(k==='reserve')return 'Свободный резерв';if(k==='amortization')return 'Амортизация';const [kind,p,e,m]=k.split(':');const name=(state.financialProjects||state.projects).find(x=>x.id===p)?.name||p;return (kind==='project'?'Деньги проекта':kind==='costs'?'Расходы проекта':'Гонорар '+(findEmployee(e)?.name||'')+' '+m)+' · '+name;}
function transfer(){const snap=state.financialJournal,b=snap.balances;const destinations=['reserve','amortization',...(state.projects||[]).map(p=>'project:'+p.id)];
 const select=(id,keys)=>'<select id="'+id+'">'+keys.map(k=>'<option value="'+esc(k)+'">'+esc(accountName(k))+(id==='journalFrom'?' · '+money(b[k]):'')+'</option>').join('')+'</select>';
 sheet('Распределить имеющиеся деньги','<p>Это перевод между назначениями внутри общей суммы. Для стройки укажите договорное основание вознаграждения компании.</p><label class="field">Откуда'+select('journalFrom',Object.keys(b).filter(k=>num(b[k])>0))+'</label><label class="field">Куда'+select('journalTo',destinations)+'</label>'+field('Сумма','journalTransferAmount')+reasonField(),async()=>({command:'transfer',revision:snap.revision,payload:{from:$('journalFrom').value,to:$('journalTo').value,amount:positive('journalTransferAmount'),reason:reason()}}));
}
function reconcile(){const snap=state.financialJournal;sheet('Повторная сверка','<p>Все деньги по журналу: '+money(total(snap.balances))+'. Разница будет отдельной записью с вашей причиной и изменит свободный резерв.</p>'+field('Все деньги фактически','journalCash')+reasonField()+'<label><input type="checkbox" id="journalChecked"> Фактическую сумму проверил</label>',async()=>{if(!$('journalChecked').checked)throw new Error('Подтвердите сверку');return {command:'reconcile',revision:snap.revision,payload:{cash:positive('journalCash'),reason:reason(),confirmed:true}};});}
function reverse(id){const snap=state.financialJournal,o=snap.operations.find(x=>x.id===id);if(!o)return;sheet('Отмена финансовой записи','<p>'+esc(o.reason)+'</p><p>Исходная запись сохранится в истории. Сервер проверит, что зависимые распределения позволяют отмену.</p>'+reasonField(),async()=>({command:'reverse',revision:snap.revision,payload:{operation:id,reason:reason()}}));}
function panel(id,html){let p=$('cash-panel-'+id);if(!p){const target=document.querySelector('.finance-visual-panel[data-fin-panel="'+id+'"]');if(!target)return;target.classList.add('cash-managed');p=document.createElement('section');p.id='cash-panel-'+id;target.appendChild(p);}p.innerHTML=html;}
const btn=(text,action,id='')=>'<button class="btn btn-secondary" data-journal="'+action+'" data-id="'+esc(id)+'">'+esc(text)+'</button>';
const row=(label,value)=>'<div class="fee-row"><div class="fl">'+esc(label)+'</div><div class="fv">'+money(value)+'</div></div>';
function renderFinance(){
 if(!owner())return;const snap=state.financialJournal;
 if(!snap?.active){const el=$('cash-panel-reserve');if(el&&!$('journalPending'))el.insertAdjacentHTML('afterbegin',pendingButton());return;}
 if($('cashMonthPicker'))$('cashMonthPicker').hidden=true;
 const b=budget(state),summary='<div class="card">'+row('Все деньги',b.cashBalance)+row('Деньги проектов и заказчиков',b.projectsHeld)+row('Зарезервировано команде',b.teamHeld)+row('Зарезервировано на расходы',b.costsHeld)+row('Амортизация',b.amortization)+row('Свободный резерв',b.companyReserve)+'<p class="note">Подтверждено сервером · запись №'+snap.revision+'. Обычные правки карточек не изменяют эти суммы.</p></div>';
 const reversed=new Set(snap.operations.map(o=>o.reverses).filter(Boolean));
 const history='<details class="card"><summary>Журнал · последние 100 операций</summary>'+snap.operations.map(o=>'<div class="card"><strong>'+esc(o.reason)+'</strong><p class="note">'+esc(new Date(o.created_at).toLocaleString('ru-RU'))+' · '+esc(findEmployee(o.actor)?.name||'Владелец')+'</p>'+row('Изменение всех денег',o.cash_delta)+row('Изменение свободного резерва',o.changes.reserve||0)+row('Резерв до операции',num(o.balances_after.reserve)-num(o.changes.reserve))+row('Резерв после операции',o.balances_after.reserve)+(o.kind!=='activate'&&!o.reverses&&!reversed.has(o.id)?btn('Отменить с причиной','reverse',o.id):'<p class="note">'+(reversed.has(o.id)?'Отменено отдельной записью':'Зафиксировано')+'</p>')+'</div>').join('')+'</details>';
 panel('overview',summary+btn('Добавить доход компании','income')+btn('Добавить расход компании','expense')+history);
 panel('reserve','<div class="finance-v-hero reserve-hero"><span>Подтверждённый свободный резерв</span><strong data-company-reserve>'+money(b.companyReserve)+'</strong></div>'+summary+btn('Распределить деньги','transfer')+btn('Сверить все деньги','reconcile')+'<details class="card"><summary>Финансовое закрытие проектов</summary>'+(state.projects||[]).map(p=>'<div class="card"><strong>'+esc(p.name)+'</strong>'+row('Деньги проекта',snap.balances['project:'+p.id])+(ARHITTEKCash.constructionProject(state,p)?'<p class="note">Средства заказчика. Вознаграждение компании — через «Распределить деньги» с основанием.</p>':/заверш/i.test(findStatus(p.status_id)?.name||'')?btn('Проверить финансовое закрытие','close',p.id):'<p class="note">После завершения появится расчёт для подтверждения.</p>')+'</div>').join('')+'</details>'+history);
 panel('amortization','<div class="card">'+row('Зафиксировано на амортизацию',b.amortization)+'<p>5% новых поступлений проектного отдела и прочих доходов. Средства заказчиков стройки исключены.</p>'+btn('Распределить деньги','transfer')+'</div>');
 // Existing cash forms, invoice payment and payroll controls are retained by the caller.
}
function salaryField(employee,month){
 $('journalSalaryField')?.remove();if(!active())return;
 const held=Object.entries(state.financialJournal.balances).filter(([k])=>k.startsWith('team:')&&k.split(':')[2]===employee&&k.split(':')[3]===month).reduce((a,[,v])=>a+num(v),0);
 const div=document.createElement('div');div.id='journalSalaryField';div.innerHTML=field('Из этой выплаты — за счёт зарезервированных гонораров (доступно '+money(held)+')','journalSalaryFunded','')+'<p class="note">Остальная часть выплаты спишется из свободного резерва. Укажите только гонорары, уже включённые в резервирование.</p>';$('salaryPaymentNote').parentElement.after(div);$('journalSalaryFunded').max=held;
}
function salaryDescription(description,amount){if(!active())return description;const funded=positive('journalSalaryFunded');if(funded>amount||funded>num($('journalSalaryFunded').max))throw new Error('Проверьте часть выплаты из зарезервированных гонораров');return description.replace(/\s*\[funded:[^\]]*\]/g,'')+' [funded:'+funded+']';}
// Stable source UUIDs survive a lost response. No retry manufactures another debit.
async function safeFetch(input,options={}){
 const url=String(input?.url||input),method=(options.method||'GET').toUpperCase();const match=url.match(/\/rest\/v1\/(ledger_entries|company_income|company_expenses)(?:\?|$)/);
 if(method!=='POST'||!match||!options.body)return fetch(input,{...options,cache:'no-store'});
 let body;try{body=JSON.parse(options.body);}catch(_){return fetch(input,{...options,cache:'no-store'});}
 const list=Array.isArray(body)?body:[body];if(!list.length)return fetch(input,{...options,cache:'no-store'});
 const signature=JSON.stringify([match[1],body]),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));
 const key='arhittek-money-pending-'+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
 let ids=JSON.parse(sessionStorage.getItem(key)||'null')||list.map(r=>r.id||crypto.randomUUID());sessionStorage.setItem(key,JSON.stringify(ids));
 list.forEach((r,i)=>r.id=ids[i]);const headers=new Headers(options.headers||{});headers.set('x-finance-client','1');
 const res=await fetch(input,{...options,headers,body:JSON.stringify(Array.isArray(body)?list:list[0]),cache:'no-store'});
 if(res.ok){sessionStorage.removeItem(key);return res;}
 // Primary-key conflict after uncertain delivery: verify exact monetary payload.
 if(res.status===409&&list.length===1){const u=new URL(url);u.search='';u.searchParams.set('id','eq.'+ids[0]);u.searchParams.set('select','*');const readHeaders=new Headers(headers);readHeaders.delete('Prefer');readHeaders.set('Accept','application/json');const check=await fetch(u,{headers:readHeaders,cache:'no-store'});
 if(check.ok){const rows=await check.json(),r=rows[0];if(r&&Object.keys(list[0]).every(k=>k==='created_at'||String(r[k]??'')===String(list[0][k]??''))){sessionStorage.removeItem(key);const one=(headers.get('Accept')||'').includes('vnd.pgrst.object');return new Response(JSON.stringify(one?r:[r]),{status:200,headers:{'Content-Type':'application/json'}});}}
 }
 return res;
}
document.addEventListener('click',async e=>{const button=e.target.closest('[data-journal]');if(!button||!ready())return;button.disabled=true;try{
 const action=button.dataset.journal,id=button.dataset.id;
 if(action==='activate')await activate();else if(action==='close')await closeProject(id);else if(action==='transfer')transfer();else if(action==='reconcile')reconcile();else if(action==='reverse')reverse(id);else if(action==='income')openCompanyIncomeSheet(null);else if(action==='expense')openCompanyExpenseSheet(null);
 }catch(error){showToast(error.message);}finally{button.disabled=false;}});
window.ARHITTEKJournal={active,valid,budget,renderFinance,salaryField,salaryDescription,safeFetch};
})();
