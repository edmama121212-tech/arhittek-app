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





  const mode=process.argv[2];assert.ok(['invalid','valid'].includes(mode));
  await p.locator('#settingsBtn').click();
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

  const click=field=>field.click();
  await act('addCategoryBtn',click);
  await act('cf-name',field=>field.fill('Учебная отделка'));
  await act('cf-feepercent',field=>field.fill(mode==='invalid'?'-5':'17.5'));
  if(mode==='valid'){
    await act('cf-feebase',field=>field.selectOption('price'));
    await act('cf-department',field=>field.selectOption('b'));
  }
  await act('cf-save',click);
  await p.waitForFunction(()=>!loadAllInFlight);
  const actual=await p.evaluate(()=>({category:__db.categories.find(c=>c.name==='Учебная отделка')||null,
    notice:document.querySelector('#toast').textContent,ledger:__db.ledger_entries.length}));
  const saved=actual.category;
  let pass;
  if(mode==='invalid')pass=!saved && await p.locator('#cf-save').isVisible() && /0.*100/.test(actual.notice);
  else pass=saved?.fee_percent===17.5&&saved.fee_base==='price'&&saved.department_id==='b'&&await p.locator('#categoriesCard').getByText('Учебная отделка').isVisible()&&actual.ledger===0;
  console.log(JSON.stringify({mode,stats,actual,build,time:new Date().toISOString(),browser:browser.version(),pass}));
  assert.ok(pass);
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
