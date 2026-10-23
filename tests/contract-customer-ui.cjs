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
   state.projects=[{id:'one',name:'Дом — Иванов',client_name:'Заказчик Али',address:'Улица Мира',category_id:'arch',area:100,price:50000},{id:'two',name:'Соул бургер',client_name:'Руслан',address:'Улица Ленина',category_id:'arch'}];
   openContractsView();
  });
  await page.click('#ct-project-picker');await page.fill('#ct-project-search','МИРА али');
  assert.equal(await page.locator('#ct-project-results button').count(),2);
  await page.locator('#ct-project-results [data-project-id="one"]').click();
  assert.equal(await page.inputValue('#ct-project'),'one');assert.equal(await page.inputValue('#ct-area'),'100');
  assert.match(await page.locator('#ct-project-picker').innerText(),/Иванов/);
  await page.click('#ct-project-picker');await page.fill('#ct-project-search','несуществующий');
  assert.match(await page.locator('#ct-project-count').innerText(),/Ничего не найдено/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#ct-project-dialog').isVisible(),false);
  await page.fill('#ct-client-name','Скрытое физлицо');await page.fill('#ct-passport','SECRET-PASSPORT');
  await page.selectOption('#ct-customer-type','legal');
  assert.equal(await page.locator('#ct-passport').isVisible(),false);assert.equal(await page.locator('#ct-legal-company-name').isVisible(),true);
  const fields={'company-name':'ООО «Тест & компания»',inn:'2014000000',kpp:'201401001',ogrn:'1232000000000','legal-address':'Грозный, улица Мира, 1',representative:'Иванов Иван Иванович','representative-role':'Директор',authority:'Устав','bank-name':'Тест Банк','bank-account':'40702810000000000001',bik:'040000001','corr-account':'30101810000000000001'};
  for(const [id,value]of Object.entries(fields))await page.fill('#ct-legal-'+id,value);
  await page.fill('#ct-email','company@example.test');await page.fill('#ct-number','LEGAL-1');await page.click('#ct-save-history');
  await page.waitForFunction(()=>__db.audit_log.some(r=>r.entity_type==='contract'&&r.changes.snapshot.new.number==='LEGAL-1'));
  const row=await page.evaluate(()=>__db.audit_log.find(r=>r.entity_type==='contract'));
  assert.equal(row.changes.snapshot.new.customer_type,'legal');assert.equal(row.changes.snapshot.new.passport,'');assert.equal(row.changes.snapshot.new.legal_entity.inn,fields.inn);
  await page.waitForFunction(()=>document.querySelector('[data-contract-history-id]'));
  await page.evaluate(()=>document.getElementById('ct-new').click());
  assert.equal(await page.inputValue('#ct-customer-type'),'individual');assert.equal(await page.inputValue('#ct-legal-inn'),'');
  await page.locator('[data-contract-history-id]').first().click();
  assert.equal(await page.inputValue('#ct-customer-type'),'legal');assert.equal(await page.inputValue('#ct-legal-bank-account'),fields['bank-account']);
  await page.evaluate(()=>{
   const Original=window.jspdf.jsPDF;window.__pdfText=[];
   window.jspdf.jsPDF=function(...args){const doc=new Original(...args),text=doc.text.bind(doc);doc.text=function(value,...rest){window.__pdfText.push(String(value));return text(value,...rest);};doc.save=()=>{};return doc;};
   const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.__contractBlob=blob;return create(blob);};exportContractToPdf();exportContractToWord();
  });
  const exports=await page.evaluate(async()=>[__pdfText.join('\n'),await __contractBlob.text()]);
  for(const text of exports){for(const value of [fields.inn,fields.kpp,fields.ogrn,fields.representative,fields['bank-account'],'company@example.test'])assert.ok(text.includes(value),value);assert.ok(!text.includes('SECRET-PASSPORT'));assert.ok(!text.includes('гражданин(ка) РФ'));}
  await page.selectOption('#ct-customer-type','individual');await page.fill('#ct-client-name','Петров Пётр');await page.fill('#ct-passport','1234 567890');
  await page.evaluate(()=>{__pdfText=[];exportContractToPdf();exportContractToWord();});
  const personal=await page.evaluate(async()=>[__pdfText.join('\n'),await __contractBlob.text()]);
  for(const text of personal){assert.ok(text.includes('Петров'));assert.ok(text.includes('1234 567890'));assert.ok(!text.includes(fields.inn));}
  for(const width of [360,390,1440]){
   await page.setViewportSize({width,height:900});await page.click('#ct-project-picker');
   assert.equal(await page.evaluate(()=>{const d=document.getElementById('ct-project-dialog');return d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().right<=innerWidth;}),true);
   await page.click('#ct-project-close');
  }
  assert.deepEqual(errors,[]);console.log('Searchable project picker, legal/individual fields, saved requisites and PDF/Word exports passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
