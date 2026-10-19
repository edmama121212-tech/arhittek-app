const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));

// This suite uses only a local, isolated database. Holds model responses that
// arrive after the user has navigated elsewhere or made another change.
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.addInitScript(()=>{
  sessionStorage.removeItem('arhittek_ui_route_v1');
  window.__heldQueries=[];window.__queryHold=null;
  const create=supabase.createClient;
  supabase.createClient=function(){
   const client=create.apply(this,arguments),from=client.from;
   client.from=function(table){
    const q=from.call(this,table);let op='select';
    for(const name of ['insert','upsert','update','delete']){
     const original=q[name];q[name]=function(){op=name==='upsert'?'insert':name;return original.apply(this,arguments);};
    }
    const then=q.then;
    async function pause(phase){
     const h=window.__queryHold;
     if(!h||h.table!==table||h.op!==op||(h.phase||'before')!==phase||h.remaining===0)return;
     if(Number.isFinite(h.remaining))h.remaining--;
     await new Promise(resolve=>window.__heldQueries.push({table,op,phase,release:resolve}));
    }
    q.then=function(resolve,reject){
     return (async()=>{await pause('before');const r=await then.call(q,x=>x);await pause('after');return r;})().then(resolve,reject);
    };
    return q;
   };
   return client;
  };
  window.__releaseQueries=()=>{for(const q of window.__heldQueries.splice(0))q.release();};
  window.__auditPull=(selector='.view.active .workspace-head',distance=100)=>{
   const target=document.querySelector(selector);
   const touch=y=>new Touch({identifier:17,target,clientX:100,clientY:y});
   const send=(name,y,ending=false)=>target.dispatchEvent(new TouchEvent(name,{bubbles:true,cancelable:name!=='touchstart',touches:ending?[]:[touch(y)],targetTouches:ending?[]:[touch(y)],changedTouches:[touch(y)]}));
   send('touchstart',120);send('touchmove',120+distance);send('touchend',120+distance,true);
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
 async function fresh(){
  await page.goto('https://app.test/');await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);await page.waitForTimeout(100);
  if(process.env.AUDIT_REFRESH_INJECT)await page.addScriptTag({path:path.join(root,'app-refresh.js')});
  await page.evaluate(async()=>{
   __db.projects=[{id:'audit-a',name:'Project A',category_id:'arch',status_id:'active',area:120,price:100000,advance:0,fee_base:'profit',employee_id:'architect',fee_percent:40,updated_at:'2026-10-19T00:00:00Z'},
    {id:'audit-b',name:'Project B',category_id:'arch',status_id:'active',area:75,price:50000,advance:0,fee_base:'profit',employee_id:'architect',fee_percent:40,updated_at:'2026-10-19T00:00:00Z'}];
   __db.project_stages=[{id:'audit-stage-a',project_id:'audit-a',name:'A custom stage',done:false,sort_order:0},
    {id:'audit-stage-b',project_id:'audit-b',name:'B custom stage',done:false,sort_order:0}];
   await loadAll();
  });
 }
 async function check(name,fn){if(process.env.AUDIT_TRACE)console.log(name);try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}finally{await page.evaluate(()=>{__queryHold=null;__releaseQueries();}).catch(()=>{});}}
 await fresh();
 await check('A late stage response never draws project A stages in project B',async()=>{
  await page.evaluate(()=>{openProjectSheet('audit-a');__queryHold={table:'project_stages',op:'update',remaining:1};window.__stageSave=markStageDone('audit-stage-a','audit-a');});
  await page.waitForFunction(()=>__heldQueries.length===1);
  await page.evaluate(()=>{openProjectSheet('audit-b');__releaseQueries();});
  await page.evaluate(()=>window.__stageSave);
  const r=await page.evaluate(()=>[editingProjectId,document.querySelector('#pf-stages-list').textContent.includes('B custom stage'),document.querySelector('#pf-stages-list').textContent.includes('A custom stage'),__db.project_stages.find(s=>s.id==='audit-stage-a').done]);
  assert.deepEqual(r,['audit-b',true,false,true]);
 });
 await fresh();
 await check('A late custom-stage addition preserves project B and its stage draft',async()=>{
  await page.evaluate(()=>{
   openProjectSheet('audit-a');document.getElementById('pf-stage-name').value='New stage for A';
   __queryHold={table:'project_stages',op:'insert',remaining:1};window.__stageAdd=addStage('audit-a');
  });
  await page.waitForFunction(()=>__heldQueries.length===1);
  await page.evaluate(()=>{openProjectSheet('audit-b');document.getElementById('pf-stage-name').value='Unsaved stage for B';__releaseQueries();});
  await page.evaluate(()=>window.__stageAdd);
  const r=await page.evaluate(()=>[editingProjectId,document.querySelector('#pf-stages-list').textContent.includes('B custom stage'),document.querySelector('#pf-stages-list').textContent.includes('New stage for A'),document.getElementById('pf-stage-name').value,__db.project_stages.some(s=>s.project_id==='audit-a'&&s.name==='New stage for A')]);
  assert.deepEqual(r,['audit-b',true,false,'Unsaved stage for B',true]);
 });
 await fresh();
 await check('Stage checkmarks respond before a slow server and do not change money',async()=>{
  await page.evaluate(()=>{
   openProjectSheet('audit-a');window.__moneyBefore=JSON.stringify([__db.ledger_entries||[],__db.company_expenses||[],__db.company_income||[]]);
   __queryHold={table:'project_stages',op:'update',remaining:1};window.__stageSave=markStageDone('audit-stage-a','audit-a');
  });
  await page.waitForFunction(()=>__heldQueries.length===1);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#pf-stages-list .stage-item')].find(e=>e.textContent.includes('A custom stage')).querySelector('.stage-check').classList.contains('done')),true);
  await page.evaluate(()=>__releaseQueries());await page.evaluate(()=>window.__stageSave);
  assert.equal(await page.evaluate(()=>JSON.stringify([__db.ledger_entries||[],__db.company_expenses||[],__db.company_income||[]])===__moneyBefore),true);
 });
 await fresh();
 await check('A failed stage change rolls back its checkmark and reports failure',async()=>{
  const r=await page.evaluate(async()=>{
   openProjectSheet('audit-a');__fail={table:'project_stages',op:'update'};await markStageDone('audit-stage-a','audit-a');__fail=null;
   return [__db.project_stages.find(s=>s.id==='audit-stage-a').done,[...document.querySelectorAll('#pf-stages-list .stage-item')].find(e=>e.textContent.includes('A custom stage')).querySelector('.stage-check').classList.contains('done'),document.getElementById('toast').textContent.includes('Ошибка')];
  });assert.deepEqual(r,[false,false,true]);
 });
 await fresh();
 await check('A background refresh preserves project text, selection, tab, focus and scroll',async()=>{
  const r=await page.evaluate(async()=>{
   openProjectSheet('audit-a');await new Promise(r=>setTimeout(r,0));document.getElementById('project-tab-team').click();
   const name=document.getElementById('pf-name');name.value='Unsaved project draft';name.dispatchEvent(new Event('input',{bubbles:true}));
   document.getElementById('pf-feepercent').value='37';
   const input=document.getElementById('pf-feepercent');input.focus();
   const sheet=document.querySelector('#projectSheetOverlay .sheet');sheet.scrollTop=200;const scroll=sheet.scrollTop;
   await loadAll();
   return [name.value,input.value,document.activeElement.id,document.getElementById('project-tab-team').getAttribute('aria-selected'),sheet.scrollTop===scroll,document.getElementById('projectSheetOverlay').dataset.dirty];
  });assert.deepEqual(r,['Unsaved project draft','37','pf-feepercent','true',true,'1']);
 });
 await fresh();
 await check('Cancelling a dirty project close keeps the draft open',async()=>{
  const r=await page.evaluate(()=>{
   openProjectSheet('audit-a');const input=document.getElementById('pf-name');input.value='Do not lose';input.dispatchEvent(new Event('input',{bubbles:true}));
   window.confirm=()=>false;document.getElementById('pf-cancel').click();window.confirm=()=>true;
   return [document.getElementById('projectSheetOverlay').classList.contains('active'),input.value];
  });assert.deepEqual(r,[true,'Do not lose']);
 });
 await fresh();
 await check('A reload requested during an older snapshot publishes the newer cash receipt',async()=>{
  await page.evaluate(()=>{__queryHold={table:'company_income',op:'select',phase:'after',remaining:1};window.__firstLoad=loadAll();});
  await page.waitForFunction(()=>__heldQueries.length===1);
  await page.evaluate(()=>{
   __db.company_income.push({id:'audit-new-income',category:'Прочее',amount:7500,income_date:'2026-10-19',description:'New receipt',created_at:'2026-10-19T14:00:00Z'});
   window.__secondLoad=loadAll();__releaseQueries();
  });
  await page.evaluate(()=>Promise.all([window.__firstLoad,window.__secondLoad]));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>state.companyIncome.some(x=>x.id==='audit-new-income')),true);
 });
 await fresh();
 await check('A failed realtime refresh never announces that data were updated',async()=>{
  const r=await page.evaluate(async()=>{
   document.getElementById('toast').textContent='';realtimeToastShown=false;
   const announced=[];const original=showToast;showToast=function(text){announced.push(text);return original.apply(this,arguments);};
   __fail={table:'company_expenses',op:'select'};scheduleReload('company_expenses');await new Promise(r=>setTimeout(r,1000));__fail=null;showToast=original;
   return [announced.some(t=>t.includes('Данные обновлены')),state.financialDataReady,document.getElementById('syncDot').classList.contains('off')];
  });assert.deepEqual(r,[false,false,true]);
 });
 await fresh();
 await check('A mobile pull refresh waits for the server and coalesces duplicate gestures',async()=>{
  await page.evaluate(()=>{
   __queryHold={table:'projects',op:'select',remaining:1};window.__pullReadStart=__reads.length;window.__pullMoney=JSON.stringify([__db.ledger_entries,__db.company_income,__db.company_expenses]);
   __auditPull();
  });
  await page.waitForFunction(()=>__heldQueries.length===1);
  const waiting=await page.evaluate(()=>{
   __auditPull();const p=ARHITTEKRefresh.refresh();const second=ARHITTEKRefresh.refresh();window.__pullPromise=p;
   return [ARHITTEKRefresh.state,ARHITTEKRefresh.isRefreshing,document.getElementById('appRefreshIndicator').getAttribute('aria-busy'),p===second];
  });assert.deepEqual(waiting,['refreshing',true,'true',true]);
  await page.evaluate(()=>__releaseQueries());assert.equal(await page.evaluate(()=>window.__pullPromise),true);
  const r=await page.evaluate(()=>[ARHITTEKRefresh.state,ARHITTEKRefresh.isRefreshing,__reads.slice(__pullReadStart).filter(r=>r.table==='projects'&&r.offset===0).length,JSON.stringify([__db.ledger_entries,__db.company_income,__db.company_expenses])===__pullMoney]);
  // Main and trash project reads are separate; there must be one main pass.
  assert.deepEqual(r,['success',false,2,true]);
 });
 await fresh();
 await check('A short pull and horizontal swipe do not refresh the application',async()=>{
  const r=await page.evaluate(async()=>{
   const before=__reads.length;__auditPull(undefined,25);await new Promise(r=>setTimeout(r,20));
   const target=document.querySelector('.view.active .workspace-head'),touch=(x,y)=>new Touch({identifier:3,target,clientX:x,clientY:y});
   for(const [name,x,y,ending]of[['touchstart',100,120,false],['touchmove',220,140,false],['touchend',220,140,true]])target.dispatchEvent(new TouchEvent(name,{bubbles:true,cancelable:true,touches:ending?[]:[touch(x,y)],changedTouches:[touch(x,y)]}));
   await new Promise(r=>setTimeout(r,20));return [__reads.length===before,ARHITTEKRefresh.state];
  });assert.deepEqual(r,[true,'idle']);
 });
 await fresh();
 await check('A pull gesture cannot refresh over an open project or lose its draft',async()=>{
  const r=await page.evaluate(async()=>{
   openProjectSheet('audit-a');await new Promise(r=>setTimeout(r,0));
   const input=document.getElementById('pf-name');input.value='Mobile draft';input.dispatchEvent(new Event('input',{bubbles:true}));
   const before=__reads.length;__auditPull();await new Promise(r=>setTimeout(r,20));
   return [__reads.length===before,ARHITTEKRefresh.state,input.value,document.getElementById('projectSheetOverlay').classList.contains('active')];
  });assert.deepEqual(r,[true,'idle','Mobile draft',true]);
 });
 await fresh();
 await check('A failed pull refresh reports failure and can be retried',async()=>{
  const r=await page.evaluate(async()=>{
   __fail={table:'company_expenses',op:'select'};const failed=await ARHITTEKRefresh.refresh();
   const error=[failed,ARHITTEKRefresh.state,document.getElementById('appRefreshIndicator').textContent.includes('Не удалось'),state.financialDataReady];
   __fail=null;const retried=await ARHITTEKRefresh.refresh();return [...error,retried,ARHITTEKRefresh.state,state.financialDataReady];
  });assert.deepEqual(r,[false,'error',true,false,true,'success',true]);
 });
 async function leadDesigner(){
  await fresh();
  await page.evaluate(async()=>{
   __db.employees.push({id:'audit-lead',name:'Lead designer',role:'Ведущий дизайнер',is_admin:false,active:true,is_salaried:true,fixed_salary:50000,can_see_projects:true,can_see_construction:true,can_edit_cards:false});
   await loadAll();setSession({employeeId:'audit-lead',name:'Lead designer',isAdmin:false,token:'isolated-lead'});applyRole();
   document.querySelector('.nav-btn[data-view="view-projects"]').click();
  });
 }
 await leadDesigner();
 await check('The lead designer sees an actionable create button and clear financial responsibility',async()=>{
  assert.equal(await page.locator('#addProjectFab').isVisible(),true);
  await page.locator('#addProjectFab').click();
  const note=page.getByText('Карточка будет создана с вами в качестве исполнителя. Стоимость, оплату и условия команды заполняет администратор.',{exact:true});
  await note.scrollIntoViewIfNeeded();
  assert.equal(await note.isVisible(),true);
  const r=await page.evaluate(()=>[getComputedStyle(document.getElementById('pf-save')).display!=='none',document.getElementById('pf-save').disabled,document.getElementById('project-tab-team').hidden,document.getElementById('project-tab-money').hidden,getComputedStyle(document.getElementById('nav-finance')).display]);
  assert.deepEqual(r,[true,false,true,true,'none']);
 });
 await leadDesigner();
 await check('A lead designer gets one accepted-create notice and sees the card without a membership read',async()=>{
  await page.locator('#addProjectFab').click();
  await page.evaluate(()=>{
   document.getElementById('pf-category').value='arch';document.getElementById('pf-category').dispatchEvent(new Event('change',{bubbles:true}));
   document.getElementById('pf-name').value='Accepted lead card';document.getElementById('pf-area').value='150';
   window.__leadBefore=__db.projects.length;window.__leadNotices=[];window.__leadShowToast=showToast;
   showToast=function(message){__leadNotices.push(message);return __leadShowToast.apply(this,arguments);};
   __queryHold={table:'projects',op:'insert',remaining:1};__fail={table:'project_members',op:'select'};
  });
  await page.locator('#pf-save').click();await page.waitForFunction(()=>__heldQueries.length===1);
  assert.deepEqual(await page.evaluate(()=>[__db.projects.length===__leadBefore,__leadNotices.some(t=>/Проект (добавлен|создан)/.test(t))]),[true,false]);
  await page.evaluate(()=>__releaseQueries());
  await page.waitForFunction(()=>!document.getElementById('projectSheetOverlay').classList.contains('active')&&__leadNotices.some(t=>/Проект (добавлен|создан)/.test(t)));
  const r=await page.evaluate(()=>{
   showToast=__leadShowToast;__fail=null;const p=__db.projects.find(p=>p.name==='Accepted lead card');
   return [__db.projects.length-__leadBefore,__leadNotices.filter(t=>/Проект (добавлен|создан)/.test(t)).length,document.getElementById('projectsCard').textContent.includes('Accepted lead card'),p.employee_id,p.fee_percent,p.price,state.projectMembers.length,isProjectMember(p.id),session.isAdmin];
  });assert.deepEqual(r,[1,1,true,'audit-lead',0,0,0,true,false]);
 });
 await browser.close();
 console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors},null,2));
 if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
