// ============================================================
// AUTH / SESSION
// ============================================================
let session = null; // {employeeId, name, isAdmin}
let loginSelectedEmployee = null;

// Permissions come only from the current server session, never saved admin flags.
let verifiedAccess=null;
function hasVerifiedAccess(){
  return !!(session?.token&&verifiedAccess&&verifiedAccess.employeeId===session.employeeId&&verifiedAccess.token===session.token);
}
function isOwner(){return hasVerifiedAccess()&&verifiedAccess.owner===true;}
function canUseDocuments(){return hasVerifiedAccess()&&verifiedAccess.documents===true;}
function canAccessView(id){
  if(!hasVerifiedAccess())return false;
  if(isOwner())return true;
  if(['view-more','view-kp','view-contracts'].includes(id))return canUseDocuments();
  if(id==='view-projects')return canSeeProjects();
  if(['view-construction','view-object'].includes(id))return canSeeConstruction();
  return false;
}
function clearPrivateState(){
  for(const key of ['projects','financialProjects','financialStatusHistory','ledger','photos','history','cashCounts','invoices','tzForms','tzReferences','kpForms','kpCatalog','timesheetPayments','companyExpenses','companyIncome','projectStages','projectMembers'])state[key]=[];
  state.employees=(state.employees||[]).map(e=>({id:e.id,name:e.name,active:e.active}));
  if(typeof resetContractCustomer==='function')resetContractCustomer();
  document.getElementById('ct-project-dialog')?.close?.();
  document.getElementById('ct-project-results')?.replaceChildren();
  window.ARHITTEKJournal?.clear();state.companyInfo=null;state.financialJournal=null;state.financialDataReady=false;state.financialLoadedAt=null;
  state.trash={projects:[],employees:[],categories:[],ledger:[],companyExpenses:[],companyIncome:[],tariffs:[]};
  for(const id of ['analyticsContent','timesheetContent','employeesCard','historyCard','trashCard','financeContent']){
    const el=document.getElementById(id);if(el)el.replaceChildren();
  }
  document.querySelectorAll('.sheet-overlay.active').forEach(el=>el.classList.remove('active'));
  for(const id of ['view-finance','view-timesheet'])document.getElementById(id)?.querySelectorAll('input,textarea').forEach(el=>el.value='');
}
function purgePrivateStorage(){
  for(const storage of [localStorage,sessionStorage]){
    try{for(const key of Object.keys(storage)){
      if(/^(forecast_|finance_|arhittek_finance_|arhittek_company_money_pending_)/.test(key))storage.removeItem(key);
    }}catch(e){}
  }
  try{companyMoneyPending.clear();companyMoneyForms.expense=null;companyMoneyForms.income=null;}catch(e){}
}
function revokeVerifiedAccess(){
  verifiedAccess=null;if(session)session.isAdmin=false;
  document.documentElement.dataset.access='locked';clearPrivateState();
}
async function verifyCurrentEmployeeAccess(){
  const actor={employeeId:session?.employeeId,token:session?.token};
  const result=await sb.rpc('get_employee_access',{});
  if(actor.employeeId!==session?.employeeId||actor.token!==session?.token)throw new Error('Учётная запись изменилась');
  if(result.error)throw result.error;
  const access=Array.isArray(result.data)?result.data[0]:result.data;
  if(!access||access.employee_id!==actor.employeeId||access.access_policy!=='owner-only-v1'||
     typeof access.is_owner!=='boolean'||typeof access.can_documents!=='boolean'){
    throw new Error('Не удалось подтвердить права доступа');
  }
  const role=String(access.role||'').trim().toLowerCase();
  verifiedAccess={...actor,owner:access.is_owner===true,
    documents:access.is_owner===true||(access.can_documents===true&&['ведущий архитектор','ведущий дизайнер'].includes(role))};
  session.isAdmin=verifiedAccess.owner;session.name=access.name;
  window.session=session;
  if(!verifiedAccess.owner){
    for(const key of ['ledger','cashCounts','timesheetPayments','companyExpenses','companyIncome','financialProjects','history'])state[key]=[];
    state.trash={projects:[],employees:[],categories:[],ledger:[],companyExpenses:[],companyIncome:[],tariffs:[]};
  }
  applyAccessVisibility();
  return actor;
}
function applyAccessVisibility(){
  const mode=isOwner()?'owner':canUseDocuments()?'lead':hasVerifiedAccess()?'staff':'locked';
  document.documentElement.dataset.access=mode;
  for(const nav of document.querySelectorAll('.nav-btn[data-view]'))nav.style.display=canAccessView(nav.dataset.view)?'':'none';
  for(const id of ['openKpBtn','openContractsBtn']){const el=document.getElementById(id);if(el)el.style.display=canUseDocuments()?'':'none';}
  for(const id of ['openCompanyBtn','openPriceListBtn','exportXlsxBtn','openTimesheetBtn','settingsBtn','more-admin-sections']){
    const el=document.getElementById(id);if(el)el.style.display=isOwner()?'':'none';
  }
  const active=document.querySelector('.view.active');
  if(!active||!canAccessView(active.id)){
    document.querySelectorAll('.view.active,.nav-btn.active').forEach(el=>el.classList.remove('active'));
    const fallback=hasVerifiedAccess()?(isOwner()?'view-overview':canSeeProjects()?'view-projects':canSeeConstruction()?'view-construction':canUseDocuments()?'view-more':null):null;
    if(fallback){document.getElementById(fallback)?.classList.add('active');document.querySelector('.nav-btn[data-view="'+fallback+'"]')?.classList.add('active');}
  }
}


