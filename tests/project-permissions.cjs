const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));

// Isolated fixtures reproduce the active lead designer's public role/visibility
// flags. No production project is created and no PIN or real session is used.
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.addInitScript(()=>{
  const create=supabase.createClient;
  supabase.createClient=function(){
   const client=create.apply(this,arguments),from=client.from;
   client.from=function(table){
    const q=from.call(this,table),insert=q.insert,update=q.update,then=q.then;let operation='select';
    q.insert=function(){operation='insert';return insert.apply(this,arguments);};
    q.update=function(){operation='update';return update.apply(this,arguments);};
    q.then=function(resolve,reject){return(async()=>{
     if(table==='projects'&&((operation==='insert'&&window.__holdProjectInsert)||operation===window.__holdProjectWriteOperation)){window.__projectInsertHeld=true;await new Promise(r=>window.__releaseProjectInsert=r);}
     return then.call(q,x=>x);
    })().then(resolve,reject);};
    return q;
   };
   return client;
  };
 });
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function fresh(profile={}){
  await page.goto('https://app.test/');await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);await page.waitForTimeout(50);
  await page.evaluate(async profile=>{
   const employee={id:'lead-designer',name:'Ведущий дизайнер',role:'Ведущий дизайнер',is_admin:false,active:true,can_edit_cards:false,can_see_projects:true,can_see_construction:true,is_salaried:true,fixed_salary:50000,...profile};
   __db.employees.push(employee);await loadAll();setSession({employeeId:employee.id,name:employee.name,isAdmin:!!employee.is_admin,token:'isolated-test'});await loadAll();applyRole();
   document.querySelector('.nav-btn[data-view="view-projects"]').click();__writes.length=0;
  },profile);
 }
 async function check(name,fn,expected){try{const actual=await page.evaluate(fn);assert.deepEqual(actual,expected);results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
 await fresh();
 await check('Lead designer sees the new-project action without company finances',()=>[getComputedStyle(document.getElementById('addProjectFab')).display!=='none',getComputedStyle(document.getElementById('nav-finance')).display,canEditCards()], [true,'none',false]);
 await page.locator('#addProjectFab').click();
 await check('New card assigns the lead designer and keeps team and money tabs hidden',()=>[document.getElementById('projectSheetOverlay').classList.contains('active'),document.getElementById('pf-employee').value,document.getElementById('project-tab-team').hidden,document.getElementById('project-tab-money').hidden],[true,'lead-designer',true,true]);
 await check('Lead designer creates an interior card with area and contacts',async()=>{
  document.getElementById('pf-name').value='Новый интерьер';document.getElementById('pf-area').value='86.5';document.getElementById('pf-phone').value='test contact';document.getElementById('pf-address').value='Test address';await saveProject();
  const p=__db.projects[0];return [__db.projects.length,p?.name,p?.area,p?.employee_id,p?.category_id,p?.phone,p?.address,p?.fee_base,document.getElementById('projectSheetOverlay').classList.contains('active')];
 },[1,'Новый интерьер',86.5,'lead-designer','design','test contact','Test address','m2',false]);
 await check('Creating a basic card does not write money or team rows',()=>__writes.filter(w=>['ledger_entries','company_expenses','company_income','project_members'].includes(w.table)).length,0);
 await fresh();
 await check('Architecture creation is not blocked by a hidden default forty-percent salary fee',async()=>{
  openProjectSheet(null);document.getElementById('pf-category').value='arch';document.getElementById('pf-category').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('pf-name').value='Новая архитектура';document.getElementById('pf-area').value='120';await saveProject();const p=__db.projects[0];
  return [__db.projects.length,p?.category_id,p?.area,p?.fee_percent,p?.co_fee_percent,p?.fee_base];
 },[1,'arch',120,0,0,'profit']);
 await fresh();
 await check('A basic create ignores hidden financial fields and employee reassignment',async()=>{
  openProjectSheet(null);document.getElementById('pf-name').value='Basic only';for(const [id,value]of Object.entries({'pf-price':'900000','pf-advance':'100000','pf-expenses':'8000','pf-feepaid':'6000','pf-co-feepaid':'4000','pf-feepercent':'80','pf-co-feepercent':'20','pf-employee':'architect','pf-employee-fee':'architect','pf-co-employee':'visual','pf-co-employee-fee':'visual'}))document.getElementById(id).value=value;currentProjectMembers=[{employee_id:'visual'}];await saveProject();
  const p=__db.projects[0];return [__db.projects.length,p?.price,p?.advance,p?.balance,p?.expenses,p?.fee_paid,p?.co_fee_paid,p?.fee_percent,p?.co_fee_percent,p?.employee_id,p?.co_employee_id,__writes.filter(w=>['ledger_entries','project_members'].includes(w.table)).length];
 },[1,0,0,0,0,0,0,0,0,'lead-designer',null,0]);
 await fresh();
 await check('Two rapid basic submits create exactly one project',async()=>{
  openProjectSheet(null);document.getElementById('pf-name').value='Single card';await Promise.all([saveProject(),saveProject()]);return __db.projects.length;
 },1);
 await fresh();
 await (async()=>{
  const name='A late create response never closes or replaces another opened card';
  try{
   await page.evaluate(async()=>{
    __db.projects=[{id:'other-open-card',name:'Other card',category_id:'arch',status_id:'active',employee_id:'architect',price:100000,fee_percent:40,fee_base:'profit'}];await loadAll();
    openProjectSheet(null);document.getElementById('pf-name').value='Slow created card';__holdProjectInsert=true;window.__creating=saveProject();
   });
   await page.waitForFunction(()=>window.__projectInsertHeld===true);
   await page.evaluate(()=>{openProjectSheet('other-open-card');__holdProjectInsert=false;__releaseProjectInsert();});
   await page.evaluate(()=>window.__creating);
   const actual=await page.evaluate(()=>[__db.projects.length,editingProjectId,document.getElementById('pf-name').value,document.getElementById('projectSheetOverlay').classList.contains('active')]);
   assert.deepEqual(actual,[2,'other-open-card','Other card',true]);results.push({name,pass:true});
  }catch(e){results.push({name,pass:false,error:e.message});}
 })();
 await fresh();
 await check('An empty card name is rejected before a database write',async()=>{openProjectSheet(null);await saveProject();return [__db.projects.length,document.getElementById('toast').textContent.includes('название')];},[0,true]);
 await check('A negative project area is rejected before a database write',async()=>{document.getElementById('pf-name').value='Invalid area';document.getElementById('pf-area').value='-5';await saveProject();return [__db.projects.length,document.getElementById('toast').textContent.toLowerCase().includes('площад')];},[0,true]);
 await check('An absent category is rejected instead of creating an unclassified card',async()=>{document.getElementById('pf-area').value='30';document.getElementById('pf-category').value='';await saveProject();return [__db.projects.length,document.getElementById('toast').textContent.toLowerCase().includes('категор')];},[0,true]);
 await fresh();
 await check('An insert failure preserves the draft and reports that saving failed',async()=>{
  openProjectSheet(null);document.getElementById('pf-name').value='Retry after offline';document.getElementById('pf-area').value='82';__fail={table:'projects',op:'insert'};await saveProject();__fail=null;
  return [__db.projects.length,document.getElementById('pf-name').value,document.getElementById('pf-area').value,document.getElementById('projectSheetOverlay').classList.contains('active'),document.getElementById('toast').textContent.toLowerCase().includes('ошибка')];
 },[0,'Retry after offline','82',true,true]);
 await check('Retry after an insert failure creates one card',async()=>{await saveProject();return [__db.projects.length,__db.projects[0]?.name];},[1,'Retry after offline']);
 await fresh();
 await check('A failed refresh after creation cannot turn a retry into a duplicate',async()=>{
  openProjectSheet(null);document.getElementById('pf-name').value='Saved before refresh';__fail={table:'projects',op:'select'};await saveProject();__fail=null;const saved=__db.projects.length,notice=document.getElementById('toast').textContent;await saveProject();return [saved,__db.projects.length,notice.includes('Проект создан'),notice.includes('обновить список')];
 },[1,1,true,true]);
 await fresh();
 await check('A thrown refresh error still reports that the server accepted the card',async()=>{
  openProjectSheet(null);document.getElementById('pf-name').value='Accepted card';const previous=loadAll;loadAll=async()=>{throw new Error('Refresh disconnected');};
  await saveProject();loadAll=previous;const notice=document.getElementById('toast').textContent;await saveProject();
  return [__db.projects.length,notice.includes('Проект создан'),notice.includes('Ошибка сохранения')];
 },[1,true,false]);
 await fresh();
 await check('An unavailable construction department cannot be used for a basic card',async()=>{
  const employee=state.employees.find(e=>e.id==='lead-designer');employee.can_see_construction=false;
  openProjectSheet(null);document.getElementById('pf-name').value='Restricted construction';document.getElementById('pf-category').value='build';await saveProject();return [__db.projects.length,document.getElementById('toast').textContent.includes('Нет доступа')];
 },[0,true]);
 await fresh();
 await check('Project completion still requires the administrator',async()=>{
  openProjectSheet(null);document.getElementById('pf-name').value='Premature completion';document.getElementById('pf-status').value='done';await saveProject();return [__db.projects.length,document.getElementById('toast').textContent.includes('администратор')];
 },[0,true]);
 await fresh();
 await check('A reversed date range is rejected',async()=>{
  openProjectSheet(null);document.getElementById('pf-name').value='Invalid dates';document.getElementById('pf-start').value='2026-10-20';document.getElementById('pf-end').value='2026-10-19';await saveProject();return [__db.projects.length,document.getElementById('toast').textContent.includes('раньше')];
 },[0,true]);
 await fresh();
 await check('Declining a duplicate-address warning keeps one project and the unsaved card',async()=>{
  __db.projects=[{id:'same-address',name:'Existing address',category_id:'arch',status_id:'active',address:'Test address'}];await loadAll();
  openProjectSheet(null);document.getElementById('pf-name').value='Duplicate address';document.getElementById('pf-address').value='  TEST  ADDRESS ';window.confirm=()=>false;await saveProject();window.confirm=()=>true;
  return [__db.projects.length,document.getElementById('projectSheetOverlay').classList.contains('active')];
 },[1,true]);
 await fresh();
 await check('An audit-history failure does not reinsert an accepted basic project',async()=>{
  openProjectSheet(null);document.getElementById('pf-name').value='Saved without history';__fail={table:'audit_log',op:'insert'};await saveProject();__fail=null;await saveProject();return [__db.projects.length,__db.projects[0]?.name];
 },[1,'Saved without history']);
 await fresh();
 await check('Lead designer cannot overwrite an existing project contract',async()=>{
  __db.projects=[{id:'existing',name:'Contract',category_id:'arch',status_id:'active',employee_id:'architect',price:100000,advance:30000,balance:70000,fee_percent:40,fee_base:'profit',updated_at:'2026-10-19T00:00:00Z'}];await loadAll();openProjectSheet('existing');document.getElementById('pf-name').value='Forbidden edit';document.getElementById('pf-price').value='1';const n=__writes.length;await saveProject();return [__db.projects[0].name,__db.projects[0].price,__writes.length===n];
 },['Contract',100000,true]);
 for(const [label,profile]of [
  ['ordinary employee',{role:'Сотрудник',is_salaried:false}],
  ['visualizer',{role:'Визуализатор',is_salaried:false}],
  ['inactive lead designer',{active:false}],
  ['deleted lead designer',{deleted_at:'2026-10-19T00:00:00Z'}],
  ['lead designer without project access',{can_see_projects:false}],
 ]){
  await fresh(profile);
  await check(label+' has no new create or company-finance permission',async()=>{
   openProjectSheet(null);document.getElementById('pf-name').value='Forbidden';await saveProject();return [__db.projects.length,getComputedStyle(document.getElementById('nav-finance')).display];
  },[0,'none']);
 }
 await fresh();
 await check('An unauthenticated client cannot save a project',async()=>{setSession(null);openProjectSheet(null);document.getElementById('pf-name').value='Client request';await saveProject();return __db.projects.length;},0);
 await fresh();
 await check('Director keeps the existing financial project-save path',async()=>{
  setSession({employeeId:'admin',name:'Director',isAdmin:true,token:'isolated-admin'});applyRole();openProjectSheet(null);document.getElementById('pf-name').value='Director card';document.getElementById('pf-price').value='200000';await saveProject();return [__db.projects.length,__db.projects[0]?.price,__db.projects[0]?.fee_base];
 },[1,200000,'m2']);
 await fresh();
 await check('A membership read failure preserves the prior team and assigned employee visibility',async()=>{
  __db.projects=[{id:'member-visible',name:'Member visible project',category_id:'arch',status_id:'active',employee_id:'architect',price:100000,fee_percent:40,fee_base:'profit'}];
  __db.project_members=[{id:'existing-member',project_id:'member-visible',employee_id:'visual'}];await loadAll();
  setSession({employeeId:'visual',name:'Visualizer',isAdmin:false,token:'isolated-visual'});applyRole();__fail={table:'project_members',op:'select'};await loadAll();__fail=null;
  return [state.projectMembers.map(m=>m.id),!!state.projectMembersDataError,isProjectMember('member-visible'),document.getElementById('projectsCard').textContent.includes('Member visible project'),state.financialDataReady,document.getElementById('syncDot').classList.contains('off')];
 },[['existing-member'],true,true,true,true,true]);
 await fresh();
 await check('An administrator cannot save an unverified empty team or remove its last-known member',async()=>{
  setSession({employeeId:'admin',name:'Director',isAdmin:true,token:'isolated-admin'});applyRole();
  __db.projects=[{id:'member-safe',name:'Safe team',category_id:'arch',status_id:'active',employee_id:'architect',price:100000,fee_percent:40,fee_base:'profit'}];
  __db.project_members=[{id:'safe-member',project_id:'member-safe',employee_id:'visual'}];await loadAll();state.projectMembers=[];
  __fail={table:'project_members',op:'select'};await loadAll();__fail=null;openProjectSheet('member-safe');document.getElementById('pf-name').value='Must not save';
  const before=__writes.length;await saveProject();currentProjectMembers=[{employee_id:'visual'}];removeProjectMember('visual');
  return [__db.projects[0].name,__db.project_members.map(m=>m.employee_id),__writes.length===before,currentProjectMembers.length,document.getElementById('pf-members-add').disabled,!!document.querySelector('#pf-members-list [role="alert"]')];
 },['Safe team',['visual'],true,1,true,true]);
 await fresh();
 await check('Recovery rehydrates a card opened without a verified team before saving is enabled',async()=>{
  setSession({employeeId:'admin',name:'Director',isAdmin:true,token:'isolated-admin'});applyRole();
  __db.projects=[{id:'recover-team',name:'Recover team',category_id:'arch',status_id:'active',employee_id:'architect',price:100000,fee_percent:40,fee_base:'profit'}];
  __db.project_members=[{id:'recovered-member',project_id:'recover-team',employee_id:'visual'}];state.projectMembers=[];__fail={table:'project_members',op:'select'};await loadAll();__fail=null;
  openProjectSheet('recover-team');await loadAll();const recovered=[state.projectMembersDataError,currentProjectMembers.map(m=>m.employee_id),document.getElementById('pf-members-add').disabled,!!document.querySelector('#pf-members-list [role="alert"]')];
  document.getElementById('pf-name').value='Recovered metadata';await saveProject();return [...recovered,__db.project_members.map(m=>m.employee_id),__db.projects[0].name];
 },[null,['visual'],false,false,['visual'],'Recovered metadata']);
 await fresh();
 await check('Recovery preserves a deliberate team draft made before the read failed',async()=>{
  setSession({employeeId:'admin',name:'Director',isAdmin:true,token:'isolated-admin'});applyRole();
  __db.projects=[{id:'draft-team',name:'Draft team',category_id:'arch',status_id:'active',employee_id:'architect',price:100000,fee_percent:40,fee_base:'profit'}];
  __db.project_members=[{id:'draft-member',project_id:'draft-team',employee_id:'visual'}];await loadAll();openProjectSheet('draft-team');removeProjectMember('visual');
  __fail={table:'project_members',op:'select'};await loadAll();__fail=null;await loadAll();const draft=currentProjectMembers.map(m=>m.employee_id);await saveProject();return [draft,__db.project_members.length];
 },[[],0]);
 await fresh();
 await check('Lead designer can create a self-assigned basic card while an older team read fails',async()=>{
  __db.projects=[{id:'prior-team-project',name:'Prior team',category_id:'arch',status_id:'active',employee_id:'architect',fee_percent:40,fee_base:'profit'}];
  __db.project_members=[{id:'prior-team-member',project_id:'prior-team-project',employee_id:'visual'}];await loadAll();__fail={table:'project_members',op:'select'};await loadAll();
  openProjectSheet(null);document.getElementById('pf-name').value='Basic with membership warning';const before=__writes.length;await saveProject();__fail=null;
  const p=__db.projects.find(p=>p.name==='Basic with membership warning');return [p?.employee_id,p?.price,!!state.projectMembersDataError,state.projectMembers.map(m=>m.id),__writes.slice(before).filter(w=>w.table==='project_members').length,isProjectMember(p?.id),document.getElementById('projectsCard').textContent.includes('Basic with membership warning')];
 },['lead-designer',0,true,['prior-team-member'],0,true,true]);
 await fresh();
 await (async()=>{
  const name='A team read failure arriving during a project update blocks the later member delete';
  try{
   await page.evaluate(async()=>{
    setSession({employeeId:'admin',name:'Director',isAdmin:true,token:'isolated-admin'});applyRole();
    __db.projects=[{id:'late-team-error',name:'Before accepted metadata',category_id:'arch',status_id:'active',employee_id:'architect',price:100000,fee_percent:40,fee_base:'profit'}];
    __db.project_members=[{id:'late-member',project_id:'late-team-error',employee_id:'visual'}];await loadAll();openProjectSheet('late-team-error');removeProjectMember('visual');document.getElementById('pf-name').value='Accepted metadata';
    __holdProjectWriteOperation='update';window.__updating=saveProject();
   });
   await page.waitForFunction(()=>window.__projectInsertHeld===true);
   await page.evaluate(async()=>{__fail={table:'project_members',op:'select'};await loadAll();__fail=null;__holdProjectWriteOperation=null;__releaseProjectInsert();});
   await page.evaluate(()=>window.__updating);
   assert.deepEqual(await page.evaluate(()=>[__db.project_members.map(m=>m.employee_id),__db.projects[0].name,!!state.projectMembersDataError]),[['visual'],'Accepted metadata',true]);results.push({name,pass:true});
  }catch(e){results.push({name,pass:false,error:e.message});}
 })();
 await fresh();
 await check('A member-only realtime failure never announces a successful update',async()=>{
  realtimeToastShown=false;const notices=[],original=showToast;showToast=function(text){notices.push(text);return original.apply(this,arguments);};
  __fail={table:'project_members',op:'select'};scheduleReload('project_members');await new Promise(r=>setTimeout(r,1000));__fail=null;showToast=original;
  return [notices.some(t=>t.includes('Данные обновлены')),!!state.projectMembersDataError,state.financialDataReady,document.getElementById('syncDot').classList.contains('off')];
 },[false,true,true,true]);
 await fresh();
 await check('An authoritative empty membership read is distinct from a failed read',async()=>{
  __db.project_members=[{id:'empty-after-recovery',project_id:'project',employee_id:'visual'}];await loadAll();__fail={table:'project_members',op:'select'};await loadAll();__fail=null;__db.project_members=[];await loadAll();return [state.projectMembersDataError,state.projectMembers.length];
 },[null,0]);
 results.push({name:'Project-permission scenarios have no uncaught browser errors',pass:errors.length===0,...(errors.length?{error:errors.join('\n')}:{})});
 console.log(JSON.stringify(results,null,2));const failed=results.filter(r=>!r.pass);console.log(`${results.length-failed.length}/${results.length} passed`);
 await browser.close();process.exitCode=failed.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
