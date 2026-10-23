const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript({path:path.join(__dirname,'mock.js')});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='app.test'){
    const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
    if(fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':undefined});
   }
   for(const [key,file]of [['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
   return route.fulfill({body:'',contentType:'text/javascript'});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://app.test');await page.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
  await page.evaluate(()=>{
   state.kpCatalog=[{id:'tariff',group_name:'Дизайн интерьера',name:'Стандарт',unit:'м²',rate:1600}];
   state.projects.push({id:'contract-project',name:'Квартира',area:100,price:200000,category_id:'design'});
   openContractsView();
  });
  await page.selectOption('#ct-project','contract-project');assert.equal(await page.inputValue('#ct-area'),'100');
  await page.selectOption('#ct-tariff','catalog:0');assert.equal(await page.inputValue('#ct-price'),'160000');
  await page.selectOption('#ct-discount-mode','discount');await page.fill('#ct-discount-pct','10');
  assert.equal(await page.inputValue('#ct-price'),'144000');
  assert.match(await page.locator('#ct-price-preview').innerText(),/100 м² × 1\s*440 ₽\/м² = 144\s*000 ₽/);
  await page.fill('#ct-number','TARIFF-1');await page.fill('#ct-client-name','Тестовый заказчик');
  await page.click('#ct-save-history');
  await page.waitForFunction(()=>__db.audit_log.some(r=>r.entity_type==='contract'&&r.changes.snapshot.new.number==='TARIFF-1'));
  const stored=await page.evaluate(()=>__db.audit_log.find(r=>r.entity_type==='contract').changes.snapshot.new);
  assert.equal(stored.price,144000);assert.equal(stored.pricing.area,100);assert.equal(stored.pricing.base_rate,1600);assert.equal(stored.pricing.discount_pct,10);
  assert.equal(await page.evaluate(()=>state.projects.find(p=>p.id==='contract-project').price),200000);
  await page.waitForFunction(()=>document.querySelector('[data-contract-history-id]'));
  await page.evaluate(()=>{state.kpCatalog[0].rate=9999;state.kpCatalog[0].name='Другой тариф';document.querySelector('#ct-new').click();document.querySelector('[data-contract-history-id]').click();});
  assert.equal(await page.inputValue('#ct-price'),'144000');assert.equal(await page.inputValue('#ct-rate'),'1600');
  // Capture the actual PDF renderer's text and the actual Word export Blob.
  await page.evaluate(()=>{
   const Original=window.jspdf.jsPDF;window.__pdfText=[];
   window.jspdf.jsPDF=function(...args){const doc=new Original(...args),text=doc.text.bind(doc);doc.text=function(value,...rest){window.__pdfText.push(String(value));return text(value,...rest);};doc.save=()=>{};return doc;};
   const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.__contractBlob=blob;return create(blob);};
   exportContractToPdf();exportContractToWord();
  });
  const exported=await page.evaluate(async()=>({pdf:__pdfText.join('\n'),word:await __contractBlob.text()}));
  for(const text of Object.values(exported)){
   assert.match(text,/Площадь объекта: 100 м²/);assert.match(text,/Стандарт/);assert.match(text,/Скидка: 10%/);assert.match(text,/1\s*440/);assert.match(text,/144\s*000/);
  }
  await page.selectOption('#ct-discount-mode','none');assert.equal(await page.inputValue('#ct-price'),'160000');
  await page.fill('#ct-area','80.25');await page.fill('#ct-rate','1234.56');await page.selectOption('#ct-discount-mode','discount');await page.fill('#ct-discount-pct','12.5');
  assert.equal(await page.inputValue('#ct-price'),'86689.26');
  await page.evaluate(()=>{__pdfText=[];exportContractToPdf();exportContractToWord();});
  const decimals=await page.evaluate(async()=>[__pdfText.join('\n'),await __contractBlob.text()]);
  decimals.forEach(text=>assert.match(text,/86\s*689,26/));
  await page.fill('#ct-discount-pct','101');
  const before=await page.evaluate(()=>__writes.length);await page.click('#ct-save-history');
  assert.equal(await page.evaluate(()=>__writes.length),before);assert.equal(await page.inputValue('#ct-price'),'');
  // Legacy saved documents keep their total and never inherit a new draft's tariff.
  await page.evaluate(()=>{
   const old=__db.audit_log.find(r=>r.entity_type==='contract');delete old.changes.snapshot.new.pricing;old.changes.snapshot.new.price=87654;
   openContractsView();
  });
  await page.waitForFunction(()=>document.querySelector('[data-contract-history-id]'));
  await page.locator('[data-contract-history-id]').first().click();
  assert.equal(await page.inputValue('#ct-price'),'87654');assert.equal(await page.inputValue('#ct-tariff'),'manual');assert.equal(await page.inputValue('#ct-area'),'');
  for(const width of [360,390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
  assert.deepEqual(errors,[]);
  console.log('Contract mobile pricing, save/reopen, frozen catalogue, PDF/Word, decimals, invalid discounts and legacy documents passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
