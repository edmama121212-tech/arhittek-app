(()=>{
'use strict';
const icons={overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',projects:'<path d="M3 8h7l2-3h9v15H3zM7 13h10M7 17h6"/>',construction:'<path d="m3 11 9-8 9 8M5 9v12h14V9M9 21v-7h6v7"/>',finance:'<path d="M4 20h16M6 16v-5M12 16V4M18 16V8"/>',cards:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',more:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'};
const svg=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]||icons.cards}</svg>`;
const nav=document.querySelector('.bottom-nav');
if(nav){const brand=document.createElement('div');brand.className='studio-sidebar-brand';brand.innerHTML='ARHIT<span>TEK</span><small>STUDIO WORKSPACE</small>';nav.prepend(brand);const foot=document.createElement('div');foot.className='sidebar-note';foot.innerHTML='<strong>Пространство вашей студии</strong>Архитектура · Интерьеры · Строительство';nav.append(foot);nav.setAttribute('aria-label','Главная навигация');nav.querySelectorAll('.nav-btn').forEach(b=>{const i=b.querySelector('.nav-icon');if(i)i.innerHTML=svg(b.dataset.view?.replace('view-',''));b.setAttribute('role','button');b.tabIndex=0;b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.click();}});});}
const meta={overview:['Рабочий стол','Проекты, команда и финансы — в одном пространстве.'],projects:['Проектная студия','От первого эскиза до готового альбома.'],construction:['Строительство','Бюджеты, материалы и ход работ по объектам.'],cards:['Коллекция проектов','Архитектура, которую можно выбрать.'],more:['Инструменты студии','Документы и процессы ежедневной работы.'],finance:['Финансы','Понятная экономика каждого направления.'],timesheet:['Команда и выплаты','Начисления, оклады и обязательства студии.'],settings:['Настройки','Команда, услуги и параметры рабочего пространства.'],kp:['Коммерческое предложение','Точный расчёт. Достойная подача.'],contracts:['Договоры','Условия сотрудничества и документы по проекту.'],company:['Реквизиты студии','Всё необходимое для работы с клиентами.'],object:['Карточка объекта','Финансовая картина и документы строительства.']};
Object.entries(meta).forEach(([id,[title,description]])=>{const v=document.getElementById('view-'+id);if(!v)return;const h=document.createElement('div');h.className='workspace-head';h.innerHTML=`<div><div class="workspace-eyebrow">ARHITTEK / ${id==='overview'?'Обзор студии':'Рабочее пространство'}</div><h1>${title}</h1><p class="workspace-description">${description}</p></div><div class="workspace-date">${new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}</div>`;v.prepend(h);});
const overview=document.getElementById('overviewContent');if(overview){const h=document.createElement('section');h.className='studio-hero';h.innerHTML='<div><div class="hero-kicker">STUDIO / AT A GLANCE</div><h2>Большие идеи. Чёткий план.</h2><p>Всё, что важно для студии сегодня.</p></div><div class="hero-actions"><button type="button" class="btn btn-primary" id="premiumNewProject">+ Новый проект</button><button type="button" class="btn btn-secondary" id="premiumOpenPayroll">Выплаты команде ↗</button></div>';overview.prepend(h);document.getElementById('premiumNewProject').onclick=()=>openProjectSheet(null);document.getElementById('premiumOpenPayroll').onclick=()=>document.getElementById('openTimesheetBtn').click();}
const grid=document.querySelector('#view-more > div[style*="display:grid"]');if(grid){grid.classList.add('premium-tool-grid');Object.entries({openKpBtn:'Коммерческие предложения',openContractsBtn:'Договоры',openCompanyBtn:'Реквизиты',openPriceListBtn:'Прайс для клиента',exportXlsxBtn:'Экспорт в Excel',openTimesheetBtn:'Табель и выплаты'}).forEach(([id,text])=>{document.getElementById(id).innerHTML=svg('cards')+text;});}
const toast=document.getElementById('toast');if(toast){toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');}document.querySelectorAll('.sheet-close').forEach(b=>b.setAttribute('aria-label','Закрыть'));document.querySelectorAll('.field').forEach(f=>{const l=f.querySelector('label'),i=f.querySelector('input,select,textarea');if(l&&i?.id&&!l.htmlFor)l.htmlFor=i.id;});
const sync=()=>{const active=document.querySelector('.view.active')?.id,fab=document.getElementById('addProjectFab');if(fab)fab.style.display=['view-projects','view-construction'].includes(active)?'':'none';nav?.querySelectorAll('.nav-btn').forEach(b=>{if(b.dataset.view===active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});};const observer=new MutationObserver(sync);document.querySelectorAll('.view').forEach(v=>observer.observe(v,{attributes:true,attributeFilter:['class']}));sync();
const user=document.getElementById('userPill');if(user){user.setAttribute('role','button');user.setAttribute('aria-label','Выйти из аккаунта');user.tabIndex=0;user.addEventListener('keydown',e=>{if(e.key==='Enter')user.click();});}const f=document.createElement('div');f.className='page-footnote';f.textContent='ARHITTEK · Сделано для точной работы';document.querySelector('main')?.append(f);document.addEventListener('keydown',e=>{if(e.key==='Escape')[...document.querySelectorAll('.sheet-overlay.active')].at(-1)?.querySelector('.sheet-close')?.click();});
})();

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
function draft(){const saved=state.projects.find(p=>p.id===editingProjectId)||{};return {...saved,id:editingProjectId,category_id:$('pf-category').value,status_id:$('pf-status').value,price:Number($('pf-price').value)||0,expenses:Number($('pf-expenses').value)||0,area:Number($('pf-area').value)||0,employee_id:$('pf-employee-fee').value||null,co_employee_id:$('pf-co-employee-fee').value||null,fee_percent:$('pf-feepercent').value===''?Number(findCategory($('pf-category').value)?.fee_percent)||0:Number($('pf-feepercent').value),co_fee_percent:Number($('pf-co-feepercent').value)||0,fee_base:$('pf-compensation-method').value==='m2'?'m2':$('pf-compensation-method').value==='percent_profit'?'profit':'price'};}
function planRows(p){
 if(p.fee_base==='m2')return projectRolePayoutEntries(p.id).map(e=>({entryId:e.id,name:findEmployee(e.payee_employee_id)?.name||'Сотрудник не найден',formula:(e.description||'').replace(' — '+(findEmployee(e.payee_employee_id)?.name||'')+' (',' · ').replace(/\)$/,''),amount:Number(e.amount)||0}));
 const f=getProjectFee(p),base=p.fee_base==='profit'?Math.max(0,p.price-p.expenses):p.price;
 return [[p.employee_id,f.mainFeeAmount,p.fee_percent],[p.co_employee_id,f.coFeeAmount,p.co_fee_percent]].filter(x=>x[0]).map(([id,amount,rate])=>({name:findEmployee(id)?.name||'Сотрудник не найден',formula:isConstructionCategory(p.category_id)?'По правилам строительного объекта':`${money(base)} × ${rate}%`,amount}));
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
 const calculationBase=p.fee_base==='profit'?Math.max(0,p.price-p.expenses):p.price;
 baseNote.textContent=isConstructionCategory(p.category_id)?'Стройка: расчёт по правилам строительного объекта.':p.fee_base==='profit'?`База: ${money(p.price)} − ${money(p.expenses)} расходов = ${money(calculationBase)}`:`База расчёта: ${money(p.price)}`;
 teamSummary.innerHTML='<h3>Гонорары команды</h3><p class="project-note">'+(interior?'Площадь работы × ставка. Сотрудники на окладе — без доплаты за проект.':architecture?'Гонорар = (стоимость − прямые расходы) × процент.':'Выберите способ расчёта и назначьте сотрудников.')+'</p>'+(interior&&!isM2?'<p class="project-warning">Здесь сохранён прежний процентный расчёт. Для новых начислений выберите «За м²». История автоматически не изменяется.</p>':'')+(architecture&&p.fee_base!=='profit'?'<p class="project-warning">Сохранены прежние условия. Для перехода выберите «Процент после расходов». Старые расчёты автоматически не изменяются.</p>':'');
 const lineResult=(id,employee,rate)=>{const el=$(id);const fees=getProjectFee(p);const row={amount:id==='team-main-result'?fees.mainFeeAmount:fees.coFeeAmount};el.innerHTML='<span>Гонорар</span><strong>'+(!employee?'—':findEmployee(employee)?.is_salaried&&rate===0?'На окладе':rate>0?esc(money(row?.amount||0)):rate===0?'Укажите %':'—')+'</strong>';};
 lineResult('team-main-result',p.employee_id,p.fee_percent);lineResult('team-co-result',p.co_employee_id,p.co_fee_percent);
 const rowsHtml=rows.length?rows.map(r=>`<div class="project-person"><div><strong>${esc(r.name)}</strong><small>${esc(r.formula)}</small></div><div class="project-person-actions"><strong>${esc(money(r.amount))}</strong>${r.entryId&&admin?`<button type="button" class="icon-btn" data-edit-payout="${esc(r.entryId)}" aria-label="Редактировать начисление: ${esc(r.name)}">✏️</button><button type="button" class="icon-btn" data-remove-payout="${esc(r.entryId)}" aria-label="Удалить из расчёта: ${esc(r.name)}">×</button>`:''}</div></div>`).join(''):'<p class="project-note">Выберите сотрудника и условия вознаграждения.</p>';
 const saved=state.projects.find(x=>x.id===editingProjectId), entries=projectRolePayoutEntries(editingProjectId);
 const staleArea=saved&&p.fee_base==='m2'&&entries.length&&p.area!==Number(saved.area||0);
 $('pf-compensation-summary').innerHTML=(isM2?rowsHtml:'')+`<div class="project-person project-total"><strong>${done?'Начислено команде':'Всего по проекту'}</strong><strong>${rows.some(r=>r.amount>0)?esc(money(total)):'—'}</strong></div><p class="team-total-note">${done?'В табеле за месяц даты сдачи.':'Попадёт в табель после завершения проекта.'}</p>`+(staleArea?'<p class="project-warning">Площадь изменена. Сохранённые суммы не пересчитываются автоматически — проверьте расчёт команды.</p>':'');
 const payment=Number($('pf-advance').value)||0;
 overview.innerHTML=`<div class="project-eyebrow">${esc(findCategory(p.category_id)?.name||'Новый проект')}</div><h3>${esc($('pf-name').value||'Начнём с основного')}</h3><p class="project-note">${esc(findStatus(p.status_id)?.name||'В работе')} · ${$('pf-end').value?'Срок: '+esc(fmtDate($('pf-end').value)):'Укажите срок проекта'}</p>`+(admin?`<div class="project-metrics">${card('Стоимость',money(p.price))}${card('Команда · '+(done?'начислено':'план'),money(total))}</div>`:'');
 const construction=isConstructionCategory(p.category_id);
 economy.innerHTML=admin?(construction?'<p class="project-note">Бюджет стройки, накладные и прямые оплаты клиента доступны в карточке объекта.</p>':`<div class="project-metrics">${card('Получено от клиента',money(payment))}${card('Долг клиента',money(Math.max(0,p.price-payment)))}</div><div class="project-equation"><span>Стоимость договора <b>${esc(money(p.price))}</b></span><span>− Прямые расходы <b>${esc(money(p.expenses))}</b></span><span>− Вознаграждения команды <b>${esc(money(total))}</b></span><span class="project-total">Остаток до общих расходов <b>${esc(money(p.price-p.expenses-total))}</b></span></div><p class="project-note">Оклады, аренда и другие общие расходы учитываются за месяц отдельно.</p>`):'';
 if(!admin){overview.querySelector('.project-metrics')?.remove();}
}
window.refreshProjectWorkspace=refresh;
function defaults(){
 if(editingProjectId)return;
 const cat=findCategory($('pf-category').value),name=(cat?.name||'').toLowerCase();
 if(name.includes('интерьер')){$('pf-compensation-method').value='m2';$('pf-feepercent').value='0';}
 else if(name.includes('архитект')||name.includes('ландшафт')){$('pf-compensation-method').value='percent_profit';$('pf-feepercent').value=cat?.fee_percent>0?cat.fee_percent:40;}
 $('pf-feebase').value=$('pf-compensation-method').value==='m2'?'m2':$('pf-compensation-method').value==='percent_profit'?'profit':'price';
 renderCompensationMethodUI();
}
const oldOpen=openProjectSheet;openProjectSheet=function(id){oldOpen(id);$('projectSheetTitle').textContent=id?'Карточка проекта':'Новый проект';coDetails.hidden=!$('pf-co-employee').value;addSecond.hidden=!coDetails.hidden;special.open=false;contactDetails.open=false;defaults();$('pf-rp-rate').value='400';$('pf-rp-area').value=$('pf-area').value;$('pf-employee-fee').value=$('pf-employee').value;$('pf-co-employee-fee').value=$('pf-co-employee').value;selectTab('overview');refresh();sheet.scrollTop=0;};
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
const oldSave=saveProject;saveProject=async function(){
 const p=draft();
 if(p.employee_id&&p.employee_id===p.co_employee_id){selectTab('team');showToast('Один сотрудник выбран дважды. Оставьте его в одной строке.');return;}
 if(p.fee_base!=='m2'&&[[p.employee_id,p.fee_percent],[p.co_employee_id,p.co_fee_percent]].some(([id,rate])=>id&&rate>0&&findEmployee(id)?.is_salaried)){selectTab('team');showToast('Сотрудник на окладе: укажите 0% и добавьте его без проектной доплаты');return;}
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
$('pf-save').removeEventListener('click',oldSave);$('pf-save').addEventListener('click',()=>saveProject());
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
    const {error}=await sb.from('ledger_entries').update({payee_employee_id:emp.id,description,amount,entry_date:new Date().toISOString().slice(0,10)}).eq('id',editingRolePayoutId);
    if(error)throw error;
    await logAudit('project',projectId,p.name,'update',{role_payout_edited:{old:before?(before.description+' — '+fmtMoney(before.amount)):null,new:description+' — '+fmtMoney(amount)}});
  }else{
    const {data,error}=await sb.from('ledger_entries').insert({type:'role_payout',project_id:projectId,payee_employee_id:emp.id,description,amount,entry_date:new Date().toISOString().slice(0,10),received_by:session.employeeId}).select().single();
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
    return (state.employees||[]).filter(e=>!e.deleted_at && (e.active!==false || n(split[e.id]?.payout)>0)).map(e=>{
      const row=split[e.id]||{salary:0,earned:0,payout:0};
      const method=e.is_salaried?'Оклад'+(n(row.earned)>0?' + проекты':''):(n(row.earned)>0?'По проектам':'Без начислений');
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
  ['reserve','Резерв']
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
  const valid=['overview','income','expense','team','forecast','reserve'];
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
    let allTimeResult=0;
    try{
      const all=computeFinancePeriod('2000-01-01',to);
      const allExtra=(state.companyIncome||[]).filter(i=>!i.deleted_at&&inRange(i.income_date,'2000-01-01',to)).reduce((s,i)=>s+n(i.amount),0);
      allTimeResult=n(all.netProfit)+allExtra;
    }catch(e){}
    reserveVisual.innerHTML=`
      <div class="finance-v-hero reserve-hero"><span>Резерв и амортизация</span><strong>${cash(allTimeResult)}</strong><small>Накопленный результат компании</small></div>
      <div class="finance-reserve-cards">
        <div><span>Результат периода</span><strong>${cash(result)}</strong></div>
        <div><span>10% на амортизацию</span><strong>${cash(amort)}</strong></div>
      </div>`;
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


/* ARHITTEK FINANCE CONTROLS V3 */
(()=>{
'use strict';
const view=document.getElementById('view-finance');
if(!view || window.__arhittekFinanceControlsV3) return;
window.__arhittekFinanceControlsV3=true;
const $=id=>document.getElementById(id);
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const money=v=>{try{return fmtMoney(Math.round(num(v)));}catch(e){return Math.round(num(v)).toLocaleString('ru-RU')+' ₽';}};
const esc=v=>{try{return escapeHtml(v);}catch(e){return String(v??'');}};
const isAdmin=()=>!!window.session?.isAdmin || !!session?.isAdmin;
let editingBonusId=null;

function financeSheet(){
  let o=$('financeControlSheetOverlay');
  if(o) return o;
  o=document.createElement('div');
  o.className='sheet-overlay';
  o.id='financeControlSheetOverlay';
  o.innerHTML=`
    <div class="sheet finance-control-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title"><span id="financeControlTitle">Финансовая операция</span><button class="sheet-close" type="button" id="financeControlClose">✕</button></div>
      <div id="financeControlBody"></div>
    </div>`;
  document.body.appendChild(o);
  $('financeControlClose').onclick=closeFinanceControl;
  return o;
}
function closeFinanceControl(){
  $('financeControlSheetOverlay')?.classList.remove('active');
  editingBonusId=null;
}
window.closeFinanceControl=closeFinanceControl;

function activeEmployees(){
  return (state.employees||[]).filter(e=>e.active!==false&&!e.deleted_at);
}
function bonusEntries(){
  return (state.ledger||[]).filter(l=>l.type==='bonus'&&!l.deleted_at).sort((a,b)=>String(b.entry_date||'').localeCompare(String(a.entry_date||'')));
}
function findBonus(id){return bonusEntries().find(x=>String(x.id)===String(id));}

window.openFinanceBonusSheet=function(id=null){
  if(!isAdmin()){showToast('Требуются права администратора');return;}
  editingBonusId=id;
  const row=id?findBonus(id):null;
  const o=financeSheet();
  $('financeControlTitle').textContent=row?'Редактировать премию':'Назначить премию';
  $('financeControlBody').innerHTML=`
    <div class="field"><label>Сотрудник</label><select id="finance-bonus-employee">${activeEmployees().map(e=>`<option value="${e.id}">${esc(e.name)}${e.role?' · '+esc(e.role):''}</option>`).join('')}</select></div>
    <div class="field-row">
      <div class="field"><label>Сумма, ₽</label><input id="finance-bonus-amount" type="number" min="1" step="500" placeholder="0"></div>
      <div class="field"><label>Дата начисления</label><input id="finance-bonus-date" type="date"></div>
    </div>
    <div class="field"><label>За что премия</label><input id="finance-bonus-desc" type="text" placeholder="например: за сдачу проекта раньше срока"></div>
    <button type="button" class="btn btn-primary" id="finance-bonus-save">${row?'Сохранить изменения':'Назначить премию'}</button>
    ${row?'<button type="button" class="btn btn-danger finance-control-danger" id="finance-bonus-delete">Удалить премию</button>':''}
  `;
  if(row){
    $('finance-bonus-employee').value=row.payee_employee_id||'';
    $('finance-bonus-amount').value=row.amount||'';
    $('finance-bonus-date').value=row.entry_date||'';
    $('finance-bonus-desc').value=row.description||'';
  }else{
    $('finance-bonus-date').value=new Date().toISOString().slice(0,10);
  }
  $('finance-bonus-save').onclick=saveFinanceBonus;
  if(row) $('finance-bonus-delete').onclick=deleteFinanceBonus;
  o.classList.add('active');
};

async function saveFinanceBonus(){
  if(!isAdmin()) return;
  const employee=$('finance-bonus-employee')?.value;
  const amount=num($('finance-bonus-amount')?.value);
  const entry_date=$('finance-bonus-date')?.value;
  const description=($('finance-bonus-desc')?.value||'').trim();
  if(!employee){showToast('Выберите сотрудника');return;}
  if(amount<=0){showToast('Укажите сумму премии');return;}
  if(!entry_date){showToast('Укажите дату');return;}
  try{
    const payload={type:'bonus',project_id:null,payee_employee_id:employee,amount,entry_date,description:description||'Премия',received_by:session?.employeeId||null};
    let q;
    if(editingBonusId) q=await sb.from('ledger_entries').update(payload).eq('id',editingBonusId);
    else q=await sb.from('ledger_entries').insert(payload);
    if(q.error) throw q.error;
    closeFinanceControl();
    showToast(editingBonusId?'Премия изменена':'Премия назначена');
    await loadAll();
    try{renderTimesheet();}catch(e){}
    try{renderFinanceVisualPanels();}catch(e){}
  }catch(e){console.error(e);showToast('Не удалось сохранить премию');}
}
async function deleteFinanceBonus(){
  if(!editingBonusId||!confirm('Удалить эту премию?')) return;
  try{
    const {error}=await sb.from('ledger_entries').delete().eq('id',editingBonusId);
    if(error) throw error;
    closeFinanceControl();
    showToast('Премия удалена');
    await loadAll();
  }catch(e){console.error(e);showToast('Ошибка удаления премии');}
}

window.openReserveCorrection=function(){
  if(!isAdmin()){showToast('Требуются права администратора');return;}
  const current=typeof getCompanyReserveBalance==='function'?getCompanyReserveBalance():190000;
  const o=financeSheet();
  $('financeControlTitle').textContent='Корректировать резерв';
  $('financeControlBody').innerHTML=`
    <div class="finance-current-balance"><span>Сейчас в резерве</span><strong>${money(current)}</strong></div>
    <div class="field"><label>Фактический остаток резерва, ₽</label><input id="finance-reserve-target" type="number" min="0" step="1000" value="${Math.round(current)}"></div>
    <div class="field"><label>Комментарий</label><input id="finance-reserve-comment" type="text" placeholder="например: сверка кассы и счетов"></div>
    <button type="button" class="btn btn-primary" id="finance-reserve-save">Сохранить фактический резерв</button>
  `;
  $('finance-reserve-save').onclick=saveReserveCorrection;
  o.classList.add('active');
};
async function saveReserveCorrection(){
  const current=typeof getCompanyReserveBalance==='function'?getCompanyReserveBalance():190000;
  const target=num($('finance-reserve-target')?.value);
  const comment=($('finance-reserve-comment')?.value||'').trim();
  if(target<0){showToast('Резерв не может быть отрицательным');return;}
  const delta=Math.round(target-current);
  if(delta===0){closeFinanceControl();showToast('Резерв уже совпадает');return;}
  const today=new Date().toISOString().slice(0,10);
  try{
    if(delta>0){
      const {error}=await sb.from('company_income').insert({category:RESERVE_INCREASE_CATEGORY,amount:delta,income_date:today,description:comment||'Корректировка фактического резерва'});
      if(error) throw error;
    }else{
      const {error}=await sb.from('company_expenses').insert({category:RESERVE_DECREASE_CATEGORY,amount:Math.abs(delta),expense_date:today,description:comment||'Корректировка фактического резерва'});
      if(error) throw error;
    }
    closeFinanceControl();showToast('Резерв скорректирован');await loadAll();
  }catch(e){console.error(e);showToast('Не удалось скорректировать резерв');}
}

window.openCompanyWithdrawal=function(){
  if(!isAdmin()){showToast('Требуются права администратора');return;}
  try{openCompanyExpenseSheet(null,COMPANY_WITHDRAWAL_CATEGORY);}catch(e){console.error(e);}
};

function renderFinanceControls(){
  const team=document.querySelector('.finance-visual-panel[data-fin-panel="team"]');
  const expense=document.querySelector('.finance-visual-panel[data-fin-panel="expense"]');
  const reserve=document.querySelector('.finance-visual-panel[data-fin-panel="reserve"]');
  const teamVisual=$('financeTeamVisual');
  const expenseVisual=$('financeExpenseVisual');
  const reserveVisual=$('financeReserveVisual');
  if(!team||!expense||!reserve) return;

  let bonusActions=$('financeBonusActions');
  if(!bonusActions){
    bonusActions=document.createElement('div');
    bonusActions.id='financeBonusActions';
    bonusActions.className='finance-management-actions';
    teamVisual?.insertAdjacentElement('afterend',bonusActions);
  }
  const bonuses=bonusEntries();
  const {from,to}=(()=>{try{return financeCurrentRange();}catch(e){return {from:'0000-01-01',to:'9999-12-31'};}})();
  const periodBonuses=bonuses.filter(b=>(b.entry_date||'')>=from&&(b.entry_date||'')<=to);
  bonusActions.innerHTML=`
    ${isAdmin()?'<button type="button" class="btn btn-primary" onclick="openFinanceBonusSheet()">+ Назначить премию</button>':''}
    <details class="finance-visual-disclosure finance-bonus-history" ${periodBonuses.length?'':'open'}>
      <summary>Премии за период · ${periodBonuses.length}</summary>
      <div class="finance-management-list">
      ${periodBonuses.length?periodBonuses.map(b=>{
        const emp=(state.employees||[]).find(e=>e.id===b.payee_employee_id);
        return `<div class="finance-management-row"><div><strong>${esc(emp?.name||'Сотрудник')}</strong><small>${esc(b.entry_date||'')}${b.description?' · '+esc(b.description):''}</small></div><div><b>${money(b.amount)}</b>${isAdmin()?`<button type="button" class="icon-btn" onclick="openFinanceBonusSheet('${b.id}')">✎</button>`:''}</div></div>`;
      }).join(''):'<div class="finance-v-empty">Премий за выбранный период нет.</div>'}
      </div>
    </details>`;

  let expenseManage=$('financeExpenseManage');
  if(!expenseManage){
    expenseManage=document.createElement('div');
    expenseManage.id='financeExpenseManage';
    expenseManage.className='finance-management-block';
    expenseVisual?.insertAdjacentElement('afterend',expenseManage);
  }
  const operational=(state.companyExpenses||[]).filter(x=>!x.deleted_at&&(typeof isOperationalCompanyExpense!=='function'||isOperationalCompanyExpense(x))).sort((a,b)=>String(b.expense_date||'').localeCompare(String(a.expense_date||'')));
  expenseManage.innerHTML=`
    ${isAdmin()?'<div class="finance-quick-actions"><button type="button" onclick="openCompanyExpenseSheet(null,\'Кофе / вода / офис\')">+ Кофе / офис</button><button type="button" onclick="openCompanyExpenseSheet(null,\'Топливо / авто\')">+ Топливо / авто</button></div>':''}
    <details class="finance-visual-disclosure">
      <summary>Управление расходами · ${operational.length}</summary>
      <div class="finance-management-list">
      ${operational.length?operational.slice(0,30).map(x=>`<div class="finance-management-row"><div><strong>${esc(x.category||'Расход')}</strong><small>${esc(x.expense_date||'')}${x.description?' · '+esc(x.description):''}</small></div><div><b class="negative">−${money(x.amount)}</b>${isAdmin()?`<button type="button" class="icon-btn" onclick="openCompanyExpenseSheet('${x.id}')">✎</button>`:''}</div></div>`).join(''):'<div class="finance-v-empty">Расходов пока нет.</div>'}
      </div>
    </details>`;

  const actualReserve=typeof getCompanyReserveBalance==='function'?getCompanyReserveBalance():190000;
  if(reserveVisual){
    const withdrawals=(state.companyExpenses||[]).filter(x=>!x.deleted_at&&x.category===COMPANY_WITHDRAWAL_CATEGORY).sort((a,b)=>String(b.expense_date||'').localeCompare(String(a.expense_date||'')));
    const corrections=[
      ...(state.companyIncome||[]).filter(x=>!x.deleted_at&&x.category===RESERVE_INCREASE_CATEGORY).map(x=>({...x,_dir:1,_date:x.income_date})),
      ...(state.companyExpenses||[]).filter(x=>!x.deleted_at&&x.category===RESERVE_DECREASE_CATEGORY).map(x=>({...x,_dir:-1,_date:x.expense_date}))
    ].sort((a,b)=>String(b._date||'').localeCompare(String(a._date||'')));
    reserveVisual.innerHTML=`
      <div class="finance-v-hero reserve-hero"><span>Фактический резерв компании</span><strong>${money(actualReserve)}</strong><small>Старт: 190 000 ₽ на 23.09.2026 · корректируется вручную по фактическому остатку</small></div>
      ${isAdmin()?'<div class="finance-management-actions reserve-actions"><button type="button" class="btn btn-primary" onclick="openReserveCorrection()">Корректировать резерв</button><button type="button" class="btn btn-secondary" onclick="openCompanyWithdrawal()">Вывести деньги</button></div>':''}
      <div class="finance-reserve-cards"><div><span>Выводов за всё время</span><strong>${money(withdrawals.reduce((s,x)=>s+num(x.amount),0))}</strong></div><div><span>Корректировок</span><strong>${corrections.length}</strong></div></div>
      <details class="finance-visual-disclosure"><summary>История резерва и выводов</summary><div class="finance-management-list">
        <div class="finance-management-row finance-opening-row"><div><strong>Стартовый резерв</strong><small>23.09.2026 · зафиксированный фактический остаток</small></div><div><b>+${money(190000)}</b></div></div>
        ${[...withdrawals.map(x=>({...x,_kind:'Вывод',_dir:-1,_date:x.expense_date})),...corrections].sort((a,b)=>String(b._date||'').localeCompare(String(a._date||''))).map(x=>`<div class="finance-management-row"><div><strong>${esc(x._kind||'Корректировка')}</strong><small>${esc(x._date||'')}${x.description?' · '+esc(x.description):''}</small></div><div><b class="${x._dir<0?'negative':''}">${x._dir<0?'−':'+'}${money(x.amount)}</b>${x._kind==='Вывод'&&isAdmin()?`<button type="button" class="icon-btn" title="Редактировать вывод" onclick="openCompanyExpenseSheet('${x.id}')">✎</button>`:''}</div></div>`).join('')}
      </div></details>`;
  }
  const flowReserve=document.querySelector('.finance-flow-node.reserve');
  if(flowReserve) flowReserve.innerHTML=`<span>Резерв компании</span><strong>${money(actualReserve)}</strong><small>Фактический остаток</small>`;
}
window.renderFinanceControls=renderFinanceControls;

const oldVisual=window.renderFinanceVisualPanels;
if(typeof oldVisual==='function'){
  window.renderFinanceVisualPanels=function(){
    const r=oldVisual.apply(this,arguments);
    try{renderFinanceControls();}catch(e){console.warn('[Finance controls]',e);}
    return r;
  };
}
const oldAll=window.renderAll;
if(typeof oldAll==='function'){
  window.renderAll=function(){
    const r=oldAll.apply(this,arguments);
    setTimeout(()=>{try{renderFinanceControls();}catch(e){}},0);
    return r;
  };
}
setTimeout(()=>{try{renderFinanceControls();}catch(e){console.warn('[Finance controls init]',e);}},1050);
})();


// ARHITTEK document workflow v1
(()=>{
'use strict';
const $=id=>document.getElementById(id);
let editingContractId=null;
let contractHistoryRows=[];
let contractSearchQuery='';
let documentReturnContext=null;
let linkedDocumentProjectId=null;

function currentDocumentOrigin(projectId){
  const objectOpen = $('view-object')?.classList.contains('active') && typeof currentObjectId!=='undefined' && currentObjectId===projectId;
  return {kind:objectOpen?'object':'project', projectId, scrollY:window.scrollY||0};
}
function showWorkspaceView(viewId){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  $(viewId)?.classList.add('active');
  const nav=document.querySelector('.nav-btn[data-view="'+viewId+'"]');
  if(nav) nav.classList.add('active');
}
function returnFromDocumentView(){
  const ctx=documentReturnContext;
  documentReturnContext=null;
  linkedDocumentProjectId=null;
  if(!ctx){
    showWorkspaceView('view-more');
    document.querySelector('.nav-btn[data-view="view-more"]')?.classList.add('active');
    window.scrollTo(0,0);
    return;
  }
  if(ctx.kind==='object'){
    if(typeof openObjectView==='function') openObjectView(ctx.projectId);
  }else{
    showWorkspaceView('view-projects');
    if(typeof openProjectSheet==='function') openProjectSheet(ctx.projectId);
  }
  setTimeout(()=>window.scrollTo(0,ctx.scrollY||0),0);
}

function escDoc(v){
  return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function contractSnapshotFromForm(){
  return {
    contract_type: typeof contractType!=='undefined' ? contractType : 'ar',
    project_id: $('ct-project')?.value || null,
    client_name: $('ct-client-name')?.value.trim() || '',
    passport: $('ct-passport')?.value.trim() || '',
    birthdate: $('ct-birthdate')?.value || '',
    passport_issuer: $('ct-passport-issuer')?.value.trim() || '',
    passport_date: $('ct-passport-date')?.value || '',
    address: $('ct-address')?.value.trim() || '',
    phone: $('ct-phone')?.value.trim() || '',
    number: $('ct-number')?.value.trim() || '',
    date: $('ct-date')?.value || new Date().toISOString().slice(0,10),
    object: $('ct-object')?.value.trim() || '',
    scope: $('ct-scope')?.value || '',
    price: Number($('ct-price')?.value)||0,
    advance_pct: Number($('ct-advance-pct')?.value)||0,
    start_date: $('ct-start')?.value || '',
    end_date: $('ct-end')?.value || '',
  };
}
function contractLabel(type){
  return (typeof CONTRACT_TYPES!=='undefined' && CONTRACT_TYPES[type]?.label) || ({ar:'Архитектурный проект',di:'Дизайн интерьера',st:'Строительство'})[type] || 'Договор';
}
function contractProjectName(projectId){
  const p=(typeof state!=='undefined' && state.projects||[]).find(x=>x.id===projectId);
  return p?.name || '';
}
function applyContractSnapshot(s){
  if(!s) return;
  contractType=s.contract_type||'ar';
  document.querySelectorAll('#contract-type .yn-btn').forEach(b=>b.classList.toggle('selected',b.dataset.value===contractType));
  const map={
    'ct-project':s.project_id||'','ct-client-name':s.client_name||'','ct-passport':s.passport||'',
    'ct-birthdate':s.birthdate||'','ct-passport-issuer':s.passport_issuer||'','ct-passport-date':s.passport_date||'',
    'ct-address':s.address||'','ct-phone':s.phone||'','ct-number':s.number||'','ct-date':s.date||'',
    'ct-object':s.object||'','ct-scope':s.scope||'','ct-price':s.price||'','ct-advance-pct':s.advance_pct??50,
    'ct-start':s.start_date||'','ct-end':s.end_date||''
  };
  Object.entries(map).forEach(([id,v])=>{const el=$(id); if(el) el.value=v;});
}
function contractRowSnapshot(row){ return row?.changes?.snapshot?.new || row?.changes?.snapshot || null; }

async function queryContractHistory(){
  try{
    const {data,error}=await sb.from('audit_log').select('*').eq('entity_type','contract').order('created_at',{ascending:false}).limit(1000);
    if(error) throw error;
    contractHistoryRows=data||[];
  }catch(e){
    console.error('contract history load error',e);
    contractHistoryRows=[];
  }
  return contractHistoryRows;
}
function latestContractRowsForProject(projectId){
  return latestUniqueContracts(contractHistoryRows.filter(r=>{
    const s=contractRowSnapshot(r);
    return s && s.project_id===projectId;
  }));
}
function contractIdentity(s){
  return [s?.project_id||'', String(s?.number||'').trim().toLowerCase(), String(s?.object||'').trim().toLowerCase()].join('|');
}
function latestUniqueContracts(rows){
  const seen=new Set(), out=[];
  for(const r of rows){
    const s=contractRowSnapshot(r)||{};
    const key=contractIdentity(s) || r.entity_id;
    if(seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}
async function renderContractHistory(){
  const list=$('ct-history-list'); if(!list) return;
  await queryContractHistory();
  if(!contractHistoryRows.length){
    list.innerHTML='<div class="empty-state">Сохранённых договоров пока нет</div>'; return;
  }
  let rows=latestUniqueContracts(contractHistoryRows);
  if(contractSearchQuery.trim()){
    const q=contractSearchQuery.trim().toLowerCase();
    rows=rows.filter(r=>{
      const s=contractRowSnapshot(r)||{};
      return [s.number,s.client_name,s.object,contractProjectName(s.project_id),contractLabel(s.contract_type)]
        .some(v=>String(v||'').toLowerCase().includes(q));
    });
  }
  if(!rows.length){
    list.innerHTML='<div class="empty-state">По вашему поиску договоры не найдены</div>';
    return;
  }
  list.innerHTML=rows.map(r=>{
    const s=contractRowSnapshot(r)||{}, p=contractProjectName(s.project_id);
    return `<div class="list-item">
      <div style="cursor:pointer;flex:1" data-contract-history-id="${escDoc(r.id)}">
        <div class="li-name">Договор № ${escDoc(s.number||'без номера')} · ${escDoc(contractLabel(s.contract_type))}</div>
        <div class="li-meta">${p?escDoc(p)+' · ':''}${escDoc(s.client_name||'Без заказчика')} · ${escDoc(typeof fmtDateTime==='function'?fmtDateTime(r.created_at):r.created_at||'')}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" type="button" data-contract-history-id="${escDoc(r.id)}" title="Редактировать договор">✏️</button>
        <button class="icon-btn danger" type="button" data-delete-contract-row="${escDoc(r.id)}" title="Удалить договор">🗑</button>
      </div>
    </div>`;
  }).join('');
}
async function loadContractVersion(rowId){
  let row=contractHistoryRows.find(r=>String(r.id)===String(rowId));
  if(!row){
    const {data}=await sb.from('audit_log').select('*').eq('id',rowId).maybeSingle();
    row=data;
  }
  const s=contractRowSnapshot(row); if(!s) return;
  editingContractId=row.entity_id;
  applyContractSnapshot(s);
  showToast('Договор открыт для редактирования');
  window.scrollTo({top:0,behavior:'smooth'});
}

async function deleteSavedContract(rowId){
  let row=contractHistoryRows.find(r=>String(r.id)===String(rowId));
  if(!row){
    const {data}=await sb.from('audit_log').select('*').eq('id',rowId).maybeSingle();
    row=data;
  }
  if(!row) return;
  const s=contractRowSnapshot(row)||{};
  const label='Договор № '+(s.number||'без номера');
  if(!confirm('Удалить '+label+'? Восстановить его из приложения будет нельзя.')) return;

  try{
    // Удаляем все записи этого договора, чтобы не осталось старых дублей.
    const entityId=row.entity_id;
    if(entityId){
      const {error}=await sb.from('audit_log').delete().eq('entity_type','contract').eq('entity_id',entityId);
      if(error) throw error;
    }else{
      const {error}=await sb.from('audit_log').delete().eq('id',row.id);
      if(error) throw error;
    }

    editingContractId=null;
    await queryContractHistory();
    await renderContractHistory();

    if(s.project_id){
      await renderProjectContractList(s.project_id);
      if(typeof currentObjectId!=='undefined' && currentObjectId===s.project_id){
        await renderObjectDocuments(s.project_id);
      }
    }

    showToast('Договор удалён');
    newContractDraft();
  }catch(e){
    console.error(e);
    showToast('Не удалось удалить договор');
  }
}
async function saveContractVersion(){
  const s=contractSnapshotFromForm();
  if(!s.client_name && !s.object && !s.number){showToast('Заполните хотя бы заказчика, объект или номер договора');return;}
  await queryContractHistory();

  // Один номер/объект в одном проекте = один договор.
  const same=contractHistoryRows.find(r=>contractIdentity(contractRowSnapshot(r)||{})===contractIdentity(s));
  if(!editingContractId && same) editingContractId=same.entity_id;
  if(!editingContractId) editingContractId=(crypto?.randomUUID?.() || ('contract-'+Date.now()+'-'+Math.random().toString(16).slice(2)));

  const projectName=contractProjectName(s.project_id);
  const actor=(typeof session!=='undefined'&&session?.name)?session.name:'';
  const payloadChanges={
    snapshot:{old:null,new:s},
    project_id:{old:null,new:s.project_id||null}
  };
  if(actor) payloadChanges._actor=actor;

  try{
    const currentRows=contractHistoryRows.filter(r=>r.entity_id===editingContractId);
    if(currentRows.length){
      const keep=currentRows[0];
      const {error}=await sb.from('audit_log').update({
        entity_name:`Договор № ${s.number||'без номера'}${projectName?' · '+projectName:''}`,
        action:'update',
        changes:payloadChanges,
        created_at:new Date().toISOString()
      }).eq('id',keep.id);
      if(error) throw error;

      // Старые версии этого же договора больше не нужны.
      const extra=currentRows.slice(1).map(r=>r.id);
      for(const id of extra){
        const {error:delErr}=await sb.from('audit_log').delete().eq('id',id);
        if(delErr) console.warn('contract duplicate cleanup',delErr);
      }
    }else{
      const {error}=await sb.from('audit_log').insert({
        entity_type:'contract', entity_id:editingContractId,
        entity_name:`Договор № ${s.number||'без номера'}${projectName?' · '+projectName:''}`,
        action:'create', changes:payloadChanges
      });
      if(error) throw error;
    }

    // Также убираем старые дубли с тем же номером/объектом.
    await queryContractHistory();
    const duplicates=contractHistoryRows.filter(r=>r.entity_id!==editingContractId && contractIdentity(contractRowSnapshot(r)||{})===contractIdentity(s));
    for(const r of duplicates){
      const {error:delErr}=await sb.from('audit_log').delete().eq('id',r.id);
      if(delErr) console.warn('contract identity duplicate cleanup',delErr);
    }

    await saveContractFields?.();
    showToast('Договор сохранён');
    if(contractView) contractView.dataset.dirty='0';
    await renderContractHistory();
    if(s.project_id) await renderProjectContractList(s.project_id);
    if(typeof currentObjectId!=='undefined' && currentObjectId===s.project_id) await renderObjectDocuments(s.project_id);
  }catch(e){ console.error(e); showToast('Не удалось сохранить договор'); }
}
function newContractDraft(){
  editingContractId=null;
  const keepProjectId=linkedDocumentProjectId||null;
  const ids=['ct-client-name','ct-passport','ct-birthdate','ct-passport-issuer','ct-passport-date','ct-address','ct-phone','ct-number','ct-object','ct-price','ct-start','ct-end'];
  ids.forEach(id=>{if($(id))$(id).value='';});
  if($('ct-project')) $('ct-project').value='';
  if($('ct-date')) $('ct-date').value=new Date().toISOString().slice(0,10);
  if($('ct-advance-pct')) $('ct-advance-pct').value=50;
  contractType='ar';
  document.querySelectorAll('#contract-type .yn-btn').forEach(b=>b.classList.toggle('selected',b.dataset.value==='ar'));
  if(typeof fillContractDefaults==='function') fillContractDefaults();
  if(keepProjectId && $('ct-project')){
    $('ct-project').value=keepProjectId;
    $('ct-project').dispatchEvent(new Event('change',{bubbles:true}));
  }
  if(contractView) contractView.dataset.dirty='0';
  showToast('Новый договор');
}

function wordContractHtml(s){
  const c=(typeof state!=='undefined'&&state.companyInfo)||{};
  const scope=String(s.scope||'').split(/\n+/).filter(Boolean).map(x=>`<li>${escDoc(x.replace(/^[-—]\s*/,''))}</li>`).join('');
  const price=(typeof fmtMoney==='function'?fmtMoney(s.price):s.price+' ₽');
  const advance=Math.round((Number(s.price)||0)*(Number(s.advance_pct)||0)/100);
  const dateFmt=v=>(typeof fmtDate==='function'?fmtDate(v):v)||'';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Договор</title>
  <style>body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.45;color:#111;margin:32px}h1{text-align:center;font-size:16pt}h2{font-size:12pt;margin-top:22px}table{width:100%;border-collapse:collapse;margin:10px 0}td{vertical-align:top;padding:5px;border:1px solid #bbb}.muted{color:#555}</style></head><body>
  <h1>ДОГОВОР № ${escDoc(s.number||'____')}</h1>
  <p style="text-align:center">${escDoc(contractLabel(s.contract_type))} · ${escDoc(dateFmt(s.date))}</p>
  <p><b>Исполнитель:</b> ${escDoc(c.full_name||c.short_name||'ARHITTEK')}, в лице ${escDoc(c.director||'руководителя')}.</p>
  <p><b>Заказчик:</b> ${escDoc(s.client_name||'________________')}.</p>
  <h2>1. Предмет договора</h2>
  <p>Исполнитель обязуется выполнить работы по объекту: <b>${escDoc(s.object||'________________')}</b>, а Заказчик обязуется принять и оплатить результат работ.</p>
  <ul>${scope||'<li>Состав работ определяется сторонами.</li>'}</ul>
  <h2>2. Стоимость и порядок оплаты</h2>
  <p>Стоимость работ: <b>${escDoc(price)}</b>. Аванс: <b>${escDoc(String(s.advance_pct||0))}% (${escDoc(typeof fmtMoney==='function'?fmtMoney(advance):advance+' ₽')})</b>.</p>
  <h2>3. Сроки</h2>
  <p>Начало работ: ${escDoc(dateFmt(s.start_date)||'по согласованию')}. Завершение: ${escDoc(dateFmt(s.end_date)||'по согласованию')}.</p>
  <h2>4. Права, обязанности и приёмка</h2>
  <p>Исполнитель выполняет согласованный объём работ и передаёт результат Заказчику. Заказчик своевременно предоставляет исходные данные, согласовывает решения и производит оплату в согласованные сроки.</p>
  <h2>5. Ответственность и изменения</h2>
  <p>Изменения объёма, стоимости и сроков фиксируются сторонами дополнительно. Стороны несут ответственность в соответствии с условиями договора и применимым законодательством.</p>
  <h2>6. Реквизиты и подписи</h2>
  <table><tr><td><b>Исполнитель</b><br>${escDoc(c.full_name||c.short_name||'ARHITTEK')}<br>ИНН: ${escDoc(c.inn||'')}<br>ОГРН: ${escDoc(c.ogrn||'')}<br>${escDoc(c.legal_address||'')}<br>${escDoc(c.phone||'')}</td>
  <td><b>Заказчик</b><br>${escDoc(s.client_name||'')}<br>Паспорт: ${escDoc(s.passport||'')}<br>Дата рождения: ${escDoc(dateFmt(s.birthdate))}<br>Выдан: ${escDoc(s.passport_issuer||'')} ${escDoc(dateFmt(s.passport_date))}<br>Адрес: ${escDoc(s.address||'')}<br>Тел.: ${escDoc(s.phone||'')}</td></tr></table>
  <p style="margin-top:40px">Исполнитель ____________________ &nbsp;&nbsp;&nbsp; Заказчик ____________________</p>
  <p class="muted">Документ сформирован в ARHITTEK. Файл можно редактировать в Microsoft Word.</p>
  </body></html>`;
}
function exportContractToWord(){
  const s=contractSnapshotFromForm();
  const blob=new Blob(['\ufeff',wordContractHtml(s)],{type:'application/msword;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  const safe=(s.number||'bez-nomera').replace(/[^a-zA-Zа-яА-Я0-9_-]/g,'_');
  a.download=`Dogovor-${safe}-${s.date||new Date().toISOString().slice(0,10)}.doc`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  showToast('Word-файл скачивается...');
}

async function detachContractFromProject(rowId,projectId){
  let row=contractHistoryRows.find(r=>String(r.id)===String(rowId));
  if(!row){await queryContractHistory();row=contractHistoryRows.find(r=>String(r.id)===String(rowId));}
  if(!row)return;
  const s=contractRowSnapshot(row)||{};
  if(!confirm('Открепить договор № '+(s.number||'без номера')+' от проекта? Сам договор останется сохранённым.'))return;
  try{
    const next={...s,project_id:null};
    const changesObj={...(row.changes||{}),snapshot:{old:s,new:next},project_id:{old:projectId||s.project_id||null,new:null}};
    const actor=(typeof session!=='undefined'&&session?.name)?session.name:'';
    if(actor)changesObj._actor=actor;
    const {error}=await sb.from('audit_log').update({
      entity_name:'Договор № '+(s.number||'без номера'),
      action:'update',
      changes:changesObj,
      created_at:new Date().toISOString()
    }).eq('id',row.id);
    if(error)throw error;
    showToast('Договор откреплён. Он остался в сохранённых договорах.');
    await queryContractHistory();
    if(projectId)await renderProjectContractList(projectId);
    if(typeof currentObjectId!=='undefined'&&currentObjectId===projectId)await renderObjectDocuments(projectId);
  }catch(e){console.error(e);showToast('Не удалось открепить договор');}
}
async function detachKpFromProject(kpId,projectId){
  const kp=(state?.kpForms||[]).find(k=>k.id===kpId);
  if(!kp)return;
  if(!confirm('Открепить это КП от проекта? Само КП останется в сохранённых.'))return;
  try{
    const {error}=await sb.from('kp_forms').update({project_id:null,updated_at:new Date().toISOString()}).eq('id',kpId);
    if(error)throw error;
    showToast('КП откреплено. Оно осталось в сохранённых КП.');
    await loadAll();
    if(projectId){
      renderKpListForProject(projectId);
      refreshProjectKpAttachSelect(projectId);
      if(typeof currentObjectId!=='undefined'&&currentObjectId===projectId)await renderObjectDocuments(projectId);
    }
  }catch(e){console.error(e);showToast('Не удалось открепить КП');}
}
window.detachKpFromProject=detachKpFromProject;
window.detachContractFromProject=detachContractFromProject;

async function renderProjectContractList(projectId){
  const list=$('pf-contract-list'); if(!list) return;
  await queryContractHistory();
  const rows=latestContractRowsForProject(projectId);
  if(!rows.length){list.innerHTML='<div class="empty-state">Договор пока не прикреплён</div>';return;}
  list.innerHTML=rows.map(r=>{const s=contractRowSnapshot(r)||{};return `<div class="list-item"><div style="flex:1"><div class="li-name">Договор № ${escDoc(s.number||'без номера')}</div><div class="li-meta">${escDoc(contractLabel(s.contract_type))} · ${escDoc(s.client_name||'Без заказчика')}</div></div><div class="li-actions"><button type="button" class="icon-btn" data-open-contract-id="${escDoc(r.id)}" title="Открыть">✏️</button><button type="button" class="icon-btn" data-detach-project-contract-id="${escDoc(r.id)}" title="Открепить от проекта">🔗</button></div></div>`;}).join('');
}
function openContractsForProject(projectId){
  documentReturnContext=currentDocumentOrigin(projectId);
  linkedDocumentProjectId=projectId;
  if($('projectSheetOverlay')?.classList.contains('active') && typeof closeProjectSheet==='function') closeProjectSheet();
  openContractsView();
  setTimeout(()=>{
    const sel=$('ct-project'); if(sel){sel.value=projectId;sel.dispatchEvent(new Event('change',{bubbles:true}));}
    editingContractId=null;
    if(contractView) contractView.dataset.dirty='0';
  },0);
}
function openContractHistoryFromAnywhere(rowId){
  const row=contractHistoryRows.find(r=>String(r.id)===String(rowId));
  const snap=contractRowSnapshot(row)||{};
  const sourceProject=(typeof editingProjectId!=='undefined'&&editingProjectId) || (typeof currentObjectId!=='undefined'&&currentObjectId) || snap.project_id || null;
  if(sourceProject){
    documentReturnContext=currentDocumentOrigin(sourceProject);
    linkedDocumentProjectId=sourceProject;
  }
  if($('projectSheetOverlay')?.classList.contains('active') && typeof closeProjectSheet==='function') closeProjectSheet();
  openContractsView();
  setTimeout(()=>loadContractVersion(rowId),0);
}

function refreshKpProjectSelect(){
  const sel=$('kp-project-link'); if(!sel) return;
  const current=(typeof editingKpProjectId!=='undefined'&&editingKpProjectId)||'';
  sel.innerHTML='<option value="">— без привязки —</option>'+((state?.projects||[]).filter(p=>!p.deleted_at).map(p=>`<option value="${escDoc(p.id)}">${escDoc(p.name)}</option>`).join(''));
  sel.value=current||'';
}
async function attachKpToCurrentProject(){
  const select=$('pf-kp-attach-select'); if(!select||!editingProjectId||!select.value) return;
  try{
    const {error}=await sb.from('kp_forms').update({project_id:editingProjectId,updated_at:new Date().toISOString()}).eq('id',select.value);
    if(error)throw error;
    showToast('КП прикреплено к проекту');
    await loadAll();
    renderKpListForProject(editingProjectId);
    refreshProjectKpAttachSelect(editingProjectId);
  }catch(e){console.error(e);showToast('Не удалось прикрепить КП');}
}
function refreshProjectKpAttachSelect(projectId){
  const sel=$('pf-kp-attach-select');if(!sel)return;
  const free=(state?.kpForms||[]).filter(k=>!k.project_id);
  sel.innerHTML='<option value="">— выбрать сохранённое КП —</option>'+free.map(k=>`<option value="${escDoc(k.id)}">${escDoc(k.client_name||k.object||'КП')} · ${escDoc(typeof fmtDate==='function'?fmtDate(k.kp_date):k.kp_date||'')}</option>`).join('');
}
async function renderObjectDocuments(projectId){
  const box=$('objDocumentsContent'); if(!box) return;
  await queryContractHistory();
  const contracts=latestContractRowsForProject(projectId);
  const kps=(state?.kpForms||[]).filter(k=>k.project_id===projectId);
  const cHtml=contracts.length?contracts.map(r=>{const s=contractRowSnapshot(r)||{};return `<div class="list-item"><div style="flex:1"><div class="li-name">Договор № ${escDoc(s.number||'без номера')}</div><div class="li-meta">${escDoc(s.client_name||'Без заказчика')}</div></div><div class="li-actions"><button class="icon-btn" type="button" data-object-contract-id="${escDoc(r.id)}" title="Открыть">✏️</button><button class="icon-btn" type="button" data-object-detach-contract-id="${escDoc(r.id)}" title="Открепить">🔗</button></div></div>`;}).join(''):'<div class="empty-state">Договоров нет</div>';
  const kHtml=kps.length?kps.map(k=>`<div class="list-item"><div style="flex:1"><div class="li-name">КП · ${escDoc(k.client_name||'Без имени')}</div><div class="li-meta">${escDoc(typeof fmtDate==='function'?fmtDate(k.kp_date):k.kp_date||'')} · ${escDoc(typeof fmtMoney==='function'?fmtMoney(kpRowSummary(k)):kpRowSummary(k))}</div></div><div class="li-actions"><button class="icon-btn" type="button" data-object-kp-id="${escDoc(k.id)}" title="Открыть">✏️</button><button class="icon-btn" type="button" data-object-detach-kp-id="${escDoc(k.id)}" title="Открепить">🔗</button></div></div>`).join(''):'<div class="empty-state">КП нет</div>';
  box.innerHTML=`<div class="project-eyebrow">Договоры</div>${cHtml}<div class="project-eyebrow" style="margin-top:12px">Коммерческие предложения</div>${kHtml}<div class="btn-row" style="margin-top:10px"><button class="btn btn-secondary" type="button" id="objNewContractBtn">+ Договор</button><button class="btn btn-secondary" type="button" id="objNewKpBtn">+ КП</button></div><button class="btn btn-secondary" type="button" id="objDownloadPriceBtn" style="margin-top:8px">Скачать прайс по направлению</button>`;
  $('objNewContractBtn')?.addEventListener('click',()=>openContractsForProject(projectId));
  $('objNewKpBtn')?.addEventListener('click',()=>openKpViewForProject(projectId));
  $('objDownloadPriceBtn')?.addEventListener('click',()=>window.openPriceListSheet?.(projectId));
}

// Inject contract history/actions.
const contractView=$('view-contracts');
if(contractView){
  const typeLabel=contractView.querySelector('.section-label');
  if(typeLabel){
    const historyLabel=document.createElement('div');historyLabel.className='section-label';historyLabel.innerHTML='<span class="lbl-text">Сохранённые договоры</span><span class="section-label-line"></span>';
    const search=document.createElement('div');search.className='search-box';search.innerHTML='<input type="text" id="ct-history-search" placeholder="Поиск по номеру, клиенту, объекту или проекту"><button class="search-clear" id="ct-history-searchClear" type="button">✕</button>';
    const historyCard=document.createElement('div');historyCard.id='ct-history-list';historyCard.className='card';historyCard.style.marginBottom='8px';
    const newBtn=document.createElement('button');newBtn.type='button';newBtn.id='ct-new';newBtn.className='btn btn-secondary';newBtn.style.marginBottom='12px';newBtn.textContent='+ Новый договор';
    contractView.insertBefore(historyLabel,typeLabel);contractView.insertBefore(search,typeLabel);contractView.insertBefore(historyCard,typeLabel);contractView.insertBefore(newBtn,typeLabel);
    const searchInput=$('ct-history-search'), searchClear=$('ct-history-searchClear');
    const syncSearch=()=>{contractSearchQuery=searchInput?.value||'';search?.classList.toggle('has-value',!!contractSearchQuery);renderContractHistory();};
    searchInput?.addEventListener('input',syncSearch);
    searchClear?.addEventListener('click',()=>{searchInput.value='';syncSearch();searchInput.focus();});
  }
  const pdf=$('ct-export-pdf');
  if(pdf){
    pdf.textContent='Скачать PDF';
    const save=document.createElement('button');save.type='button';save.id='ct-save-history';save.className='btn btn-primary';save.style.marginBottom='8px';save.textContent='Сохранить договор';
    const word=document.createElement('button');word.type='button';word.id='ct-export-word';word.className='btn btn-secondary';word.style.marginBottom='8px';word.textContent='Скачать Word';
    const del=document.createElement('button');del.type='button';del.id='ct-delete-contract';del.className='btn btn-danger';del.style.marginTop='8px';del.textContent='Удалить договор';
    pdf.parentNode.insertBefore(save,pdf);pdf.parentNode.insertBefore(word,pdf);pdf.parentNode.insertBefore(del,pdf.nextSibling);
    del.addEventListener('click',async()=>{
      if(!editingContractId){showToast('Сначала откройте сохранённый договор');return;}
      await queryContractHistory();
      const row=contractHistoryRows.find(r=>r.entity_id===editingContractId);
      if(!row){showToast('Сохранённый договор не найден');return;}
      deleteSavedContract(row.id);
    });
  }
  $('ct-history-list')?.addEventListener('click',e=>{
    const del=e.target.closest('[data-delete-contract-row]');
    if(del){ e.stopPropagation(); deleteSavedContract(del.dataset.deleteContractRow); return; }
    const b=e.target.closest('[data-contract-history-id]');
    if(b) loadContractVersion(b.dataset.contractHistoryId);
  });
  $('ct-new')?.addEventListener('click',newContractDraft);
  $('ct-save-history')?.addEventListener('click',saveContractVersion);
  $('ct-export-word')?.addEventListener('click',exportContractToWord);
}

// Inject contracts + existing-KP attachment into the project Documents tab.
const kpList=$('pf-kp-list');
if(kpList && !$('pf-contract-list')){
  const kpBtn=$('pf-create-kp');
  const attach=document.createElement('div');attach.className='card';attach.style.margin='8px 0 0';
  attach.innerHTML='<div class="field" style="margin-bottom:8px"><label>Прикрепить сохранённое КП</label><select id="pf-kp-attach-select"><option value="">— выбрать сохранённое КП —</option></select></div><button type="button" class="btn btn-secondary" id="pf-kp-attach-btn">Прикрепить КП</button>';
  kpBtn?.after(attach);
  const label=document.createElement('div');label.className='section-label';label.style.margin='18px 0 10px';label.innerHTML='<span class="lbl-text">Договоры</span><span class="section-label-line"></span>';
  const list=document.createElement('div');list.id='pf-contract-list';list.className='card';list.style.marginBottom='8px';
  const btn=document.createElement('button');btn.type='button';btn.id='pf-create-contract';btn.className='btn btn-secondary';btn.textContent='+ Создать / прикрепить договор';
  attach.after(label,list,btn);
  $('pf-kp-attach-btn')?.addEventListener('click',attachKpToCurrentProject);
  list.addEventListener('click',e=>{
    const detach=e.target.closest('[data-detach-project-contract-id]');
    if(detach){detachContractFromProject(detach.dataset.detachProjectContractId,editingProjectId);return;}
    const b=e.target.closest('[data-open-contract-id]');
    if(b)openContractHistoryFromAnywhere(b.dataset.openContractId);
  });
  btn.addEventListener('click',()=>{if(editingProjectId)openContractsForProject(editingProjectId);});
}

// Inject project linkage into KP editor.
const kpNew=$('kpNewBtn');
if(kpNew && !$('kp-saved-search')){
  const kpSaved=$('kpSavedList');
  if(kpSaved){
    const kpSearch=document.createElement('div');
    kpSearch.className='search-box';
    kpSearch.innerHTML='<input type="text" id="kp-saved-search" placeholder="Поиск КП по клиенту, объекту или проекту"><button class="search-clear" id="kp-saved-searchClear" type="button">✕</button>';
    kpSaved.before(kpSearch);
    const applyKpSearch=()=>{
      const q=($('kp-saved-search')?.value||'').trim().toLowerCase();
      kpSearch.classList.toggle('has-value',!!q);
      kpSaved.querySelectorAll('.list-item').forEach(row=>{row.style.display=!q||row.textContent.toLowerCase().includes(q)?'':'none';});
    };
    $('kp-saved-search')?.addEventListener('input',applyKpSearch);
    $('kp-saved-searchClear')?.addEventListener('click',()=>{$('kp-saved-search').value='';applyKpSearch();$('kp-saved-search').focus();});
    window.__applyKpSavedSearch=applyKpSearch;
  }
}
if(kpNew && !$('kp-project-link')){
  const label=document.createElement('div');label.className='section-label';label.innerHTML='<span class="lbl-text">Привязка к проекту / объекту</span><span class="section-label-line"></span>';
  const card=document.createElement('div');card.className='card';card.innerHTML='<div class="field" style="margin-bottom:0"><label>Карточка проекта или объекта</label><select id="kp-project-link"><option value="">— без привязки —</option></select><div class="hint" style="margin-top:6px">После сохранения КП появится в разделе «Документы» выбранной карточки.</div></div>';
  kpNew.after(label,card);
  $('kp-project-link').addEventListener('change',e=>{editingKpProjectId=e.target.value||null;});
}

// Inject documents into construction object card.
const objSummary=$('objSummary');
if(objSummary && !$('objDocumentsContent')){
  const label=document.createElement('div');label.className='section-label';label.style.marginTop='14px';label.innerHTML='<span class="lbl-text">Документы</span><span class="section-label-line"></span>';
  const box=document.createElement('div');box.id='objDocumentsContent';box.className='card';
  objSummary.after(label,box);
  box.addEventListener('click',e=>{
    const dc=e.target.closest('[data-object-detach-contract-id]');
    if(dc){detachContractFromProject(dc.dataset.objectDetachContractId,typeof currentObjectId!=='undefined'?currentObjectId:null);return;}
    const dk=e.target.closest('[data-object-detach-kp-id]');
    if(dk){detachKpFromProject(dk.dataset.objectDetachKpId,typeof currentObjectId!=='undefined'?currentObjectId:null);return;}
    const c=e.target.closest('[data-object-contract-id]');if(c){openContractHistoryFromAnywhere(c.dataset.objectContractId);return;}
    const k=e.target.closest('[data-object-kp-id]');if(k){loadKpFormById(k.dataset.objectKpId);}
  });
}

// Wrap existing flows so the new document UI stays in sync.
if(typeof openContractsView==='function'){
  const old=openContractsView;
  openContractsView=function(){
    const r=old.apply(this,arguments);
    editingContractId=null;
    if(!linkedDocumentProjectId) newContractDraft();
    renderContractHistory();
    if(contractView) contractView.dataset.dirty='0';
    return r;
  };
}
if(typeof openProjectSheet==='function'){
  const old=openProjectSheet;
  openProjectSheet=function(id){old.apply(this,arguments);if(id){renderProjectContractList(id);refreshProjectKpAttachSelect(id);}else{if($('pf-contract-list'))$('pf-contract-list').innerHTML='<div class="empty-state">Сохраните проект, чтобы прикреплять договоры</div>';refreshProjectKpAttachSelect('');}};
}
if(typeof openObjectView==='function'){
  const old=openObjectView;
  openObjectView=function(id){const r=old.apply(this,arguments);setTimeout(()=>renderObjectDocuments(id),0);return r;};
}
if(typeof openKpView==='function'){
  const old=openKpView;
  openKpView=function(){const r=old.apply(this,arguments);refreshKpProjectSelect();if($('view-kp'))$('view-kp').dataset.dirty='0';setTimeout(()=>window.__applyKpSavedSearch?.(),0);return r;};
}
if(typeof loadKpForm==='function'){
  const old=loadKpForm;
  loadKpForm=function(kp){const r=old.apply(this,arguments);refreshKpProjectSelect();if($('kp-project-link'))$('kp-project-link').value=kp?.project_id||'';return r;};
}
if(typeof resetKpForm==='function'){
  const old=resetKpForm;
  resetKpForm=function(){
    const keep=linkedDocumentProjectId||null;
    const r=old.apply(this,arguments);
    if(keep) editingKpProjectId=keep;
    refreshKpProjectSelect();
    if($('kp-project-link'))$('kp-project-link').value=keep||'';
    if(keep){
      const p=(state?.projects||[]).find(x=>x.id===keep);
      if(p){
        if($('kp-client-name'))$('kp-client-name').value=p.client_name||'';
        if($('kp-client-phone'))$('kp-client-phone').value=p.phone||'';
        if($('kp-object'))$('kp-object').value=p.address||p.name||'';
      }
    }
    if($('view-kp'))$('view-kp').dataset.dirty='0';
    return r;
  };
}
if(typeof saveKpForm==='function'){
  const old=saveKpForm;
  saveKpForm=async function(){
    if($('kp-project-link'))editingKpProjectId=$('kp-project-link').value||null;
    const r=await old.apply(this,arguments);
    if($('view-kp'))$('view-kp').dataset.dirty='0';
    if(editingKpProjectId){renderKpListForProject(editingKpProjectId);if(typeof currentObjectId!=='undefined'&&currentObjectId===editingKpProjectId)renderObjectDocuments(editingKpProjectId);}
    setTimeout(()=>window.__applyKpSavedSearch?.(),0);
    return r;
  };
}

// Existing addEventListener bindings in index.html keep the original function reference,
 // so refresh the enhanced UI explicitly after those legacy handlers run.
 $('openContractsBtn')?.addEventListener('click',()=>{documentReturnContext=null;linkedDocumentProjectId=null;setTimeout(()=>{newContractDraft();renderContractHistory();},0);});
 $('kpNewBtn')?.addEventListener('click',()=>setTimeout(()=>{const keep=linkedDocumentProjectId||null;if(keep)editingKpProjectId=keep;refreshKpProjectSelect();if($('kp-project-link'))$('kp-project-link').value=keep||'';},0));
 $('openKpBtn')?.addEventListener('click',()=>{documentReturnContext=null;linkedDocumentProjectId=null;setTimeout(()=>{resetKpForm();refreshKpProjectSelect();},0);});

 // Existing index.html back handlers always go to «Ещё». Capture the click first
 // so documents opened from a project/object return to the same place.
 ['contractsBack','kpBack'].forEach(id=>{
   $(id)?.addEventListener('click',e=>{
     if(documentReturnContext){
       e.preventDefault();e.stopImmediatePropagation();
       returnFromDocumentView();
     }
   },true);
 });

 // Remember where KP was opened from, including the construction object view.
 if(typeof openKpViewForProject==='function'){
   const originalOpenKpForProject=openKpViewForProject;
   openKpViewForProject=function(projectId){
     documentReturnContext=currentDocumentOrigin(projectId);
     linkedDocumentProjectId=projectId;
     return originalOpenKpForProject.apply(this,arguments);
   };
 }
 if(typeof loadKpFormById==='function'){
   const originalLoadKpById=loadKpFormById;
   loadKpFormById=function(id){
     const kp=(state?.kpForms||[]).find(k=>k.id===id);
     const sourceProject=(typeof editingProjectId!=='undefined'&&editingProjectId) || (typeof currentObjectId!=='undefined'&&currentObjectId) || kp?.project_id || null;
     if(sourceProject){documentReturnContext=currentDocumentOrigin(sourceProject);linkedDocumentProjectId=sourceProject;}
     return originalLoadKpById.apply(this,arguments);
   };
 }

 window.openContractsForProject=openContractsForProject;
 window.renderProjectContractList=renderProjectContractList;
 window.exportContractToWord=exportContractToWord;
})();


