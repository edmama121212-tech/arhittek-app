const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
(async()=>{
 const browser=await (process.env.CATALOG_BROWSER==='webkit'?webkit:chromium).launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:process.env.CATALOG_BROWSER==='webkit'?[]:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.addInitScript(()=>sessionStorage.removeItem('arhittek_ui_route_v1'));
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.protocol==='blob:')return route.continue();
  if(u.hostname==='app.test'){
   const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':undefined});
  }
  for(const [key,file] of [['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']]){
   if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  }
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://app.test/');await page.waitForFunction(()=>state.financialDataReady);
 const result=await page.evaluate(async()=>{
  const calls=[];window.renderFinanceSalaries=()=>calls.push('salary');window.renderAnalytics=()=>calls.push('analytics');
  const finance=document.querySelector('.nav-btn[data-view="view-finance"]'),projects=document.querySelector('.nav-btn[data-view="view-projects"]');
  finance.click();const immediate=[document.getElementById('view-finance').classList.contains('active'),calls.length];
  projects.click();await new Promise(r=>setTimeout(r,100));const abandoned=calls.length;
  finance.click();await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,20)));const completed=[...calls];
  __reads=[];await Promise.all([loadCards(),loadCards(),loadCards()]);
  return {immediate,abandoned,completed,cardReads:__reads.filter(r=>r.table==='project_cards').length};
 });
 assert.deepEqual(result,{immediate:[true,0],abandoned:0,completed:['salary','analytics'],cardReads:1});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:5,result}));await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
