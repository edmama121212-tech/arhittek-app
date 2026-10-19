const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
const source=fs.readFileSync(path.join(root,'construction-workflow.js'),'utf8');
const scope=vm.createContext({TextEncoder,Uint8Array,Uint32Array,Map,console});vm.runInContext(source,scope);
const plan=scope.ARHITTEKConstructionWorkflow,results=[],errors=[];
function unit(name,run){try{run();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}}
const expected=['Обмеры и обследование','Смета и согласование','Подготовка и демонтаж','Черновые работы','Инженерные сети','Чистовая отделка','Комплектация и монтаж','Проверка и сдача'];
unit('Repair template contains the eight agreed stages in order',()=>assert.deepEqual(Array.from(plan.names),expected));
unit('Repeated module inclusion preserves the same API and creates no duplicate instance',()=>{const original=scope.ARHITTEKConstructionWorkflow;vm.runInContext(source,scope);assert.equal(scope.ARHITTEKConstructionWorkflow,original);});
unit('Every deterministic stage UUID agrees with the standard UUID v5 construction',()=>{
 for(const project of ['object-a','object-b','46b3fc42-b788-4700-bf79-825104fd6ded'])for(const name of expected){
  const bytes=crypto.createHash('sha1').update(Buffer.from(plan.namespace.replace(/-/g,''),'hex')).update('arhittek:'+plan.version+':'+project+':'+name).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString('hex'),id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');assert.equal(plan.stageId(project,name),id);
 }
});
unit('Plans have stable UUIDs after reload, unique across stages and objects',()=>{
 const first=plan.createPlan('object-a'),again=plan.createPlan('object-a'),other=plan.createPlan('object-b');assert.equal(JSON.stringify(first),JSON.stringify(again));assert.equal(new Set([...first.rows,...other.rows].map(row=>row.id)).size,16);assert.ok(first.rows.every(row=>/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.id)));
});
unit('Existing custom stages are preserved and new stages are appended after them',()=>{
 const existing=[{id:'custom',project_id:'object-a',name:'Согласовать плитку',sort_order:20,done:true,due_date:'2026-10-23'}],before=JSON.stringify(existing),missing=plan.missingRows(plan.createPlan('object-a'),existing);assert.equal(JSON.stringify(existing),before);assert.equal(missing.length,8);assert.equal(missing[0].sort_order,21);assert.equal(missing[7].sort_order,28);
});
unit('Existing equivalent names and previously renamed stable IDs are never duplicated',()=>{
 const p=plan.createPlan('object-a'),existing=[{id:'manual',project_id:'object-a',name:'  ОБМЕРЫ   И ОБСЛЕДОВАНИЕ ',sort_order:0},{id:p.rows[1].id,project_id:'object-a',name:'Согласование согласованной сметы',sort_order:1}];assert.equal(plan.missingRows(p,existing).length,6);
});
unit('Stages from another object and deleted rows do not suppress this object plan',()=>{
 const p=plan.createPlan('object-a'),existing=p.rows.map(row=>({...row,project_id:'object-b'}));existing.push({...p.rows[0],deleted_at:'2026-10-19'});assert.equal(plan.missingRows(p,existing).length,8);
});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.addInitScript(()=>{
  window.__repairFault=null;window.__repairHold=null;window.__repairHeld=[];window.__repairAttempts=[];
  const create=supabase.createClient;
  supabase.createClient=function(){const client=create.apply(this,arguments);if(client.__repairHook)return client;client.__repairHook=true;
   const from=client.from;client.from=function(table){const q=from.call(this,table),then=q.then,insert=q.insert;let op='select',payload;
    for(const method of ['insert','update','delete']){const old=q[method];q[method]=function(value){op=method;payload=value;return old.apply(this,arguments);};}
    q.then=function(resolve,reject){return(async()=>{
     if(table!=='project_stages')return then.call(q,x=>x);
     const fault=window.__repairFault;
     if(op==='select'&&fault?.committed&&fault.readFailures>0){fault.readFailures--;return{data:null,error:{message:'Verification read failed'}};}
     if(op==='insert'){
      const rows=Array.isArray(payload)?payload:[payload];__repairAttempts.push(rows.map(row=>row.id));
      if(rows.some(row=>(__db.project_stages||[]).some(old=>old.id===row.id)))return{data:null,error:{code:'23505',message:'Duplicate primary key'}};
      if(fault?.mode==='partial'&&fault.remaining>0)insert.call(q,rows.slice(0,3));
     }
     const result=await then.call(q,x=>x),hold=window.__repairHold;
     if(hold?.op===op&&hold.remaining>0){hold.remaining--;await new Promise(release=>__repairHeld.push(release));}
     if(op==='insert'&&fault?.remaining>0&&!result.error){fault.remaining--;fault.committed=true;if(fault.mode==='commit-throw')throw new Error('Connection lost after commit');if(['commit-error','partial'].includes(fault.mode))return{data:null,error:{message:'Response lost after commit'}};}
     return result;
    })().then(resolve,reject);};return q;};return client;};
  window.__releaseRepair=()=>{for(const release of __repairHeld.splice(0))release();};
 });
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));if(fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 async function fresh(){
  await page.goto('https://app.test/');await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);await page.waitForTimeout(80);if(!await page.evaluate(()=>!!window.ARHITTEKConstructionWorkflow))await page.addScriptTag({path:path.join(root,'construction-workflow.js')});
  await page.evaluate(async()=>{__db.projects=[{id:'object-a',name:'Object A',category_id:'build',status_id:'active',employee_id:'architect'},{id:'object-b',name:'Object B',category_id:'build',status_id:'active',employee_id:'architect'}];__db.project_stages=[];await loadAll();openObjectView('object-a');ARHITTEKConstructionWorkflow.render();__writes=[];__repairAttempts=[];});
 }
 async function check(name,run,expected,args){try{const actual=await page.evaluate(run,args);assert.deepEqual(actual,expected);results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}finally{await page.evaluate(()=>{__fail=null;__repairFault=null;__repairHold=null;__releaseRepair();}).catch(()=>{});}}
 await fresh();
 await check('Opening, rendering and refreshing an existing object never applies the template',async()=>{
  const before=JSON.stringify(__db.project_stages);ARHITTEKConstructionWorkflow.render();openObjectView('object-b');openObjectView('object-a');await loadAll();await new Promise(r=>setTimeout(r,10));return[before===JSON.stringify(__db.project_stages),__writes.filter(w=>w.table==='project_stages').length,defaultStageNamesForProject(state.projects[0])];
 },[true,0,null]);
 await check('Two immediate apply clicks persist one set of eight ordinary server stages',async()=>{
  const a=ARHITTEKConstructionWorkflow.applyTemplate('object-a'),b=ARHITTEKConstructionWorkflow.applyTemplate('object-a');const same=a===b;await Promise.all([a,b]);return[same,__db.project_stages.length,new Set(__db.project_stages.map(row=>row.id)).size,__repairAttempts.length,__db.project_stages.every(row=>!row.done&&row.due_date===null)];
 },[true,8,8,1,true]);
 await check('Applying a completed template again is read-only and creates no duplicates',async()=>{
  const before=__repairAttempts.length,result=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[result,__db.project_stages.length,__repairAttempts.length-before];
 },[true,8,0]);
 await check('Mobile stage rows keep a compact checkbox and show complete stage names',()=>{
  const box=document.querySelector('#constructionWorkflow .stage-check'),names=Array.from(document.querySelectorAll('#constructionWorkflow .li-name'));return[box.getBoundingClientRect().width<=26,names.length===8,names.every(node=>getComputedStyle(node).whiteSpace!=='nowrap'&&node.scrollWidth<=node.clientWidth+1)];
 },[true,true,true]);
 await check('The template creates no ledger entries, cash movements or budget changes',()=>{
  return __writes.filter(w=>w.table&& !['project_stages','audit_log'].includes(w.table));
 },[]);
 await check('Deleting a persisted template stage does not recreate it on reload or render',async()=>{
  const id=__db.project_stages[0].id;await deleteStage(id,'object-a');await loadAll();ARHITTEKConstructionWorkflow.render();await new Promise(r=>setTimeout(r,10));return[__db.project_stages.length,__db.project_stages.some(row=>row.id===id),document.querySelectorAll('#constructionWorkflow [data-stage-id]').length];
 },[7,false,7]);
 await check('Only a new explicit apply may restore a deleted template stage',async()=>{
  const result=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[result,__db.project_stages.length,new Set(__db.project_stages.map(row=>row.id)).size];
 },[true,8,8]);
 await fresh();
 await check('The visible apply button handles real repeated clicks without duplicate rows',async()=>{
  const button=document.querySelector('#constructionWorkflow [data-construction-workflow="apply"]');button.click();button.click();for(let i=0;i<100&&__db.project_stages.length<8;i++)await new Promise(r=>setTimeout(r,5));for(let i=0;i<100&&document.querySelector('#constructionWorkflow [data-construction-workflow="apply"]').textContent.includes('Добавляем');i++)await new Promise(r=>setTimeout(r,5));
  return[__db.project_stages.length,__repairAttempts.length,document.querySelector('#constructionWorkflow [data-construction-workflow="apply"]').disabled];
 },[8,1,true]);
 await check('Stage checkboxes in the object card retain the existing immediate per-stage queue',async()=>{
  const buttons=document.querySelectorAll('#constructionWorkflow [data-construction-workflow="toggle"]');buttons[0].click();document.querySelectorAll('#constructionWorkflow [data-construction-workflow="toggle"]')[1].click();const immediate=state.projectStages.filter(row=>row.project_id==='object-a'&&row.done).length;for(let i=0;i<100&&__db.project_stages.filter(row=>row.done).length<2;i++)await new Promise(r=>setTimeout(r,5));return[immediate,__db.project_stages.filter(row=>row.done).length];
 },[2,2]);
 await fresh();
 await check('An audit-history error does not turn verified server stages into an unsuccessful insertion',async()=>{
  const original=logAudit;logAudit=async()=>{throw new Error('Audit history unavailable');};try{const result=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[result,__db.project_stages.length,document.getElementById('constructionWorkflow').textContent.includes('Не удалось подтвердить')];}finally{logAudit=original;}
 },[true,8,false]);
 await fresh();
 await check('An existing manually created equivalent stage and its dates remain unchanged',async()=>{
  __db.project_stages=[{id:'manual',project_id:'object-a',name:'Смета и согласование',sort_order:12,done:true,done_at:'2026-10-18T12:00:00Z',due_date:'2026-10-20'}];await loadAll();const before=JSON.stringify(__db.project_stages[0]);await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[__db.project_stages.length,JSON.stringify(__db.project_stages.find(row=>row.id==='manual'))===before,__repairAttempts[0].length,Math.min(...__db.project_stages.filter(row=>row.id!=='manual').map(row=>row.sort_order)),__db.audit_log.findLast(row=>row.changes?.repair_stages_template)?.changes.repair_stages_template.new.stage_ids.includes('manual')];
 },[8,true,7,13,true]);
 for(const mode of ['commit-error','commit-throw']){
  await fresh();
  await check(mode+': a lost insert response is confirmed without another insert',async mode=>{__repairFault={mode,remaining:1};const first=await ARHITTEKConstructionWorkflow.applyTemplate('object-a'),second=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[first,second,__db.project_stages.length,__repairAttempts.length];},[true,true,8,1],mode);
 }
 await fresh();
 await check('A partial insert is reported honestly and a retry adds only the missing stable IDs',async()=>{
  __repairFault={mode:'partial',remaining:1};const first=await ARHITTEKConstructionWorkflow.applyTemplate('object-a'),partial=__db.project_stages.length,firstIds=__repairAttempts[0].slice();__repairFault=null;const second=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[first,partial,second,__db.project_stages.length,__repairAttempts.map(ids=>ids.length),__repairAttempts[1].every(id=>firstIds.includes(id))];
 },[false,3,true,8,[8,5],true]);
 await fresh();
 await check('A failed verification keeps the outcome unconfirmed and a retry reads the committed rows',async()=>{
  __repairFault={mode:'verify-fail',remaining:1,readFailures:1};const first=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');const after=[__db.project_stages.length,state.projectStages.length,document.getElementById('constructionWorkflow').textContent.includes('Не удалось подтвердить')];__repairFault=null;const second=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[first,after,second,__repairAttempts.length,state.projectStages.length];
 },[false,[8,0,true],true,1,8]);
 await fresh();
 await check('An unreadable stage table prevents all inserts and preserves existing stages',async()=>{
  __db.project_stages=[{id:'original',project_id:'object-a',name:'Existing',sort_order:0}];await loadAll();__fail={table:'project_stages',op:'select'};const result=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[result,__db.project_stages.length,__repairAttempts.length,state.projectStages[0].id];
 },[false,1,0,'original']);
 await fresh();
 await check('A rejected insert never displays a successful template application',async()=>{
  __fail={table:'project_stages',op:'insert'};const result=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[result,__db.project_stages.length,document.getElementById('constructionWorkflow').textContent.includes('Не удалось подтвердить')];
 },[false,0,true]);
 await fresh();
 await check('Staff and logged-out users cannot apply a template through a direct call',async()=>{
  session={employeeId:'architect',name:'Architect',isAdmin:false,token:'test'};window.session=session;ARHITTEKConstructionWorkflow.render();const staff=await ARHITTEKConstructionWorkflow.applyTemplate('object-a'),button=!!document.querySelector('#constructionWorkflow [data-construction-workflow="apply"]');session=null;window.session=null;const guest=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[staff,guest,button,__repairAttempts.length];
 },[false,false,false,0]);
 await fresh();
 await check('A known stage-read error blocks template application',async()=>{
  state.stageDataError='Failed stage read';ARHITTEKConstructionWorkflow.render();const result=await ARHITTEKConstructionWorkflow.applyTemplate('object-a');return[result,__repairAttempts.length,document.querySelector('#constructionWorkflow [data-construction-workflow="apply"]').disabled];
 },[false,0,true]);
 await fresh();
 await check('Changing session while the initial read is in flight prevents the insert',async()=>{
  __repairHold={op:'select',remaining:1};const task=ARHITTEKConstructionWorkflow.applyTemplate('object-a');for(let i=0;i<100&&!__repairHeld.length;i++)await new Promise(r=>setTimeout(r,5));if(!__repairHeld.length)throw new Error('Stage read did not pause');session={employeeId:'architect',name:'Architect',isAdmin:false,token:'other'};window.session=session;__releaseRepair();const result=await task;return[result,__repairAttempts.length,__db.project_stages.length];
 },[false,0,0]);
 await fresh();
 await check('Late object A completion never repaints object B or retargets its stages',async()=>{
  __repairHold={op:'insert',remaining:1};const first=ARHITTEKConstructionWorkflow.applyTemplate('object-a');for(let i=0;i<100&&!__repairHeld.length;i++)await new Promise(r=>setTimeout(r,5));if(!__repairHeld.length)throw new Error('Stage insert did not pause');openObjectView('object-b');ARHITTEKConstructionWorkflow.render();const second=await ARHITTEKConstructionWorkflow.applyTemplate('object-b'),before=document.getElementById('constructionWorkflow').innerHTML;__releaseRepair();const one=await first;await new Promise(r=>setTimeout(r,10));return[one,second,currentObjectId,document.getElementById('constructionWorkflow').dataset.projectId,document.getElementById('constructionWorkflow').innerHTML===before,__db.project_stages.filter(row=>row.project_id==='object-a').length,__db.project_stages.filter(row=>row.project_id==='object-b').length,state.projectStages.length];
 },[true,true,'object-b','object-b',true,8,8,16]);
 if(process.env.TEST_SCREENSHOT_DIR){await page.evaluate(()=>{document.getElementById('toast').style.visibility='hidden';});fs.mkdirSync(process.env.TEST_SCREENSHOT_DIR,{recursive:true});await page.locator('#constructionWorkflow').screenshot({path:path.join(process.env.TEST_SCREENSHOT_DIR,'construction-stages-mobile.png')});}
 await browser.close();console.log(JSON.stringify({passed:results.filter(row=>row.pass).length,total:results.length,failed:results.filter(row=>!row.pass),errors},null,2));if(results.some(row=>!row.pass)||errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exit(1);});