// ===== Client-facing price list export =====
(()=>{
'use strict';
if(window.__arhittekPriceListInstalled) return;
window.__arhittekPriceListInstalled=true;

const $=id=>document.getElementById(id);
const esc=v=>{try{return escapeHtml(String(v??''));}catch(e){return String(v??'');}};
let priceProjectId=null;
let priceMode='all';
let selectedPriceGroups=new Set();
let selectedPriceItems=new Set();

function allPriceGroups(){
  try{return (kpCatalogGrouped()||[]).filter(g=>g?.items?.length);}
  catch(e){return [];}
}
function itemKey(groupName,item,index){
  return String(groupName)+'::'+String(item.id||item.name||index);
}
function priceGroupForProject(projectId){
  const p=(state.projects||[]).find(x=>x.id===projectId);
  if(!p) return null;
  const cat=(typeof findCategory==='function'?findCategory(p.category_id):null);
  const name=String(cat?.name||'').toLowerCase();
  const groups=allPriceGroups();
  const tests=[];
  if(name.includes('интерьер')) tests.push('интерьер');
  if(name.includes('архитект')) tests.push('архитект');
  if(name.includes('ландшафт')) tests.push('ландшафт');
  if(name.includes('мебел')) tests.push('мебел');
  if(name.includes('строит')||name.includes('ремонт')||name.includes('монтаж')) tests.push('строит','ремонт');
  tests.push(...name.split(/\s+/).filter(x=>x.length>4));
  return groups.find(g=>tests.some(t=>String(g.group||'').toLowerCase().includes(t))) || null;
}
function filteredPriceGroups(){
  const groups=allPriceGroups();
  if(priceMode==='all') return groups;
  if(priceMode==='group'){
    return groups.filter(g=>selectedPriceGroups.has(g.group));
  }
  return groups.map(g=>({
    group:g.group,
    items:g.items.filter((it,i)=>selectedPriceItems.has(itemKey(g.group,it,i)))
  })).filter(g=>g.items.length);
}
function ensurePriceSheet(){
  let o=$('priceListSheetOverlay');
  if(o) return o;
  o=document.createElement('div');
  o.className='sheet-overlay';
  o.id='priceListSheetOverlay';
  o.innerHTML=`
    <div class="sheet" style="max-width:640px">
      <div class="sheet-handle"></div>
      <div class="sheet-title">
        <span>Скачать прайс для клиента</span>
        <button class="sheet-close" id="priceListClose" type="button">✕</button>
      </div>
      <div class="field">
        <label>Что скачать</label>
        <div class="yn-group" id="priceListMode" style="flex-wrap:wrap">
          <div class="yn-btn selected" data-value="all" style="flex-basis:31%">Весь прайс</div>
          <div class="yn-btn" data-value="group" style="flex-basis:31%">Направление</div>
          <div class="yn-btn" data-value="custom" style="flex-basis:31%">Выбрать услуги</div>
        </div>
      </div>
      <div id="priceProjectHint" class="note" style="display:none;margin-bottom:10px"></div>
      <div id="priceGroupBox" class="card" style="display:none;margin-bottom:10px"></div>
      <div id="priceCustomBox" class="card" style="display:none;margin-bottom:10px;max-height:340px;overflow:auto"></div>
      <div class="field">
        <label>Заголовок для клиента</label>
        <input id="priceListTitle" type="text" value="Прайс-лист услуг ARHITTEK">
      </div>
      <label style="display:flex;align-items:flex-start;gap:9px;margin:4px 0 14px;font-size:12px;color:var(--text-dim)">
        <input id="priceIncludeDesc" type="checkbox" checked style="width:auto;margin-top:2px">
        <span>Показывать краткое описание того, что входит в услугу</span>
      </label>
      <div class="btn-row">
        <button class="btn btn-primary" id="priceDownloadPdf" type="button">Скачать PDF</button>
        <button class="btn btn-secondary" id="priceDownloadXlsx" type="button">Скачать Excel</button>
      </div>
    </div>`;
  document.body.appendChild(o);
  $('priceListClose').onclick=()=>o.classList.remove('active');
  $('priceListMode').addEventListener('click',e=>{
    const b=e.target.closest('[data-value]');if(!b)return;
    priceMode=b.dataset.value;
    $('priceListMode').querySelectorAll('.yn-btn').forEach(x=>x.classList.toggle('selected',x===b));
    renderPricePicker();
  });
  $('priceDownloadPdf').onclick=exportPricePdf;
  $('priceDownloadXlsx').onclick=exportPriceXlsx;
  return o;
}
function renderPricePicker(){
  const groups=allPriceGroups();
  const gb=$('priceGroupBox'), cb=$('priceCustomBox');
  if(!gb||!cb) return;

  gb.style.display=priceMode==='group'?'':'none';
  cb.style.display=priceMode==='custom'?'':'none';

  if(priceMode==='group'){
    gb.innerHTML=groups.map(g=>`
      <label class="list-item" style="cursor:pointer">
        <div><div class="li-name">${esc(g.group)}</div><div class="li-meta">${g.items.length} услуг</div></div>
        <input type="radio" name="priceGroupChoice" value="${esc(g.group)}" ${selectedPriceGroups.has(g.group)?'checked':''} style="width:auto">
      </label>`).join('');
    gb.querySelectorAll('input[name="priceGroupChoice"]').forEach(r=>r.addEventListener('change',()=>{
      selectedPriceGroups=new Set([r.value]);
    }));
  }

  if(priceMode==='custom'){
    cb.innerHTML=groups.map(g=>`
      <div class="project-eyebrow" style="margin:10px 0 5px">${esc(g.group)}</div>
      ${g.items.map((it,i)=>{
        const key=itemKey(g.group,it,i);
        return `<label class="list-item" style="cursor:pointer">
          <div style="min-width:0"><div class="li-name">${esc(it.name)}</div><div class="li-meta">${Number(it.rate||0).toLocaleString('ru-RU')} ₽ / ${esc(it.unit||'м²')}</div></div>
          <input type="checkbox" data-price-key="${esc(key)}" ${selectedPriceItems.has(key)?'checked':''} style="width:auto">
        </label>`;
      }).join('')}`).join('');
    cb.querySelectorAll('[data-price-key]').forEach(ch=>ch.addEventListener('change',()=>{
      if(ch.checked) selectedPriceItems.add(ch.dataset.priceKey);
      else selectedPriceItems.delete(ch.dataset.priceKey);
    }));
  }
}
function openPriceListSheet(projectId=null){
  priceProjectId=projectId||null;
  const groups=allPriceGroups();
  selectedPriceGroups=new Set();
  selectedPriceItems=new Set();
  priceMode='all';

  const matched=projectId?priceGroupForProject(projectId):null;
  if(matched){
    priceMode='group';
    selectedPriceGroups.add(matched.group);
  }else if(groups.length){
    selectedPriceGroups.add(groups[0].group);
  }

  const o=ensurePriceSheet();
  $('priceListMode').querySelectorAll('.yn-btn').forEach(x=>x.classList.toggle('selected',x.dataset.value===priceMode));
  const hint=$('priceProjectHint');
  if(projectId){
    const p=(state.projects||[]).find(x=>x.id===projectId);
    if(matched){
      hint.style.display='';
      hint.textContent='Для проекта «'+(p?.name||'')+'» автоматически выбрано направление: '+matched.group+'. При необходимости можно выбрать другой режим.';
    }else{
      hint.style.display='';
      hint.textContent='Для этого проекта не удалось однозначно определить направление. Выберите нужный раздел прайса вручную.';
    }
  }else hint.style.display='none';

  renderPricePicker();
  o.classList.add('active');
}
function priceSelectionOrWarn(){
  const groups=filteredPriceGroups();
  if(!groups.length){
    showToast(priceMode==='custom'?'Выберите хотя бы одну услугу':'Выберите направление прайса');
    return null;
  }
  return groups;
}
function priceSafeName(groups,ext){
  let tag='ves-prays';
  if(priceMode==='group'&&groups.length===1) tag=groups[0].group;
  else if(priceMode==='custom') tag='vybrannye-uslugi';
  tag=String(tag).replace(/[^a-zA-Zа-яА-Я0-9_-]+/g,'_').replace(/^_+|_+$/g,'');
  return 'ARHITTEK-Price-'+tag+'-'+new Date().toISOString().slice(0,10)+'.'+ext;
}
function exportPricePdf(){
  const groups=priceSelectionOrWarn(); if(!groups)return;
  const {jsPDF}=window.jspdf||{};
  if(!jsPDF){showToast('PDF-модуль не загружен');return;}
  const doc=new jsPDF({unit:'mm',format:'a4'});
  registerPdfFonts(doc);
  const pageW=doc.internal.pageSize.getWidth(), margin=15, blue=[69,134,236];
  const title=($('priceListTitle')?.value||'Прайс-лист услуг ARHITTEK').trim();
  const includeDesc=!!$('priceIncludeDesc')?.checked;

  const logoSize=14;
  try{doc.addImage(ARHITTEK_LOGO_B64,'PNG',margin,10,logoSize,logoSize*(87/100));}catch(e){}
  const tx=margin+logoSize+4;
  doc.setFont('Roboto','bold');doc.setFontSize(18);doc.setTextColor(0);doc.text('ARHIT',tx,19);
  const w=doc.getTextWidth('ARHIT');doc.setTextColor(...blue);doc.text('TEK',tx+w,19);
  doc.setTextColor(0);doc.setFont('Roboto','normal');doc.setFontSize(11);doc.text(title,tx,26);
  doc.setFontSize(8.5);doc.setTextColor(120);doc.text('Актуально на '+fmtDate(new Date().toISOString().slice(0,10)),pageW-margin,19,{align:'right'});
  doc.setTextColor(0);
  let y=37;

  groups.forEach((g,gi)=>{
    if(y>250){doc.addPage();y=18;}
    doc.setFillColor(...blue);doc.roundedRect(margin,y-5,pageW-margin*2,9,1.5,1.5,'F');
    doc.setFont('Roboto','bold');doc.setFontSize(10);doc.setTextColor(255);doc.text(String(g.group).toUpperCase(),margin+3,y+0.5);
    doc.setTextColor(0);y+=8;

    const rows=g.items.map(it=>[
      it.name||'Услуга',
      Number(it.rate||0).toLocaleString('ru-RU')+' ₽',
      it.unit||'м²'
    ]);
    doc.autoTable({
      startY:y,
      head:[['Услуга','Стоимость','Ед.']],
      body:rows,
      theme:'grid',
      headStyles:{fillColor:[240,244,250],textColor:[35,44,60],font:'Roboto',fontStyle:'bold'},
      styles:{font:'Roboto',fontSize:9,cellPadding:3,textColor:[35,44,60]},
      columnStyles:{1:{cellWidth:32,halign:'right'},2:{cellWidth:18,halign:'center'}},
      margin:{left:margin,right:margin}
    });
    y=doc.lastAutoTable.finalY+4;

    if(includeDesc){
      doc.setFont('Roboto','normal');doc.setFontSize(8);doc.setTextColor(90);
      for(const it of g.items){
        if(!it.desc)continue;
        if(y>270){doc.addPage();y=18;}
        doc.setFont('Roboto','bold');doc.setTextColor(45);doc.text(it.name,margin,y);y+=4;
        doc.setFont('Roboto','normal');doc.setTextColor(100);
        const lines=doc.splitTextToSize(it.desc,pageW-margin*2);
        lines.forEach(line=>{if(y>276){doc.addPage();y=18;}doc.text(line,margin,y);y+=3.8;});
        y+=2;
      }
      doc.setTextColor(0);
    }
    if(gi<groups.length-1)y+=4;
  });

  if(y>265){doc.addPage();y=20;}
  doc.setDrawColor(210);doc.line(margin,y,pageW-margin,y);y+=6;
  doc.setFont('Roboto','normal');doc.setFontSize(8);doc.setTextColor(105);
  doc.text('Стоимость указана по действующему прайсу и может уточняться после изучения объекта и технического задания.',margin,y);y+=4.5;
  doc.text('ARHITTEK — архитектура · дизайн интерьера · строительство под ключ',margin,y);y+=4.5;
  const ci=state.companyInfo||{};
  const contacts=[ci.phone,ci.email,ci.website].filter(Boolean).join(' · ');
  if(contacts)doc.text(contacts,margin,y);

  doc.save(priceSafeName(groups,'pdf'));
  showToast('Прайс PDF скачивается...');
}
function exportPriceXlsx(){
  const groups=priceSelectionOrWarn(); if(!groups)return;
  if(typeof XLSX==='undefined'){showToast('Excel-модуль не загружен');return;}
  const rows=[['ARHITTEK — прайс-лист услуг'],['Актуально на',fmtDate(new Date().toISOString().slice(0,10))],[]];
  groups.forEach(g=>{
    rows.push([g.group]);
    rows.push(['Услуга','Стоимость, ₽','Единица','Что входит']);
    g.items.forEach(it=>rows.push([it.name,Number(it.rate)||0,it.unit||'м²',$('priceIncludeDesc')?.checked?(it.desc||''):'']));
    rows.push([]);
  });
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:42},{wch:16},{wch:12},{wch:80}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Прайс');
  XLSX.writeFile(wb,priceSafeName(groups,'xlsx'));
  showToast('Прайс Excel скачивается...');
}

window.openPriceListSheet=openPriceListSheet;

// Main entry point: Studio Tools.

const studioGrid=document.querySelector('#view-more .premium-tool-grid') || document.querySelector('#view-more > div[style*="display:grid"]');
if(studioGrid && !$('openPriceListBtn')){
  const b=document.createElement('button');
  b.id='openPriceListBtn';b.type='button';b.className='btn btn-primary';b.textContent='Прайс для клиента';
  studioGrid.appendChild(b);
  b.dataset.priceListToolFallback='1';
}
$('openPriceListBtn')?.addEventListener('click',()=>openPriceListSheet()); // price-list-tool-fallback


// KP workspace: quick access while talking to a potential client.
const kpNew=$('kpNewBtn');
if(kpNew && !$('kpPriceListBtn')){
  const btn=document.createElement('button');
  btn.className='btn btn-secondary';
  btn.id='kpPriceListBtn';
  btn.type='button';
  btn.style.marginBottom='10px';
  btn.textContent='Скачать прайс';
  kpNew.after(btn);
  btn.addEventListener('click',()=>openPriceListSheet(typeof editingKpProjectId!=='undefined'?editingKpProjectId:null));
}

// Project card / object: one-click relevant price list.
const projectContractBtn=$('pf-create-contract');
if(projectContractBtn && !$('pf-download-price')){
  const btn=document.createElement('button');
  btn.className='btn btn-secondary';
  btn.id='pf-download-price';
  btn.type='button';
  btn.style.marginTop='8px';
  btn.textContent='Скачать прайс по направлению';
  projectContractBtn.after(btn);
  btn.addEventListener('click',()=>{if(typeof editingProjectId!=='undefined'&&editingProjectId)openPriceListSheet(editingProjectId);});
}

const objectDocs=$('objDocumentsContent');
if(objectDocs){
  objectDocs.addEventListener('click',e=>{
    const b=e.target.closest?.('#objDownloadPriceBtn');
    if(b&&typeof currentObjectId!=='undefined'&&currentObjectId)openPriceListSheet(currentObjectId);
  });
}
const oldRenderObjectDocs=window.renderObjectDocuments;
if(typeof oldRenderObjectDocs==='function'){
  window.renderObjectDocuments=async function(projectId){
    const r=await oldRenderObjectDocs.apply(this,arguments);
    const box=$('objDocumentsContent');
    if(box&&!$('objDownloadPriceBtn')){
      const actions=box.querySelector('.btn-row');
      if(actions){
        const b=document.createElement('button');
        b.className='btn btn-secondary';b.type='button';b.id='objDownloadPriceBtn';b.textContent='Прайс по направлению';
        actions.append(b);
      }
    }
    return r;
  };
}
})();


