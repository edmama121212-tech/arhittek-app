const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
// Every read/write and file request stays in the isolated fixture transport.
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function fresh(){
  await page.goto('https://app.test/');await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);
  await page.evaluate(async()=>{
   __db.projects=[{id:'build-a',name:'Тестовый ремонт',category_id:'build',status_id:'active',price:1000000,advance:999999,balance:999999,employee_id:'architect',fee_percent:15,fee_base:'expenses',created_at:'2026-10-10T10:00:00Z',updated_at:'2026-10-10T10:00:00Z'}];
   __db.ledger_entries=[{id:'receipt-a',project_id:'build-a',type:'construction_budget',amount:100000,entry_date:'2026-10-10',created_at:'2026-10-10T10:00:00Z'}];
   __db.invoices=[];__db.expense_photos=[];await loadAll();__writes=[];
  });
 }
 async function check(name,fn,expected,args){try{const actual=await page.evaluate(fn,args);assert.deepEqual(actual,expected);results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
 await fresh();
 await check('An unpaid invoice is a commitment, not a cash payment',()=>{
  state.invoices=[{id:'bill-a',project_id:'build-a',item_type:'Материал',amount:40000,invoice_date:'2026-10-10'}];const f=getConstructionFinancials(state.projects[0]);return[f.received,f.cashOutgoing,f.balance,f.unpaidInvoices,f.directCosts];
 },[100000,0,100000,40000,40000]);
 await check('A partial invoice payment spends cash once and leaves the unpaid remainder',()=>{
  state.ledger.push({id:'pay-a',project_id:'build-a',type:'project_expense',amount:10000,entry_date:'2026-10-11',description:'[invoice-payment:bill-a]'});const f=getConstructionFinancials(state.projects[0]);return[f.cashOutgoing,f.balance,f.unpaidInvoices,f.directCosts];
 },[10000,90000,30000,40000]);
 await fresh();
 await check('An ordinary expense without an invoice reduces cash and direct project costs',()=>{
  state.ledger.push({id:'ordinary-cost',project_id:'build-a',type:'expense',amount:8000,entry_date:'2026-10-11'});const p=state.projects[0],f=getConstructionFinancials(p);return[f.balance,f.directCosts,getProjectExpenses(p)];
 },[92000,8000,8000]);
 await check('A supplier payment without a payee is a direct cost; payroll is separate',()=>{
  state.ledger.push({id:'supplier-payment',project_id:'build-a',type:'payment',amount:2000,entry_date:'2026-10-11'},{id:'team-payment',project_id:'build-a',type:'payment',payee_employee_id:'architect',amount:3000,entry_date:'2026-10-11'});const f=getConstructionFinancials(state.projects[0]);return[f.balance,f.directCosts];
 },[87000,10000]);
 await fresh();
 await check('Accrued work does not debit cash; each actual outgoing type does',()=>{
  state.ledger.push({id:'accrual',project_id:'build-a',type:'role_payout',amount:20000,payee_employee_id:'architect',entry_date:'2026-10-11'});
  const before=getConstructionFinancials(state.projects[0]).balance;
  for(const type of ['expense','project_expense','payment','withdrawal','fee_payment','salary_payment'])state.ledger.push({id:'out-'+type,project_id:'build-a',type,amount:1000,entry_date:'2026-10-11'});
  state.ledger.push({id:'imported',project_id:'build-a',type:'project_expense',amount:50000,entry_date:'2026-10-11',description:'Ранее внесённые расходы'});const f=getConstructionFinancials(state.projects[0]);return[before,f.balance,f.cashOutgoing,f.rolePayouts];
 },[100000,94000,6000,20000]);
 await fresh();
 await check('Direct client payment with an unusual invoice type never adds company cash',()=>{
  state.invoices=[{id:'client-bill',project_id:'build-a',item_type:'Прочее',amount:30000,invoice_date:'2026-10-10',paid_by_client:true}];const p=state.projects[0],f=getConstructionFinancials(p);return[f.received,f.directPaid,f.balance,f.otherTotal,getProjectExpenses(p),f.unpaidInvoices];
 },[100000,30000,100000,30000,30000,0]);
 await check('Deleted and future cash operations do not change today cash',()=>{
  state.ledger.push({id:'deleted',project_id:'build-a',type:'expense',amount:7000,entry_date:'2026-10-11',deleted_at:'2026-10-12'},{id:'future-out',project_id:'build-a',type:'withdrawal',amount:9000,entry_date:'2099-01-01'},{id:'future-in',project_id:'build-a',type:'advance',amount:11000,entry_date:'2099-01-01'});return getConstructionFinancials(state.projects[0]).balance;
 },100000);
 await check('A pending insert or cancellation uses its provided ledger snapshot',()=>{
  const p=state.projects[0],override=[{id:'override-in',project_id:p.id,type:'advance',amount:50000,entry_date:'2026-10-10'},{id:'override-out',project_id:p.id,type:'withdrawal',amount:7000,entry_date:'2026-10-11'}];return[getConstructionFinancials(p,override).balance,getConstructionFinancials(p,override.slice(0,1)).balance];
 },[43000,50000]);
 await check('Invoice payment in another project cannot settle this invoice',()=>{
  const invoice={id:'same-marker',project_id:'build-a',amount:20000};return ARHITTEKCash.invoicePaymentState({ledger:[{id:'foreign',project_id:'build-b',type:'project_expense',amount:20000,entry_date:'2026-10-11',description:'[invoice-payment:same-marker]'}]},invoice).remaining;
 },20000);
 await check('Export and expected funding derive from cash history, not stale stored counters',()=>{
  const p=state.projects[0],row=buildExportRows()['Проекты'][0];return[row['Аванс'],row['Остаток'],ARHITTEKCash.expected(p)];
 },[100000,100000,900000]);
 await fresh();
 await check('List, object and PDF use the same employee fee basis; company 15% is a separate plan',()=>{
  state.invoices=[{id:'cost-bill',project_id:'build-a',item_type:'Материал',amount:40000,invoice_date:'2026-10-10'}];state.ledger.push({id:'work-accrual',project_id:'build-a',type:'role_payout',amount:50000,payee_employee_id:'visual',entry_date:'2026-10-11'});
  openObjectView('build-a');const p=state.projects[0],plan=document.querySelector('.construction-company-fee-plan').textContent.replace(/\s/g,'');
  return[getProjectFee(p).feeAmount,document.getElementById('objSummary').textContent.replace(/\s/g,'').includes('6000'),plan.includes('150000'),plan.includes('850000'),plan.includes('1150000'),plan.includes('неподтверждены'),__writes.length];
 },[6000,true,true,true,true,true,0]);
 await check('The generated internal PDF separates cash, commitments and employee fees',()=>{
  const Original=window.jspdf.jsPDF;window.__pdfText=[];window.jspdf.jsPDF=function(...args){const doc=new Original(...args),text=doc.text;doc.text=function(value,...rest){__pdfText.push(String(value));return text.call(this,value,...rest);};doc.save=()=>{};return doc;};try{exportConstrPdf('build-a');}finally{window.jspdf.jsPDF=Original;}return[__pdfText.some(t=>t.includes('Выплачено из денег объекта')),__pdfText.some(t=>t.includes('Не оплачено по накладным')),__pdfText.includes('6 000 руб.')||__pdfText.includes('6\u00a0000 руб.'),__pdfText.some(t=>t.includes('Гонорар ARHITTEK'))];
 },[true,true,true,false]);
 await fresh();
 await check('Invoice photos appear in the object gallery without duplicating shared URLs',()=>{
  state.invoices=[{id:'image-bill',project_id:'build-a',item_type:'Материал',description:'Фото накладной',amount:5000,invoice_date:'2026-10-10',photo_url:'https://example.invalid/invoice.jpg'}];state.photos=[{id:'same-image',project_id:'build-a',photo_url:'https://example.invalid/invoice.jpg'},{id:'site-image',project_id:'build-a',photo_url:'https://example.invalid/site.jpg'},{id:'foreign-image',project_id:'build-b',photo_url:'https://example.invalid/foreign.jpg'}];openObjectView('build-a');switchObjTab('photos');return[document.querySelectorAll('#objTabContent .photo-thumb').length,document.querySelectorAll('#objTabContent [data-photo-invoice="image-bill"]').length];
 },[2,1]);
 await check('The invoice gallery button opens its own document',()=>{
  document.querySelector('#objTabContent [data-photo-invoice="image-bill"]').click();return invSheetCurrentId;
 },'image-bill');
 await fresh();
 for(const width of [360,390]){
  await page.setViewportSize({width,height:844});
  await check('Object cash, long title and both header actions fit '+width+'px',async()=>{
   state.projects[0].name='Ремонт квартиры с очень длинным названием и адресом';openObjectView('build-a');await new Promise(r=>requestAnimationFrame(r));
   const width=document.documentElement.clientWidth,buttons=['objBack','objPdfBtn','objEditBtn'].map(id=>document.getElementById(id).getBoundingClientRect());
   return[document.documentElement.scrollWidth<=width+1,buttons.every(r=>r.left>=0&&r.right<=width+1),getComputedStyle(document.getElementById('objSummary').querySelector('.fee-card')).opacity];
  },[true,true,'1']);
 }
 await check('Unconfirmed company fee plan does not change company cash, reserve or employee terms',()=>{
  const before=[ARHITTEKCash.balance(state),ARHITTEKCash.available(state),JSON.stringify(state.projects[0]),JSON.stringify(state.ledger)],p=state.projects[0];constructionCompanyFeePlanHtml(p);constructionCompanyFeePlanHtml({...p,price:0});return JSON.stringify(before)===JSON.stringify([ARHITTEKCash.balance(state),ARHITTEKCash.available(state),JSON.stringify(p),JSON.stringify(state.ledger)]);
 },true);
 await fresh();
 await check('Construction withdrawal save and cancellation synchronize stored and derived cash',async()=>{
  openPaymentSheet('build-a');paymentType='withdrawal';document.getElementById('payment-amount').value='10000';document.getElementById('payment-date').value='2026-10-11';document.getElementById('payment-note').value='Тестовая выплата';await savePayment();
  const saved=[__db.projects[0].balance,getConstructionFinancials(state.projects[0]).balance],row=__db.ledger_entries.find(r=>r.type==='withdrawal');await cancelPayment(row.id);return[saved,__db.projects[0].balance,getConstructionFinancials(state.projects[0]).balance];
 },[[90000,90000],100000,100000]);
 await fresh();
 await check('Construction receipt cancellation and restore keep advance equal to recorded receipts',async()=>{
  openPaymentSheet('build-a');document.getElementById('payment-amount').value='20000';document.getElementById('payment-date').value='2026-10-11';document.getElementById('payment-note').value='Дополнительный аванс';await savePayment();
  const row=__db.ledger_entries.find(r=>r.type==='advance'),saved=[__db.projects[0].advance,__db.projects[0].balance];await cancelPayment(row.id);const cancelled=[__db.projects[0].advance,__db.projects[0].balance];await restoreItem('ledger_entries',row.id,'Тестовый аванс');await restoreItem('ledger_entries',row.id,'Тестовый аванс');return[saved,cancelled,[__db.projects[0].advance,__db.projects[0].balance],__db.ledger_entries.filter(r=>r.type==='advance'&&!r.deleted_at).length];
 },[[120000,120000],[100000,100000],[120000,120000],1]);
 await fresh();
 await check('Construction employee fee save, cancel and restore move cash and counter together',async()=>{
  openPaymentSheet('build-a');paymentType='fee_payment';document.getElementById('payment-payee').value='architect';document.getElementById('payment-amount').value='2000';document.getElementById('payment-date').value='2026-10-11';document.getElementById('payment-note').value='Тестовая выплата исполнителю';await savePayment();
  const row=__db.ledger_entries.find(r=>r.type==='fee_payment'),saved=[__db.projects[0].balance,__db.projects[0].fee_paid];await cancelPayment(row.id);const cancelled=[__db.projects[0].balance,__db.projects[0].fee_paid];await restoreItem('ledger_entries',row.id,'Тестовая выплата');return[saved,cancelled,[__db.projects[0].balance,__db.projects[0].fee_paid]];
 },[[98000,2000],[100000,0],[98000,2000]]);
 await fresh();
 await check('An unconfirmed data reload does not display stale construction totals',()=>{
  openObjectView('build-a');state.financialDataReady=false;renderObjectSummary(state.projects[0]);return[document.getElementById('objSummary').textContent.includes('не подтверждены'),!!document.querySelector('#objSummary .fee-card')];
 },[true,false]);
 await page.evaluate(()=>{state.financialDataReady=true;renderObjectSummary(state.projects[0]);});
 if(process.env.TEST_SCREENSHOT_DIR){fs.mkdirSync(process.env.TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TEST_SCREENSHOT_DIR,'construction-cash-mobile.png'),fullPage:true});}
 await browser.close();console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors},null,2));if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
