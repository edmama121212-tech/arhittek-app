const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const fixture=()=>{
  const params=new URL(location.href).searchParams,actor=params.get('actor')||'admin';
  __db.employees.push({id:'lead-architect',name:'Lead architect',role:'Ведущий архитектор',active:true},
   {id:'other-admin',name:'Мансур',role:'Генеральный директор',is_admin:true,active:true,fixed_salary:60000});
  __db.projects=__db.employees.map(e=>({id:'project-'+e.id,name:'Project '+e.id,employee_id:e.id,category_id:'arch',status_id:'active'}));
  const e=__db.employees.find(e=>e.id===actor);
  localStorage.setItem('arhittek_session',JSON.stringify({employeeId:e.id,name:'Мансур',isAdmin:true,token:'isolated-ui-session-'+e.id,createdAt:Date.now()}));
  sessionStorage.setItem('arhittek_ui_route_v1',JSON.stringify({employeeId:e.id,view:'view-finance'}));
  const create=supabase.createClient;
  supabase.createClient=function(){
   const client=create.apply(this,arguments);if(client.__rankWrapped)return client;client.__rankWrapped=true;
   const rpc=client.rpc;
   client.rpc=async function(name,args){
    if(name==='get_employee_access'){
     if(params.has('hold'))await new Promise(resolve=>window.__releaseAccess=resolve);
     if(params.has('missing')||window.__denyAccess)return {data:null,error:{code:'PGRST202',message:'Isolated unavailable policy'}};
    }
    return rpc.call(this,name,args);
   };
   return client;
  };
 };
 await context.addInitScript({content:'if(window===window.top){\n'+fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+'\n;('+fixture.toString()+')();\n}'});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])
   if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage();let checks=0;
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 for(const [actor,mode,documents]of [['admin','owner',true],['lead-architect','lead',true],['designer','lead',true],['architect','staff',false],['visual','staff',false],['other-admin','staff',false]]){
  await page.goto('https://app.test/?actor='+actor);
  await page.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&!loadAllInFlight,null,{timeout:10000});
  if(documents&&actor!=='admin')await page.locator('.nav-btn[data-view="view-more"]').click();
  const value=await page.evaluate(()=>{
   const visible=id=>{const el=document.getElementById(id);return !!el&&getComputedStyle(el).display!=='none'&&el.checkVisibility();};
   return {mode:document.documentElement.dataset.access,finance:visible('nav-finance'),
    more:getComputedStyle(document.querySelector('.nav-btn[data-view="view-more"]')).display!=='none',
    tools:[...document.querySelectorAll('#view-more button')].filter(el=>el.checkVisibility()).map(el=>el.id),
    reads:__reads.filter(x=>['ledger_entries','company_expenses','company_income','timesheet_payments','audit_log'].includes(x.table)).map(x=>x.table),
    projects:state.projects.map(p=>p.employee_id),salary:state.employees.some(e=>e.fixed_salary!=null),roleControl:document.getElementById('ef-role').tagName,
    active:document.querySelector('.view.active')?.id};
  });
  eq(value.mode,mode,'Rank mode '+actor);eq(value.roleControl,'SELECT','Position picker '+actor);
  eq(value.finance,actor==='admin','Finance '+actor);eq(value.more,documents,'More '+actor);
  if(actor!=='admin'){
   eq(value.reads,[],'No financial requests '+actor);eq(value.salary,false,'No payroll in client state '+actor);
   eq(value.projects,[actor],'Only assigned projects '+actor);
   eq(value.tools,documents?['openKpBtn','openContractsBtn']:[],'Only safe child buttons '+actor);
   eq(value.active!=='view-finance',true,'Stale finance route denied '+actor);
   const forced=await page.evaluate(()=>{
    document.getElementById('openTimesheetBtn').click();renderTimesheet();document.getElementById('view-finance').classList.add('active');
    return [getComputedStyle(document.getElementById('view-finance')).display,getComputedStyle(document.getElementById('view-timesheet')).display];
   });
   eq(forced,['none','none'],'Direct finance and payroll denied '+actor);
  }
 }
 await page.goto('https://app.test/?actor=admin&hold=1');
 await page.waitForFunction(()=>!!window.__releaseAccess,null,{timeout:10000});
 eq(await page.evaluate(()=>[document.documentElement.dataset.access,__reads.some(x=>['ledger_entries','company_expenses','timesheet_payments'].includes(x.table))]),['locked',false],'No privileged first paint or request before verification');
 await page.evaluate(()=>__releaseAccess());
 await page.waitForFunction(()=>typeof isOwner==='function'&&isOwner()&&!loadAllInFlight,null,{timeout:10000});
 eq(await page.evaluate(()=>isOwner()),true,'Owner unlocks only after verification');
 const revoked=await page.evaluate(async()=>{__denyAccess=true;await loadAll();return [isOwner(),document.documentElement.dataset.access,state.ledger.length,state.companyExpenses.length,state.timesheetPayments.length];});
 eq(revoked,[false,'locked',0,0,0],'Access error clears data and closes views');
 await page.goto('https://app.test/?actor=admin&missing=1');
 await page.waitForFunction(()=>typeof loadAllInFlight!=='undefined'&&!loadAllInFlight,null,{timeout:10000});
 eq(await page.evaluate(()=>[document.documentElement.dataset.access,isOwner(),__reads.some(x=>x.table==='company_expenses')]),['locked',false,false],'Missing policy never falls back to saved admin');
 console.log(checks+' owner/rank mobile browser checks passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
