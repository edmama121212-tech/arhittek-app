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




  await p.evaluate(async processMode=>{
    __db.projects=[{id:'qa-room',name:'Учебный интерьер',category_id:processMode==='area'?'design':'arch',status_id:'active',price:70000,area:32,fee_base:processMode==='area'?'m2':'profit'}];
    __db.ledger_entries=processMode==='area'?[{id:'paid',type:'advance',project_id:'qa-room',amount:550,entry_date:financeToday(),description:'Замеры'}]:[];await loadAll();
  },process.argv[2]);
  await p.locator('.nav-btn[data-view="view-projects"]').click();
  await p.locator('#projectsCard .proj-row').click();
  const stats={};
  async function act(id,action){
    const field=p.locator('#'+id);
    const details=field.locator('xpath=ancestor::details[not(@open)]').first();
    if(await details.count())await details.locator('summary').first().click();
    await field.scrollIntoViewIfNeeded();const box=await field.boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=391,id);
    const start=performance.now();await action(field);
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    stats[id]={ms:Math.round(performance.now()-start),width:Math.round(box.width)};
  }

  if(process.argv[2]==='area'){
   await act('pf-area',f=>f.fill('45.75'));
   const start=performance.now();await p.locator('#pf-save').click();await p.waitForFunction(()=>!loadAllInFlight && __db.projects[0].area===45.75);
   console.log(JSON.stringify({id:'UI-0210',...stats['pf-area'],msSave:Math.round(performance.now()-start),build,time:new Date().toISOString(),browser:browser.version(),pass:true}));
   await p.locator('#projectsCard .proj-row').click();await p.locator('#project-tab-money').click();
   const button=p.locator('button[onclick*="pf-payment-history"]');await button.scrollIntoViewIfNeeded();
   const box=await button.boundingBox(),t=performance.now();await button.click();
   await p.waitForFunction(()=>{const el=document.querySelector('#pf-payment-history'),b=el.getBoundingClientRect();return el.innerText.includes('Замеры')&&el.innerText.includes('550')&&b.top<innerHeight&&b.bottom>0;});
   assert.equal(await p.evaluate(()=>__db.ledger_entries.length),1);
   console.log(JSON.stringify({id:'UI-0222',width:Math.round(box.width),ms:Math.round(performance.now()-t),build,time:new Date().toISOString(),browser:browser.version(),pass:true}));return;
  }
  await p.locator('#project-tab-team').click();
  await act('pf-employee-fee',f=>f.selectOption('architect'));
  await act('pf-feepercent',f=>f.fill('25'));
  await p.locator('#team-add-second').click();
  await act('pf-co-employee-fee',f=>f.selectOption('visual'));
  await act('pf-co-feepercent',f=>f.fill('10'));
  const members=p.locator('#pf-members-add');
  if(await members.isVisible())await act('pf-members-add',f=>f.selectOption('designer'));
  const preview=await p.locator('#project-team-summary').innerText();
  const t=performance.now();await p.locator('#pf-save').click();
  await p.waitForFunction(()=>!document.querySelector('#projectSheetOverlay').classList.contains('active')&&!loadAllInFlight);
  const saved=await p.evaluate(()=>({p:__db.projects[0],members:__db.project_members||[],ledger:__db.ledger_entries.length}));
  assert.equal(saved.p.employee_id,'architect');assert.equal(saved.p.co_employee_id,'visual');
  assert.equal(saved.p.fee_percent,25);assert.equal(saved.p.co_fee_percent,10);assert.equal(saved.ledger,0);
  if(stats['pf-members-add'])assert.ok(saved.members.some(m=>m.employee_id==='designer'&&m.project_id===saved.p.id));
  console.log(JSON.stringify({stats,preview,ms:Math.round(performance.now()-t),build,time:new Date().toISOString(),browser:browser.version()}));
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
