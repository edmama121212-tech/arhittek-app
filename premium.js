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
const special=document.createElement('details');special.className='project-special';special.innerHTML='<summary>Особые условия расчёта</summary>';
const methodField=$('pf-compensation-method').closest('.field');methodField.before(special);special.append(methodField);
const methodHint=special.nextElementSibling;if(methodHint?.classList.contains('hint'))methodHint.remove();
$('pf-compensation-method').options[1].textContent='Процент от стоимости за вычетом прямых расходов';
compensation.querySelector('.accent-title').textContent='Вознаграждение команды';
const duplicate=$('pf-employee-field');duplicate.classList.add('project-legacy-selects');
$('pf-employee-fee').closest('.field').querySelector('label').textContent='Сотрудник';
$('pf-co-employee-fee').closest('.field').querySelector('label').textContent='Второй сотрудник (если нужен)';
const percentBox=$('pf-percent-method-fields');
const mainLine=document.createElement('div');mainLine.className='project-team-line';mainLine.append($('pf-employee-fee').closest('.field'),$('pf-feepercent').closest('.field'));
const coDetails=document.createElement('details');coDetails.className='project-special';coDetails.innerHTML='<summary>Второй сотрудник</summary>';
const coLine=document.createElement('div');coLine.className='project-team-line';coLine.append($('pf-co-employee-fee').closest('.field'),$('pf-co-feepercent').closest('.field'));coDetails.append(coLine);
percentBox.replaceChildren(mainLine,coDetails);
$('pf-feepercent').closest('.field').querySelector('label').textContent='Ставка, %';$('pf-co-feepercent').closest('.field').querySelector('label').textContent='Ставка, %';