// ===== Preserve current screen across page refresh =====
(()=>{
'use strict';
if(window.__arhittekRoutePersistenceInstalled) return;
window.__arhittekRoutePersistenceInstalled=true;

const ROUTE_KEY='arhittek_ui_route_v1';
let restoring=true;
let restored=false;
let saveTimer=null;

function readRoute(){
  try{return JSON.parse(sessionStorage.getItem(ROUTE_KEY)||'null');}catch(e){return null;}
}
const bootRoute=readRoute();

function activeViewId(){
  return document.querySelector('.view.active')?.id || 'view-overview';
}
function projectTab(){
  return document.querySelector('#projectSheetOverlay.active .project-tabs button[aria-selected="true"]')?.dataset.tab || null;
}
function routeSnapshot(){
  const view=activeViewId();
  return {
    employeeId:(typeof session!=='undefined'&&session?.employeeId)||window.session?.employeeId||null,
    view,
    objectId:view==='view-object' && typeof currentObjectId!=='undefined' ? currentObjectId : null,
    objectTab:view==='view-object' && typeof activeObjTab!=='undefined' ? activeObjTab : null,
    projectId:document.getElementById('projectSheetOverlay')?.classList.contains('active') && typeof editingProjectId!=='undefined' ? editingProjectId : null,
    projectTab:projectTab(),
    scrollY:Math.max(0,Math.round(window.scrollY||0)),
    at:Date.now()
  };
}
function saveRouteNow(){
  if(restoring) return;
  try{sessionStorage.setItem(ROUTE_KEY,JSON.stringify(routeSnapshot()));}catch(e){}
}
function scheduleRouteSave(){
  if(restoring)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveRouteNow,100);
}
function canUseSavedRoute(r){
  if(!r||!r.view)return false;
  const sid=(typeof session!=='undefined'&&session?.employeeId)||window.session?.employeeId||null;
  if(!sid||!r.employeeId||sid!==r.employeeId)return false;
  if(r.view==='view-settings' && !(typeof session!=='undefined'&&session?.isAdmin))return false;
  return !!document.getElementById(r.view);
}
function showViewDirect(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  const nav=document.querySelector('.nav-btn[data-view="'+id+'"]');
  if(nav && nav.style.display!=='none') nav.classList.add('active');
}
function navAllowed(id){
  const nav=document.querySelector('.nav-btn[data-view="'+id+'"]');
  return !nav || nav.style.display!=='none';
}
function restoreRoute(r){
  if(!canUseSavedRoute(r)) return false;

  // Screens that need their own initialization.
  if(r.view==='view-object'){
    if(!r.objectId || !(state.projects||[]).some(p=>p.id===r.objectId))return false;
    openObjectView(r.objectId);
    if(r.objectTab && typeof activeObjTab!=='undefined'){
      activeObjTab=r.objectTab;
      try{renderObjTabs();renderObjTabContent();}catch(e){}
    }
  }else if(r.view==='view-kp'){
    if(typeof openKpView==='function')openKpView(); else showViewDirect(r.view);
  }else if(r.view==='view-contracts'){
    if(typeof openContractsView==='function')openContractsView(); else showViewDirect(r.view);
  }else if(r.view==='view-settings'){
    document.getElementById('settingsBtn')?.click();
  }else if(r.view==='view-company'){
    document.getElementById('openCompanyBtn')?.click();
  }else if(r.view==='view-timesheet'){
    document.getElementById('openTimesheetBtn')?.click();
  }else if(r.view==='view-cards'){
    const nav=document.querySelector('.nav-btn[data-view="view-cards"]');
    if(nav&&nav.style.display!=='none')nav.click();else showViewDirect(r.view);
  }else{
    if(!navAllowed(r.view))return false;
    const nav=document.querySelector('.nav-btn[data-view="'+r.view+'"]');
    if(nav&&nav.style.display!=='none')nav.click();else showViewDirect(r.view);
  }

  // Reopen a saved project card after the underlying screen is restored.
  if(r.projectId && (state.projects||[]).some(p=>p.id===r.projectId) && typeof openProjectSheet==='function'){
    openProjectSheet(r.projectId);
    if(r.projectTab){
      setTimeout(()=>{
        document.querySelector('#projectSheetOverlay .project-tabs button[data-tab="'+r.projectTab+'"]')?.click();
      },80);
    }
  }

  setTimeout(()=>window.scrollTo(0,Number(r.scrollY)||0),80);
  return true;
}

function attemptRestore(){
  if(restored)return;
  const login=document.getElementById('loginOverlay');
  const sid=(typeof session!=='undefined'&&session?.employeeId)||window.session?.employeeId||null;
  if(!sid || (login&&login.style.display!=='none'))return;

  // For object/project restoration wait until project data has arrived.
  const needsProject=bootRoute?.objectId||bootRoute?.projectId;
  if(needsProject && !(state.projects||[]).length)return;

  restored=true;
  const ok=restoreRoute(bootRoute);
  restoring=false;
  if(!ok) saveRouteNow();
}

// Observe every view switch and sheet open/close.
const viewObserver=new MutationObserver(()=>scheduleRouteSave());
document.querySelectorAll('.view').forEach(v=>viewObserver.observe(v,{attributes:true,attributeFilter:['class']}));
const projectOverlay=document.getElementById('projectSheetOverlay');
if(projectOverlay)viewObserver.observe(projectOverlay,{attributes:true,attributeFilter:['class']});

document.addEventListener('click',e=>{
  if(e.target.closest('.nav-btn,#objTabs,.project-tabs,#kpBack,#contractsBack,#settingsBack,#objBack'))setTimeout(scheduleRouteSave,0);
},true);
window.addEventListener('scroll',scheduleRouteSave,{passive:true});
window.addEventListener('beforeunload',()=>{if(!restoring)saveRouteNow();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!restoring)saveRouteNow();});

