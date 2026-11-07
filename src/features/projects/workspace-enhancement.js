// Project workspace: one team, explicit calculation, progressive disclosure.
(()=>{
'use strict';
const $=id=>document.getElementById(id), sheet=$('projectSheetOverlay').querySelector('.sheet');
const esc=s=>escapeHtml(String(s??'')), money=n=>fmtMoney(Number(n)||0);
const originalChildren=[...sheet.children], start=originalChildren.indexOf($('pf-name').closest('.field')), finish=originalChildren.indexOf($('pf-save'));
const nav=document.createElement('div');nav.className='project-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Разделы проекта');
const panels={};
for(const [id,label] of [['overview','Обзор'],['team','Команда'],['money','Деньги'],['files','Документы']]){
 const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.tab=id;b.id='project-tab-'+id;b.setAttribute('role','tab');b.setAttribute('aria-controls','project-panel-'+id);b.onclick=()=>selectTab(id);nav.append(b);
 const panel=document.createElement('section');panel.id='project-panel-'+id;panel.className='project-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id);panels[id]=panel;
}
sheet.insertBefore(nav,originalChildren[start]);Object.values(panels).forEach(p=>sheet.insertBefore(p,originalChildren[start]));
let group='overview';
for(const node of originalChildren.slice(start,finish)){
 if(node.id==='pf-financial-section'){panels.money.append(node);continue;}
 if(node.id==='pf-employee-field'||node.id==='pf-members-field'){panels.team.append(node);continue;}
 if(node.classList.contains('section-label')&&node.textContent.includes('Техническое'))group='files';
 panels[group].append(node);
}
const compensation=$('pf-compensation-block');panels.team.prepend(compensation);
const overview=document.createElement('div');overview.id='project-glance';panels.overview.prepend(overview);
const teamSummary=document.createElement('div');teamSummary.id='project-team-summary';panels.team.prepend(teamSummary);
const economy=document.createElement('div');economy.id='project-economy';panels.money.prepend(economy);
const special=document.createElement('div');special.hidden=true;
const methodField=$('pf-compensation-method').closest('.field');methodField.before(special);special.append(methodField);
const methodHint=special.nextElementSibling;if(methodHint?.classList.contains('hint'))methodHint.remove();
const methods=document.createElement('div');methods.className='team-methods';methods.setAttribute('role','group');methods.setAttribute('aria-label','Способ расчёта');
methods.innerHTML='<button type="button" data-method="percent"><strong>Процент</strong><span>Доля от стоимости проекта</span></button><button type="button" data-method="m2"><strong>За м²</strong><span>Площадь работы × ставка</span></button>';
special.after(methods);
const baseField=document.createElement('label');baseField.className='team-base';baseField.innerHTML='<input type="checkbox" id="team-deduct-costs"><span>Вычитать прямые расходы перед расчётом процента</span>';
methods.after(baseField);
const baseNote=document.createElement('div');baseNote.className='team-base-note';baseField.after(baseNote);
methods.addEventListener('click',e=>{const b=e.target.closest('[data-method]');if(!b)return;if(b.dataset.method==='percent'&&isInterior($('pf-category').value))return;if(b.dataset.method==='m2'&&isArchitecture($('pf-category').value))return;const next=isArchitecture($('pf-category').value)?'percent_profit':b.dataset.method==='m2'?'m2':$('team-deduct-costs').checked?'percent_profit':'percent_price';const saved=state.projects.find(p=>p.id===editingProjectId);if(next!=='m2'&&saved?.fee_base==='m2'&&projectRolePayoutEntries(editingProjectId).length){showToast('Сначала удалите сохранённые начисления по м²');return;}if(isInterior($('pf-category').value)&&saved?.fee_base!=='m2'&&saved&&(Number(saved.fee_percent)>0||Number(saved.co_fee_percent)>0)){if(findStatus(saved.status_id)?.name==='Завершён'){showToast('Старый завершённый расчёт сохранён для истории');return;}if(!confirm('Перейти на оплату за м²? После сохранения прежний процентный расчёт этого проекта будет заменён.'))return;}if(isArchitecture($('pf-category').value)&&saved&&saved.fee_base!=='profit'){if(findStatus(saved.status_id)?.name==='Завершён'){showToast('Старый завершённый расчёт сохранён для истории');return;}if(!confirm('После сохранения процент будет считаться от стоимости за вычетом прямых расходов. Продолжить?'))return;}$('pf-compensation-method').value=next;$('pf-compensation-method').dispatchEvent(new Event('change',{bubbles:true}));});
$('team-deduct-costs').addEventListener('change',()=>{$('pf-compensation-method').value=$('team-deduct-costs').checked?'percent_profit':'percent_price';$('pf-compensation-method').dispatchEvent(new Event('change',{bubbles:true}));});
compensation.querySelector('.accent-title').textContent='Вознаграждение команды';
const duplicate=$('pf-employee-field');duplicate.classList.add('project-legacy-selects');
$('pf-employee-fee').closest('.field').querySelector('label').textContent='Сотрудник';
$('pf-co-employee-fee').closest('.field').querySelector('label').textContent='Сотрудник';
const percentBox=$('pf-percent-method-fields');
const mainLine=document.createElement('div');mainLine.className='project-team-line';mainLine.append($('pf-employee-fee').closest('.field'),$('pf-feepercent').closest('.field'));
const coDetails=document.createElement('div');coDetails.className='team-second';coDetails.hidden=true;
const coLine=document.createElement('div');coLine.className='project-team-line';coLine.append($('pf-co-employee-fee').closest('.field'),$('pf-co-feepercent').closest('.field'));coDetails.append(coLine);
const addSecond=document.createElement('button');addSecond.type='button';addSecond.className='team-add-link';addSecond.textContent='+ Добавить второго сотрудника';addSecond.id='team-add-second';addSecond.onclick=()=>{coDetails.hidden=false;addSecond.hidden=true;$('pf-co-employee-fee').focus();};
const removeSecond=document.createElement('button');removeSecond.type='button';removeSecond.className='team-remove-link';removeSecond.textContent='Убрать';removeSecond.onclick=()=>{$('pf-co-employee-fee').value='';$('pf-co-employee').value='';$('pf-co-feepercent').value='';coDetails.hidden=true;addSecond.hidden=false;refresh();};coDetails.append(removeSecond);
mainLine.insertAdjacentHTML('beforeend','<div class="team-line-result" id="team-main-result" aria-live="polite"></div>');coLine.insertAdjacentHTML('beforeend','<div class="team-line-result" id="team-co-result" aria-live="polite"></div>');
percentBox.replaceChildren(mainLine,coDetails,addSecond);
$('pf-feepercent').closest('.field').querySelector('label').textContent='Ставка, %';$('pf-co-feepercent').closest('.field').querySelector('label').textContent='Ставка, %';

$('pf-members-field').querySelector('label').textContent='На окладе / без доплаты';$('pf-members-field').classList.add('team-members');
$('pf-rp-add-btn').textContent='Добавить сотрудника';
$('pf-rp-rate').placeholder='400';
const workAreaField=document.createElement('div');workAreaField.className='field';workAreaField.style.cssText='margin-bottom:0;flex:1;min-width:110px';
workAreaField.innerHTML='<label for="pf-rp-area">Площадь работы, м²</label><input id="pf-rp-area" type="number" min="0.01" step="0.01" placeholder="Площадь сотрудника">';
$('pf-rp-rate').closest('.field').before(workAreaField);
const workPreview=document.createElement('p');workPreview.id='pf-rp-preview';workPreview.className='team-work-preview';$('pf-rp-add-btn').before(workPreview);
const m2Row=$('pf-m2-add-row');m2Row.classList.add('team-m2-editor');m2Row.prepend($('pf-rp-employee').closest('.field'));m2Row.insertAdjacentHTML('afterbegin','<div class="team-editor-label">Добавить сотрудника</div>');
$('pf-rp-employee').closest('.field').querySelector('label').textContent='Сотрудник';

// Area belongs to the project rather than a hidden compensation method.
const area=$('pf-area').closest('.field');panels.overview.insertBefore(area,$('pf-phone-field'));
const salaryHint=document.createElement('p');salaryHint.className='project-note';salaryHint.textContent='Оклад учитывается в табеле отдельно от проекта.';$('pf-members-field').append(salaryHint);
const contacts=$('pf-phone-field'), contactDetails=document.createElement('details');contactDetails.className='project-special';contactDetails.innerHTML='<summary>Контакты и адрес</summary>';contacts.before(contactDetails);contactDetails.append(contacts);
const statusField=$('pf-department-field');statusField.classList.add('project-legacy-selects'); // Payment state is derived from received payments.
const moneyIntro=$('pf-financial-section').querySelector('.accent-block');if(moneyIntro)moneyIntro.style.display='none';
$('pf-save').textContent='Сохранить проект';
const saveNote=document.createElement('p');saveNote.className='project-note';saveNote.textContent='Изменения полей — по кнопке «Сохранить проект».';$('pf-save').before(saveNote);
function selectTab(id){
 if((id==='money'||id==='team')&&!session?.isAdmin)id='overview';
 Object.entries(panels).forEach(([key,p])=>p.hidden=key!==id);
 nav.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===id));b.tabIndex=b.dataset.tab===id?0:-1;});
}
nav.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...nav.querySelectorAll('button')].filter(b=>!b.hidden);let i=buttons.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[i].click();buttons[i].focus();});
function isArchitecture(categoryId){const n=(findCategory(categoryId)?.name||'').toLowerCase();return n.includes('архитект')||n.includes('ландшафт');}
function isInterior(categoryId){return (findCategory(categoryId)?.name||'').toLowerCase().includes('интерьер');}
function draft(){const saved=state.projects.find(p=>p.id===editingProjectId)||{};return {...saved,id:editingProjectId,category_id:$('pf-category').value,status_id:$('pf-status').value,price:Number($('pf-price').value)||0,expenses:Number($('pf-expenses').value)||0,area:Number($('pf-area').value)||0,employee_id:$('pf-employee-fee').value||null,co_employee_id:$('pf-co-employee-fee').value||null,fee_percent:$('pf-feepercent').value===''?projectFeePercent({category_id:$('pf-category').value,employee_id:$('pf-employee-fee').value}):Number($('pf-feepercent').value),co_fee_percent:Number($('pf-co-feepercent').value)||0,fee_base:$('pf-compensation-method').value==='m2'?'m2':$('pf-compensation-method').value==='percent_profit'?'profit':'price'};}
function planRows(p){
 if(p.fee_base==='m2')return projectRolePayoutEntries(p.id).map(e=>({entryId:e.id,name:findEmployee(e.payee_employee_id)?.name||'Сотрудник не найден',formula:(e.description||'').replace(' — '+(findEmployee(e.payee_employee_id)?.name||'')+' (',' · ').replace(/\)$/,''),amount:Number(e.amount)||0}));
 const f=getProjectFee(p),base=p.fee_base==='profit'?Math.max(0,p.price-p.expenses):p.price;
 return [[p.employee_id,f.mainFeeAmount,p.fee_percent],[p.co_employee_id,f.coFeeAmount,p.co_fee_percent]].filter(x=>x[0]).map(([id,amount,rate])=>({name:findEmployee(id)?.name||'Сотрудник не найден',formula:isConstructionCategory(p.category_id)?'По правилам строительного объекта':`${money(projectEmployeeRole(id)==='manager'?p.price:projectEmployeeRole(id)==='architect'?f.architectBase:base)} × ${rate}%${projectEmployeeRole(id)==='manager'?' · менеджер, выплата по поступлениям':projectEmployeeRole(id)==='architect'?' · после комиссии менеджера и расходов':''}`,amount}));
}
function card(label,value){return `<div class="project-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;}
function refresh(){
 const selectedTeamEmployee=findEmployee($('pf-rp-employee').value);
 const salariedTeamEmployee=!!selectedTeamEmployee?.is_salaried;
 $('pf-rp-area').disabled=salariedTeamEmployee;
 $('pf-rp-rate').disabled=salariedTeamEmployee;
 $('pf-rp-add-btn').textContent=salariedTeamEmployee?'Добавить в проект':'Добавить сотрудника';
 const a=Number($('pf-rp-area').value),r=Number($('pf-rp-rate').value);
 workPreview.innerHTML=salariedTeamEmployee
   ? '<span>Сотрудник на окладе<small>Будет участником проекта без дополнительного начисления</small></span><strong>Без доплаты</strong>'
   : (a>0&&r>0&&Number.isFinite(a*r)?`<span>Гонорар сотрудника<small>${esc(a)} м² × ${esc(r.toLocaleString('ru-RU',{maximumFractionDigits:2}))} ₽</small></span><strong>${esc(money(Math.round(a*r*100)/100))}</strong>`:'Укажите площадь и ставку');
 const p=draft(),rows=planRows(p),total=rows.reduce((s,r)=>s+r.amount,0),done=findStatus(p.status_id)?.name==='Завершён',admin=!!session?.isAdmin;
 const basicCreate=!editingProjectId&&canCreateProjectCard();
 $('pf-save').hidden=!admin&&!basicCreate;
 saveNote.textContent=!admin?(basicCreate?'Карточка будет создана с вами в качестве исполнителя. Стоимость, оплату и условия команды заполняет администратор.':'Условия проекта изменяет администратор. Этапы и задачи сохраняются отдельно.'):'Изменения полей — по кнопке «Сохранить проект».';
 const activeView=document.querySelector('.view.active')?.id;
 if($('addProjectFab'))$('addProjectFab').style.display=canCreateProjectCard()&&['view-projects','view-construction'].includes(activeView)?'':'none';
 nav.querySelectorAll('button').forEach(b=>b.hidden=!admin&&['team','money'].includes(b.dataset.tab));
 if(!admin&&(!panels.team.hidden||!panels.money.hidden))selectTab('overview');
 const isM2=p.fee_base==='m2',interior=isInterior(p.category_id),architecture=isArchitecture(p.category_id);
 methods.hidden=(interior&&isM2)||(architecture&&p.fee_base==='profit');
 methods.querySelector('[data-method="percent"]').hidden=interior;methods.classList.toggle('team-interior',interior||architecture);methods.querySelector('[data-method="m2"]').hidden=architecture;methods.querySelector('[data-method="percent"] strong').textContent=architecture?'Процент после расходов':'Процент';methods.querySelector('[data-method="percent"] span').textContent=architecture?'(Стоимость − прямые расходы) × ставка':'Доля от стоимости проекта';
 methods.querySelector('[data-method="m2"] span').textContent=interior?'Площадь работы × ставка; сотрудники на окладе — без доплаты':'Площадь работы × ставка';
 for(const option of [...$('pf-rp-employee').options]){
   if(!option.value) continue;
   const emp=findEmployee(option.value);
   if(emp) option.textContent=emp.name+(emp.is_salaried?' · на окладе':'');
 }

 methods.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.method==='m2')===isM2)));
 baseField.hidden=isM2||interior||architecture;baseNote.hidden=isM2;$('team-deduct-costs').checked=p.fee_base==='profit';
 const roleFees=getProjectFee(p);
 const calculationBase=p.fee_base==='profit'?Math.max(0,p.price-p.expenses):p.price;
 baseNote.textContent=roleFees.managerCommission>0?`Комиссия менеджера: ${money(roleFees.managerCommission)} · База архитектора: ${money(roleFees.architectBase)}`:isConstructionCategory(p.category_id)?'Стройка: расчёт по правилам строительного объекта.':p.fee_base==='profit'?`База: ${money(p.price)} − ${money(p.expenses)} расходов = ${money(calculationBase)}`:`База расчёта: ${money(p.price)}`;
 teamSummary.innerHTML='<h3>Гонорары команды</h3><p class="project-note">'+(interior?'Площадь работы × ставка. Сотрудники на окладе — без доплаты за проект.':architecture?'Гонорар = (стоимость − прямые расходы) × процент.':'Выберите способ расчёта и назначьте сотрудников.')+'</p>'+(interior&&!isM2?'<p class="project-warning">Здесь сохранён прежний процентный расчёт. Для новых начислений выберите «За м²». История автоматически не изменяется.</p>':'')+(architecture&&p.fee_base!=='profit'?'<p class="project-warning">Сохранены прежние условия. Для перехода выберите «Процент после расходов». Старые расчёты автоматически не изменяются.</p>':'');
 const lineResult=(id,employee,rate)=>{const el=$(id);const fees=getProjectFee(p);const row={amount:id==='team-main-result'?fees.mainFeeAmount:fees.coFeeAmount};el.innerHTML='<span>Гонорар</span><strong>'+(!employee?'—':findEmployee(employee)?.is_salaried&&rate===0?'На окладе':rate>0?esc(money(row?.amount||0)):rate===0?'Укажите %':'—')+'</strong>';};
 lineResult('team-main-result',p.employee_id,p.fee_percent);lineResult('team-co-result',p.co_employee_id,p.co_fee_percent);
 const rowsHtml=rows.length?rows.map(r=>`<div class="project-person"><div><strong>${esc(r.name)}</strong><small>${esc(r.formula)}</small></div><div class="project-person-actions"><strong>${esc(money(r.amount))}</strong>${r.entryId&&admin?`<button type="button" class="icon-btn" data-edit-payout="${esc(r.entryId)}" aria-label="Редактировать начисление: ${esc(r.name)}">✏️</button><button type="button" class="icon-btn" data-remove-payout="${esc(r.entryId)}" aria-label="Удалить из расчёта: ${esc(r.name)}">×</button>`:''}</div></div>`).join(''):'<p class="project-note">Выберите сотрудника и условия вознаграждения.</p>';
 const saved=state.projects.find(x=>x.id===editingProjectId), entries=projectRolePayoutEntries(editingProjectId);
 const staleArea=saved&&p.fee_base==='m2'&&entries.length&&p.area!==Number(saved.area||0);
 $('pf-compensation-summary').innerHTML=(isM2?rowsHtml:'')+`<div class="project-person project-total"><strong>${done?'Гонорары по договору':'Всего по проекту'}</strong><strong>${rows.some(r=>r.amount>0)?esc(money(total)):'—'}</strong></div><p class="team-total-note">${projectManagerSlots(p).length?'Менеджер: начисление с каждого поступления клиента. Архитектор: в табеле после завершения проекта.':done?'В табеле за месяц фактического завершения.':'Попадёт в табель после завершения проекта.'}</p>`+(staleArea?'<p class="project-warning">Площадь изменена. Сохранённые суммы не пересчитываются автоматически — проверьте расчёт команды.</p>':'');
 if(admin&&projectManagerSlots(p).length){
   const received=Number($('pf-advance').value)||0;
   const commission=projectManagerSlots(p).reduce((sum,[id,rate])=>sum+received*Math.max(0,Number(rate)||0)/100,0);
   $('pf-compensation-summary').innerHTML+=`<div class="project-person"><strong>Менеджеру с полученных денег</strong><strong>${esc(money(commission))}</strong></div><p class="team-total-note">Начислено с поступлений клиента; фактические выплаты отмечаются отдельно в табеле.</p>`;
 }
 if(admin&&!isConstructionCategory(p.category_id)){
   $('pf-compensation-summary').innerHTML+=`<div class="project-person project-total"><strong>Остаётся компании</strong><strong>${esc(money(p.price-getProjectExpenses(p)-total))}</strong></div><p class="team-total-note">При полной оплате договора, после комиссии менеджера, гонораров и прямых расходов. До амортизации 5% и общих расходов.</p>`;
 }
 const payment=Number($('pf-advance').value)||0;
 overview.innerHTML=`<div class="project-eyebrow">${esc(findCategory(p.category_id)?.name||'Новый проект')}</div><h3>${esc($('pf-name').value||'Начнём с основного')}</h3><p class="project-note">${esc(findStatus(p.status_id)?.name||'В работе')} · ${$('pf-end').value?'Срок: '+esc(fmtDate($('pf-end').value)):'Укажите срок проекта'}</p>`+(admin?`<div class="project-metrics">${card('Стоимость',money(p.price))}${card('Команда · '+(done?'начислено':'план'),money(total))}</div>`:'');
 const construction=isConstructionCategory(p.category_id);
 economy.innerHTML=admin?(construction?'<p class="project-note">Бюджет стройки, накладные и прямые оплаты клиента доступны в карточке объекта.</p>':`<div class="project-metrics">${card('Получено от клиента',money(payment))}${card('Долг клиента',money(Math.max(0,p.price-payment)))}</div><div class="project-equation"><span>Стоимость договора <b>${esc(money(p.price))}</b></span><span>− Прямые расходы <b>${esc(money(p.expenses))}</b></span><span>− Вознаграждения команды <b>${esc(money(total))}</b></span><span class="project-total">Остаётся компании <b>${esc(money(p.price-p.expenses-total))}</b></span></div><p class="project-note">Оклады, аренда и другие общие расходы учитываются за месяц отдельно.</p>`):'';
 if(construction){
   methods.hidden=true;baseField.hidden=true;
   compensation.querySelector('.accent-title').textContent='Открытая наценка компании';
   $('pf-feepercent').closest('.field').querySelector('label').textContent='Наценка ARHITTEK, %';
   $('pf-employee-fee').closest('.field').querySelector('label').textContent='Ответственный за объект';
   $('pf-co-feepercent').closest('.field').hidden=true;addSecond.hidden=true;
   const source=state.projects.find(item=>item.id===p.id)||p;
   const fee=constructionCompanyMarkup({...source,fee_percent:p.fee_percent},getConstructionExpenses(source).expenses);
   $('team-main-result').innerHTML='<span>Наценка компании по документам</span><strong>'+esc(constructionMoney(fee.companyMarkupAmount))+'</strong>';
   teamSummary.innerHTML='<h3>Компания и команда объекта</h3><p class="project-note">Наценка начисляется на расходы объекта. Ответственный сотрудник не получает её автоматически; его выплаты учитываются отдельно.</p>';
   baseNote.textContent='Материалы, работы, доставка и другие расходы × сохранённая ставка. Сам аванс наценку не создаёт.';
   $('pf-compensation-summary').innerHTML='<p class="project-note">Суммы расходов, наценка и деньги заказчика показаны в карточке объекта.</p>';
 }else{
   compensation.querySelector('.accent-title').textContent='Вознаграждение команды';
   $('pf-feepercent').closest('.field').querySelector('label').textContent='Ставка, %';
   $('pf-employee-fee').closest('.field').querySelector('label').textContent='Сотрудник';
   $('pf-co-feepercent').closest('.field').hidden=false;
 }
 if(!admin){overview.querySelector('.project-metrics')?.remove();}
}
window.refreshProjectWorkspace=refresh;
function defaults(){
 if(editingProjectId)return;
 const cat=findCategory($('pf-category').value),name=(cat?.name||'').toLowerCase();
 if(isConstructionCategory(cat?.id)){$('pf-compensation-method').value='percent_price';$('pf-feepercent').value='15';}
 else if(name.includes('интерьер')){$('pf-compensation-method').value='m2';$('pf-feepercent').value='0';}
 else if(name.includes('архитект')||name.includes('ландшафт')){$('pf-compensation-method').value='percent_profit';$('pf-feepercent').value=cat?.fee_percent>0?cat.fee_percent:40;}
 $('pf-feebase').value=$('pf-compensation-method').value==='m2'?'m2':$('pf-compensation-method').value==='percent_profit'?'profit':'price';
 renderCompensationMethodUI();
}
const oldOpen=openProjectSheet;openProjectSheet=function(id){if(!id&&!canCreateProjectCard()){showToast('Создание проекта доступно ведущему дизайнеру, ведущему архитектору и Мансуру');return;}basicProjectDraftVersion++;oldOpen(id);$('projectSheetTitle').textContent=id?'Карточка проекта':'Новый проект';coDetails.hidden=!$('pf-co-employee').value;addSecond.hidden=!coDetails.hidden;special.open=false;contactDetails.open=false;defaults();$('pf-rp-rate').value='400';$('pf-rp-area').value=$('pf-area').value;$('pf-employee-fee').value=$('pf-employee').value;$('pf-co-employee-fee').value=$('pf-co-employee').value;selectTab('overview');refresh();sheet.scrollTop=0;};
const oldRole=applyRole;applyRole=function(){oldRole();refresh();};
const oldRecalc=recalcLiveFeeSummary;recalcLiveFeeSummary=function(){oldRecalc();refresh();};
const oldRenderRoles=renderProjectRolePayouts;renderProjectRolePayouts=function(id){oldRenderRoles(id);refresh();};
const oldSummary=renderM2CompensationSummary;renderM2CompensationSummary=function(p){oldSummary(p);refresh();};
const oldRenderAll=renderAll;renderAll=function(){oldRenderAll();if($('projectSheetOverlay').classList.contains('active'))refresh();};
sheet.addEventListener('click',e=>{
 const edit=e.target.closest('[data-edit-payout]');
 if(edit&&session?.isAdmin){
   const row=(state.ledger||[]).find(x=>x.id===edit.dataset.editPayout&&x.type==='role_payout');
   if(row){
     editingRolePayoutId=row.id;
     $('pf-rp-employee').value=row.payee_employee_id||'';
     const txt=row.description||'';
     const role=txt.split(' — ')[0]||'Другое';
     if([...$('pf-rp-role').options].some(o=>o.value===role)) $('pf-rp-role').value=role;
     const area=txt.match(/([\d.,]+)\s*м²/)?.[1]?.replace(',','.');
     const rate=txt.match(/×\s*([\d\s.,]+)\s*₽\/м²/)?.[1]?.replace(/\s/g,'')?.replace(',','.');
     if(area) $('pf-rp-area').value=area;
     if(rate) $('pf-rp-rate').value=rate;
     $('pf-rp-add-btn').textContent='Сохранить изменение';
     payoutCancel.style.display='';
     refresh();
   }
   return;
 }
 const b=e.target.closest('[data-remove-payout]');
 if(b&&session?.isAdmin)deleteProjectRolePayout(b.dataset.removePayout,editingProjectId);
});
sheet.addEventListener('input',e=>{if(e.target.id!=='team-deduct-costs')refresh();});sheet.addEventListener('change',e=>{if(e.target.id==='pf-category')defaults();refresh();});
// Stale duplicate selections must never restore an employee removed in the team tab.
['pf-employee-fee','pf-co-employee-fee'].forEach((id,i)=>$(id).addEventListener('change',()=>{$(i?'pf-co-employee':'pf-employee').value=$(id).value;}));
['pf-feepaid','pf-co-feepaid'].forEach(id=>{const el=$(id);if(el){el.readOnly=true;el.title='Фактическая выплата записывается через приём платежа или табель';}});
// The lead designer may start a project without editing contract or payroll terms.
// Keep this path separate from the administrator's financial form: those hidden
// fields may contain defaults or values from a previously opened project.
function canCreateProjectCard(){
 if(!hasVerifiedAccess())return false;
 if(isOwner())return true;
 const employee=findEmployee(session.employeeId);
 return !!(employee&&employee.active!==false&&!employee.deleted_at&&canSeeProjects()&&['ведущий дизайнер','ведущий архитектор'].includes(String(employee.role||'').trim().toLowerCase()));
}
window.canCreateProjectCard=canCreateProjectCard;
let basicProjectSaveInFlight=false,basicProjectDraftVersion=0;
async function saveBasicProjectCard(){
 if(basicProjectSaveInFlight||!$('projectSheetOverlay').classList.contains('active'))return;
 if(!canCreateProjectCard()||editingProjectId){showToast('Условия проекта изменяет администратор');return;}
 const name=$('pf-name').value.trim(),category=findCategory($('pf-category').value);
 const rawArea=$('pf-area').value,area=rawArea===''?null:Number(rawArea);
 if(!name){showToast('Введите название проекта');return;}
 if(!category){showToast('Выберите категорию проекта');return;}
 if(isConstructionCategory(category.id)&&!canSeeConstruction()){showToast('Нет доступа к строительному отделу');return;}
 if(area!==null&&(!Number.isFinite(area)||area<0)){showToast('Площадь не может быть отрицательной');return;}
 const status=findStatus($('pf-status').value);
 if(!status){showToast('Выберите статус проекта');return;}
 if(status.name==='Завершён'){showToast('Завершение проекта подтверждает администратор');return;}
 const address=$('pf-address').value.trim(),normalize=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
 const duplicate=address&&(state.projects||[]).find(p=>!p.deleted_at&&normalize(p.address)===normalize(address));
 if(duplicate&&!confirm(`Объект с адресом «${address}» уже есть в системе («${duplicate.name}»). Всё равно создать ещё один?`))return;
 const startDate=$('pf-start').value||null,endDate=$('pf-end').value||null;
 if(startDate&&endDate&&startDate>endDate){showToast('Дата сдачи не может быть раньше начала проекта');return;}
 const payload={name,category_id:category.id,status_id:status.id,employee_id:session.employeeId,
   co_employee_id:null,phone:$('pf-phone').value.trim(),address,area,
   start_date:startDate,end_date:endDate,
   notes:$('pf-notes').value.trim(),client_name:$('pf-client-name').value.trim()||null,
   price:0,advance:0,balance:0,expenses:0,fee_paid:0,co_fee_paid:0,fee_percent:0,co_fee_percent:0,
   fee_base:isInterior(category.id)?'m2':isArchitecture(category.id)?'profit':(category.fee_base||'price'),
   payment_status:'Ждём оплату',updated_at:new Date().toISOString()};
 const draftVersion=basicProjectDraftVersion;let accepted=false;
 basicProjectSaveInFlight=true;$('pf-save').disabled=true;
 try{
   const {data,error}=await sb.from('projects').insert(payload).select().single();
   if(error)throw error;
   if(!data?.id)throw new Error('Не получено подтверждение создания проекта');
   accepted=true;
   // Record success before secondary work: a failed refresh must not allow a
   // second insert of a project the server has already accepted.
   const sameDraft=()=>basicProjectDraftVersion===draftVersion&&!editingProjectId&&$('projectSheetOverlay').classList.contains('active');
   state.projects=[...(state.projects||[]).filter(p=>p.id!==data.id),{...payload,...data}];
   await logAudit('project',data.id,payload.name,'create',{});
   if(sameDraft()){editingProjectId=data.id;editingProjectLoadedAt=payload.updated_at;closeProjectSheet();}
   const refreshed=await loadAll();
   showToast(state.projectMembersDataError?'Проект создан. Состав команды не обновлён — повторите обновление.':refreshed===false||state.financialDataReady===false?'Проект создан. Не удалось обновить список — повторите обновление.':'Проект добавлен');
 }catch(error){console.error(error);showToast(accepted?'Проект создан. Не удалось обновить список — повторите обновление.':'Ошибка сохранения проекта. Данные формы сохранены — повторите попытку.');}
 finally{basicProjectSaveInFlight=false;$('pf-save').disabled=false;}
}
const oldSave=saveProject;saveProject=async function(){
 if(!session?.isAdmin){await saveBasicProjectCard();return;}
 const p=draft();
 if(p.employee_id&&p.employee_id===p.co_employee_id){selectTab('team');showToast('Один сотрудник выбран дважды. Оставьте его в одной строке.');return;}
 if(!isConstructionCategory(p.category_id)&&p.fee_base!=='m2'&&[[p.employee_id,p.fee_percent],[p.co_employee_id,p.co_fee_percent]].some(([id,rate])=>id&&rate>0&&findEmployee(id)?.is_salaried)){selectTab('team');showToast('Сотрудник на окладе: укажите 0% и добавьте его без проектной доплаты');return;}
 const old=state.projects.find(x=>x.id===editingProjectId);
 if(isInterior(p.category_id)&&p.fee_base!=='m2'&&(!old||old.category_id!==p.category_id||old.fee_base!==p.fee_base||Number(old.fee_percent||0)!==p.fee_percent||Number(old.co_fee_percent||0)!==p.co_fee_percent||(old.employee_id||null)!==p.employee_id||(old.co_employee_id||null)!==p.co_employee_id)){selectTab('team');showToast('В дизайне интерьера — только оплата за м². Выберите «За м²».');return;}

 if(isArchitecture(p.category_id)&&p.fee_base!=='profit'&&(!old||old.category_id!==p.category_id||old.fee_base!==p.fee_base||Number(old.fee_percent||0)!==p.fee_percent||Number(old.co_fee_percent||0)!==p.co_fee_percent||(old.employee_id||null)!==p.employee_id||(old.co_employee_id||null)!==p.co_employee_id)){selectTab('team');showToast('Для архитектуры и ландшафта выберите процент после расходов');return;}
 if(old&&old.fee_base!==p.fee_base&&projectRolePayoutEntries(old.id).length){selectTab('team');showToast('Сначала удалите прежние начисления по м², затем меняйте метод');return;}
 if(p.fee_base==='m2'){$('pf-feepercent').value='0';$('pf-co-feepercent').value='0';}
 $('pf-employee').value=p.employee_id||'';$('pf-co-employee').value=p.co_employee_id||'';
 if(!isConstructionCategory(p.category_id))$('pf-payment').value=Number($('pf-advance').value)>=p.price&&p.price>0?'Оплачен':Number($('pf-advance').value)>0?'Частично оплачен':'Ждём оплату';
 if(!session?.isAdmin){showToast('Условия проекта изменяет администратор');return;}
 $('pf-save').disabled=true;try{await oldSave();}finally{$('pf-save').disabled=false;}
};
// The index button resolves saveProject at click time, including this wrapper.
const oldDelete=deleteProjectRolePayout;deleteProjectRolePayout=async function(id,pid){if(!session?.isAdmin){showToast('Расчёт команды изменяет администратор');return;}if(editingRolePayoutId===id){resetRolePayoutEditor();}await oldDelete(id,pid);refresh();};
const oldAdd=addProjectRolePayout;let adding=false,editingRolePayoutId=null;
let payoutCancel=$('pf-rp-cancel-edit');
if(!payoutCancel){
 payoutCancel=document.createElement('button');
 payoutCancel.type='button';payoutCancel.id='pf-rp-cancel-edit';payoutCancel.className='btn btn-secondary';
 payoutCancel.style.cssText='display:none;width:auto;white-space:nowrap;margin-bottom:0;padding:11px 12px;';
 payoutCancel.textContent='Отмена';
 $('pf-rp-add-btn').after(payoutCancel);
}
function resetRolePayoutEditor(){
 editingRolePayoutId=null;
 $('pf-rp-employee').value='';
 $('pf-rp-rate').value='400';
 const p=state.projects.find(x=>x.id===editingProjectId);
 if(p)$('pf-rp-area').value=p.area||'';
 $('pf-rp-add-btn').textContent='Добавить сотрудника';
 payoutCancel.style.display='none';
 refresh();
}
payoutCancel.addEventListener('click',resetRolePayoutEditor);
addProjectRolePayout=async function(){
 if(!session?.isAdmin){showToast('Расчёт команды изменяет администратор');return;}
 if(adding)return;
 const emp=findEmployee($('pf-rp-employee').value),role=$('pf-rp-role').value,p=state.projects.find(x=>x.id===editingProjectId);
 if(emp?.is_salaried){
   if(!currentProjectMembers.some(m=>m.employee_id===emp.id)){
     currentProjectMembers.push({employee_id:emp.id});
     renderProjectMemberChips();
   }
   $('pf-rp-employee').value='';
   refresh();
   showToast('Сотрудник добавлен в проект без доплаты. Нажмите «Сохранить проект».');
   return;
 }
 if(p&&Number(p.area)!==Number($('pf-area').value)){showToast('Сначала сохраните новую площадь проекта');return;}
 if(projectRolePayoutEntries(editingProjectId).some(e=>e.id!==editingRolePayoutId&&e.payee_employee_id===emp?.id&&e.description?.startsWith(role+' —'))){showToast('Этот сотрудник уже добавлен на выбранную роль');return;}
 if(!p){showToast('Сначала сохраните проект');return;}
 if(isArchitecture(p.category_id)){showToast('В архитектуре и ландшафте применяется процент после расходов');return;}
 if(p.fee_base!=='m2'){showToast('Сохраните проект с методом «Ставка за м²»');return;}
 if(!emp||emp.active===false){showToast('Выберите сотрудника');return;}
 const area=Number($('pf-rp-area').value),rate=Number($('pf-rp-rate').value),amount=Math.round(area*rate*100)/100;
 if(!Number.isFinite(area)||area<=0||area>Number(p.area||0)){showToast('Площадь работы должна быть больше нуля и не превышать площадь проекта');return;}
 if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(amount)||amount<=0){showToast('Укажите корректную положительную ставку');return;}
 const projectId=p.id,description=`${role} — ${emp.name} (${area} м² × ${rate.toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽/м²)`;
 adding=true;$('pf-rp-add-btn').disabled=true;
 try{
  const wasEditing=!!editingRolePayoutId;
  if(editingRolePayoutId){
    const before=(state.ledger||[]).find(x=>x.id===editingRolePayoutId);
    const {error}=await sb.from('ledger_entries').update({payee_employee_id:emp.id,description,amount,entry_date:financeToday()}).eq('id',editingRolePayoutId);
    if(error)throw error;
    await logAudit('project',projectId,p.name,'update',{role_payout_edited:{old:before?(before.description+' — '+fmtMoney(before.amount)):null,new:description+' — '+fmtMoney(amount)}});
  }else{
    const {data,error}=await sb.from('ledger_entries').insert({type:'role_payout',project_id:projectId,payee_employee_id:emp.id,description,amount,entry_date:financeToday(),received_by:session.employeeId}).select().single();
    if(error)throw error;
    if(data){state.ledger=state.ledger||[];state.ledger.push(data);}
    await logAudit('project',projectId,p.name,'update',{role_payout_added:{old:null,new:description+' — '+fmtMoney(amount)}});
  }
  editingRolePayoutId=null;
  payoutCancel.style.display='none';
  await loadAll();
  if(editingProjectId===projectId){renderProjectRolePayouts(projectId);$('pf-rp-rate').value='400';$('pf-rp-area').value=p.area;$('pf-rp-employee').value='';$('pf-rp-add-btn').textContent='Добавить сотрудника';refresh();}
  showToast(wasEditing?'Начисление изменено':'В расчёт добавлено '+fmtMoney(amount)+'. В табель — после завершения проекта.');
 }catch(e){console.error(e);showToast('Не удалось завершить сохранение. Обновите расчёт перед повторной попыткой.');}
 finally{adding=false;$('pf-rp-add-btn').disabled=false;}
};
$('pf-rp-add-btn').removeEventListener('click',oldAdd);$('pf-rp-add-btn').addEventListener('click',()=>addProjectRolePayout());
// Make the existing monthly flag explicit: it is not a partial-payment ledger.
// If the calculation changed after the "paid" mark, the mark is considered stale
// until the administrator confirms the payment again.
const rawIsTimesheetPaid=isTimesheetPaid;
function paidMarkState(employeeId,monthStr){
 const row=(state.timesheetPayments||[]).find(t=>t.employee_id===employeeId&&t.month===monthStr&&t.paid);
 if(!row)return {paid:false,stale:false};
 if(!row.paid_at)return {paid:true,stale:false};
 const paidAt=new Date(row.paid_at).getTime();
 const range=timesheetMonthRange(monthStr);
 let latest=0;
 const touch=v=>{const t=v?new Date(v).getTime():0;if(Number.isFinite(t)&&t>latest)latest=t;};
 const emp=findEmployee(employeeId);touch(emp?.updated_at);
 (state.projects||[]).forEach(p=>{
   const involved=p.employee_id===employeeId||p.co_employee_id===employeeId||(state.projectMembers||[]).some(m=>m.project_id===p.id&&m.employee_id===employeeId);
   if(!involved)return;
   const st=findStatus(p.status_id),ref=timesheetProjectRefDate(p);
   if(st?.name==='Завершён'&&ref&&ref>=range.from&&ref<=range.to){touch(p.updated_at);}
 });
 (state.ledger||[]).forEach(l=>{
   if(l.deleted_at)return;
   if(l.type==='bonus'&&l.payee_employee_id===employeeId&&l.entry_date>=range.from&&l.entry_date<=range.to){touch(l.updated_at||l.created_at);}
   if(l.type==='role_payout'&&l.payee_employee_id===employeeId){
     const p=(state.projects||[]).find(x=>x.id===l.project_id),ref=p?timesheetProjectRefDate(p):null;
     if(ref&&ref>=range.from&&ref<=range.to){touch(l.updated_at||l.created_at);touch(p?.updated_at);}
   }
 });
 return {paid:true,stale:latest>paidAt};
}
isTimesheetPaid=function(employeeId,monthStr){const s=paidMarkState(employeeId,monthStr);return s.paid&&!s.stale;};

const oldTimesheet=renderTimesheet;renderTimesheet=function(){
 oldTimesheet();const card=$('timesheetCard');if(!card)return;
 const range=timesheetMonthRange($('ts-month').value),map=completedProjectEarningsForRange(range.from,range.to).employees,{result}=splitPayrollByEmployee(map);
 [...card.querySelectorAll('input[type="checkbox"]')].forEach(box=>{
  const row=box.closest('.list-item'),click=row.getAttribute('onclick')||'',id=click.match(/toggleTimesheetRow\('([^']+)'\)/)?.[1],r=result[id];if(!r)return;
  const mark=paidMarkState(id,$('ts-month').value);
  const meta=row.querySelector('.li-meta');
  meta.textContent=`Оклад ${money(r.salary)} · Проекты ${money(r.earned)} · ${mark.stale?'Сумма изменилась после выплаты — подтвердите заново':box.checked?'Отмечено выплаченным':'К выплате '+money(r.payout)}`;
  if(mark.stale){meta.style.color='var(--gold)';row.style.outline='1px solid rgba(232,163,61,.25)';}
  box.title=mark.stale?'Расчёт изменился после отметки. Проверьте сумму и отметьте выплату снова.':'Отметка о полной выплате за месяц';
 });
 const note=document.createElement('p');note.className='project-note payroll-explanation';note.textContent='Здесь — начисления выбранного месяца. Фактические и частичные выплаты учитываются отдельно.';card.prepend(note);
};
const oldToggle=toggleTimesheetPaid;toggleTimesheetPaid=async function(id,month,checked){if(session?.isAdmin&&checked&&!confirm('Отметить полную выплату сотруднику за '+month+'? Это отметка учёта, деньги не переводятся.')){renderTimesheet();return;}return oldToggle(id,month,checked);};
selectTab('overview');
})();


