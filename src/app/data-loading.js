// ============================================================
// DATA LOADING
// ============================================================
// Task 10: ТЗ badge — уведомление о новых заполненных ТЗ
const TZ_SEEN_KEY = 'arhittek_tz_seen';
function updateTzBadge(){
  if(!session || !session.isAdmin) return;
  const seenStr = localStorage.getItem(TZ_SEEN_KEY) || '1970-01-01';
  const seenDate = new Date(seenStr);
  const newCount = (state.tzForms || []).filter(f=>{
    return f.status === 'Заполнено' && f.submitted_at && new Date(f.submitted_at) > seenDate;
  }).length;
  // Update badge on nav or tz-related buttons
  let badge = document.getElementById('tz-nav-badge');
  if(!badge){
    // Find the "ТЗ" section label or any nav element referencing TZ
    const tzBtns = document.querySelectorAll('[onclick*="openTz"], [onclick*="tz"], #pf-tz-create');
    if(tzBtns.length === 0) return;
  }
  // Show badge on all tz buttons in project views
  document.querySelectorAll('.pf-tz-btn, #pf-tz-create, [data-tz-badge]').forEach(el=>{
    let b = el.querySelector('.tz-badge');
    if(newCount > 0){
      if(!b){ b = document.createElement('span'); b.className='tz-badge'; el.style.position='relative'; el.appendChild(b); }
      b.textContent = newCount;
      b.style.cssText = 'position:absolute;top:-6px;right:-6px;background:#e74c3c;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;pointer-events:none;';
    } else {
      if(b) b.remove();
    }
  });
  // Also update section label
  const tzLabel = document.querySelector('.section-label .lbl-text');
  // Use a dedicated badge next to "Технические задания" list header if visible
  const tzListHeader = document.getElementById('tz-list-header');
  if(tzListHeader){
    let b = document.getElementById('tz-header-badge');
    if(newCount > 0){
      if(!b){ b = document.createElement('span'); b.id='tz-header-badge'; b.style.cssText='background:#e74c3c;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:700;margin-left:8px;'; tzListHeader.appendChild(b); }
      b.textContent = '+ ' + newCount + ' новых';
    } else {
      if(b) b.remove();
    }
  }
}
function markTzSeen(){
  localStorage.setItem(TZ_SEEN_KEY, new Date().toISOString());
  updateTzBadge();
}

// Profile data comes from a narrow server API; raw employee rows contain PINs.
const EMPLOYEE_PROFILE_FIELDS=['id','name','role','is_admin','active','can_edit_cards','can_see_projects','can_see_construction','is_salaried','fixed_salary','deleted_at','created_at'];
function isMissingEmployeeRpc(result){
  const error=result?.error;if(!error)return false;
  if(error.code==='PGRST202')return true;
  return Number(result.status||error.status)===404&&(!error.code||error.code==='404');
}
function isMissingEmployeeSalaryColumn(error){
  return !!(error&&['42703','PGRST204'].includes(error.code)&&/is_salaried|fixed_salary/.test(error.message||''));
}
function employeeRowsResult(result,fields){
  if(result?.error)return result;
  if(!Array.isArray(result?.data)||result.data.some(row=>!row||typeof row!=='object'||typeof row.id!=='string'||typeof row.name!=='string')){
    return {data:null,error:{code:'EMPLOYEE_PROFILE_RESPONSE',message:'Не удалось проверить список сотрудников'}};
  }
  return {...result,data:result.data.map(row=>{
    const safe={};for(const key of fields)if(Object.hasOwn(row,key))safe[key]=row[key];
    if(fields===EMPLOYEE_PROFILE_FIELDS&&!isOwner()){safe.fixed_salary=null;safe.is_salaried=null;safe.is_admin=false;}
    return safe;
  })};
}
// Compatibility is only for the interval before the safe RPCs are installed.
// Permission/network failures must never fall back to a broader table query.
async function fetchEmployeesResilient(filterFn){
  let res=await fetchAllRows(()=>filterFn(sb.from('employees').select(EMPLOYEE_PROFILE_FIELDS.join(','),{count:'exact'})));
  if(isMissingEmployeeSalaryColumn(res.error)){
    const fields=EMPLOYEE_PROFILE_FIELDS.filter(key=>!['is_salaried','fixed_salary'].includes(key));
    res=await fetchAllRows(()=>filterFn(sb.from('employees').select(fields.join(','),{count:'exact'})));
  }
  return employeeRowsResult(res,EMPLOYEE_PROFILE_FIELDS);
}
async function loadEmployeesSafe({deleted=false}={}){
  let result;
  try{result=await sb.rpc('get_employee_profiles',{});}catch(error){return {data:null,error};}
  if(isMissingEmployeeRpc(result))return fetchEmployeesResilient(query=>deleted?query.not('deleted_at','is',null).order('deleted_at',{ascending:false}):query.is('deleted_at',null).order('name'));
  result=employeeRowsResult(result,EMPLOYEE_PROFILE_FIELDS);
  if(result.error)return result;
  const rows=result.data.filter(employee=>deleted?employee.deleted_at!=null:employee.deleted_at==null);
  rows.sort((a,b)=>deleted?String(b.deleted_at).localeCompare(String(a.deleted_at))||a.id.localeCompare(b.id):a.name.localeCompare(b.name,'ru')||a.id.localeCompare(b.id));
  return {...result,data:rows,count:rows.length};
}
async function loadEmployeeLoginOptions(){
  let result;
  try{result=await sb.rpc('get_employee_login_options',{});}catch(error){return {data:null,error};}
  if(isMissingEmployeeRpc(result))result=await fetchAllRows(()=>sb.from('employees').select('id,name,active',{count:'exact'}).is('deleted_at',null).order('name'));
  result=employeeRowsResult(result,['id','name','active']);
  if(result.error)return result;
  return {...result,data:result.data.filter(employee=>employee.active!==false).sort((a,b)=>a.name.localeCompare(b.name,'ru')||a.id.localeCompare(b.id))};
}