// loadAll can run after refresh, login, realtime and visibility changes.
// Restoring after it keeps the current screen instead of returning to Overview.
if(typeof loadAll==='function' && !loadAll.__routePersistence){
  const originalLoadAll=loadAll;
  loadAll=async function(){
    const r=await originalLoadAll.apply(this,arguments);
    setTimeout(attemptRestore,0);
    return r;
  };
  loadAll.__routePersistence=true;
}

// The first load may have started before premium.js was evaluated.
let tries=0;
const timer=setInterval(()=>{
  tries++;
  attemptRestore();
  if(restored||tries>50){
    clearInterval(timer);
    if(!restored){restoring=false;saveRouteNow();}
  }
},160);

window.__arhittekClearSavedRoute=()=>{try{sessionStorage.removeItem(ROUTE_KEY);}catch(e){}};
})();
// ===== UX safety: protect unsaved form edits =====
(()=>{
  const overlayIds=[
    'projectSheetOverlay','paymentSheetOverlay','empSheetOverlay','catSheetOverlay',
    'tariffSheetOverlay','companyExpenseSheetOverlay','companyIncomeSheetOverlay',
    'tzSheetOverlay','invoiceSheetOverlay','shareLinkOverlay','financeControlSheetOverlay'
  ];

  function visibleOverlay(el){
    if(!el) return false;
    return el.classList.contains('active') || (el.style.display && el.style.display!=='none');
  }
  function resetDirty(el){ if(el) el.dataset.dirty='0'; }
  function markDirtyFromEvent(e){
    const el=overlayIds.map(id=>document.getElementById(id)).find(o=>o&&o.contains(e.target)&&visibleOverlay(o));
    if(el && !e.target.matches('button')) el.dataset.dirty='1';
    const view=e.target.closest?.('#view-kp,#view-contracts');
    if(view && view.classList.contains('active') && !e.target.matches('button')) view.dataset.dirty='1';
  }
  document.addEventListener('input',markDirtyFromEvent,true);
  document.addEventListener('change',markDirtyFromEvent,true);

  // Reset when a sheet is freshly opened.
  const observer=new MutationObserver(records=>{
    records.forEach(r=>{
      const el=r.target;
      if(overlayIds.includes(el.id) && visibleOverlay(el)) resetDirty(el);
    });
  });
  overlayIds.forEach(id=>{
    const el=document.getElementById(id);
    if(el) observer.observe(el,{attributes:true,attributeFilter:['class','style']});
  });

  document.addEventListener('click',e=>{
    const close=e.target.closest?.('.sheet-close,#pf-cancel,#ef-cancel,#cf-cancel,#tf-cancel,#cex-cancel,#cin-cancel');
    if(close){
      const overlay=overlayIds.map(id=>document.getElementById(id)).find(o=>o&&o.contains(close)&&visibleOverlay(o));
      if(overlay?.dataset.dirty==='1' && !confirm('Есть несохранённые изменения. Закрыть окно и потерять их?')){
        e.preventDefault();e.stopImmediatePropagation();
        return;
      }
    }

    const leavesProject=e.target.closest?.('#pf-create-kp,#pf-create-contract,#pf-open-as-object');
    const projectOverlay=document.getElementById('projectSheetOverlay');
    if(leavesProject && projectOverlay?.classList.contains('active') && projectOverlay.dataset.dirty==='1'){
      if(!confirm('В карточке проекта есть несохранённые изменения. Продолжить и потерять их?')){
        e.preventDefault();e.stopImmediatePropagation();
        return;
      }
      projectOverlay.dataset.dirty='0';
    }

    const back=e.target.closest?.('#kpBack,#contractsBack');
    if(back){
      const view=back.closest('.view');
      if(view?.dataset.dirty==='1' && !confirm('Есть несохранённые изменения. Выйти без сохранения?')){
        e.preventDefault();e.stopImmediatePropagation();
      }
    }
  },true);

  // Навигация по нижнему/боковому меню из КП или договора.
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      const active=document.querySelector('#view-kp.active,#view-contracts.active');
      if(active?.dataset.dirty==='1' && !confirm('Есть несохранённые изменения. Перейти в другой раздел без сохранения?')){
        e.preventDefault();e.stopImmediatePropagation();
      }
    },true);
  });

  window.addEventListener('beforeunload',e=>{
    const dirtyOverlay=overlayIds.some(id=>{const el=document.getElementById(id);return visibleOverlay(el)&&el.dataset.dirty==='1';});
    const dirtyView=document.querySelector('#view-kp.active[data-dirty="1"],#view-contracts.active[data-dirty="1"]');
    if(dirtyOverlay||dirtyView){e.preventDefault();e.returnValue='';}
  });

  // Explicit successful-save buttons clear the simple dirty marker after the save flow.
  ['kpSaveBtn','ct-save-history'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>setTimeout(()=>{
    const v=id==='kpSaveBtn'?document.getElementById('view-kp'):document.getElementById('view-contracts');
    if(v) v.dataset.dirty='0';
  },700)));
})();


