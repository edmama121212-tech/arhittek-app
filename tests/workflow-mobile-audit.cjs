const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));

// Independent workflow/mobile checks. Everything is served locally; the only
// database and storage are the isolated mock. No production requests or writes.
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Moscow',serviceWorkers:'block'});
 await context.addInitScript(()=>{
  const OriginalDate=Date;
  window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-10-19T18:00:00Z']));}static now(){return OriginalDate.parse('2026-10-19T18:00:00Z');}};
 });
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),results=[],errors=[],layouts=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function fresh(){
  await page.goto('https://app.test/');await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);await page.waitForTimeout(100);
  await page.evaluate(async()=>{
   __db.projects=[
    {id:'workflow-a',name:'Дом Али',client_name:'Заказчик Али',phone:'+7 900 123-45-67',address:'Грозный, улица Мира',notes:'Редкая пометка',category_id:'arch',status_id:'active',price:100000,fee_base:'profit',employee_id:'architect',updated_at:'2026-10-19T00:00:00Z'},
    {id:'workflow-b',name:'Квартира Б',client_name:'Другой заказчик',category_id:'design',status_id:'done',price:50000,fee_base:'m2',updated_at:'2026-10-19T00:00:00Z'},
    {id:'workflow-build',name:'Строительный объект',category_id:'build',status_id:'active',updated_at:'2026-10-19T00:00:00Z'}
   ];
   __db.project_members=[{id:'workflow-member',project_id:'workflow-b',employee_id:'visual'}];
   __db.project_cards=[{id:'card-a',project_number:'A',title:'Проект №A — Первый дом',floors:1,images:[],thumbnails:[],tags:[],expl1:[],expl2:[]},{id:'card-b',project_number:'B',title:'Проект №B — Второй дом',floors:2,images:[],thumbnails:[],tags:[],expl1:[],expl2:[]}];
   __db.invoices=[{id:'invoice-a',project_id:'workflow-build',number:'A',description:'Материал A',amount:5000,item_type:'Материал',invoice_date:'2026-10-19',photo_url:''},{id:'invoice-b',project_id:'workflow-build',number:'B',description:'Материал B',amount:7000,item_type:'Материал',invoice_date:'2026-10-19',photo_url:''}];
   await loadAll();await loadCards();
  });
 }
 async function check(name,fn,expected){
  try{const actual=await page.evaluate(fn);assert.deepEqual(actual,expected);results.push({name,pass:true});}
  catch(e){results.push({name,pass:false,error:e.message});}
 }
 await fresh();
 await check('Project search covers customer, address, phone and notes',()=>{
  activeCategoryFilter=activeStatusFilter=activePaymentFilter=activeEmployeeFilter='all';
  const found=[];
  for(const query of ['заказчик али','улица мира','123-45','редкая пометка']){projectSearchQuery=query;renderProjects();found.push(document.getElementById('projectsCard').textContent.includes('Дом Али')&&!document.getElementById('projectsCard').textContent.includes('Квартира Б'));}
  projectSearchQuery='';renderProjects();return found;
 },[true,true,true,true]);
 await check('Category, status and team-member filters compose correctly',()=>{
  projectSearchQuery='';activeCategoryFilter='design';activeStatusFilter='done';activeEmployeeFilter='visual';renderProjects();
  return document.getElementById('projectsCard').textContent.includes('Квартира Б')&&!document.getElementById('projectsCard').textContent.includes('Дом Али');
 },true);
 await check('An empty filter has an explicit empty-state message',()=>{activeEmployeeFilter='architect';renderProjects();return document.getElementById('projectsCard').textContent.includes('Нет проектов по этому фильтру');},true);
 await fresh();
 await check('Failed employee save keeps the form and draft available',async()=>{
  openEmployeeSheet('architect');document.getElementById('ef-name').value='Unsaved staff change';__fail={table:'employees',op:'update'};await saveEmployee();__fail=null;
  return [document.getElementById('empSheetOverlay').classList.contains('active'),document.getElementById('ef-name').value,__db.employees.find(e=>e.id==='architect').name,document.getElementById('toast').textContent.includes('Ошибка')];
 },[true,'Unsaved staff change','Адам',true]);
 await fresh();
 await check('Two immediate employee submits create one employee',async()=>{
  openEmployeeSheet(null);document.getElementById('ef-name').value='Unique new colleague';document.getElementById('ef-role').value='Архитектор';document.getElementById('ef-pin').value='4321';
  await Promise.all([saveEmployee(),saveEmployee()]);return __db.employees.filter(e=>e.name==='Unique new colleague').length;
 },1);
 await fresh();
 await check('Cancelling catalogue close preserves an unsaved catalogue draft',async()=>{
  openCardEditor('card-a');await new Promise(r=>setTimeout(r,0));const input=document.getElementById('ce-title');input.value='Important catalogue draft';input.dispatchEvent(new Event('input',{bubbles:true}));
  let prompts=0;window.confirm=()=>{prompts++;return false;};document.querySelector('#cardEditorOverlay button[onclick="closeCardEditor()"]').click();window.confirm=()=>true;
  return [document.getElementById('cardEditorOverlay').style.display!=='none',input.value,prompts>0];
 },[true,'Important catalogue draft',true]);
 await fresh();
 await check('A late catalogue image upload never overwrites another opened card',async()=>{
  openCardEditor('card-a');document.getElementById('ce-title').value='Edited first house';
  const original=uploadCardImages;let release;let first=true;
  uploadCardImages=async images=>{if(first){first=false;await new Promise(r=>release=r);return ['https://example.invalid/first-house.jpg'];}return [];};
  const pending=saveCard();while(!release)await new Promise(r=>setTimeout(r,0));
  closeCardEditor();openCardEditor('card-b');document.getElementById('ce-title').value='Unsaved second-house draft';
  release();await pending;uploadCardImages=original;
  return [__db.project_cards.find(c=>c.id==='card-b').title,__db.project_cards.find(c=>c.id==='card-b').images,__db.project_cards.find(c=>c.id==='card-a').title,document.getElementById('cardEditorOverlay').style.display,document.getElementById('ce-title').value];
 },['Проект №B — Второй дом',[],'Проект №A — Edited first house','flex','Unsaved second-house draft']);
 await fresh();
 await check('A late invoice photo upload never updates another opened invoice',async()=>{
  openInvoiceSheet('invoice-a');document.getElementById('invSheet-desc').value='Edited material A';invSheetNewPhotoBlob=new Blob(['test'],{type:'image/jpeg'});
  const original=compressAndUpload;let release;
  compressAndUpload=async()=>{await new Promise(r=>release=r);return 'https://example.invalid/invoice-a.jpg';};
  const pending=saveInvoiceSheet();while(!release)await new Promise(r=>setTimeout(r,0));
  closeInvoiceSheet();openInvoiceSheet('invoice-b');release();await pending;compressAndUpload=original;
  return [__db.invoices.find(i=>i.id==='invoice-b').description,__db.invoices.find(i=>i.id==='invoice-b').amount,__db.invoices.find(i=>i.id==='invoice-b').photo_url,__db.invoices.find(i=>i.id==='invoice-a').description,invSheetCurrentId,document.getElementById('invoiceSheetOverlay').style.display];
 },['Материал B',7000,'','Edited material A','invoice-b','flex']);
 await fresh();
 await check('Two immediate catalogue submits create one catalogue record',async()=>{
  openCardEditor(null);document.getElementById('ce-num').value='NEW';document.getElementById('ce-title').value='One house';
  await Promise.all([saveCard(),saveCard()]);return __db.project_cards.filter(c=>c.project_number==='NEW').length;
 },1);
 await fresh();
 await check('Catalogue insertion failure preserves draft and permits one successful retry',async()=>{
  openCardEditor(null);document.getElementById('ce-num').value='RETRY';document.getElementById('ce-title').value='Retry house';
  __fail={table:'project_cards',op:'insert'};await saveCard();__fail=null;
  const failed=[document.getElementById('cardEditorOverlay').style.display,document.getElementById('ce-title').value,document.getElementById('ce-save-btn').disabled];
  await saveCard();return [...failed,__db.project_cards.filter(c=>c.project_number==='RETRY').length];
 },['flex','Retry house',false,1]);
 await fresh();
 await check('Two immediate invoice edits produce one row update',async()=>{
  openInvoiceSheet('invoice-a');document.getElementById('invSheet-desc').value='Once';
  const before=__writes.filter(w=>w.table==='invoices'&&w.op==='update').length;await Promise.all([saveInvoiceSheet(),saveInvoiceSheet()]);
  return __writes.filter(w=>w.table==='invoices'&&w.op==='update').length-before;
 },1);
 await fresh();
 await check('Failed invoice edit preserves the original row and edited draft',async()=>{
  openInvoiceSheet('invoice-a');document.getElementById('invSheet-desc').value='Retry material';
  __fail={table:'invoices',op:'update'};await saveInvoiceSheet();__fail=null;
  return [__db.invoices.find(i=>i.id==='invoice-a').description,document.getElementById('invSheet-desc').value,invSheetCurrentId,document.querySelector('#invoiceSheetOverlay button[onclick="saveInvoiceSheet()"]').disabled];
 },['Материал A','Retry material','invoice-a',false]);
 await fresh();
 await check('Project-total failure accurately reports an already saved invoice',async()=>{
  openInvoiceSheet('invoice-a');document.getElementById('invSheet-desc').value='Confirmed material';
  __fail={table:'projects',op:'update'};await saveInvoiceSheet();__fail=null;
  return [__db.invoices.find(i=>i.id==='invoice-a').description,document.getElementById('toast').textContent.includes('Накладная сохранена'),document.getElementById('toast').textContent.includes('Не удалось')];
 },['Confirmed material',true,true]);
 await fresh();
 await check('A late employee audit confirmation cannot close another employee draft',async()=>{
  openEmployeeSheet('architect');document.getElementById('ef-name').value='Updated architect';
  const original=logAudit;let release;logAudit=async()=>new Promise(r=>release=r);
  const pending=saveEmployee();while(!release)await new Promise(r=>setTimeout(r,0));
  closeEmployeeSheet();openEmployeeSheet('visual');document.getElementById('ef-name').value='Unsaved visualizer';release();await pending;logAudit=original;
  return [__db.employees.find(e=>e.id==='architect').name,__db.employees.find(e=>e.id==='visual').name,editingEmployeeId,document.getElementById('ef-name').value,document.getElementById('empSheetOverlay').classList.contains('active'),document.getElementById('ef-save').disabled];
 },['Updated architect','Ислам','visual','Unsaved visualizer',true,false]);
 await fresh();
 await check('A late invoice photo preview cannot enter another invoice form',async()=>{
  openInvoiceSheet('invoice-a');let release;const original=compressImage;
  compressImage=async()=>{await new Promise(r=>release=r);return new Blob(['photo A'],{type:'image/jpeg'});};
  const pending=onInvSheetPhotoChange({files:[new File(['A'],'A.jpg',{type:'image/jpeg'})]});
  openInvoiceSheet('invoice-b');release();await pending;compressImage=original;
  return [invSheetCurrentId,invSheetNewPhotoBlob,document.getElementById('invSheet-photo-name').textContent];
 },['invoice-b',null,'']);
 await fresh();
 await check('A late invoice-payment check keeps its original note and another payment form open',async()=>{
  openInvoicePayment('invoice-a');document.getElementById('cashInvoiceNote').value='Payment note A';
  const original=sb.from;let release,held=false;
  sb.from=function(table){const query=original.call(this,table);if(table==='invoices'&&!held){held=true;const then=query.then;query.then=(resolve,reject)=>(async()=>{await new Promise(r=>release=r);return then.call(query,x=>x);})().then(resolve,reject);}return query;};
  const pending=document.getElementById('cashInvoiceSave').onclick();while(!release)await new Promise(r=>setTimeout(r,0));
  openInvoicePayment('invoice-b');document.getElementById('cashInvoiceNote').value='Payment note B';release();await pending;sb.from=original;
  const rows=__db.ledger_entries.filter(r=>String(r.description||'').includes('[invoice-payment:'));
  return [rows.length,rows[0]?.amount,rows[0]?.description.includes('[invoice-payment:invoice-a]'),rows[0]?.description.includes('Payment note A'),rows[0]?.description.includes('Payment note B'),document.getElementById('cashInvoiceOverlay').classList.contains('active'),document.getElementById('cashInvoiceNote').value];
 },[1,5000,true,true,false,true,'Payment note B']);
 await fresh();
 await check('Cancelling invoice close keeps an unsaved invoice draft',async()=>{
  openInvoiceSheet('invoice-a');await new Promise(r=>setTimeout(r,0));const input=document.getElementById('invSheet-desc');input.value='Keep invoice draft';input.dispatchEvent(new Event('input',{bubbles:true}));
  window.confirm=()=>false;document.querySelector('#invoiceSheetOverlay button[onclick="closeInvoiceSheet()"]').click();window.confirm=()=>true;
  return [invSheetCurrentId,document.getElementById('invoiceSheetOverlay').style.display,input.value];
 },['invoice-a','flex','Keep invoice draft']);
 await fresh();
 await check('A late catalogue photo decode cannot enter another catalogue form',async()=>{
  openCardEditor('card-a');let release;const original=loadOrientedImage;
  loadOrientedImage=async()=>{await new Promise(r=>release=r);return {source:document.createElement('canvas'),width:1,height:1};};
  const pending=ceLoadImg({files:[new File(['A'],'A.jpg',{type:'image/jpeg'})]},'ce-facade-preview',0,'ce-f1-name');
  openCardEditor('card-b');release();await pending;loadOrientedImage=original;
  return [ceCurrentId,ceImages,ceThumbs];
 },['card-b',[null,null,null,null,null,null],[null,null,null,null,null,null]]);
 await fresh();
 await check('Invoice insertion failure preserves its input and creates no record',async()=>{
  openObjectView('workflow-build');switchObjTab('add');document.getElementById('inv-desc-obj').value='Unsaved invoice';document.getElementById('inv-amount-obj').value='9000';
  const before=__db.invoices.length;__fail={table:'invoices',op:'insert'};await addInvoice('workflow-build');__fail=null;
  return [__db.invoices.length===before,document.getElementById('inv-desc-obj').value,document.getElementById('inv-amount-obj').value];
 },[true,'Unsaved invoice','9000']);
 await check('Client-paid invoice cannot be changed while company payments exist',async()=>{
  __db.ledger_entries=[{id:'linked-payment',project_id:'workflow-build',type:'project_expense',amount:2000,entry_date:'2026-10-19',description:'[invoice-payment:invoice-a] paid'}];await loadAll();
  openInvoiceSheet('invoice-a');document.getElementById('invSheet-paid-client').checked=true;await saveInvoiceSheet();return !!__db.invoices.find(i=>i.id==='invoice-a').paid_by_client;
 },false);
 await fresh();
 await check('Unpaid customer debt and an accrued fee cannot create cash',async()=>{
  __db.projects=[{id:'math-partial',name:'Partial receipt',category_id:'arch',status_id:'active',price:100000,advance:30000,balance:70000,employee_id:'architect',fee_base:'profit',fee_percent:40,fee_paid:0,expenses:0,end_date:'2026-10-19',created_at:'2026-10-10T10:00:00Z',updated_at:'2026-10-19T10:00:00Z'}];
  __db.invoices=[];__db.ledger_entries=[{id:'math-receipt',project_id:'math-partial',type:'advance',amount:30000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z'}];await loadAll();
  const p=state.projects[0],b=ARHITTEKCash.projectBudget(state),earned=completedProjectEarningsForRange('2026-10-01','2026-10-31').employees.architect?.earned||0;
  return [ARHITTEKCash.expected(p),getProjectFee(p).mainFeeAmount,earned,b.cashBalance,b.projectsHeld,b.amortization,b.companyReserve];
 },[70000,40000,0,50000,28500,1500,20000]);
 await fresh();
 await check('Percentage-fee lifecycle conserves cash and paying a held debt never debits reserve twice',async()=>{
  const p={id:'math-fee',name:'Fee invariant',category_id:'arch',status_id:'active',price:100000,advance:100000,balance:0,employee_id:'architect',fee_base:'profit',fee_percent:40,fee_paid:0,expenses:10000,end_date:'2026-10-19',created_at:'2026-10-10T10:00:00Z',updated_at:'2026-10-19T10:00:00Z'};
  __db.projects=[p];__db.invoices=[];__db.ledger_entries=[{id:'math-in',project_id:p.id,type:'advance',amount:100000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z'},{id:'math-cost',project_id:p.id,type:'project_expense',amount:10000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z'}];
  const snapshots=[];const capture=async()=>{await loadAll();const b=ARHITTEKCash.projectBudget(state);snapshots.push([b.cashBalance,b.companyReserve,b.projectsHeld,b.teamHeld,b.amortization,b.costsHeld]);};
  await capture();p.status_id='done';await capture();
  __db.ledger_entries.push({id:'math-pay-one',project_id:p.id,type:'fee_payment',payee_employee_id:'architect',amount:10000,entry_date:'2026-10-19',created_at:'2026-10-19T11:00:00Z'});p.fee_paid=10000;await capture();
  const rest={id:'math-pay-rest',project_id:p.id,type:'fee_payment',payee_employee_id:'architect',amount:26000,entry_date:'2026-10-19',created_at:'2026-10-19T12:00:00Z'};__db.ledger_entries.push(rest);p.fee_paid=36000;await capture();
  rest.deleted_at='2026-10-19T13:00:00Z';p.fee_paid=10000;await capture();rest.deleted_at=null;p.fee_paid=36000;await capture();
  p.deleted_at='2026-10-19T14:00:00Z';await capture();p.deleted_at=null;await capture();
  return snapshots;
 },[[110000,20000,85000,0,5000,0],[110000,69000,0,36000,5000,0],[100000,69000,0,26000,5000,0],[74000,69000,0,0,5000,0],[100000,69000,0,26000,5000,0],[74000,69000,0,0,5000,0],[74000,69000,0,0,5000,0],[74000,69000,0,0,5000,0]]);
 await fresh();
 await check('Archiving a paid project keeps its payment settled in both budget and payroll',async()=>{
  const p={id:'math-paid-archive',name:'Paid archival invariant',category_id:'arch',status_id:'done',price:100000,advance:100000,balance:0,employee_id:'architect',fee_base:'profit',fee_percent:40,fee_paid:40000,expenses:0,end_date:'2026-10-19',created_at:'2026-10-10T10:00:00Z',updated_at:'2026-10-19T10:00:00Z'};
  __db.projects=[p];__db.invoices=[];__db.ledger_entries=[{id:'math-archive-in',project_id:p.id,type:'advance',amount:100000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z'},{id:'math-archive-pay',project_id:p.id,type:'fee_payment',payee_employee_id:'architect',amount:40000,entry_date:'2026-10-19',created_at:'2026-10-19T11:00:00Z'}];
  await loadAll();const before=salaryPaymentState('architect','2026-10');p.deleted_at='2026-10-19T14:00:00Z';await loadAll();const after=salaryPaymentState('architect','2026-10'),budget=ARHITTEKCash.projectBudget(state);
  return [before.paid,before.remaining,after.paid,after.remaining,budget.teamHeld];
 },[40000,0,40000,0,0]);
 await fresh();
 await check('Square-metre accruals change obligations only; partial payment changes cash once',async()=>{
  const p={id:'math-m2',name:'Area invariant',category_id:'design',status_id:'active',price:100000,advance:100000,balance:0,employee_id:'visual',fee_base:'m2',area:100,end_date:'2026-10-19',created_at:'2026-10-10T10:00:00Z',updated_at:'2026-10-19T10:00:00Z'};
  __db.projects=[p];__db.invoices=[];__db.ledger_entries=[{id:'math-m2-in',project_id:p.id,type:'advance',amount:100000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z'}];
  const snapshots=[];const capture=async()=>{await loadAll();const b=ARHITTEKCash.projectBudget(state);snapshots.push([b.cashBalance,b.companyReserve,b.teamHeld,b.amortization]);};
  await capture();__db.ledger_entries.push({id:'math-m2-accrue',project_id:p.id,type:'role_payout',payee_employee_id:'visual',amount:100*400,entry_date:'2026-10-19',created_at:'2026-10-19T11:00:00Z'});await capture();
  p.status_id='done';await capture();__db.ledger_entries.push({id:'math-m2-pay',type:'salary_payment',payee_employee_id:'visual',amount:12000,description:'[salary:2026-10]',entry_date:'2026-10-19',created_at:'2026-10-19T12:00:00Z'});await capture();return snapshots;
 },[[120000,20000,0,5000],[120000,20000,0,5000],[120000,75000,40000,5000],[108000,75000,28000,5000]]);
 await fresh();
 await check('Manager commission accrues on partial receipts, independently of advertising costs',async()=>{
  __db.employees.push({id:'math-manager',name:'Manager',role:'Менеджер',active:true,is_salaried:false});
  __db.projects=[{id:'math-manager-project',name:'Manager invariant',category_id:'arch',status_id:'active',price:100000,advance:30000,balance:70000,co_employee_id:'math-manager',fee_base:'profit',fee_percent:0,co_fee_percent:15,created_at:'2026-10-10T10:00:00Z',updated_at:'2026-10-19T10:00:00Z'}];__db.invoices=[];
  __db.ledger_entries=[{id:'math-manager-in',project_id:'math-manager-project',type:'advance',amount:30000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z'}];
  __db.company_expenses=[{id:'math-ad',category:'Реклама / продвижение',amount:9500,description:'Advertising budget',expense_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z'}];await loadAll();
  const earned=completedProjectEarningsForRange('2026-10-01','2026-10-31').employees['math-manager'].earned;const before=ARHITTEKCash.projectBudget(state);
  __db.ledger_entries.push({id:'math-manager-pay',type:'salary_payment',payee_employee_id:'math-manager',amount:4500,description:'[salary:2026-10]',entry_date:'2026-10-19',created_at:'2026-10-19T12:00:00Z'});await loadAll();const after=ARHITTEKCash.projectBudget(state);
  return [earned,before.cashBalance,before.companyReserve,before.projectsHeld,after.cashBalance,after.companyReserve,after.projectsHeld];
 },[4500,40500,10500,28500,36000,10500,24000]);
 await fresh();
 await check('Construction cash conserves independently calculated kopecks across 400 invoice, accrual and payment combinations',()=>{
  let seed=19732;const next=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;},money=minor=>minor/100;
  const p={id:'math-build',name:'Cash property',category_id:'build',status_id:'active',price:1000000,advance:999999,balance:999999,fee_base:'expenses',employee_id:'architect',fee_percent:15};
  state.projects=[p];state.financialProjects=[p];state.companyIncome=[];state.companyExpenses=[];state.cashCounts=[];state.history=[];
  const failures=[];
  for(let sample=0;sample<400;sample++){
   const incomingOne=1+next(10000000),incomingTwo=next(10000000),material=1+next(3000000),work=1+next(3000000),direct=1+next(1000000),accrual=1+next(2000000),linked=next(material+1),manual=next(3000000),fee=next(2000000),withdrawal=next(1000000),foreign=next(1000000);
   state.invoices=[{id:'bill-m',project_id:p.id,item_type:'Материал',amount:money(material),invoice_date:'2026-10-19'},{id:'bill-w',project_id:p.id,item_type:'Работа',amount:money(work),invoice_date:'2026-10-19'},{id:'bill-direct',project_id:p.id,item_type:'Прочее',amount:money(direct),paid_by_client:true,invoice_date:'2026-10-19'}];
   const row=(id,type,amount,extra={})=>({id,project_id:p.id,type,amount:money(amount),entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z',...extra});
   state.ledger=[row('r-one','construction_budget',incomingOne),row('r-two','advance',incomingTwo),row('a-work','role_payout',accrual,{payee_employee_id:'architect'}),row('p-linked','project_expense',linked,{description:'[invoice-payment:bill-m] Material'}),row('p-manual','expense',manual),row('p-fee','fee_payment',fee,{payee_employee_id:'architect'}),row('p-withdraw','withdrawal',withdrawal),row('foreign','expense',foreign,{project_id:'some-other-object'}),row('future','advance',10000000,{entry_date:'2099-01-01'}),row('deleted','expense',10000000,{deleted_at:'2026-10-19T11:00:00Z'}),row('historical','project_expense',10000000,{description:'Ранее внесённые расходы'})];
   const before=JSON.stringify([p,state.invoices,state.ledger]),expectedMinor=incomingOne+incomingTwo-linked-manual-fee-withdrawal,f=getConstructionFinancials(p),company=ARHITTEKCash.balance(state);
   if(Math.round(f.balance*100)!==expectedMinor||Math.round(company*100)!==2000000+expectedMinor-foreign||Math.round(f.unpaidInvoices*100)!==material-linked+work)failures.push(sample);
   p.status_id='done';if(Math.round(getConstructionFinancials(p).balance*100)!==expectedMinor)failures.push('close-'+sample);p.status_id='active';
   const cancelled=state.ledger.map(r=>r.id==='p-withdraw'?{...r,deleted_at:'2026-10-19T12:00:00Z'}:r);
   if(Math.round(getConstructionFinancials(p,cancelled).balance*100)!==expectedMinor+withdrawal)failures.push('cancel-'+sample);
   if(JSON.stringify([p,state.invoices,state.ledger])!==before)failures.push('mutated-'+sample);
  }
  return failures;
 },[]);
 await fresh();
 for(const width of [390,360]){
  await page.setViewportSize({width,height:844});
  for(const view of ['overview','projects','construction','cards','finance','more']){
   await page.locator(`.nav-btn[data-view="view-${view}"]`).click();
   const sample=await page.evaluate(()=>({width:innerWidth,view:document.querySelector('.view.active')?.id,pageFits:document.documentElement.scrollWidth<=innerWidth+1,outside:[...document.querySelectorAll('.view.active button,.view.active input,.view.active select')].filter(e=>e.getClientRects().length).map(e=>({id:e.id,text:e.textContent.trim().slice(0,35),rect:e.getBoundingClientRect()})).filter(e=>e.rect.left< -1||e.rect.right>innerWidth+1).map(e=>({id:e.id,text:e.text}))}));
   layouts.push(sample);
   results.push({name:`Mobile ${view} page fits at ${width}px`,pass:sample.pageFits});
  }
  await page.evaluate(()=>{document.querySelector('.nav-btn[data-view="view-more"]').click();openKpView();});
  const kp=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);results.push({name:`Mobile proposal page fits at ${width}px`,pass:kp});
  await page.evaluate(()=>{document.querySelector('.nav-btn[data-view="view-more"]').click();openContractsView();});
  results.push({name:`Mobile contract page fits at ${width}px`,pass:await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)});
 }
 await fresh();
 await check('Saved catalogue listing loads after refresh without changing editor input',async()=>{
  openCardEditor('card-a');document.getElementById('ce-title').value='Catalogue unsaved draft';await loadCards();return document.getElementById('ce-title').value;
 },'Catalogue unsaved draft');
 await check('Archived employees retain their display names in project exports',()=>{
  const e=state.employees.find(e=>e.id==='architect');e.active=false;const row=buildExportRows()['Проекты'].find(p=>p['Название']==='Дом Али');return row['Исполнитель'];
 },'Адам');
 await check('Client price export and proposal export download exactly once',()=>{
  let xlsx=0,pdf=0;const originalX=XLSX.writeFile,originalP=jspdf.jsPDF.API.save;XLSX.writeFile=()=>xlsx++;jspdf.jsPDF.API.save=function(){pdf++;return this;};
  openPriceListSheet();document.getElementById('priceDownloadXlsx').click();resetKpForm();exportKpToPdf();XLSX.writeFile=originalX;jspdf.jsPDF.API.save=originalP;return [xlsx,pdf];
 },[1,1]);
 const tz=await context.newPage();tz.on('pageerror',e=>errors.push(e.message));
 await tz.addInitScript(()=>window.__tz={id:'workflow-brief',answers:{full_name:'Client'}});
 await tz.goto('https://app.test/tz.html?token=test');await tz.waitForFunction(()=>typeof answers!=='undefined'&&!!tzForm);
 for(const width of [390,360]){
  await tz.setViewportSize({width,height:844});results.push({name:`Public brief fits at ${width}px`,pass:await tz.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)});
 }
 try{
  const r=await tz.evaluate(async()=>{
   const original=sb.rpc;let release;let first=true;const payloads=[];
   sb.rpc=async(name,args)=>{payloads.push(JSON.parse(JSON.stringify(args)));if(first){first=false;await new Promise(r=>release=r);}return {data:null,error:null};};
   answers.full_name='First draft';scheduleAutoSave();clearTimeout(saveTimer);const one=autoSave();
   answers.full_name='Latest draft';scheduleAutoSave();clearTimeout(saveTimer);await autoSave();release();await one;sb.rpc=original;
   return [payloads.map(p=>p.p_answers.full_name),answersDirty,saveInFlight];
  });assert.deepEqual(r,[['First draft','Latest draft'],false,false]);results.push({name:'Brief changes during slow autosave are queued and the latest draft is saved',pass:true});
 }catch(e){results.push({name:'Brief changes during slow autosave are queued and the latest draft is saved',pass:false,error:e.message});}
 await tz.close();
 const catalog=await context.newPage();catalog.on('pageerror',e=>errors.push(e.message));
 await catalog.goto('https://app.test/catalog.html?t=test');await catalog.waitForFunction(()=>typeof init==='function');
 await catalog.evaluate(async()=>{__db.share_links=[{token:'test',expires_at:'2099-01-01'}];__db.project_cards=[{id:'public-card',title:'Дом с длинным названием',floors:2,total_area:200,price:40000,images:[],tags:['Современный'],expl1:[],expl2:[]}];await init();});
 for(const width of [390,360]){
  await catalog.setViewportSize({width,height:844});results.push({name:`Public catalogue fits at ${width}px`,pass:await catalog.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)});
 }
 await browser.close();
 const report={passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,layouts};
 console.log(JSON.stringify(report,null,2));
 if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
