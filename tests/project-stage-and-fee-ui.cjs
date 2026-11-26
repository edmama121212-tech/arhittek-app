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
    __db.projects=[{id:'qa-room',name:'Учебный интерьер',category_id:'design',status_id:'active',price:70000,area:32,fee_base:'m2'}];
    __db.ledger_entries=[];await loadAll();
  });
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
  await act('pf-stage-name',field=>field.fill('Проверка обмеров'));
  await act('pf-stage-add',field=>field.click());
  await p.waitForFunction(()=>__db.project_stages.some(s=>s.name==='Проверка обмеров'&&s.project_id==='qa-room'));
  assert.match(await p.locator('#pf-stages-list').innerText(),/Проверка обмеров/);
  console.log(JSON.stringify({group:'stage',stats:{...stats},build,time:new Date().toISOString(),browser:browser.version()}));
  await p.locator('#project-tab-team').click();
  await act('pf-rp-employee',field=>field.selectOption('visual'));
  await act('pf-rp-role',field=>field.selectOption('Чертёжник'));
  await act('pf-rp-rate',field=>field.fill('375'));
  await act('pf-rp-add-btn',field=>field.click());
  await p.waitForFunction(()=>__db.ledger_entries.some(e=>e.type==='role_payout'));
  const ledger=await p.evaluate(()=>__db.ledger_entries);
  assert.equal(ledger.length,1);assert.equal(ledger[0].project_id,'qa-room');
  assert.equal(ledger[0].payee_employee_id,'visual');assert.match(ledger[0].description,/Чертёжник/);
  assert.equal(ledger[0].amount,12000);
  assert.match(await p.locator('#pf-m2-payouts-list').innerText(),/12\s*000/);
  console.log(JSON.stringify({group:'team',stats,build,time:new Date().toISOString(),browser:browser.version()}));
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