// ===== ARHITTEK PAYROLL & OBLIGATIONS V1 =====
(()=>{
'use strict';
if(window.__arhittekPayrollObligationsInstalled) return;
window.__arhittekPayrollObligationsInstalled=true;

const $=id=>document.getElementById(id);
const LEGACY_PAID_FN = typeof isTimesheetPaid==='function' ? isTimesheetPaid : (()=>false);
let editingSalaryPaymentId=null;
let salarySheetEmployeeId=null;
let salarySheetMonth=null;

function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function monthLabel(key){
  try{return ruMonthLabel(key);}catch(e){return key||'';}
}
function monthRange(key){
  return timesheetMonthRange(key);
}
function payrollDueForEmployee(employeeId,month){
  const range=monthRange(month);
  const earned=completedProjectEarningsForRange(range.from,range.to).employees;
  const split=splitPayrollByEmployee(earned).result;
  return Math.max(0,num(split[employeeId]?.payout));
}
function salaryPaymentMonth(row){
  const m=String(row?.description||'').match(/\[salary:(\d{4}-\d{2})\]/);
  return m?m[1]:null;
}
function salaryPaymentNote(row){
  return String(row?.description||'').replace(/^\[salary:\d{4}-\d{2}\]\s*/,'').trim();
}
function salaryPaymentRows(employeeId,month){
  return (state.ledger||[])
    .filter(x=>!x.deleted_at&&x.type==='salary_payment'&&x.payee_employee_id===employeeId&&salaryPaymentMonth(x)===month)
    .sort((a,b)=>String(b.entry_date||'').localeCompare(String(a.entry_date||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
}
function salaryDueDay(){
  return Math.min(28,Math.max(1,parseInt(localStorage.getItem('finance_salary_due_day')||'10',10)||10));
}
function officeDueDay(kind){
  const def=kind==='rent'?5:10;
  return Math.min(28,Math.max(1,parseInt(localStorage.getItem('finance_'+kind+'_due_day')||String(def),10)||def));
}
function salaryDueDate(month){
  const p=month.split('-').map(Number),d=new Date(p[0],p[1],salaryDueDay());
  return d.toISOString().slice(0,10);
}
function officeDueDate(month,kind){
  const p=month.split('-').map(Number),d=new Date(p[0],p[1]-1,officeDueDay(kind));
  return d.toISOString().slice(0,10);
}
function todayISO(){return new Date().toISOString().slice(0,10);}
function salaryPaymentState(employeeId,month,dueOverride){
  const due=dueOverride==null?payrollDueForEmployee(employeeId,month):Math.max(0,num(dueOverride));
  const rows=salaryPaymentRows(employeeId,month);
  let paid=rows.reduce((s,x)=>s+num(x.amount),0);
  if(!rows.length && LEGACY_PAID_FN(employeeId,month)) paid=due;
  paid=Math.max(0,Math.min(due,paid));
  const remaining=Math.max(0,due-paid);
  const dueDate=salaryDueDate(month);
  const overdue=remaining>0.009&&todayISO()>dueDate;
  return {due,paid,remaining,dueDate,overdue,rows,full:due>0&&remaining<=0.009};
}
window.salaryPaymentState=salaryPaymentState;
window.payrollDueForEmployee=payrollDueForEmployee;

async function syncLegacySalaryFlag(employeeId,month){
  const st=salaryPaymentState(employeeId,month);
  const existing=(state.timesheetPayments||[]).find(x=>x.employee_id===employeeId&&x.month===month);
  const payload={paid:st.full,paid_at:st.full?new Date().toISOString():null};
  if(existing){
    const r=await sb.from('timesheet_payments').update(payload).eq('id',existing.id);
    if(r.error)throw r.error;
    Object.assign(existing,payload);
  }else if(st.full){
    const r=await sb.from('timesheet_payments').insert({employee_id:employeeId,month:month,paid:true,paid_at:payload.paid_at}).select().single();
    if(r.error)throw r.error;
    state.timesheetPayments=state.timesheetPayments||[];
    if(r.data)state.timesheetPayments.push(r.data);
  }
}
function ensureSalarySheet(){
  let o=$('salaryPaymentSheetOverlay');
  if(o)return o;
  o=document.createElement('div');
  o.className='sheet-overlay';
  o.id='salaryPaymentSheetOverlay';
  o.innerHTML=
    '<div class="sheet" style="max-width:560px">'+
      '<div class="sheet-handle"></div>'+
      '<div class="sheet-title"><span id="salaryPaymentSheetTitle">Выплата зарплаты</span><button class="sheet-close" id="salaryPaymentClose" type="button">✕</button></div>'+
      '<div id="salaryPaymentSummary" class="fee-card" style="margin-bottom:12px"></div>'+
      '<div class="field-row">'+
        '<div class="field"><label>Сумма выплаты, ₽</label><input type="number" id="salaryPaymentAmount" min="0" step="100"></div>'+
        '<div class="field"><label>Дата выплаты</label><input type="date" id="salaryPaymentDate"></div>'+
      '</div>'+
      '<div class="field"><label>Комментарий</label><input type="text" id="salaryPaymentNote" placeholder="например: первая часть / перевод на карту"></div>'+
      '<button class="btn btn-primary" id="salaryPaymentSave" type="button">Сохранить выплату</button>'+
      '<button class="btn btn-secondary" id="salaryPaymentCancelEdit" type="button" style="display:none;margin-top:8px">Отменить редактирование</button>'+
      '<div class="section-label" style="margin-top:18px"><span class="lbl-text">История выплат</span><span class="section-label-line"></span></div>'+
      '<div id="salaryPaymentHistory" class="card"></div>'+
    '</div>';
  document.body.appendChild(o);
  $('salaryPaymentClose').addEventListener('click',()=>o.classList.remove('active'));
  $('salaryPaymentSave').addEventListener('click',saveSalaryPayment);
  $('salaryPaymentCancelEdit').addEventListener('click',()=>{editingSalaryPaymentId=null;renderSalaryPaymentSheet();});
  $('salaryPaymentHistory').addEventListener('click',e=>{
    const edit=e.target.closest('[data-edit-salary-payment]');
    if(edit){editingSalaryPaymentId=edit.dataset.editSalaryPayment;renderSalaryPaymentSheet();return;}
    const del=e.target.closest('[data-delete-salary-payment]');
    if(del)deleteSalaryPayment(del.dataset.deleteSalaryPayment);
  });
  return o;
}
function renderSalaryPaymentSheet(){
  if(!salarySheetEmployeeId||!salarySheetMonth)return;
  const emp=findEmployee(salarySheetEmployeeId);
  const st=salaryPaymentState(salarySheetEmployeeId,salarySheetMonth);
  const edit=editingSalaryPaymentId?st.rows.find(x=>x.id===editingSalaryPaymentId):null;
  $('salaryPaymentSheetTitle').textContent=(edit?'Редактировать выплату':'Выплата зарплаты')+' · '+(emp?.name||'');
  $('salaryPaymentSummary').innerHTML=
    '<div class="fee-row"><div class="fl">Начислено за '+escapeHtml(monthLabel(salarySheetMonth))+'</div><div class="fv">'+fmtMoney(st.due)+'</div></div>'+
    '<div class="fee-row"><div class="fl">Уже выплачено</div><div class="fv" style="color:var(--green)">'+fmtMoney(st.paid)+'</div></div>'+
    '<div class="fee-row total"><div class="fl">Осталось выплатить</div><div class="fv" style="color:'+(st.overdue?'var(--red)':'var(--gold)')+'">'+fmtMoney(st.remaining)+'</div></div>'+
    '<div class="project-note" style="margin-top:8px">'+(st.full?'Закрыто полностью':st.overdue?'Просрочка · срок был до '+fmtDate(st.dueDate):'Срок выплаты до '+fmtDate(st.dueDate))+'</div>';
  const max=Math.max(0,st.remaining+num(edit?.amount));
  $('salaryPaymentAmount').value=edit?edit.amount:(st.remaining||'');
  $('salaryPaymentAmount').max=String(max);
  $('salaryPaymentDate').value=edit?.entry_date||todayISO();
  $('salaryPaymentNote').value=edit?salaryPaymentNote(edit):'';
  $('salaryPaymentSave').textContent=edit?'Сохранить изменение':'Сохранить выплату';
  $('salaryPaymentSave').disabled=!edit&&st.remaining<=0.009;
  $('salaryPaymentCancelEdit').style.display=edit?'':'none';
  $('salaryPaymentHistory').innerHTML=st.rows.length?st.rows.map(x=>
    '<div class="list-item">'+
      '<div><div class="li-name">'+fmtMoney(x.amount)+'</div><div class="li-meta">'+fmtDate(x.entry_date)+(salaryPaymentNote(x)?' · '+escapeHtml(salaryPaymentNote(x)):'')+'</div></div>'+
      '<div class="li-actions"><button class="icon-btn" type="button" data-edit-salary-payment="'+escapeHtml(x.id)+'" title="Редактировать">✏️</button><button class="icon-btn danger" type="button" data-delete-salary-payment="'+escapeHtml(x.id)+'" title="Удалить выплату">🗑</button></div>'+
    '</div>'
  ).join(''):'<div class="empty-state">Выплат пока нет</div>';
}
function openSalaryPaymentSheet(employeeId,month){
  if(!session?.isAdmin){showToast('Выплаты отмечает администратор');return;}
  salarySheetEmployeeId=employeeId;salarySheetMonth=month;editingSalaryPaymentId=null;
  const o=ensureSalarySheet();renderSalaryPaymentSheet();o.classList.add('active');
}
window.openSalaryPaymentSheet=openSalaryPaymentSheet;

async function saveSalaryPayment(){
  if(!session?.isAdmin||!salarySheetEmployeeId||!salarySheetMonth)return;
  const amount=num($('salaryPaymentAmount').value),date=$('salaryPaymentDate').value,note=$('salaryPaymentNote').value.trim();
  const current=salaryPaymentState(salarySheetEmployeeId,salarySheetMonth);
  const edit=editingSalaryPaymentId?current.rows.find(x=>x.id===editingSalaryPaymentId):null;
  const max=current.remaining+num(edit?.amount);
  if(amount<=0){showToast('Укажите сумму выплаты');return;}
  if(amount>max+0.009){showToast('Сумма больше остатка к выплате: '+fmtMoney(max));return;}
  if(!date){showToast('Укажите дату выплаты');return;}
  const description='[salary:'+salarySheetMonth+']'+(note?' '+note:'');
  try{
    if(edit){
      const r=await sb.from('ledger_entries').update({amount:amount,entry_date:date,description:description,payee_employee_id:salarySheetEmployeeId}).eq('id',edit.id);
      if(r.error)throw r.error;
    }else{
      const r=await sb.from('ledger_entries').insert({type:'salary_payment',payee_employee_id:salarySheetEmployeeId,amount:amount,entry_date:date,description:description,received_by:session.employeeId}).select().single();
      if(r.error)throw r.error;
    }
    editingSalaryPaymentId=null;
    await loadAll();
    await syncLegacySalaryFlag(salarySheetEmployeeId,salarySheetMonth);
    renderTimesheet();
    renderSalaryPaymentSheet();
    renderFinancialObligations();
    showToast(edit?'Выплата изменена':'Выплата сохранена');
  }catch(e){console.error(e);showToast('Не удалось сохранить выплату');}
}
async function deleteSalaryPayment(id){
  if(!session?.isAdmin)return;
  if(!confirm('Удалить эту запись о выплате? Она будет перемещена в корзину.'))return;
  try{
    const r=await sb.from('ledger_entries').update({deleted_at:new Date().toISOString()}).eq('id',id);
    if(r.error)throw r.error;
    await loadAll();
    await syncLegacySalaryFlag(salarySheetEmployeeId,salarySheetMonth);
    renderTimesheet();renderSalaryPaymentSheet();renderFinancialObligations();
    showToast('Выплата удалена');
  }catch(e){console.error(e);showToast('Не удалось удалить выплату');}
}

function enhanceTimesheet(){
  const card=$('timesheetCard'),month=$('ts-month')?.value;
  if(!card||!month)return;
  card.querySelector('.payroll-explanation')?.remove();
  const note=document.createElement('p');
  note.className='project-note payroll-explanation';
  note.textContent='Табель показывает начислено, фактически выплачено и остаток. Частичные выплаты сохраняются отдельно; просрочка появляется после установленного срока выплаты.';
  card.prepend(note);

  let totalDue=0,totalPaid=0,totalRemaining=0,totalOverdue=0;
  const range=monthRange(month),earned=completedProjectEarningsForRange(range.from,range.to).employees,split=splitPayrollByEmployee(earned).result;
  Array.from(card.querySelectorAll('.list-item[onclick*="toggleTimesheetRow"]')).forEach(row=>{
    const click=row.getAttribute('onclick')||'',id=(click.match(/toggleTimesheetRow\('([^']+)'\)/)||[])[1];
    if(!id)return;
    const due=num(split[id]?.payout),st=salaryPaymentState(id,month,due);
    totalDue+=st.due;totalPaid+=st.paid;totalRemaining+=st.remaining;if(st.overdue)totalOverdue+=st.remaining;
    const checkbox=row.querySelector('input[type="checkbox"]');
    if(checkbox)checkbox.style.display='none';
    const meta=row.querySelector('.li-meta');
    if(meta){
      meta.innerHTML='Начислено '+fmtMoney(st.due)+' · <span style="color:var(--green)">выплачено '+fmtMoney(st.paid)+'</span> · <span style="color:'+(st.overdue?'var(--red)':'var(--gold)')+'">осталось '+fmtMoney(st.remaining)+'</span>'+(st.overdue?' · <b style="color:var(--red)">ПРОСРОЧЕНО</b>':st.full?' · <b style="color:var(--green)">ОПЛАЧЕНО</b>':'');
    }
    const right=row.lastElementChild;
    if(right){
      const sum=right.querySelector('.proj-sum');
      if(sum){sum.textContent=st.remaining>0?'Остаток '+fmtMoney(st.remaining):'Оплачено';sum.style.color=st.remaining?(st.overdue?'var(--red)':'var(--gold)'):'var(--green)';}
      if(session?.isAdmin&&!right.querySelector('[data-salary-pay]')){
        const b=document.createElement('button');
        b.type='button';b.className='btn btn-secondary';b.dataset.salaryPay=id;b.style.cssText='width:auto;padding:7px 10px;font-size:11px;white-space:nowrap';
        b.textContent=st.remaining>0?'Выплатить':'История';
        b.addEventListener('click',e=>{e.stopPropagation();openSalaryPaymentSheet(id,month);});
        right.appendChild(b);
      }
    }
  });
  Array.from(card.querySelectorAll('.list-item')).forEach(row=>{
    const name=row.querySelector('.li-name')?.textContent?.trim();
    const sum=row.querySelector('.proj-sum');
    if(!sum)return;
    if(name==='Всего начислено за месяц')sum.textContent=fmtMoney(totalDue);
    if(name==='Отмечено выплаченным'){row.querySelector('.li-name').textContent='Фактически выплачено';sum.textContent=fmtMoney(totalPaid);sum.style.color='var(--green)';}
    if(name==='Осталось выплатить'){sum.textContent=fmtMoney(totalRemaining);sum.style.color=totalOverdue?'var(--red)':'var(--gold)';}
  });
  if(totalOverdue>0){
    const warn=document.createElement('div');
    warn.className='note';warn.style.cssText='margin:8px 0 10px;border:1px solid rgba(224,82,82,.35);background:rgba(224,82,82,.08);color:var(--red);';
    warn.textContent='Просрочено по зарплате: '+fmtMoney(totalOverdue);
    note.after(warn);
  }
}
if(typeof renderTimesheet==='function'){
  const oldRenderTimesheetV3=renderTimesheet;
  renderTimesheet=function(){const r=oldRenderTimesheetV3.apply(this,arguments);try{enhanceTimesheet();}catch(e){console.warn('[Payroll]',e);}return r;};
}

function obligationPeriod(row){
  const m=String(row?.description||'').match(/период\s+(\d{4}-\d{2})/i);
  return m?m[1]:String(row?.expense_date||'').slice(0,7);
}
function officeExpected(kind){
  const def=kind==='rent'?110000:2500;
  return Math.max(0,num(localStorage.getItem('forecast_'+kind)??def));
}
function officePaid(kind,month){
  const re=kind==='rent'?/аренд/i:/интернет|связь/i;
  return (state.companyExpenses||[]).filter(x=>!x.deleted_at&&re.test(String(x.category||''))&&obligationPeriod(x)===month).reduce((s,x)=>s+num(x.amount),0);
}
function officeObligation(kind,month){
  const expected=officeExpected(kind),paid=Math.min(expected,officePaid(kind,month)),remaining=Math.max(0,expected-paid),dueDate=officeDueDate(month,kind),overdue=remaining>0.009&&todayISO()>dueDate;
  return {kind,expected,paid,remaining,dueDate,overdue,full:remaining<=0.009};
}
function currentObligationMonth(){return $('finance-obligation-month')?.value||new Date().toISOString().slice(0,7);}
function financeTrackingStart(){
  let v=localStorage.getItem('finance_obligations_tracking_start');
  if(!v){
    const candidates=[new Date().toISOString().slice(0,7)];
    (state.timesheetPayments||[]).forEach(x=>{if(/^\d{4}-\d{2}$/.test(x.month||''))candidates.push(x.month);});
    (state.ledger||[]).filter(x=>!x.deleted_at&&x.type==='salary_payment').forEach(x=>{const m=salaryPaymentMonth(x);if(m)candidates.push(m);});
    (state.companyExpenses||[]).filter(x=>!x.deleted_at&&/аренд|интернет|связь/i.test(String(x.category||''))).forEach(x=>{
      const m=obligationPeriod(x);if(/^\d{4}-\d{2}$/.test(m||''))candidates.push(m);
    });
    v=candidates.sort()[0];
    localStorage.setItem('finance_obligations_tracking_start',v);
  }
  return v;
}
function monthSequence(from,to){
  if(!/^\d{4}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}$/.test(to||'')||from>to)return [];
  const out=[],a=from.split('-').map(Number),b=to.split('-').map(Number);
  let y=a[0],m=a[1],guard=0;
  while((y<b[0]||(y===b[0]&&m<=b[1]))&&guard<36){
    out.push(String(y)+'-'+String(m).padStart(2,'0'));
    m++;if(m>12){m=1;y++;}guard++;
  }
  return out;
}
function allOverdueObligations(){
  const current=new Date().toISOString().slice(0,7),start=financeTrackingStart();
  let salary=0,rent=0,internet=0;
  monthSequence(start,current).forEach(month=>{
    const s=salaryAggregate(month),r=officeObligation('rent',month),i=officeObligation('internet',month);
    salary+=s.overdue;
    if(r.overdue)rent+=r.remaining;
    if(i.overdue)internet+=i.remaining;
  });
  return {salary,rent,internet,total:salary+rent+internet,start};
}
function openOfficePayment(kind,month){
  const st=officeObligation(kind,month);
  if(st.remaining<=0){showToast('Обязательство уже оплачено');return;}
  const category=kind==='rent'?'Аренда':'Связь и интернет';
  openCompanyExpenseSheet(null,category);
  setTimeout(()=>{
    if($('cex-amount'))$('cex-amount').value=st.remaining;
    if($('cex-date'))$('cex-date').value=todayISO();
    if($('cex-desc'))$('cex-desc').value=(kind==='rent'?'Оплата аренды':'Оплата интернета / связи')+' · период '+month;
  },0);
}
window.openOfficePayment=openOfficePayment;

function salaryAggregate(month){
  let due=0,paid=0,remaining=0,overdue=0;
  (state.employees||[]).filter(e=>e.active!==false||payrollDueForEmployee(e.id,month)>0).forEach(e=>{
    const st=salaryPaymentState(e.id,month);
    due+=st.due;paid+=st.paid;remaining+=st.remaining;if(st.overdue)overdue+=st.remaining;
  });
  return {due,paid,remaining,overdue};
}
function ensureObligationsBlock(){
  const view=$('view-finance');if(!view)return null;
  let wrap=$('financeObligationsWrap');if(wrap)return wrap;
  wrap=document.createElement('section');wrap.id='financeObligationsWrap';wrap.style.marginBottom='18px';
  const forecast=$('forecastMain')?.closest('.forecast-wrap');
  if(forecast)forecast.after(wrap);else view.querySelector('.workspace-head')?.after(wrap);
  return wrap;
}
function statusBadge(st){
  if(st.full)return '<span style="color:var(--green);font-weight:700">ОПЛАЧЕНО</span>';
  if(st.overdue)return '<span style="color:var(--red);font-weight:700">ПРОСРОЧЕНО</span>';
  if(st.paid>0)return '<span style="color:var(--gold);font-weight:700">ЧАСТИЧНО</span>';
  return '<span style="color:var(--text-dim);font-weight:700">К ОПЛАТЕ</span>';
}
function renderFinancialObligations(){
  const wrap=ensureObligationsBlock();if(!wrap)return;
  const month=currentObligationMonth(),salary=salaryAggregate(month),rent=officeObligation('rent',month),internet=officeObligation('internet',month);
  const totalDue=salary.due+rent.expected+internet.expected,totalPaid=salary.paid+rent.paid+internet.paid,totalRemaining=salary.remaining+rent.remaining+internet.remaining,totalOverdue=salary.overdue+(rent.overdue?rent.remaining:0)+(internet.overdue?internet.remaining:0);
  const backlog=allOverdueObligations();
  wrap.innerHTML=
    '<div class="section-label"><span class="lbl-text">Обязательства и оплаты</span><span class="section-label-line"></span></div>'+
    '<div class="card">'+
      '<div class="field" style="margin-bottom:12px"><label>Месяц</label><input type="month" id="finance-obligation-month" value="'+month+'"></div>'+
      '<div class="finance-kpi-grid">'+
        '<div class="finance-kpi"><span>Начислено / план</span><strong>'+fmtMoney(totalDue)+'</strong></div>'+
        '<div class="finance-kpi"><span>Фактически оплачено</span><strong style="color:var(--green)">'+fmtMoney(totalPaid)+'</strong></div>'+
        '<div class="finance-kpi finance-kpi-main"><span>Осталось оплатить</span><strong style="color:'+(backlog.total?'var(--red)':'var(--gold)')+'">'+fmtMoney(totalRemaining)+'</strong><small>'+(backlog.total?'общая просрочка '+fmtMoney(backlog.total):'просрочек нет')+'</small></div>'+
      '</div>'+
      (backlog.total?'<div class="note" style="margin:10px 0;border:1px solid rgba(224,82,82,.35);background:rgba(224,82,82,.08);color:var(--red)"><b>Просроченные обязательства: '+fmtMoney(backlog.total)+'</b><br>Зарплата '+fmtMoney(backlog.salary)+' · аренда '+fmtMoney(backlog.rent)+' · интернет '+fmtMoney(backlog.internet)+' · учёт с '+escapeHtml(backlog.start)+'</div>':'')+
      '<div class="list-item"><div><div class="li-name">Зарплата сотрудникам</div><div class="li-meta">Начислено '+fmtMoney(salary.due)+' · выплачено '+fmtMoney(salary.paid)+' · осталось '+fmtMoney(salary.remaining)+'</div></div><div class="li-actions">'+(salary.overdue?'<span style="color:var(--red);font-size:11px;font-weight:700">ПРОСРОЧЕНО</span>':'')+'<button class="btn btn-secondary" type="button" id="financeOpenTimesheet" style="width:auto;padding:7px 10px">Табель</button></div></div>'+
      '<div class="list-item"><div><div class="li-name">Аренда офиса · '+fmtMoney(rent.expected)+'</div><div class="li-meta">Оплачено '+fmtMoney(rent.paid)+' · осталось '+fmtMoney(rent.remaining)+' · срок до '+fmtDate(rent.dueDate)+'</div></div><div class="li-actions">'+statusBadge(rent)+(rent.remaining>0?'<button class="btn btn-secondary" type="button" data-pay-office="rent" style="width:auto;padding:7px 10px">Оплатить</button>':'')+'</div></div>'+
      '<div class="list-item"><div><div class="li-name">Интернет / связь · '+fmtMoney(internet.expected)+'</div><div class="li-meta">Оплачено '+fmtMoney(internet.paid)+' · осталось '+fmtMoney(internet.remaining)+' · срок до '+fmtDate(internet.dueDate)+'</div></div><div class="li-actions">'+statusBadge(internet)+(internet.remaining>0?'<button class="btn btn-secondary" type="button" data-pay-office="internet" style="width:auto;padding:7px 10px">Оплатить</button>':'')+'</div></div>'+
      '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--text-dim)">Настроить суммы и сроки</summary>'+
        '<div class="field-row" style="margin-top:10px"><div class="field"><label>Аренда в месяц, ₽</label><input type="number" id="financeRentExpected" value="'+rent.expected+'"></div><div class="field"><label>Аренда до числа</label><input type="number" min="1" max="28" id="financeRentDueDay" value="'+officeDueDay('rent')+'"></div></div>'+
        '<div class="field-row"><div class="field"><label>Интернет в месяц, ₽</label><input type="number" id="financeInternetExpected" value="'+internet.expected+'"></div><div class="field"><label>Интернет до числа</label><input type="number" min="1" max="28" id="financeInternetDueDay" value="'+officeDueDay('internet')+'"></div></div>'+
        '<div class="field"><label>Зарплата за месяц — выплатить до числа следующего месяца</label><input type="number" min="1" max="28" id="financeSalaryDueDay" value="'+salaryDueDay()+'"></div>'+
        '<div class="field"><label>С какого месяца учитывать просрочки</label><input type="month" id="financeTrackingStart" value="'+financeTrackingStart()+'"></div>'+
      '</details>'+
    '</div>';
  $('finance-obligation-month')?.addEventListener('change',renderFinancialObligations);
  wrap.querySelectorAll('[data-pay-office]').forEach(b=>b.addEventListener('click',()=>openOfficePayment(b.dataset.payOffice,month)));
  $('financeOpenTimesheet')?.addEventListener('click',()=>{
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    $('view-timesheet').classList.add('active');$('ts-month').value=month;renderTimesheet();window.scrollTo(0,0);
  });
  [['financeRentExpected','forecast_rent'],['financeInternetExpected','forecast_internet'],['financeRentDueDay','finance_rent_due_day'],['financeInternetDueDay','finance_internet_due_day'],['financeSalaryDueDay','finance_salary_due_day']].forEach(pair=>{
    $(pair[0])?.addEventListener('change',e=>{localStorage.setItem(pair[1],String(Math.max(0,num(e.target.value))));renderFinancialObligations();try{renderFinancialForecast?.();}catch(_){}});
  });
  $('financeTrackingStart')?.addEventListener('change',e=>{if(e.target.value)localStorage.setItem('finance_obligations_tracking_start',e.target.value);renderFinancialObligations();});
  const nav=document.querySelector('.nav-btn[data-view="view-finance"]');
  if(nav){
    let badge=nav.querySelector('.finance-overdue-badge');
    if(backlog.total>0){
      if(!badge){badge=document.createElement('span');badge.className='finance-overdue-badge';badge.style.cssText='position:absolute;top:3px;right:8px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--red);color:white;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center';nav.style.position='relative';nav.appendChild(badge);}
      badge.textContent='!';
      nav.title='Есть просроченные обязательства на '+fmtMoney(backlog.total);
    }else if(badge)badge.remove();
  }
}
window.renderFinancialObligations=renderFinancialObligations;

const oldRenderAnalyticsPayroll=typeof renderAnalytics==='function'?renderAnalytics:null;
if(oldRenderAnalyticsPayroll){
  renderAnalytics=function(){const r=oldRenderAnalyticsPayroll.apply(this,arguments);setTimeout(renderFinancialObligations,0);return r;};
}
const oldRenderAllPayroll=typeof renderAll==='function'?renderAll:null;
if(oldRenderAllPayroll){
  renderAll=function(){const r=oldRenderAllPayroll.apply(this,arguments);setTimeout(()=>{try{renderFinancialObligations();}catch(e){}},0);return r;};
}
setTimeout(()=>{try{renderFinancialObligations();}catch(e){console.warn('[Obligations]',e);}},900);
})();
