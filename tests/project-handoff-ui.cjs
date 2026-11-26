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
    __db.projects=[{id:'qa',name:'Учебный договор',category_id:'arch',status_id:'active',price:900,advance:100,balance:800,fee_base:'profit'}];__db.ledger_entries=[];await loadAll();
  });
  await p.locator('.nav-btn[data-view="view-projects"]').click();const row=p.locator('#projectsCard .proj-row');await row.click();
  const stats={};const note='Передать эскиз на замер';
  for(const [id,val] of [['pf-start','2028-02-28'],['pf-duration-days','2'],['pf-notes',note]]){
    const f=p.locator('#'+id);
    const details=f.locator('xpath=ancestor::details[not(@open)]').first();
    if(await details.count())await details.locator('summary').first().click();
    await f.scrollIntoViewIfNeeded();
    const box=await f.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);
    const t=performance.now();await f.fill(val);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    stats[id]=Math.round(performance.now()-t);
  }
  const preview=await p.locator('#pf-end-preview').innerText();
  const t=performance.now();await p.locator('#pf-save').click();await p.locator('#projectSheetOverlay').waitFor({state:'hidden'});
  await p.waitForFunction(()=>!loadAllInFlight);const ms=Math.round(performance.now()-t);
  await p.locator('#projectSearch').fill(note);assert.equal(await row.count(),1);await row.click();
  const result=await p.evaluate(()=>({project:__db.projects[0],ledger:__db.ledger_entries.length}));
  const x=result.project;const passed=x.start_date==='2028-02-28'&&x.end_date==='2028-03-01'&&x.notes===note&&x.balance===800&&result.ledger===0&&preview.includes('01.03.2028');
  console.log(JSON.stringify({build,time:new Date().toISOString(),browser:browser.version(),stats,ms,preview,end:x.end_date,passed}));assert.ok(passed);
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
