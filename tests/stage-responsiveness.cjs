const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.addInitScript(()=>sessionStorage.removeItem('arhittek_ui_route_v1'));
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':undefined});
  }
  for(const [key,file] of [['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']]){
   if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  }
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function fresh(){
  await page.goto('https://app.test/');
  await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);
  await page.evaluate(async()=>{
   __db.projects=[{id:'a',name:'Project A',category_id:'design',status_id:'active'},{id:'b',name:'Project B',category_id:'arch',status_id:'active'}];
   __db.project_stages=[{id:'a-measure',project_id:'a',name:'Замеры',done:false,sort_order:5},{id:'a-visual',project_id:'a',name:'Визуализация',done:false,sort_order:2},{id:'b-custom',project_id:'b',name:'Проверка B',done:false,sort_order:5}];
   await loadAll();await new Promise(r=>setTimeout(r,20));openProjectSheet('a');__reads=[];__writes=[];
   window.__net={table:'project_stages',holdWrites:true,holdReads:false,holds:[],writeCalls:0,failWrites:[]};
   window.__tick=()=>new Promise(r=>setTimeout(r,0));
   const originalFrom=sb.from.bind(sb);
   sb.from=table=>{
    const q=originalFrom(table);let op='select',deletedRead=false;
    const originalNot=q.not.bind(q);q.not=(...args)=>{deletedRead=true;return originalNot(...args)};
    for(const method of ['insert','update','delete']){
     const original=q[method].bind(q);q[method]=(...args)=>{op=method;return original(...args)};
    }
    const originalThen=q.then.bind(q);
    q.then=(resolve,reject)=>{
     const writing=op!=='select';
     const attempt=table==='project_stages'&&writing?++__net.writeCalls:0;
     const submit=()=>attempt&&__net.failWrites.includes(attempt)
      ? Promise.resolve({data:null,error:{message:'Delayed stage write failed'}})
      : new Promise((res,rej)=>originalThen(res,rej));
     if(table===__net.table && !deletedRead && ((writing&&__net.holdWrites)||(!writing&&__net.holdReads))){
      if(writing)return new Promise((res,rej)=>__net.holds.push({table,op,attempt,release:()=>submit().then(res,rej)})).then(resolve,reject);
      return submit().then(result=>new Promise(res=>__net.holds.push({table,op,attempt,release:()=>res(result)}))).then(resolve,reject);
     }
     return submit().then(resolve,reject);
    };
    return q;
   };
   window.__release=async index=>{const [job]=__net.holds.splice(index||0,1);if(!job)throw new Error('No held request');job.release();await __tick();return job.attempt};
   window.__flush=async()=>{for(let i=0;i<30;i++){if(__net.holds.length)await __release();else if(!pendingStageChanges.size)return;else await __tick()}throw new Error('Stage queue did not drain')};
   window.__stageButton=name=>[...document.querySelectorAll('#pf-stages-list .stage-item')].find(el=>el.querySelector('.li-name').textContent===name)?.querySelector('.stage-check');
  });
 }
 async function check(name,fn,expected){
  await fresh();
  try{const actual=await page.evaluate(fn);assert.deepEqual(actual,expected);results.push({name,pass:true})}
  catch(e){results.push({name,pass:false,error:e.message})}
 }
 await check('Two adjacent stages change immediately while both requests are still held',async()=>{
  __stageButton('Замеры').click();__stageButton('Визуализация').click();
  const immediate=[__stageButton('Замеры').getAttribute('aria-pressed'),__stageButton('Визуализация').getAttribute('aria-pressed'),document.querySelectorAll('[data-stage-saving]').length];
  await __tick();const held=__net.holds.length,untouched=__db.project_stages.filter(s=>s.done).length;
  await __flush();return [immediate,held,untouched,__db.project_stages.filter(s=>s.done).length,__reads.filter(r=>r.table!=='audit_log').map(r=>r.table)];
 },[['true','true',2],2,0,2,[]]);
 await fresh();
 try{
  const target=await page.evaluate(()=>{
   const button=__stageButton('Замеры'),panel=button.closest('.project-panel');
   document.querySelector('[aria-controls="'+panel.id+'"]').click();button.scrollIntoView({block:'center'});
   const rect=button.getBoundingClientRect();return {x:rect.left-8,y:rect.top+rect.height/2,width:rect.width,labelsFit:[...document.querySelectorAll('#pf-stages-list .li-name')].every(el=>el.scrollWidth<=el.clientWidth+1)};
  });
  assert.equal(Math.round(target.width),22);assert.equal(target.labelsFit,true);
  await page.mouse.click(target.x,target.y);
  const actual=await page.evaluate(async()=>{const immediate=__stageButton('Замеры').classList.contains('done');await __tick();await __flush();return immediate});
  assert.equal(actual,true);results.push({name:'The mobile checkbox accepts a tap outside its 22px visual square',pass:true});
 }catch(e){results.push({name:'The mobile checkbox accepts a tap outside its 22px visual square',pass:false,error:e.message})}
 await check('Rapid repeat clicks on the same stage serialize and persist the last intent',async()=>{
  __stageButton('Замеры').click();__stageButton('Замеры').click();__stageButton('Замеры').click();await __tick();
  const before=[__net.holds.length,__stageButton('Замеры').classList.contains('done')];
  await __release();const next=[__net.holds.length,__stageButton('Замеры').classList.contains('done')];
  await __flush();return [before,next,__db.project_stages.find(s=>s.id==='a-measure').done,__net.writeCalls];
 },[[1,true],[1,true],true,2]);
 await check('A missing canonical stage creates one row even when toggled before insertion completes',async()=>{
  __stageButton('Чертежи').click();__stageButton('Чертежи').click();await __tick();
  const immediate=__stageButton('Чертежи').classList.contains('done');
  await __flush();await refreshProjectStages();
  const saved=__db.project_stages.filter(s=>s.project_id==='a'&&s.name==='Чертежи');
  return [immediate,saved.length,saved[0].done,state.projectStages.filter(s=>s.name==='Чертежи').length];
 },[false,1,false,1]);
 await check('Failure of an earlier request never rolls back a newer click',async()=>{
  __net.failWrites=[1];__stageButton('Замеры').click();__stageButton('Замеры').click();__stageButton('Замеры').click();await __tick();
  await __release();const afterOldFailure=__stageButton('Замеры').classList.contains('done');
  await __flush();return [afterOldFailure,__db.project_stages.find(s=>s.id==='a-measure').done,document.getElementById('toast').textContent.includes('Ошибка')];
 },[true,true,true]);
 await check('The latest failed request rolls back to the latest server-confirmed state only',async()=>{
  __net.failWrites=[3];__stageButton('Замеры').click();__stageButton('Замеры').click();__stageButton('Визуализация').click();await __tick();
  await __release(0);await __release(1);await __flush();
  return [__stageButton('Замеры').classList.contains('done'),__stageButton('Визуализация').classList.contains('done'),__db.project_stages.find(s=>s.id==='a-measure').done,__db.project_stages.find(s=>s.id==='a-visual').done,pendingStageChanges.size];
 },[true,true,true,true,0]);
 await check('A failed first insertion restores the canonical checkbox and can be retried',async()=>{
  __net.failWrites=[1];__stageButton('Чертежи').click();await __tick();await __flush();
  const rollback=[__stageButton('Чертежи').classList.contains('done'),state.projectStages.some(s=>s.name==='Чертежи')];
  __net.failWrites=[];__stageButton('Чертежи').click();await __tick();await __flush();
  return [rollback,__db.project_stages.filter(s=>s.name==='Чертежи').length,__stageButton('Чертежи').classList.contains('done')];
 },[[false,false],1,true]);
 await check('An update affecting no row reports an error instead of claiming success',async()=>{
  __db.project_stages=__db.project_stages.filter(s=>s.id!=='a-measure');
  __stageButton('Замеры').click();await __tick();await __flush();
  return [__stageButton('Замеры').classList.contains('done'),document.getElementById('toast').textContent.includes('Ошибка')];
 },[false,true]);
 await check('A full refresh cannot overwrite a stage that is still pending',async()=>{
  __net.holdReads=true;const refresh=loadAll();await __tick();
  __stageButton('Замеры').click();await __tick();await __release(0);await refresh;
  const during=state.projectStages.find(s=>s.id==='a-measure').done;
  __net.holdReads=false;await __flush();return [during,__stageButton('Замеры').classList.contains('done')];
 },[true,true]);
 await check('A stale read started before a successful write cannot undo its result',async()=>{
  __net.holdReads=true;const refresh=loadAll();await __tick();
  __stageButton('Замеры').click();await __tick();await __release(1);
  await __release(0);await refresh;
  return [state.projectStages.find(s=>s.id==='a-measure').done,__stageButton('Замеры').classList.contains('done'),pendingStageChanges.size];
 },[true,true,0]);
 await check('A fresh server read after acknowledgement can display another user’s change',async()=>{
  __stageButton('Замеры').click();await __tick();await __flush();
  __db.project_stages.find(s=>s.id==='a-measure').done=false;
  __net.holdWrites=false;await refreshProjectStages();
  return [state.projectStages.find(s=>s.id==='a-measure').done,__stageButton('Замеры').classList.contains('done')];
 },[false,false]);
 await check('An older read cannot replace a newer accepted remote change',async()=>{
  __net.holdReads=true;const oldRead=refreshProjectStages();await __tick();
  __stageButton('Замеры').click();await __tick();await __release(1);
  __db.project_stages.find(s=>s.id==='a-measure').done=false;
  __net.holdReads=false;await refreshProjectStages();await __release(0);await oldRead;
  return [state.projectStages.find(s=>s.id==='a-measure').done,__stageButton('Замеры').classList.contains('done')];
 },[false,false]);
 await check('A full refresh redraws open stages without replacing unsaved project fields',async()=>{
  __db.project_stages.find(s=>s.id==='a-measure').done=true;document.getElementById('pf-notes').value='Unsaved project note';
  await loadAll();
  return [__stageButton('Замеры').classList.contains('done'),document.getElementById('pf-notes').value];
 },[true,'Unsaved project note']);
 await check('A failed stage read retains known marks and displays an explicit stale-data notice',async()=>{
  __stageButton('Замеры').click();await __tick();await __flush();__fail={table:'project_stages',op:'select'};
  await loadAll();__fail=null;
  const failed=[state.projectStages.find(s=>s.id==='a-measure').done,__stageButton('Замеры').classList.contains('done'),document.getElementById('pf-stages-list').textContent.includes('Не удалось обновить этапы')];
  await refreshProjectStages();return [failed,!!state.stageDataError];
 },[[true,true,true],false]);
 await check('An older failed read cannot override a newer successful refresh with an error notice',async()=>{
  __net.holdReads=true;__fail={table:'project_stages',op:'select'};const oldRead=refreshProjectStages();await __tick();
  __fail=null;__net.holdReads=false;__db.project_stages.find(s=>s.id==='a-measure').done=true;
  await refreshProjectStages();await __release();await oldRead;
  return [__stageButton('Замеры').classList.contains('done'),!!state.stageDataError,document.getElementById('pf-stages-list').textContent.includes('Не удалось обновить этапы')];
 },[true,false,false]);
 await check('Completing a save in A does not replace stages or unsaved fields in B',async()=>{
  __stageButton('Замеры').click();await __tick();openProjectSheet('b');document.getElementById('pf-notes').value='Unsaved B note';
  await __flush();
  return [editingProjectId,!!__stageButton('Проверка B'),!!__stageButton('Замеры'),document.getElementById('pf-notes').value];
 },['b',true,false,'Unsaved B note']);
 await check('Returning to a project shows its pending intent until saving completes',async()=>{
  __stageButton('Замеры').click();await __tick();openProjectSheet('b');openProjectSheet('a');
  const pending=[__stageButton('Замеры').classList.contains('done'),document.querySelectorAll('[data-stage-saving]').length];
  await __flush();return [pending,document.querySelectorAll('[data-stage-saving]').length];
 },[[true,1],0]);
 await check('Stage realtime reloads only its own table and updates the open checklist',async()=>{
  __net.holdWrites=false;__db.project_stages.find(s=>s.id==='a-measure').done=true;__reads=[];
  scheduleStageReload();await new Promise(r=>setTimeout(r,220));
  return [__reads.length,__reads.every(r=>r.table==='project_stages'),__stageButton('Замеры').classList.contains('done')];
 },[1,true,true]);
 await check('Different projects save concurrently without sharing a lock',async()=>{
  markStageDone('a-measure','a');markStageDone('b-custom','b');await __tick();
  const pending=__net.holds.length;await __flush();
  return [pending,__db.project_stages.filter(s=>s.done).length];
 },[2,2]);
 await check('Deletion during an in-flight toggle is serialized and does not resurrect the stage',async()=>{
  markStageDone('a-measure','a');deleteStage('a-measure','a');await __tick();
  const immediate=!!__stageButton('Замеры');await __flush();
  return [immediate,__db.project_stages.some(s=>s.id==='a-measure'),state.projectStages.some(s=>s.id==='a-measure')];
 },[false,false,false]);
 await check('Adding a stage in A cannot clear a new draft or redraw stages in B',async()=>{
  document.getElementById('pf-stage-name').value='Old A stage';document.getElementById('pf-stage-date').value='2026-12-01';
  const first=addStage('a'),second=addStage('a');await __tick();
  openProjectSheet('b');document.getElementById('pf-stage-name').value='New B stage';document.getElementById('pf-stage-date').value='2026-12-02';
  await __release();await Promise.all([first,second]);
  return [__db.project_stages.filter(s=>s.name==='Old A stage').length,editingProjectId,!!__stageButton('Проверка B'),!!__stageButton('Замеры'),document.getElementById('pf-stage-name').value,document.getElementById('pf-stage-date').value];
 },[1,'b',true,false,'New B stage','2026-12-02']);
 await check('A non-member cannot optimistically change another project or send a write',async()=>{
  session={employeeId:'visual',name:'Ислам',isAdmin:false,token:'test'};markStageDone('a-measure','a');await __tick();
  return [state.projectStages.find(s=>s.id==='a-measure').done,pendingStageChanges.size,__net.writeCalls];
 },[false,0,0]);
 await check('Repeated refresh calls wait for one coalesced follow-up snapshot',async()=>{
  __net.table='projects';__net.holdReads=true;__reads=[];
  let firstDone=false,secondDone=false;
  const first=loadAll().then(()=>{firstDone=true});await __tick();
  __db.projects.push({id:'c',name:'Late project',category_id:'arch',status_id:'active'});
  const second=loadAll().then(()=>{secondDone=true});
  await __release();const beforeSecond=[firstDone,secondDone,__net.holds.length];
  await __release();await Promise.all([first,second]);
  return [beforeSecond,firstDone,secondDone,state.projects.some(p=>p.id==='c'),__reads.filter(r=>r.table==='projects'&&r.limit!==Infinity).length];
 },[[false,false,1],true,true,true,4]);
 await browser.close();
 console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors}));
 if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
