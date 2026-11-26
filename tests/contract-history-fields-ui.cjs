const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
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
  page.setDefaultTimeout(4000);
  page.on('dialog',dialog=>dialog.accept());
  const build=require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
  const rows=[];
  async function action(id,dom,apply){
    const control=page.locator('#'+dom);await control.scrollIntoViewIfNeeded();
    const box=await control.boundingBox();
    const start=performance.now();await apply(control);
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.ok(box.width>0 && box.x>=0 && box.x+box.width<=391,dom);
    const row={id,dom,ms:Math.round(performance.now()-start),width:Math.round(box.width),build,time:new Date().toISOString(),browser:browser.version()};
    return row;
  }
  function record(row,result,steps,total=row.ms){rows.push({...row,result,steps,total});console.log(JSON.stringify(rows.at(-1)));}
  const click=control=>control.click();
  await page.locator('.nav-btn[data-view="view-more"]').click();
  const open=await action(289,'openContractsBtn',click);assert.ok(await page.locator('#view-contracts').isVisible());
  record(open,'Открылась форма нового договора.','Ещё → Договор');
  await page.click('#ct-project-picker');const close=await action(99,'ct-project-close',click);
  assert.ok(!await page.locator('#ct-project-dialog').isVisible());assert.equal(await page.inputValue('#ct-project'),'');
  record(close,'Выбор проекта закрыт. В договоре проект остаётся свободным.','Договор → Выбор проекта → Закрыть поиск');
  const person=[[104,'birthdate','1988-02-29'],[105,'passport-issuer','Учебный отдел'],[106,'passport-date','2020-02-29'],[107,'address','Учебная улица 3'],[120,'phone','+7 000 000-00-02'],[123,'date','2026-11-26'],[124,'object','Учебное здание'],[125,'scope','Обмеры\nПланировка'],[132,'advance-pct','25'],[133,'start','2026-12-01'],[134,'end','2027-01-10']];
  const legal=[[108,'legal-company-name','Учебное общество'],[112,'legal-legal-address','Учебный переулок 4'],[114,'legal-representative-role','Учебный директор'],[115,'legal-authority','Учебный устав'],[116,'legal-bank-name','Учебный банк'],[118,'legal-bik','040000001'],[119,'legal-corr-account','30101810000000000001']];
  for(const [number,fields] of [['QA-P',person],['QA-L',legal]]){
   if(number==='QA-L'){await page.click('#ct-new');await page.selectOption('#ct-customer-type','legal');}
   await page.fill('#ct-number',number);
   const pending=[];
   for(const [id,key,value] of fields)pending.push(await action(id,'ct-'+key,control=>control.fill(value)));
   const start=performance.now();await page.click('#ct-save-history');
   await page.waitForFunction(n=>__db.audit_log.some(row=>row.changes?.snapshot?.new?.number===n),number);
   const saved=Math.round(performance.now()-start);
   await page.waitForFunction(()=>document.querySelector('#view-contracts').dataset.dirty==='0');
   await page.click('#ct-new');await page.locator('[data-contract-history-id]').filter({hasText:number}).first().click();
   for(const [i,[,key,value]] of fields.entries()){
    assert.equal(await page.inputValue('#ct-'+key),value,key);
    record(pending[i],'Значение «'+value.replaceAll('\n',' / ')+'» восстановлено в сохранённом договоре '+number+' при открытии из истории.', 'Договор → '+number+' → поле '+key+' → сохранить → новый договор → открыть '+number+' из истории',saved);
   }
  }
  const filePromise=page.waitForEvent('download',{timeout:5000});const pdf=await action(135,'ct-export-pdf',click);const download=await filePromise;
  assert.match(download.suggestedFilename(),/\.pdf$/i);
  const payload=require('child_process').execFileSync('pdftotext',['-layout',await download.path(),'-'],{encoding:'utf8'});
  for(const value of ['QA-L','Учебное общество','Учебный банк','040000001','30101810000000000001'])assert.ok(payload.includes(value),value);
  assert.ok(!payload.includes('Учебная улица 3'));
  record(pdf,'Скачанный PDF содержит номер QA-L, организацию, банк, БИК и корреспондентский счёт. Адрес физлица из другого договора отсутствует.','Открыть QA-L → Скачать договор в PDF → извлечь текст скачанного файла');
  const back=await action(96,'contractsBack',click);assert.ok(await page.locator('#view-more').isVisible());
  assert.equal(await page.evaluate(()=>__db.ledger_entries.length),0);assert.deepEqual(errors,[]);
  record(back,'Открыт раздел «Ещё». Оформление двух договоров не создало денежных операций.','Договор → Назад');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
