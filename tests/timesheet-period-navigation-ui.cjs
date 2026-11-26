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
   __db.ledger_entries=[{id:'qa-wage',type:'salary_payment',payee_employee_id:'designer',amount:12500,entry_date:'2026-11-03',description:'[salary:2026-10] Расчёт за октябрь'}];
   await loadAll();
  });
  const errors=[];p.on('pageerror',err=>errors.push(err.message));
  await p.locator('.nav-btn[data-view="view-more"]').click();
  async function check(id,element,action,verify){
   const control=p.locator('#'+element);await control.scrollIntoViewIfNeeded();
   const box=await control.boundingBox(),start=performance.now();
   await action(control);
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const ms=Math.round(performance.now()-start);
   const row={id,build,time:new Date().toISOString(),browser:browser.version(),ms,width:Math.round(box.width)};
   try{
    assert.ok(box.x>=0&&box.x+box.width<=391);
    await verify();assert.deepEqual(errors,[]);row.pass=true;
   }catch(error){row.pass=false;row.error=error.message;}
   console.log(JSON.stringify(row));assert.ok(row.pass);
  }
  const click=el=>el.click();
  const designer=p.locator('.payroll-card').filter({has:p.locator('.payroll-head[onclick*="designer"]')});
  await check('UI-0293','openTimesheetBtn',click,async()=>{
   assert.ok(await p.locator('#view-timesheet').isVisible());assert.ok(await designer.isVisible());
  });
  await check('UI-0190','ts-month',el=>el.fill('2026-10'),async()=>{
   const values=await designer.locator('.payroll-line b').allTextContents();
   assert.deepEqual(values.map(s=>Number(s.replace(/[^0-9,.-]/g,'').replace(',','.'))),[50000,12500,37500]);
  });
  await check('UI-0189','timesheetBack',click,async()=>{
   assert.ok(await p.locator('#view-more').isVisible());assert.equal(await p.locator('.view.active').count(),1);
   assert.equal(await p.evaluate(()=>__db.ledger_entries.length),1);
  });
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