function getSession(){
  try{
    const raw = localStorage.getItem('arhittek_session');
    if(!raw) return null;
    const s = JSON.parse(raw);
    if(!s || !s.employeeId) return null;
    // Проверяем срок действия — 30 дней (совпадает со сроком токена сессии в БД)
    const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    if(s.createdAt && Date.now() - s.createdAt > SESSION_TTL_MS){
      localStorage.removeItem('arhittek_session');
      return null;
    }
    s.isAdmin=false;
    window.session = s;
    if(s.token) applySessionToken(s.token);
    return s;
  }catch(e){ return null; }
}

function setSession(s){
  if(session?.employeeId!==s?.employeeId)purgePrivateStorage();
  revokeVerifiedAccess();
  session = {...s, isAdmin:false, createdAt: Date.now()};
  window.session = session;
  if(session.token) applySessionToken(session.token);
  try{ localStorage.setItem('arhittek_session', JSON.stringify(session)); }catch(e){}
}

function clearSession(){
  const token = session && session.token;
  purgePrivateStorage();
  revokeVerifiedAccess();
  session = null;window.session=null;applySessionToken(null);
  try{ localStorage.removeItem('arhittek_session'); }catch(e){}
  try{ sessionStorage.removeItem('arhittek_ui_route_v1'); }catch(e){}
  // Best-effort: гасим токен на сервере, чтобы им нельзя было воспользоваться повторно
  if(token){ try{ sb.rpc('logout_session', {p_token: token}); }catch(e){} }
  location.reload();
}

function showLoginScreen(){
  const overlay = document.getElementById('loginOverlay');
  overlay.style.display = 'flex';
  document.getElementById('loginStep1').style.display = '';
  document.getElementById('loginStep2').style.display = 'none';
  loginSelectedEmployee = null;

  const list = document.getElementById('loginEmployeeList');
  const employees = state.employees.filter(e=>e.active!==false);
  list.innerHTML = employees.map(e=>`
    <div class="list-item" style="cursor:pointer; padding:13px 0;" onclick="selectLoginEmployee('${e.id}')">
      <div class="li-name">${escapeHtml(e.name)}</div>
      <div class="icon-btn" style="font-size:16px;">›</div>
    </div>
  `).join('');
}

function selectLoginEmployee(employeeId){
  const emp = state.employees.find(e=>e.id===employeeId);
  if(!emp) return;
  loginSelectedEmployee = emp;
  document.getElementById('loginSelectedName').textContent = emp.name;
  document.getElementById('loginStep1').style.display = 'none';
  document.getElementById('loginStep2').style.display = '';
  document.getElementById('loginPin').value = '';
  document.getElementById('loginPin').focus();
}

