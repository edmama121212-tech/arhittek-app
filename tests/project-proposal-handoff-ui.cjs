'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
async function run(){
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
  await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
  await ctx.route('**/*',route=>{
   const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
   return u.hostname==='qa.test'&&fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({body:''});
  });
  const p=await ctx.newPage();p.setDefaultTimeout(5000);
  await p.goto('https://qa.test/');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);


  await p.evaluate(async()=>{
    __db.projects=[{id:'qa-proposal',name:'Учебная мастерская',address:'Учебная 8',client_name:'Учебный заказчик',category_id:'arch',status_id:'active',price:900,balance:800}];
    __db.kp_forms=[];__db.ledger_entries=[];await loadAll();
  });
  await p.locator('.nav-btn[data-view="view-projects"]').click();
  await p.locator('#projectsCard .proj-row').click();
  await p.locator('#projectSheetOverlay').getByText('Документы',{exact:true}).first().click();
  const timings={};
  const act=async(id,operation)=>{
   const field=p.locator('#'+id);
   const closed=field.locator('xpath=ancestor::details[not(@open)]').first();
   if(await closed.count())await closed.locator('summary').first().click();
   await field.scrollIntoViewIfNeeded();const box=await field.boundingBox();
   assert.ok(box && box.width>0 && box.x>=0 && box.x+box.width<=391,id);
   const start=performance.now();await operation(field);
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   timings[id]=Math.round(performance.now()-start);
  };
  await act('pf-create-kp',field=>field.click());
  assert.equal(await p.locator('#kp-client-name').inputValue(),'Учебный заказчик');
  assert.equal(await p.locator('#kp-object').inputValue(),'Учебная 8');
  const fields=[
   ['kp-client-name','client_name','Учебная организация'],
   ['kp-client-phone','client_phone','+7 000 000-00-00'],
   ['kp-object','object','Учебная мастерская, корпус 2'],
   ['kp-date','kp_date','2026-12-01'],
   ['kp-deadline','deadline','12 рабочих дней'],
   ['kp-start','start_date','После обмеров']
  ];
  for(const [id,,value] of fields)await act(id,field=>field.fill(value));
  const t=performance.now();await p.locator('#kpSaveBtn').click();
  await p.waitForFunction(()=>__db.kp_forms.length===1&&!kpSaveInFlight);
  const ms=Math.round(performance.now()-t);
  const result=await p.evaluate(()=>({doc:__db.kp_forms[0],project:__db.projects[0],payments:__db.ledger_entries.length}));
  assert.equal(result.doc.project_id,'qa-proposal');
  assert.equal(result.project.client_name,'Учебный заказчик');
  assert.equal(result.project.balance,800);assert.equal(result.payments,0);
  for(const [,column,value] of fields)assert.equal(result.doc[column],value);
  console.log(JSON.stringify({build,browser:browser.version(),time:new Date().toISOString(),ms,timings}));
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