function loadAll(){
  if(loadAllPromise){loadAllQueued=true;return loadAllPromise;}
  loadAllPromise=(async()=>{
    do{loadAllQueued=false;await loadAllData();}while(loadAllQueued);
  })().finally(()=>{loadAllPromise=null;});
  return loadAllPromise;
}
async function loadAllData(){
  if(loadAllInFlight) return;
  loadAllInFlight = true;
  setSyncStatus('loading', 'синхронизация…');
  // Восстанавливаем токен сессии (если есть) ДО запроса данных — большинство
  // таблиц требует его через RLS, иначе первый запрос после перезагрузки страницы
  // придёт без заголовка и вернёт пусто.
  if(!session) session = getSession();
  if(!session?.token){
    session=null;window.session=null;
    applySessionToken(null);
    revokeVerifiedAccess();applyAccessVisibility();
    try{
      const result=await loadEmployeeLoginOptions();
      if(result.error) throw result.error;
      state.employees=result.data||[];
      setSyncStatus('on','войдите в приложение');
    }catch(e){setSyncStatus('off','нет связи');showToast('Не удалось загрузить список сотрудников');}
    showLoginScreen();loadAllInFlight=false;return;
  }
  const accessActor={employeeId:session.employeeId,token:session.token};
  let accessConfirmed=false;
  try{
    await verifyCurrentEmployeeAccess();
    accessConfirmed=true;
    const ownerRead=read=>isOwner()?read():Promise.resolve({data:[],error:null,count:0});
    const documentRead=read=>canUseDocuments()?read():Promise.resolve({data:[],error:null,count:0});
    const stageRead=beginStageRead();
    const [proj, emp, cat, st, dept, led, photos, invs, tzForms, tzRefs, company, kpForms, stages, members, kpCat, tsPay, compExp, compInc, counts, statusHistory, journal] = await Promise.all([
      fetchAllRows(()=>sb.from('projects').select('*',{count:'exact'}).order('created_at', {ascending:true})),
      loadEmployeesSafe(),
      fetchAllRows(()=>sb.from('categories').select('*',{count:'exact'}).is('deleted_at', null).order('sort_order')),
      fetchAllRows(()=>sb.from('statuses').select('*',{count:'exact'}).order('sort_order')),
      fetchAllRows(()=>sb.from('departments').select('*',{count:'exact'}).order('sort_order')),
      ownerRead(()=>fetchAllRows(()=>sb.from('ledger_entries').select('*',{count:'exact'}).is('deleted_at', null).order('created_at', {ascending:false}))),
      fetchAllRows(()=>sb.from('expense_photos').select('*',{count:'exact'}).order('created_at', {ascending:false})),
      fetchAllRows(()=>sb.from('invoices').select('*',{count:'exact'}).order('invoice_date', {ascending:true})),
      fetchAllRows(()=>sb.from('tz_forms').select('*',{count:'exact'}).order('created_at', {ascending:false})),
      fetchAllRows(()=>sb.from('tz_references').select('*',{count:'exact'})),
      canUseDocuments()?sb.from('company_info').select('*').limit(1).maybeSingle():Promise.resolve({data:null,error:null}),
      documentRead(()=>fetchAllRows(()=>sb.from('kp_forms').select('*',{count:'exact'}).order('created_at', {ascending:false}))),
      fetchAllRows(()=>sb.from('project_stages').select('*',{count:'exact'}).order('sort_order', {ascending:true})),
      fetchAllRows(()=>sb.from('project_members').select('*',{count:'exact'})),
      documentRead(()=>fetchAllRows(()=>sb.from('kp_catalog').select('*',{count:'exact'}).is('deleted_at', null).order('sort_order', {ascending:true}))),
      ownerRead(()=>fetchAllRows(()=>sb.from('timesheet_payments').select('*',{count:'exact'}))),
      ownerRead(()=>fetchAllRows(()=>sb.from('company_expenses').select('*',{count:'exact'}).is('deleted_at', null))),
      ownerRead(()=>fetchAllRows(()=>sb.from('company_income').select('*',{count:'exact'}).is('deleted_at', null))),
      ownerRead(()=>fetchAllRows(()=>sb.from('audit_log').select('id,entity_type,entity_id,entity_name,action,changes,created_at',{count:'exact'}).eq('entity_type','reserve').eq('action','cash_count').order('created_at',{ascending:false}))),
      ownerRead(()=>fetchAllRows(()=>sb.from('audit_log').select('id,entity_id,changes,created_at',{count:'exact'}).eq('entity_type','project').order('created_at',{ascending:false}))),
      isOwner()?sb.rpc('get_financial_journal'):Promise.resolve({data:null,error:null}),
    ]);

    if(accessActor.employeeId!==session?.employeeId||accessActor.token!==session?.token||!hasVerifiedAccess())return;
    // kpForms and stages are optional — may not exist until migrations run
    const errs = [proj,emp,cat,st,dept,led,photos,invs,tzForms,tzRefs,company,tsPay,compExp,compInc,counts,statusHistory,journal].map(r=>r.error).filter(Boolean);
    if(errs.length) throw errs[0];
    if(isOwner()&&!ARHITTEKJournal.valid(journal.data))throw new Error("Сервер не подтвердил финансовый журнал");
    state.financialJournal=isOwner()?journal.data:null;
    const freshEmployee=(emp.data||[]).find(e=>e.id===session.employeeId);
    if(!freshEmployee||freshEmployee.active===false)throw new Error('Учётная запись недоступна');
    if(!isOwner()&&!['ведущий архитектор','ведущий дизайнер'].includes(String(freshEmployee.role||'').trim().toLowerCase()))verifiedAccess.documents=false;
    applyAccessVisibility();
    state.kpForms = !canUseDocuments()||kpForms.error ? [] : (kpForms.data || []);
    if(stages.error)failStageRead(stageRead,stages.error);
    else state.projectStages=mergeStageRead(stages.data,stageRead);
    // Membership affects visibility and edits: a failed read is not an empty team.
    const membersErrorBefore=!!state.projectMembersDataError;
    state.projectMembersDataError=members.error?(members.error.message||'Не удалось загрузить состав команды'):null;
    if(!members.error){
      state.projectMembers=members.data||[];
      // A card opened during a read failure never had a verified team draft.
      // Rehydrate it after recovery rather than saving its fallback as removals.
      if(projectMembersDraftUnverified&&document.getElementById('projectSheetOverlay').classList.contains('active')){
        currentProjectMembers=editingProjectId?state.projectMembers.filter(m=>m.project_id===editingProjectId).map(m=>({employee_id:m.employee_id})):[];
        projectMembersDraftUnverified=false;
      }
    }
    state.kpCatalog = !canUseDocuments()||kpCat.error ? [] : (kpCat.data || []);
    state.timesheetPayments = tsPay.error ? [] : (tsPay.data || []);
    state.companyExpenses = compExp.error ? [] : (compExp.data || []);
    state.companyIncome = compInc.error ? [] : (compInc.data || []);
    state.cashCounts = counts.data || [];
    state.financialStatusHistory=(statusHistory.data||[]).filter(row=>row.changes?.status_id);

    const projectRows=proj.data||[];
    state.financialProjects=isOwner()?projectRows:[];
    state.projects=projectRows.filter(p=>!p.deleted_at&&(isOwner()||p.employee_id===session.employeeId||p.co_employee_id===session.employeeId||
      (state.projectMembers||[]).some(m=>m.project_id===p.id&&m.employee_id===session.employeeId)));
    state.employees = emp.data || [];
    state.categories = cat.data || [];
    state.statuses = st.data || [];
    // Автосоздание статуса «Заморожен», если его ещё нет в БД (self-install, одна попытка за сессию)
    if(session?.isAdmin && !state.statuses.some(s=>s.name==='Заморожен') && !sessionStorage.getItem('arhittek_frozen_tried')){
      sessionStorage.setItem('arhittek_frozen_tried','1');
      try{
        const {data: frozenData, error: frErr} = await sb.from('statuses').insert({name:'Заморожен'}).select('*').single();
        if(frErr) throw frErr;
        if(frozenData) state.statuses.push(frozenData);
      }catch(frErr){ console.warn('Не удалось создать статус «Заморожен» автоматически — возможно, нужно добавить вручную', frErr); }
    }
    state.departments = dept.data || [];
    // Автосоздание категории «Ландшафтный дизайн» в проектном отделе (self-install, одна попытка за сессию)
    if(session?.isAdmin && !state.categories.some(c=>(c.name||'').toLowerCase().includes('ландшафт')) && !sessionStorage.getItem('arhittek_landscape_tried')){
      sessionStorage.setItem('arhittek_landscape_tried','1');
      try{
        // Берём отдел не строительный (проектный) — как у Архитектуры/Дизайна
        const constrDeptX = state.departments.find(d=>d.name==='Строительный отдел');
        const sampleCat = state.categories.find(c=>{
          if(constrDeptX && c.department_id === constrDeptX.id) return false;
          const nm = (c.name||'').toLowerCase();
          return !(nm.includes('строительств')||nm.includes('ремонт')||nm.includes('монтаж'));
        });
        const deptId = sampleCat ? sampleCat.department_id : (state.departments.find(d=>d.name!=='Строительный отдел')||{}).id;
        const payloadCat = {name:'Ландшафтный дизайн'};
        if(deptId) payloadCat.department_id = deptId;
        const {data: lcData, error: lcErr} = await sb.from('categories').insert(payloadCat).select('*').single();
        if(lcErr) throw lcErr;
        if(lcData) state.categories.push(lcData);
      }catch(lcErr){ console.warn('Не удалось создать категорию «Ландшафтный дизайн» автоматически — возможно, нужно добавить вручную', lcErr); }
    }
    state.ledger = led.data || [];
    state.photos = photos.data || [];
    state.invoices = invs.data || [];
    state.tzForms = tzForms.data || [];
    state.tzReferences = tzRefs.data || [];
    state.companyInfo = canUseDocuments()?(company.data||null):null;
    state.financialDataReady=true;state.financialDataError=null;state.financialLoadedAt=new Date().toISOString();

    // Показываем live-статус если realtime канал активен
    const isLive = realtimeChannel && realtimeChannel.state === 'joined';
    setSyncStatus(state.projectMembersDataError?'off':isLive?'live':'on',state.projectMembersDataError?'состав команды не обновлён':isLive?'live · обновляется':'синхронизировано');
    if(state.projectMembersDataError&&!membersErrorBefore)showToast('Не удалось обновить состав команды. Показаны прежние данные; изменения команды временно недоступны.');
    renderAll();
    if(document.getElementById('projectSheetOverlay').classList.contains('active'))renderProjectMemberChips();
    renderCurrentStages(editingProjectId);
    updateTzBadge();
    // Журнал аудита (до 5000 записей) и корзина удалённых объектов никому не
    // нужны для первого экрана — грузим их отдельно, в фоне, не задерживая
    // основную отрисовку (см. loadDeferredData).
    loadDeferredData();

    // Auth check (after first load, employees list is available)
    if(!session){
      session = getSession();
    }
    if(session){
      // Verify the session's employee still exists and is active
      const emp = state.employees.find(e=>e.id===session.employeeId);
      if(!emp || emp.active===false){
        clearSession();
        return;
      }
      session.isAdmin=isOwner();
      session.name=emp.name;
      document.getElementById('loginOverlay').style.display = 'none';
      applyRole();
      if(!window._pushSubscribeAttempted && 'Notification' in window && Notification.permission === 'granted'){
        window._pushSubscribeAttempted = true;
        subscribeToPush();
      }
    }else{
      showLoginScreen();
    }
  }catch(e){
    console.error(e);
    if(accessActor.employeeId===session?.employeeId&&accessActor.token===session?.token){
      if(accessConfirmed)clearPrivateState();else revokeVerifiedAccess();
      applyRole();
    }
    const wasOk = document.getElementById('syncDot').classList.contains('off') === false;
    setSyncStatus('off', 'нет связи');
    state.financialDataReady=false;
    state.financialDataError=e.message||'Не удалось загрузить операции';
    window.renderCashFinance?.();
    if(wasOk) showToast('Ошибка подключения к базе');
  }finally{
    loadAllInFlight = false;
    // Проверяем просрочки для уведомлений (один раз в день)
    if(typeof checkOverdueNotifications === 'function') checkOverdueNotifications();
  }
}

