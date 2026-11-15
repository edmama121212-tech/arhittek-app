const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file] of [['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 try{
  const page=await context.newPage();
  await page.goto('https://app.test/');
  await page.waitForFunction(()=>typeof loadAll==='function' && state.financialDataReady);
  await page.evaluate(()=>{state.kpCatalog=[{id:'sample',name:'Проект',unit:'м²',rate:450}];openKpView();resetKpForm();});
  const nums=page.locator('#kpServicesList input[type=number]');
  await nums.nth(0).fill('120');await nums.nth(0).press('Tab');
  await nums.nth(1).fill('300');await nums.nth(1).press('Tab');
  await page.locator('#kp-advance-percent').selectOption('100');
  await page.locator('#kp-comment').fill('Два варианта планировки.\nВключён выезд.');
  assert.match(await page.locator('#kpServicesList .hint').innerText(),/Скидка: 150/);
  await page.locator('#kpSaveBtn').click();
  await page.waitForFunction(()=>__db.kp_forms?.length && !kpSaveInFlight);
  await page.evaluate(()=>{const saved=__db.kp_forms[0];resetKpForm();loadKpForm(saved);});
  const info=await page.evaluate(()=>{const d=getKpData();return [d.services[0].listRate,d.services[0].rate,d.services[0].qty,d.subtotal,d.advance,d.remainder,kpRowSummary(__db.kp_forms[0]),d.comment];});
  assert.deepEqual(info,[450,300,120,36000,36000,0,36000,'Два варианта планировки.\nВключён выезд.']);
  const pdf=await page.evaluate(()=>{let pdf;window.jspdf.jsPDF.API.save=function(){pdf=Array.from(new Uint8Array(this.output('arraybuffer')));};exportKpToPdf();return pdf;});
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc=await pdfjs.getDocument({data:Uint8Array.from(pdf),useSystemFonts:true}).promise;
  const parts=[];for(let i=1;i<=doc.numPages;i++)parts.push(...(await (await doc.getPage(i)).getTextContent()).items.map(x=>x.str));
  const content=parts.join(' ').replace(/\s+/g,' ');
  for(const str of ['450 руб./м²','300 руб./м²','36 000 руб.','Оплата (100%):','Остаток:','Два варианта планировки.','Включён выезд.'])assert.ok(content.includes(str),str+' missing from PDF: '+content);
  await doc.destroy();
  const rows=await page.evaluate(()=>{let rows;XLSX.writeFile=book=>rows=XLSX.utils.sheet_to_json(book.Sheets['КП'],{header:1});exportKpToXlsx();return rows;});
  assert.deepEqual(rows.find(r=>r[0]===1),[1,'Проект',120,'м²',450,300,36000]);
  assert.deepEqual(rows.find(r=>r[0]==='Комментарий'),['Комментарий',info.at(-1)]);
  assert.ok(rows.some(r=>r[5]==='Оплата (100%):'&&r[6]===36000));
  assert.ok(rows.some(r=>r[5]==='Остаток:'&&r[6]===0));
  await page.locator('#kp-discount-value').fill('10');
  assert.deepEqual(await page.evaluate(()=>{const d=getKpData();return [d.total,d.advance,d.remainder]}),[32400,32400,0]);
  assert.deepEqual(await page.evaluate(()=>{loadKpForm({id:'old',services:[{qty:1,customRate:99.99,snapshot:{name:'Тест',rate:450,unit:'м²'}}]});const d=getKpData();return [d.comment,d.advancePercent,d.advance,d.remainder]}),['',50,50,49.99]);
  console.log('КП: скидка за м², сохранение, старые КП, 50/100%, PDF и Excel — пройдено');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
