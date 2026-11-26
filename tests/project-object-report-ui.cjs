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
   const vendor={'/npm/jspdf@2.5.1/dist/jspdf.umd.min.js':'jspdf/dist/jspdf.umd.min.js','/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js':'jspdf-autotable/dist/jspdf.plugin.autotable.min.js'}[u.pathname];
   if(u.hostname==='cdn.jsdelivr.net'&&vendor)return route.fulfill({path:path.join(root,'node_modules',vendor),contentType:'text/javascript'});
   return u.hostname==='qa.test'&&fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({body:''});
  });
  const p=await ctx.newPage();p.setDefaultTimeout(5000);
  await p.goto('https://qa.test/');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);




  await p.evaluate(async()=>{
    __db.projects=[{id:'qa-site',name:'Учебный корпус',category_id:'build',status_id:'active',expenses:460,price:900}];
    __db.invoices=[{id:'qa-inv',number:'К-45',project_id:'qa-site',item_type:'Материал',invoice_date:financeToday(),amount:460}];
    __db.ledger_entries=[];await loadAll();
  });
  await p.locator('.nav-btn[data-view="view-construction"]').click();
  await p.locator('.obj-card').filter({hasText:'Учебный корпус'}).click();
  await p.locator('#objEditBtn').click();
  const errors=[];p.on('pageerror',err=>errors.push(err.message));

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


  await check('UI-0237','pf-open-as-object',click,async()=>{
    assert.equal(await p.evaluate(()=>currentObjectId),'qa-site');
    assert.ok(await p.locator('#view-object').isVisible());assert.ok(await p.locator('#projectSheetOverlay').isHidden());
    assert.doesNotMatch(await p.locator('#toast').textContent(),/Нет доступа/);
  });
  let file;
  await check('UI-0094','objPdfBtn',async el=>{
    const [download]=await Promise.all([p.waitForEvent('download',{timeout:5000}),el.click()]);file=await download.path();
  },async()=>{
    const pdf=require('node:child_process').execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
    assert.match(pdf,/Учебный корпус/);assert.match(pdf,/460/);assert.match(pdf,/К-45/);
  });
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
