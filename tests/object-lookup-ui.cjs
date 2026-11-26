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
   __db.projects=['Береговая','Садовая'].map((street,i)=>({id:'qa-'+i,name:'Учебный дом',address:street,category_id:'build',status_id:'active',price:1000}));
   __db.invoices=[{id:'act',project_id:'qa-1',invoice_date:financeToday(),item_type:'Работа',amount:350,number:'Акт'}];await loadAll();
  });
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.locator('.nav-btn[data-view="view-construction"]').click();
  const search=p.locator('#constrSearch'),clear=p.locator('#constrSearchClear'),back=p.locator('#objBack'),cards=p.locator('#constructionList .obj-card');
  const action=async(id,el,apply,check)=>{
    await el.scrollIntoViewIfNeeded();const box=await el.boundingBox();const pre=errors.length,t=performance.now();
    await apply();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const ms=Math.round(performance.now()-t),outcome=await check();
    const pass=outcome&&errors.length===pre&&box.x>=0&&box.x+box.width<=391;
    console.log(JSON.stringify({id,build,time:new Date().toISOString(),browser:browser.version(),ms,width:Math.round(box.width),outcome,errors:errors.slice(pre),pass}));
    return pass;
  };
  const searchOk=await action('UI-0091',search,()=>search.fill('садовая'),async()=>await cards.count()===1&&(await cards.innerText()).includes('Садовая'));
  let backOk=true;
  if(!process.argv.includes('--retry-search')){
    await cards.first().click();
    assert.match(await p.locator('#objSummary .fee-row').filter({hasText:'Накладные на работы'}).innerText(),/350/);
    backOk=await action('UI-0093',back,()=>back.click(),async()=>await search.isVisible()&&await search.inputValue()==='садовая'&&await cards.count()===1);
  }
  const clearOk=await action('UI-0092',clear,()=>clear.click(),async()=>await search.inputValue()===''&&await cards.count()===2&&await search.evaluate(e=>document.activeElement===e));
  assert.ok(searchOk&&backOk&&clearOk);
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