async function attemptLogin(){
  if(!loginSelectedEmployee) return;
  const pin = document.getElementById('loginPin').value.trim();
  if(!pin){ showToast('Введите PIN-код'); return; }

  const submitBtn = document.getElementById('loginSubmitBtn');
  if(submitBtn) submitBtn.disabled = true;

  try{
    const { data, error } = await sb.rpc('verify_employee_pin', {
      p_employee_id: loginSelectedEmployee.id,
      p_pin: pin,
    });

    if(error){
      console.error(error);
      showToast('Ошибка входа. Попробуйте ещё раз.');
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if(!result || result.error === 'too_many_attempts'){
      showToast('Слишком много неверных попыток. Подождите несколько минут.');
      document.getElementById('loginPin').value = '';
      return;
    }
    if(!result.employee_id){
      showToast('Неверный PIN-код');
      document.getElementById('loginPin').value = '';
      return;
    }

    setSession({
      employeeId: result.employee_id,
      name: result.name,
      isAdmin: !!result.is_admin,
      token: result.session_token,
    });

    document.getElementById('loginOverlay').style.display = 'none';
    applyRole();
    // Данные (проекты, финансы и т.д.) были недоступны до входа (требуют сессии) —
    // перезагружаем их теперь, когда клиент несёт токен.
    await loadAll();
    setupRealtime();
    if('Notification' in window && Notification.permission === 'granted') subscribeToPush();
  }catch(e){
    console.error(e);
    showToast('Ошибка входа. Попробуйте ещё раз.');
  }finally{
    if(submitBtn) submitBtn.disabled = false;
  }
}

// Хелпер: является ли текущий сотрудник участником проекта (employee_id, co_employee_id или project_members)
function isProjectMember(projectId){
  if(!session) return false;
  if(session.isAdmin) return true;
  const p = state.projects.find(x=>x.id===projectId);
  if(p && (p.employee_id===session.employeeId || p.co_employee_id===session.employeeId)) return true;
  return (state.projectMembers||[]).some(m=>m.project_id===projectId && m.employee_id===session.employeeId);
}

// Хелпер: роль сотрудника (из поля role в employees)
function getEmployeeRole(){
  if(!session) return null;
  const emp = state.employees.find(e=>e.id===session.employeeId);
  return emp ? (emp.role||'').toLowerCase() : null;
}

// Эвристика по роли (используется как fallback, если can_see_construction не задано явно в БД,
// а также в форме сотрудника — чтобы предложить осмысленное значение по умолчанию)
function canSeeConstructionForRole(role){
  role = (role||'').toLowerCase();
  return !!(role && (role.includes('прораб') || role.includes('менеджер') || role.includes('manager')));
}

// Эвристика по роли для раздела "Проектный" (fallback)
function canSeeProjectsForRole(role){
  role = (role||'').toLowerCase();
  // По умолчанию все не-admin видят проектный, если явно не выключено
  return true;
}

// Может ли видеть строительный отдел
function canSeeConstruction(){
  if(!session) return false;
  if(session.isAdmin) return true;
  const emp = state.employees.find(e=>e.id===session.employeeId);
  if(emp && emp.can_see_construction === true) return true;
  if(emp && emp.can_see_construction === false) return false;
  // Поле не задано явно в БД — используем эвристику по роли
  return canSeeConstructionForRole(getEmployeeRole());
}

// This is a client-side workflow guard. Server RLS must independently verify
// the actor and membership; an open form never grants access by itself.
function canAccessConstructionProject(projectId,actor=null){
  if(!session||!canSeeConstruction())return false;
  if(actor&&(session.employeeId!==actor.employeeId||session.token!==actor.token||!!session.isAdmin!==!!actor.isAdmin))return false;
  const project=(state.projects||[]).find(p=>p.id===projectId&&!p.deleted_at);
  if(!project||!isConstructionProject(project))return false;
  if(session.isAdmin)return true;
  return !state.projectMembersDataError&&isProjectMember(projectId);
}

// Может ли видеть проектный отдел
function canSeeProjects(){
  if(!session) return false;
  if(session.isAdmin) return true;
  const emp = state.employees.find(e=>e.id===session.employeeId);
  if(emp && emp.can_see_projects === true) return true;
  if(emp && emp.can_see_projects === false) return false;
  // Поле не задано явно в БД — используем эвристику по роли
  return canSeeProjectsForRole(getEmployeeRole());
}

function applyRole(){
  const userPill = document.getElementById('userPill');
  if(!session){ userPill.style.display = 'none'; applyAccessVisibility(); return; }

  userPill.style.display = 'flex';
  const roleLabel = getEmployeeRole() ? ` · ${getEmployeeRole()}` : (session.isAdmin ? '' : ' · исполнитель');
  userPill.innerHTML = `<span style="font-weight:600;">${escapeHtml(session.name)}</span><span style="opacity:0.6;">${escapeHtml(roleLabel)}</span>`;

  const isAdmin = isOwner();
  const seeConstr = canSeeConstruction();
  const seeProj = canSeeProjects();

  document.getElementById('settingsBtn').style.display=isAdmin?'':'none';
  document.getElementById('exportXlsxBtn').style.display=isAdmin?'':'none';
  // Bottom nav — скрываем по ролям
  const navConstr = document.querySelector('.nav-btn[data-view="view-construction"]');
  const navProj = document.querySelector('.nav-btn[data-view="view-projects"]');
  const navOverview = document.querySelector('.nav-btn[data-view="view-overview"]');
  if(navConstr) navConstr.style.display = seeConstr ? '' : 'none';
  if(navProj) navProj.style.display = seeProj ? '' : 'none';

  if(navOverview) navOverview.style.display = isAdmin ? '' : 'none';

  // Кнопка Готовые проекты — только редакторам каталога (Мансур/Ислам)
  const navCards = document.getElementById('nav-cards');
  if(navCards) navCards.style.display = canEditCards() ? '' : 'none';

  applyCardsRole();

  // "Ещё" view: секции администратора
  const moreAdminSections = document.getElementById('more-admin-sections');
  if(moreAdminSections) moreAdminSections.style.display = isAdmin ? '' : 'none';

  // Финансы компании — только администратору (Мансур), теперь отдельная вкладка навигации
  const navFinance = document.getElementById('nav-finance');
  if(navFinance) navFinance.style.display = isAdmin ? '' : 'none';

  // Редиректим если текущий раздел недоступен
  const activeView = document.querySelector('.view.active');
  if(activeView){
    const hidden = (activeView.id==='view-overview' && !isAdmin)
      || (activeView.id==='view-finance' && !isAdmin)
      || (activeView.id==='view-settings' && !isAdmin)
      || (activeView.id==='view-construction' && !seeConstr)
      || (activeView.id==='view-projects' && !seeProj)
      || (activeView.id==='view-cards' && !canEditCards());
    if(hidden){
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      // Открываем первый доступный раздел
      const fallbackView = seeProj ? 'view-projects' : seeConstr ? 'view-construction' : 'view-more';
      document.getElementById(fallbackView)?.classList.add('active');
      document.querySelector(`.nav-btn[data-view="${fallbackView}"]`)?.classList.add('active');
    }
  }

  // Project sheet: hide financial section + delete button for non-admins
  const finSection = document.getElementById('pf-financial-section');
  const deleteBtn = document.getElementById('pf-delete');
  const empField = document.getElementById('pf-employee-field');
  const deptField = document.getElementById('pf-department-field');
  if(finSection) finSection.style.display = isAdmin ? '' : 'none';
  if(deleteBtn) deleteBtn.style.display = isAdmin ? '' : 'none';
  if(empField) empField.style.display = isAdmin ? '' : 'none';
  if(deptField) deptField.style.display = isAdmin ? '' : 'none';
  applyAccessVisibility();
}

// Permanently delete trash items older than 2 months (60 days)
const TRASH_RETENTION_DAYS = 60;
let trashPurgeInFlight = false;
async function purgeOldTrash(){
  if(trashPurgeInFlight) return;
  if(!session || !session.isAdmin) return; // только admin
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const tables = {
    projects: state.trash.projects,
    employees: state.trash.employees,
    categories: state.trash.categories,
    ledger_entries: state.trash.ledger,
  };
  const toDelete = [];
  Object.entries(tables).forEach(([table, items])=>{
    items.forEach(item=>{
      if(item.deleted_at && new Date(item.deleted_at).getTime() < cutoff){
        toDelete.push({table, id: item.id});
      }
    });
  });
  if(!toDelete.length) return;
  trashPurgeInFlight = true;
  try{
    for(const {table, id} of toDelete){
      await sb.from(table).delete().eq('id', id);
    }
  }catch(e){
    console.error('purgeOldTrash error', e);
  }finally{
    trashPurgeInFlight = false;
  }
}

