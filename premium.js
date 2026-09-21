(()=>{
'use strict';
const icons={overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',projects:'<path d="M3 8h7l2-3h9v15H3zM7 13h10M7 17h6"/>',construction:'<path d="m3 11 9-8 9 8M5 9v12h14V9M9 21v-7h6v7"/>',finance:'<path d="M4 20h16M6 16v-5M12 16V4M18 16V8"/>',cards:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',more:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'};
const svg=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]||icons.cards}</svg>`;
const nav=document.querySelector('.bottom-nav');
if(nav){const brand=document.createElement('div');brand.className='studio-sidebar-brand';brand.innerHTML='ARHIT<span>TEK</span><small>STUDIO WORKSPACE</small>';nav.prepend(brand);const foot=document.createElement('div');foot.className='sidebar-note';foot.innerHTML='<strong>Пространство вашей студии</strong>Архитектура · Интерьеры · Строительство';nav.append(foot);nav.setAttribute('aria-label','Главная навигация');nav.querySelectorAll('.nav-btn').forEach(b=>{const i=b.querySelector('.nav-icon');if(i)i.innerHTML=svg(b.dataset.view?.replace('view-',''));b.setAttribute('role','button');b.tabIndex=0;b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.click();}});});}
const meta={overview:['Рабочий стол','Проекты, команда и финансы — в одном пространстве.'],projects:['Проектная студия','От первого эскиза до готового альбома.'],construction:['Строительство','Бюджеты, материалы и ход работ по объектам.'],cards:['Коллекция проектов','Архитектура, которую можно выбрать.'],more:['Инструменты студии','Документы и процессы ежедневной работы.'],finance:['Финансы','Понятная экономика каждого направления.'],timesheet:['Команда и выплаты','Начисления, оклады и обязательства студии.'],settings:['Настройки','Команда, услуги и параметры рабочего пространства.'],kp:['Коммерческое предложение','Точный расчёт. Достойная подача.'],contracts:['Договоры','Условия сотрудничества и документы по проекту.'],company:['Реквизиты студии','Всё необходимое для работы с клиентами.'],object:['Карточка объекта','Финансовая картина и документы строительства.']};
Object.entries(meta).forEach(([id,[title,description]])=>{const v=document.getElementById('view-'+id);if(!v)return;const h=document.createElement('div');h.className='workspace-head';h.innerHTML=`<div><div class="workspace-eyebrow">ARHITTEK / ${id==='overview'?'Обзор студии':'Рабочее пространство'}</div><h1>${title}</h1><p class="workspace-description">${description}</p></div><div class="workspace-date">${new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}</div>`;v.prepend(h);});
const overview=document.getElementById('overviewContent');if(overview){const h=document.createElement('section');h.className='studio-hero';h.innerHTML='<div><div class="hero-kicker">STUDIO / AT A GLANCE</div><h2>Большие идеи. Чёткий план.</h2><p>Всё, что важно для студии сегодня.</p></div><div class="hero-actions"><button type="button" class="btn btn-primary" id="premiumNewProject">+ Новый проект</button><button type="button" class="btn btn-secondary" id="premiumOpenPayroll">Выплаты команде ↗</button></div>';overview.prepend(h);document.getElementById('premiumNewProject').onclick=()=>openProjectSheet(null);document.getElementById('premiumOpenPayroll').onclick=()=>document.getElementById('openTimesheetBtn').click();}
const grid=document.querySelector('#view-more > div[style*="display:grid"]');if(grid){grid.classList.add('premium-tool-grid');Object.entries({openKpBtn:'Коммерческие предложения',openContractsBtn:'Договоры',openCompanyBtn:'Реквизиты',exportXlsxBtn:'Экспорт в Excel',openTimesheetBtn:'Табель и выплаты'}).forEach(([id,text])=>{document.getElementById(id).innerHTML=svg('cards')+text;});}
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
 const a=Number($('pf-rp-area').value),r=Number($('pf-rp-rate').value);workPreview.innerHTML=a>0&&r>0&&Number.isFinite(a*r)?`<span>Гонорар сотрудника<small>${esc(a)} м² × ${esc(r.toLocaleString('ru-RU',{maximumFractionDigits:2}))} ₽</small></span><strong>${esc(money(Math.round(a*r*100)/100))}</strong>`:'Укажите площадь и ставку';
 const p=draft(),rows=planRows(p),total=rows.reduce((s,r)=>s+r.amount,0),done=findStatus(p.status_id)?.name==='Завершён',admin=!!session?.isAdmin;
 nav.querySelectorAll('button').forEach(b=>b.hidden=!admin&&['team','money'].includes(b.dataset.tab));
 if(!admin&&(!panels.team.hidden||!panels.money.hidden))selectTab('overview');
 const isM2=p.fee_base==='m2',interior=isInterior(p.category_id),architecture=isArchitecture(p.category_id);
 methods.hidden=(interior&&isM2)||(architecture&&p.fee_base==='profit');
 methods.querySelector('[data-method="percent"]').hidden=interior;methods.classList.toggle('team-interior',interior||architecture);methods.querySelector('[data-method="m2"]').hidden=architecture;methods.querySelector('[data-method="percent"] strong').textContent=architecture?'Процент после расходов':'Процент';methods.querySelector('[data-method="percent"] span').textContent=architecture?'(Стоимость − прямые расходы) × ставка':'Доля от стоимости проекта';
 methods.querySelector('[data-method="m2"] span').textContent=interior?'Дизайн интерьера · сотрудники без оклада':'Площадь работы × ставка';
 for(const option of [...$('pf-rp-employee').options]){if(option.value&&findEmployee(option.value)?.is_salaried)option.remove();}

 methods.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.method==='m2')===isM2)));
 baseField.hidden=isM2||interior||architecture;baseNote.hidden=isM2;$('team-deduct-costs').checked=p.fee_base==='profit';
 const calculationBase=p.fee_base==='profit'?Math.max(0,p.price-p.expenses):p.price;
 baseNote.textContent=isConstructionCategory(p.category_id)?'Стройка: расчёт по правилам строительного объекта.':p.fee_base==='profit'?`База: ${money(p.price)} − ${money(p.expenses)} расходов = ${money(calculationBase)}`:`База расчёта: ${money(p.price)}`;
 teamSummary.innerHTML='<h3>Гонорары команды</h3><p class="project-note">'+(interior?'Площадь работы × ставка. Сотрудники на окладе — без доплаты за проект.':architecture?'Гонорар = (стоимость − прямые расходы) × процент.':'Выберите способ расчёта и назначьте сотрудников.')+'</p>'+(interior&&!isM2?'<p class="project-warning">Здесь сохранён прежний процентный расчёт. Для новых начислений выберите «За м²». История автоматически не изменяется.</p>':'')+(architecture&&p.fee_base!=='profit'?'<p class="project-warning">Сохранены прежние условия. Для перехода выберите «Процент после расходов». Старые расчёты автоматически не изменяются.</p>':'');
 const lineResult=(id,employee,rate)=>{const el=$(id);const fees=getProjectFee(p);const row={amount:id==='team-main-result'?fees.mainFeeAmount:fees.coFeeAmount};el.innerHTML='<span>Гонорар</span><strong>'+(!employee?'—':findEmployee(employee)?.is_salaried&&rate===0?'На окладе':rate>0?esc(money(row?.amount||0)):rate===0?'Укажите %':'—')+'</strong>';};
 lineResult('team-main-result',p.employee_id,p.fee_percent);lineResult('team-co-result',p.co_employee_id,p.co_fee_percent);
 const rowsHtml=rows.length?rows.map(r=>`<div class="project-person"><div><strong>${esc(r.name)}</strong><small>${esc(r.formula)}</small></div><div class="project-person-actions"><strong>${esc(money(r.amount))}</strong>${r.entryId&&admin?`<button type="button" class="icon-btn" data-remove-payout="${esc(r.entryId)}" aria-label="Удалить из расчёта: ${esc(r.name)}">×</button>`:''}</div></div>`).join(''):'<p class="project-note">Выберите сотрудника и условия вознаграждения.</p>';
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
sheet.addEventListener('click',e=>{const b=e.target.closest('[data-remove-payout]');if(b&&session?.isAdmin)deleteProjectRolePayout(b.dataset.removePayout,editingProjectId);});
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
const oldDelete=deleteProjectRolePayout;deleteProjectRolePayout=async function(id,pid){if(!session?.isAdmin){showToast('Расчёт команды изменяет администратор');return;}await oldDelete(id,pid);refresh();};
const oldAdd=addProjectRolePayout;let adding=false;
addProjectRolePayout=async function(){
 if(!session?.isAdmin){showToast('Расчёт команды изменяет администратор');return;}
 if(adding)return;
 const emp=findEmployee($('pf-rp-employee').value),role=$('pf-rp-role').value,p=state.projects.find(x=>x.id===editingProjectId);
 if(emp?.is_salaried){showToast('Сотрудник на окладе: добавьте его в участники без проектной доплаты');return;}
 if(p&&Number(p.area)!==Number($('pf-area').value)){showToast('Сначала сохраните новую площадь проекта');return;}
 if(projectRolePayoutEntries(editingProjectId).some(e=>e.payee_employee_id===emp?.id&&e.description?.startsWith(role+' —'))){showToast('Этот сотрудник уже добавлен на выбранную роль');return;}
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
  const {data,error}=await sb.from('ledger_entries').insert({type:'role_payout',project_id:projectId,payee_employee_id:emp.id,description,amount,entry_date:new Date().toISOString().slice(0,10),received_by:session.employeeId}).select().single();
  if(error)throw error;
  if(data){state.ledger=state.ledger||[];state.ledger.push(data);}
  await logAudit('project',projectId,p.name,'update',{role_payout_added:{old:null,new:description+' — '+fmtMoney(amount)}});
  await loadAll();
  if(editingProjectId===projectId){renderProjectRolePayouts(projectId);$('pf-rp-rate').value='400';$('pf-rp-area').value=p.area;$('pf-rp-employee').value='';refresh();}
  showToast('В расчёт добавлено '+fmtMoney(amount)+'. В табель — после завершения проекта.');
 }catch(e){console.error(e);showToast('Не удалось завершить сохранение. Обновите расчёт перед повторной попыткой.');}
 finally{adding=false;$('pf-rp-add-btn').disabled=false;}
};
$('pf-rp-add-btn').removeEventListener('click',oldAdd);$('pf-rp-add-btn').addEventListener('click',()=>addProjectRolePayout());
// Make the existing monthly flag explicit: it is not a partial-payment ledger.
const oldTimesheet=renderTimesheet;renderTimesheet=function(){
 oldTimesheet();const card=$('timesheetCard');if(!card)return;
 const range=timesheetMonthRange($('ts-month').value),map=completedProjectEarningsForRange(range.from,range.to).employees,{result}=splitPayrollByEmployee(map);
 [...card.querySelectorAll('input[type="checkbox"]')].forEach(box=>{
  const row=box.closest('.list-item'),click=row.getAttribute('onclick')||'',id=click.match(/toggleTimesheetRow\('([^']+)'\)/)?.[1],r=result[id];if(!r)return;
  const meta=row.querySelector('.li-meta');meta.textContent=`Оклад ${money(r.salary)} · Проекты ${money(r.earned)} · ${box.checked?'Отмечено выплаченным':'К выплате '+money(r.payout)}`;
  box.title='Отметка о полной выплате за месяц';
 });
 const note=document.createElement('p');note.className='project-note payroll-explanation';note.textContent='Здесь — оклад и завершённые проекты выбранного месяца. Галочка означает полную выплату по текущему расчёту; частичные выплаты и закрытие месяца пока не поддерживаются.';card.prepend(note);
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
  <div class="section-label" style="margin-top:4px"><span class="lbl-text">Прогноз месяца</span><span class="section-label-line"></span></div>
  <div id="forecastMain"></div>
  <div class="section-label"><span class="lbl-text">Из чего складывается прогноз</span><span class="section-label-line"></span></div>
  <div class="card" id="forecastBreakdown"></div>
  <div class="section-label"><span class="lbl-text">Проекты, которые влияют на прогноз</span><span class="section-label-line"></span></div>
  <div class="card" id="forecastProjects"></div>
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
 const entered=(state.companyIncome||[]).filter(i=>!i.deleted_at && inMonth(i.income_date,key)).reduce((s,i)=>s+num(i.amount),0);
 // Если аренда за месяц уже занесена в доходы, второй раз 20 000 ₽ не добавляем.
 const hasRent=(state.companyIncome||[]).some(i=>!i.deleted_at && inMonth(i.income_date,key) && String(i.category||'').toLowerCase().includes('аренд'));
 return {entered,autoRent:hasRent?0:20000};
}
function settings(){
 return {
  rent: num(localStorage.getItem('forecast_rent') ?? 110000),
  internet: num(localStorage.getItem('forecast_internet') ?? 2500),
  reelsUnit: num(localStorage.getItem('forecast_reels_unit') ?? 2000),
  debtPayment: num(localStorage.getItem('forecast_debt_payment') ?? 111000),
  debtWorkers: num(localStorage.getItem('forecast_debt_workers') ?? 36000),
  debtFurniture: num(localStorage.getItem('forecast_debt_furniture') ?? 300000)
 };
}
function renderForecast(){
 const key=$('forecast-month')?.value || monthKey();
 const set=settings(), bounds=monthBounds(key);
 const reelsDays=Math.ceil(bounds.days/2), reels=reelsDays*set.reelsUnit;
 const salaries=salaryTotal();
 const rows=projectRows(key);
 const projectsIncome=rows.reduce((s,r)=>s+r.expected,0);
 const direct=rows.reduce((s,r)=>s+r.direct,0);
 const team=rows.reduce((s,r)=>s+r.team,0);
 const extra=recurringIncome(key);
 const income=projectsIncome+extra.entered+extra.autoRent;
 const fixed=set.rent+set.internet+salaries+reels;
 const operating=income-fixed-direct-team;
 const afterDebt=operating-set.debtPayment;
 const debtTotal=set.debtWorkers+set.debtFurniture;
 const remainingDebt=Math.max(0,debtTotal-set.debtPayment);
 const cls=afterDebt>=0?'pos':'neg';
 const label=afterDebt>=0?'Ожидаемый плюс':'Ожидаемый минус';
 $('forecastMain').innerHTML=`
 <div class="forecast-hero">
   <div class="forecast-head">
     <div><div class="forecast-title">${label}</div><div class="forecast-sub">Если новых продаж не будет и текущие проекты закроются по плану.</div></div>
     <div style="min-width:126px"><div class="field" style="margin:0"><label>Месяц</label><input type="month" id="forecast-month" value="${key}"></div></div>
   </div>
   <div class="forecast-result ${cls}">${money(afterDebt)}</div>
   <div class="forecast-grid">
     <div class="forecast-metric"><span>Ожидаемые поступления</span><strong>${money(income)}</strong></div>
     <div class="forecast-metric"><span>Все расходы до долга</span><strong>${money(fixed+direct+team)}</strong></div>
     <div class="forecast-metric"><span>Операционный результат</span><strong>${money(operating)}</strong></div>
     <div class="forecast-metric"><span>После погашения долга</span><strong>${money(afterDebt)}</strong></div>
   </div>
   <div class="forecast-controls">
     <div class="field"><label>Платёж по долгам в этом месяце, ₽</label><input type="number" id="forecast-debt-payment" min="0" step="1000" value="${set.debtPayment}"></div>
     <div class="field"><label>Долг после этого платежа</label><input type="text" readonly value="${money(remainingDebt)}"></div>
   </div>
   <div class="forecast-note">Долги сейчас: рабочим ${money(set.debtWorkers)} + мебельщику ${money(set.debtFurniture)}. Reels: ${reelsDays} выходов × ${money(set.reelsUnit)} = ${money(reels)}.</div>
 </div>`;

 $('forecastBreakdown').innerHTML=`
   <div class="forecast-line"><span>Остатки оплат по проектам месяца</span><b>+${money(projectsIncome)}</b></div>
   <div class="forecast-line"><span>Прочие доходы, уже внесённые</span><b>+${money(extra.entered)}</b></div>
   <div class="forecast-line"><span>Субаренда, если ещё не внесена</span><b>+${money(extra.autoRent)}</b></div>
   <div class="forecast-line"><span>Аренда офиса</span><b>−${money(set.rent)}</b></div>
   <div class="forecast-line"><span>Интернет</span><b>−${money(set.internet)}</b></div>
   <div class="forecast-line"><span>Фиксированные зарплаты</span><b>−${money(salaries)}</b></div>
   <div class="forecast-line"><span>Reels · через день</span><b>−${money(reels)}</b></div>
   <div class="forecast-line"><span>Прямые расходы проектов</span><b>−${money(direct)}</b></div>
   <div class="forecast-line"><span>Гонорары команды по проектам</span><b>−${money(team)}</b></div>
   <div class="forecast-line total"><span>Операционный итог</span><b>${money(operating)}</b></div>
   <div class="forecast-line total"><span>После планового платежа по долгам</span><b>${money(afterDebt)}</b></div>`;

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