$('pf-members-field').querySelector('label').textContent='Участники без проектной доплаты';
$('pf-rp-add-btn').textContent='Добавить в расчёт';
$('pf-rp-rate').placeholder='400';
// Area belongs to the project rather than a hidden compensation method.
const area=$('pf-area').closest('.field');panels.overview.insertBefore(area,$('pf-phone-field'));
const salaryHint=document.createElement('p');salaryHint.className='project-note';salaryHint.textContent='Сотрудника на окладе добавьте в участники без проектной доплаты. Оклад учитывается в месячном табеле.';$('pf-members-field').append(salaryHint);
const contacts=$('pf-phone-field'), contactDetails=document.createElement('details');contactDetails.className='project-special';contactDetails.innerHTML='<summary>Контакты и адрес</summary>';contacts.before(contactDetails);contactDetails.append(contacts);
const statusField=$('pf-department-field');statusField.classList.add('project-legacy-selects'); // Payment state is derived from received payments.
const moneyIntro=$('pf-financial-section').querySelector('.accent-block');if(moneyIntro)moneyIntro.style.display='none';
$('pf-save').textContent='Сохранить проект';
const saveNote=document.createElement('p');saveNote.className='project-note';saveNote.textContent='Поля карточки сохраняются этой кнопкой. Платежи, расходы и добавления в расчёт сохраняются сразу.';$('pf-save').before(saveNote);
function selectTab(id){
 if((id==='money'||id==='team')&&!session?.isAdmin)id='overview';
 Object.entries(panels).forEach(([key,p])=>p.hidden=key!==id);
 nav.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===id));b.tabIndex=b.dataset.tab===id?0:-1;});
}
nav.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...nav.querySelectorAll('button')].filter(b=>!b.hidden);let i=buttons.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[i].click();buttons[i].focus();});
function draft(){const saved=state.projects.find(p=>p.id===editingProjectId)||{};return {...saved,id:editingProjectId,category_id:$('pf-category').value,status_id:$('pf-status').value,price:Number($('pf-price').value)||0,expenses:Number($('pf-expenses').value)||0,area:Number($('pf-area').value)||0,employee_id:$('pf-employee-fee').value||null,co_employee_id:$('pf-co-employee-fee').value||null,fee_percent:$('pf-feepercent').value===''?Number(findCategory($('pf-category').value)?.fee_percent)||0:Number($('pf-feepercent').value),co_fee_percent:Number($('pf-co-feepercent').value)||0,fee_base:$('pf-compensation-method').value==='m2'?'m2':$('pf-compensation-method').value==='percent_profit'?'profit':'price'};}
function planRows(p){
 if(p.fee_base==='m2')return projectRolePayoutEntries(p.id).map(e=>({entryId:e.id,name:findEmployee(e.payee_employee_id)?.name||'Сотрудник не найден',formula:e.description,amount:Number(e.amount)||0}));
 const f=getProjectFee(p),base=p.fee_base==='profit'?Math.max(0,p.price-p.expenses):p.price;
 return [[p.employee_id,f.mainFeeAmount,p.fee_percent],[p.co_employee_id,f.coFeeAmount,p.co_fee_percent]].filter(x=>x[0]).map(([id,amount,rate])=>({name:findEmployee(id)?.name||'Сотрудник не найден',formula:isConstructionCategory(p.category_id)?'По правилам строительного объекта':`${money(base)} × ${rate}%`,amount}));
}
function card(label,value){return `<div class="project-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;}
function refresh(){
 const p=draft(),rows=planRows(p),total=rows.reduce((s,r)=>s+r.amount,0),done=findStatus(p.status_id)?.name==='Завершён',admin=!!session?.isAdmin;
 nav.querySelectorAll('button').forEach(b=>b.hidden=!admin&&['team','money'].includes(b.dataset.tab));
 if(!admin&&(!panels.team.hidden||!panels.money.hidden))selectTab('overview');
 const template=p.fee_base==='m2'?'Площадь × ставка сотрудника':p.fee_base==='profit'?'Процент после прямых расходов':'Процент от стоимости';
 teamSummary.innerHTML=`<div class="project-eyebrow">${esc(template)}</div><h3>Понятный расчёт каждому</h3><p class="project-note">${done?'Проект завершён. Начисления относятся к месяцу указанной даты сдачи.':'Пока проект в работе, это план. В табель сумма попадёт после завершения.'}</p>`;
 const rowsHtml=rows.length?rows.map(r=>`<div class="project-person"><div><strong>${esc(r.name)}</strong><small>${esc(r.formula)}</small></div><div class="project-person-actions"><strong>${esc(money(r.amount))}</strong>${r.entryId&&admin?`<button type="button" class="icon-btn" data-remove-payout="${esc(r.entryId)}" aria-label="Удалить из расчёта: ${esc(r.name)}">×</button>`:''}</div></div>`).join(''):'<p class="project-note">Выберите сотрудника и условия вознаграждения.</p>';
 const saved=state.projects.find(x=>x.id===editingProjectId), entries=projectRolePayoutEntries(editingProjectId);
 const staleArea=saved&&p.fee_base==='m2'&&entries.length&&p.area!==Number(saved.area||0);
 $('pf-compensation-summary').innerHTML=rowsHtml+`<div class="project-person project-total"><strong>${done?'Начислено':'План вознаграждений'}</strong><strong>${esc(money(total))}</strong></div>`+(staleArea?'<p class="project-warning">Площадь изменена. Сохранённые суммы не пересчитываются автоматически — проверьте расчёт команды.</p>':'');
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
const oldOpen=openProjectSheet;openProjectSheet=function(id){oldOpen(id);$('projectSheetTitle').textContent=id?'Карточка проекта':'Новый проект';coDetails.open=!!$('pf-co-employee').value;special.open=false;contactDetails.open=false;defaults();$('pf-rp-rate').value='400';$('pf-employee-fee').value=$('pf-employee').value;$('pf-co-employee-fee').value=$('pf-co-employee').value;selectTab('overview');refresh();sheet.scrollTop=0;};
const oldRole=applyRole;applyRole=function(){oldRole();refresh();};
const oldRecalc=recalcLiveFeeSummary;recalcLiveFeeSummary=function(){oldRecalc();refresh();};
const oldRenderRoles=renderProjectRolePayouts;renderProjectRolePayouts=function(id){oldRenderRoles(id);refresh();};
const oldSummary=renderM2CompensationSummary;renderM2CompensationSummary=function(p){oldSummary(p);refresh();};
const oldRenderAll=renderAll;renderAll=function(){oldRenderAll();if($('projectSheetOverlay').classList.contains('active'))refresh();};
sheet.addEventListener('click',e=>{const b=e.target.closest('[data-remove-payout]');if(b&&session?.isAdmin)deleteProjectRolePayout(b.dataset.removePayout,editingProjectId);});
sheet.addEventListener('input',refresh);sheet.addEventListener('change',e=>{if(e.target.id==='pf-category')defaults();refresh();});
// Stale duplicate selections must never restore an employee removed in the team tab.
['pf-employee-fee','pf-co-employee-fee'].forEach((id,i)=>$(id).addEventListener('change',()=>{$(i?'pf-co-employee':'pf-employee').value=$(id).value;}));
const oldSave=saveProject;saveProject=async function(){
 const p=draft();
 if(p.employee_id&&p.employee_id===p.co_employee_id){selectTab('team');showToast('Один сотрудник выбран дважды. Оставьте его в одной строке.');return;}
 if(p.fee_base!=='m2'&&[[p.employee_id,p.fee_percent],[p.co_employee_id,p.co_fee_percent]].some(([id,rate])=>id&&rate>0&&findEmployee(id)?.is_salaried)){selectTab('team');showToast('Сотрудник на окладе: укажите 0% и добавьте его без проектной доплаты');return;}
 const old=state.projects.find(x=>x.id===editingProjectId);
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
 adding=true;$('pf-rp-add-btn').disabled=true;try{await oldAdd();$('pf-rp-rate').value='400';refresh();}finally{adding=false;$('pf-rp-add-btn').disabled=false;}
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
