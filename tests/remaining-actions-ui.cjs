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
  const mode=process.argv[2];
  const fixture=fs.readFileSync(path.join(__dirname,'mock.js'),'utf8');
  await ctx.addInitScript({content:fixture+(mode==='login'?";localStorage.removeItem('arhittek_session');":'')});
  await ctx.route('**/*',route=>{
   const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
   const vendor={'/npm/xlsx@0.18.5/dist/xlsx.full.min.js':'xlsx/dist/xlsx.full.min.js','/npm/jspdf@2.5.1/dist/jspdf.umd.min.js':'jspdf/dist/jspdf.umd.min.js','/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js':'jspdf-autotable/dist/jspdf.plugin.autotable.min.js'}[u.pathname];
   if(u.hostname==='cdn.jsdelivr.net'&&vendor)return route.fulfill({path:path.join(root,'node_modules',vendor),contentType:'text/javascript'});
   return u.hostname==='qa.test'&&fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({body:''});
  });
  const p=await ctx.newPage();p.setDefaultTimeout(5000);
  await p.goto('https://qa.test/');if(mode==='login')await p.locator('#loginEmployeeList .list-item').first().waitFor();
  else await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);




  if(mode!=='login')await p.evaluate(async()=>{
    __db.projects=[{id:'qa-site',name:'Учебный корпус',category_id:'build',status_id:'active',expenses:460,price:900}];
    __db.invoices=[{id:'qa-inv',number:'К-45',project_id:'qa-site',item_type:'Материал',invoice_date:financeToday(),amount:460,photo_url:'https://qa.test/icon-32.png'}];
    __db.ledger_entries=[];await loadAll();
  });
  const errors=[];p.on('pageerror',err=>errors.push(err.message));

  async function check(id,element,action,verify){
   const control=p.locator(element);await control.scrollIntoViewIfNeeded();
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



  p.on('dialog',d=>d.accept());
  if(mode==='invoice'){
   await p.locator('.nav-btn[data-view="view-construction"]').click();await p.locator('.obj-card').click();
   await p.locator('#objInvList .inv-row').first().click();
   await check('UI-0079','#invSheet-photo-img',async el=>{
     const [tab]=await Promise.all([ctx.waitForEvent('page'),el.click()]);await tab.waitForURL('https://qa.test/icon-32.png');await tab.close();
   },async()=>assert.ok(await p.locator('#invoiceSheetOverlay').isVisible()));
   for(const [id,field,name] of [['UI-0087','photo','Смета.pdf'],['UI-0088','camera','Чек.png']]){
    const buffer=field==='photo'?Buffer.from('%PDF-1.4\n%%EOF'):fs.readFileSync(path.join(root,'icon-32.png'));
    await check(id,'div[style*="display:flex"] > label[for="invSheet-'+field+'-input"]',async el=>{
     const [chooser]=await Promise.all([p.waitForEvent('filechooser'),el.click()]);
     await chooser.setFiles({name,mimeType:field==='photo'?'application/pdf':'image/png',buffer});
    },async()=>assert.equal(await p.locator('#invSheet-photo-input').evaluate(e=>e.files[0]?.name),name));
   }
   await check('UI-0078','#invoiceSheet button[onclick="closeInvoiceSheet()"]',click,async()=>{
     assert.ok(await p.locator('#invoiceSheetOverlay').isHidden());
     assert.ok(await p.evaluate(()=>__db.invoices[0].photo_url.endsWith('/icon-32.png')&&__db.invoices[0].amount===460));
   });
  }else if(mode==='tools'){
   await p.locator('.nav-btn[data-view="view-more"]').click();
   await check('UI-0291','#openPriceListBtn',click,async()=>{
     assert.ok(await p.locator('#priceDownloadXlsx').isVisible());assert.ok(await p.locator('#priceDownloadPdf').isVisible());
   });await p.locator('#priceListClose').click();
   let file;
   await check('UI-0292','#exportXlsxBtn',async el=>{
     const [dl]=await Promise.all([p.waitForEvent('download'),el.click()]);file=await dl.path();
   },async()=>{
     const XLSX=require('xlsx'),book=XLSX.readFile(file);const docs=XLSX.utils.sheet_to_json(book.Sheets['Накладные (Стройка)']);
     assert.equal(docs[0]['Номер накладной'],'К-45');assert.ok(Object.values(docs[0]).includes(460));assert.equal(docs[0]['Объект'],'Учебный корпус');
   });
   const tree='https://zhoba-family-tree.edmama121212.chatgpt.site/';
   await ctx.route(tree,r=>r.fulfill({body:'Учебная страница назначения',contentType:'text/plain'}));
   await check('UI-0294','#openFamilyTreeBtn',click,async()=>{await p.waitForURL(tree);assert.equal(new URL(p.url()).search,'');});
  }else if(mode==='login'){
   await p.locator('#loginEmployeeList .list-item').first().click();await p.locator('#loginPin').fill('22');
   await check('UI-0003','#loginBackBtn',click,async()=>{assert.ok(await p.locator('#loginStep1').isVisible());await p.locator('#loginEmployeeList .list-item').last().click();assert.equal(await p.locator('#loginPin').inputValue(),'');});
  }else{
   await p.locator('#settingsBtn').click();
   await check('UI-0303','#addTariffBtn',click,async()=>assert.ok(await p.locator('#tariffSheetClose').isVisible()));
   await check('UI-0155','#tariffSheetClose',click,async()=>assert.ok(await p.locator('#tariffSheetClose').isHidden()));
  }
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