// Журнал аудита и корзина удалённых объектов — тяжёлые (audit_log до 5000 строк)
// и нужны только во вкладках «История»/«Корзина», поэтому грузятся отдельно от
// loadAll() и не задерживают первую отрисовку приложения. Перерисовывает те же
// (обычно скрытые) секции, что и renderAll(), когда данные приходят.
async function loadDeferredData(){
  if(!isOwner())return;
  const actor={employeeId:session.employeeId,token:session.token};
  try{
    const [hist, trashProj, trashEmp, trashCat, trashLed, trashCompanyExpenses, trashCompanyIncome, trashTariffs] = await Promise.all([
      fetchAllRows(()=>sb.from('audit_log').select('*',{count:'exact'}).order('created_at', {ascending:false}),{maxRows:5000}),
      fetchAllRows(()=>sb.from('projects').select('*',{count:'exact'}).not('deleted_at', 'is', null).order('deleted_at', {ascending:false})),
      loadEmployeesSafe({deleted:true}),
      fetchAllRows(()=>sb.from('categories').select('*',{count:'exact'}).not('deleted_at', 'is', null).order('deleted_at', {ascending:false})),
      fetchAllRows(()=>sb.from('ledger_entries').select('*',{count:'exact'}).not('deleted_at', 'is', null).order('deleted_at', {ascending:false})),
      fetchAllRows(()=>sb.from('company_expenses').select('*',{count:'exact'}).not('deleted_at', 'is', null).order('deleted_at', {ascending:false})),
      fetchAllRows(()=>sb.from('company_income').select('*',{count:'exact'}).not('deleted_at', 'is', null).order('deleted_at', {ascending:false})),
      fetchAllRows(()=>sb.from('kp_catalog').select('*',{count:'exact'}).not('deleted_at', 'is', null).order('deleted_at', {ascending:false})),
    ]);
    if(!isOwner()||actor.employeeId!==session.employeeId||actor.token!==session.token)return;
    state.history = hist.error ? [] : (hist.data || []);
    state.trash = {
      projects: trashProj.error ? [] : (trashProj.data || []),
      employees: trashEmp.error ? [] : (trashEmp.data || []),
      categories: trashCat.error ? [] : (trashCat.data || []),
      ledger: trashLed.error ? [] : (trashLed.data || []),
      companyExpenses: trashCompanyExpenses.error ? [] : (trashCompanyExpenses.data || []),
      companyIncome: trashCompanyIncome.error ? [] : (trashCompanyIncome.data || []),
      tariffs: trashTariffs.error ? [] : (trashTariffs.data || []),
    };
    // Loading must not trigger irreversible deletions from trash.
    renderHistory();
    renderTrash();
    if(state.financialDataReady && typeof renderCashFinance==='function') renderCashFinance();
  }catch(e){ console.error('loadDeferredData error', e); }
}
function renderAll(){
  if(isOwner())renderOverview();
  renderCategoryFilters();
  renderStatusFilters();
  renderPaymentFilters();
  renderEmployeeFilters();
  renderConstrStatusFilters();
  renderProjects();
  renderConstruction();
  if(isOwner()){renderFeeCalc();renderEmployeeFeeSummary();}
  // renderLedger убран — раздел Финансы удалён
  if(isOwner()){renderEmployees();renderCategories();renderTariffs();renderStatuses();renderHistory();renderTrash();}
  if(!document.getElementById('projectSheetOverlay').classList.contains('active')) populateProjectFormSelects();
  populateEmployeeFormSelects();
  if(document.getElementById('view-timesheet').classList.contains('active')) renderTimesheet();
}

