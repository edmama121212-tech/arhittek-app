const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
(async()=>{
 const browser=await (process.env.CATALOG_BROWSER==='webkit'?webkit:chromium).launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:process.env.CATALOG_BROWSER==='webkit'?[]:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',hasTouch:true,reducedMotion:'reduce'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});

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
 const views=['overview','projects','construction','cards','finance','more'];
 const scenarios=['mouse','enter','space','touch','landscape','double-click','return','scroll','rotation','reload'];
 const observations=[];
 try {
  for (const scenario of scenarios) {
   const width=scenario==='mouse'?1440:scenario==='landscape'?844:390;
   await page.setViewportSize({width,height:scenario==='landscape'?390:844});
   for(const [index,view] of views.entries()){
    const button=page.locator('.nav-btn[data-view="view-'+view+'"]');
    const other=page.locator('.nav-btn[data-view="view-'+views[(index+1)%views.length]+'"]');
    await other.click();
    if(scenario==='scroll') await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    await page.evaluate(()=>{
     document.addEventListener('click',function capture(event){
      if(!event.target.closest('.nav-btn'))return;
      const started=performance.now();
      window.navigationPaint=new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(Math.round(performance.now()-started)))));
      document.removeEventListener('click',capture,true);
     },true);
    });
    if(scenario==='enter'||scenario==='space'){
     await button.focus();
     await page.keyboard.press(scenario==='enter'?'Enter':'Space');
    }else if(scenario==='touch'||scenario==='landscape')await button.tap();
    else if(scenario==='double-click')await button.dblclick();
    else await button.click();
    const feedbackMs=await page.evaluate(()=>window.navigationPaint);
    if(scenario==='return'){await other.click();await button.click()}
    if(scenario==='rotation'){await page.setViewportSize({width:844,height:390});await page.setViewportSize({width:390,height:844})}
    if(scenario==='reload'){
     await page.waitForFunction(view=>JSON.parse(sessionStorage.getItem('arhittek_ui_route_v1')||'{}').view==='view-'+view,view);
     await page.reload();
    }
    await page.waitForFunction(view=>document.querySelector('.view.active')?.id==='view-'+view,view);
    const state=await button.evaluate(b=>{
     const rect=b.getBoundingClientRect();
     return {current:b.getAttribute('aria-current'),activeScreens:document.querySelectorAll('.view.active').length,
       title:document.querySelector('.view.active h1')?.textContent,button:b.textContent.trim(),
       fits:document.documentElement.scrollWidth<=innerWidth+1,width:Math.round(rect.width),height:Math.round(rect.height)};
    });
    assert.equal(state.current,'page',scenario+' '+view);
    assert.equal(state.activeScreens,1);
    assert.ok(state.title&&state.button&&state.fits,scenario+' '+view+' '+JSON.stringify(state));
    observations.push({scenario,view,feedbackMs,...state});
   }
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:observations.length,observations}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
