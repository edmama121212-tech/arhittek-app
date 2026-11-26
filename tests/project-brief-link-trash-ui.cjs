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
    __db.projects=[{id:'qa-room',name:'Учебный интерьер',category_id:'arch',status_id:'active',price:70000,area:32,fee_base:'profit'}];
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


  await p.locator('#project-tab-files').click();
  await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://qa.test'});
  await act('pf-tz-create',f=>f.click());
  await p.waitForFunction(()=>!loadAllInFlight&&__db.tz_forms?.length===1);
  const status=await p.locator('#pf-tz-list .li-meta').innerText();
  const correct=await p.evaluate(async()=>{const row=__db.tz_forms[0];return row.project_id==='qa-room'&&(await navigator.clipboard.readText()).includes(row.token);});
  const pass=correct && !/отправлен/i.test(status);
  console.log(JSON.stringify({id:'UI-0233',...stats['pf-tz-create'],pass,status,build,browser:browser.version(),time:new Date().toISOString()}));assert.ok(pass);
  await p.locator('#pf-tz-list [title^="Посмотреть"]').click();
  await act('tzSheetClose',f=>f.click());assert.ok(await p.locator('#tzSheetOverlay').isHidden());assert.ok(await p.locator('#projectSheetOverlay').isVisible());
  console.log(JSON.stringify({id:'UI-0005',...stats.tzSheetClose,pass:true,build,browser:browser.version(),time:new Date().toISOString()}));
  p.on('dialog',d=>d.accept());await act('pf-delete',f=>f.click());
  await p.waitForFunction(()=>!loadAllInFlight&&__db.projects[0].deleted_at);
  await p.locator('.nav-btn[data-view="view-more"]').click();assert.match(await p.locator('#trashCard').innerText(),/Учебный интерьер/);
  console.log(JSON.stringify({id:'UI-0238',...stats['pf-delete'],pass:true,build,browser:browser.version(),time:new Date().toISOString()}));
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
