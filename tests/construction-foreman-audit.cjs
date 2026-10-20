const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
// Deliberately isolated operational-readiness audit. It does not contact production.
// Missing user requirements are reported as blockers, rather than normalized away.
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
 const page=await context.newPage(),results=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 async function fresh(){await page.goto('https://app.test/');await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);await page.waitForTimeout(80);}
 async function check(name,fn,expected,{severity='P1',requirement=false}={}){try{const actual=await page.evaluate(fn);assert.deepEqual(actual,expected);results.push({name,pass:true});}catch(error){results.push({name,pass:false,severity,requirement,error:error.message});}}
 await fresh();
 await check('All five supported invoice types contribute to the object cost exactly once',()=>{
  const p={id:'repair',name:'Repair',category_id:'build',price:1000000,employee_id:'architect',fee_percent:15};state.projects=[p];
  state.invoices=['Материал','Инструмент','Расходник','Доставка','Работа'].map((item_type,i)=>({id:'bill-'+i,project_id:p.id,item_type,amount:(i+1)*1000,invoice_date:'2026-10-19'}));
  state.ledger=[{id:'in',project_id:p.id,type:'construction_budget',amount:100000,entry_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z'}];
  const f=getConstructionFinancials(p);return [f.matTotal,f.workTotal,f.directCosts,getProjectExpenses(p)];
 },[10000,5000,15000,15000]);
 await check('Uploading an unpaid invoice creates no company cash outflow',()=>{
  const s={projects:state.projects,ledger:state.ledger,invoices:state.invoices,companyExpenses:[],companyIncome:[],cashCounts:[]};
  return [ARHITTEKCash.balance({...s,invoices:[]}),ARHITTEKCash.balance(s)];
 },[120000,120000],{severity:'P0'});
 await check('Object money remaining does not fall just because an unpaid bill was uploaded',()=>{
  const p=state.projects[0];state.invoices=[{id:'unpaid',project_id:p.id,item_type:'Материал',amount:40000,invoice_date:'2026-10-19'}];
  return getConstructionFinancials(p).balance;
 },100000,{severity:'P0',requirement:true});
 await check('A partial invoice payment reduces object cash only by the paid amount',()=>{
  const p=state.projects[0];state.ledger.push({id:'partial',project_id:p.id,type:'expense',amount:10000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z',description:'[invoice-payment:unpaid] First payment'});
  return [ARHITTEKCash.invoicePaymentState(state,state.invoices[0]).remaining,getConstructionFinancials(p).balance];
 },[30000,90000],{severity:'P0',requirement:true});
 await check('An unlinked actual supplier expense reduces object cash even without a bill',()=>{
  const p=state.projects[0];state.invoices=[];state.ledger=state.ledger.filter(e=>e.type==='construction_budget');
  state.ledger.push({id:'cash-delivery',project_id:p.id,type:'expense',amount:8000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z',description:'Delivery paid'});
  return getConstructionFinancials(p).balance;
 },92000,{severity:'P0',requirement:true});
 await check('A worker accrual is visible as an obligation without being presented as paid cash',()=>{
  const p=state.projects[0];state.ledger=state.ledger.filter(e=>e.type==='construction_budget');
  state.ledger.push({id:'labor-accrual',project_id:p.id,type:'role_payout',payee_employee_id:'architect',amount:20000,entry_date:'2026-10-19'});
  return getConstructionFinancials(p).balance;
 },100000,{severity:'P0',requirement:true});
 await check('Customer payment straight to a supplier never creates company cash',()=>{
  const p=state.projects[0];state.ledger=state.ledger.filter(e=>e.type==='construction_budget');
  state.invoices=[{id:'direct',project_id:p.id,item_type:'Материал',amount:20000,invoice_date:'2026-10-19',paid_by_client:true}];
  return [getConstructionFinancials(p).balance,ARHITTEKCash.balance(state)];
 },[100000,120000],{severity:'P0'});
 await check('Company service fee is 15% of the approved budget even without an employee assignment',()=>{
  state.invoices=[];const p={...state.projects[0],employee_id:null,price:1000000,fee_percent:15};return getProjectFee(p).feeAmount;
 },150000,{severity:'P0',requirement:true});
 await check('Company service fee uses the budget rather than the amount of uploaded invoices',()=>{
  const p={...state.projects[0],price:1000000,employee_id:'architect',fee_percent:15};state.invoices=[{id:'cost',project_id:p.id,item_type:'Материал',amount:40000,invoice_date:'2026-10-19'}];return getProjectFee(p).feeAmount;
 },150000,{severity:'P0',requirement:true});
 await check('New renovation object offers a usable construction-stage checklist',()=>{
  const p=state.projects[0];return (defaultStageNamesForProject(p)||[]).length>0;
 },true,{requirement:true});
 await check('Object card has a direct stages/work-progress tab, separate from cost bills',()=>{
  openObjectView('repair');return Array.from(document.querySelectorAll('#objTabs .filter-chip')).some(e=>/Этап|Ход работ|Прогресс/.test(e.textContent));
 },true,{requirement:true});
 await check('The object photo gallery includes uploaded invoice photos',()=>{
  state.invoices=[{id:'photo-bill',project_id:'repair',item_type:'Материал',amount:1000,invoice_date:'2026-10-19',photo_url:'https://example.invalid/invoice-proof.jpg'}];state.photos=[];switchObjTab('photos');return !!document.querySelector('#objTabContent img[src="https://example.invalid/invoice-proof.jpg"]');
 },true,{severity:'P2',requirement:true});
 await fresh();
 await check('The foreman role can enter the construction department',async()=>{
  __db.employees.push({id:'foreman',name:'Test Foreman',role:'Прораб',active:true});__db.projects=[{id:'own',name:'Assigned object',category_id:'build',status_id:'active',employee_id:'foreman'},{id:'other',name:'Other object',category_id:'build',status_id:'active',employee_id:'architect'}];
  await loadAll();session={employeeId:'foreman',name:'Test Foreman',isAdmin:false,token:'test'};window.session=session;return [canSeeConstruction(),isProjectMember('own'),isProjectMember('other')];
 },[true,true,false]);
 await check('The foreman can upload a purchase bill for the assigned object',async()=>{
  openObjectView('own');switchObjTab('add');document.getElementById('inv-num-obj').value='FOREMAN-1';document.getElementById('inv-desc-obj').value='Materials';document.getElementById('inv-date-obj').value='2026-10-19';document.getElementById('inv-amount-obj').value='2500';await addInvoice('own');
  return (__db.invoices||[]).filter(i=>i.project_id==='own').length;
 },1);
 await check('A foreman cannot create an invoice for an unassigned object through an old form',async()=>{
  openObjectView('own');switchObjTab('add');document.getElementById('inv-num-obj').value='FOREMAN-OTHER';document.getElementById('inv-desc-obj').value='Unassigned';document.getElementById('inv-date-obj').value='2026-10-19';document.getElementById('inv-amount-obj').value='1000';await addInvoice('other');
  return (__db.invoices||[]).filter(i=>i.project_id==='other').length;
 },0,{severity:'P0'});
 await check('Opening an object by ID also checks membership, not only the list filter',()=>{
  openObjectView('own');openObjectView('other');return currentObjectId;
 },'own',{severity:'P0'});
 await check('An invoice cannot be opened for editing by staff outside its object team',()=>{
  const inv={id:'other-invoice',project_id:'other',item_type:'Материал',amount:2500,invoice_date:'2026-10-19'};state.invoices.push(inv);closeInvoiceSheet();openInvoiceSheet(inv.id);return document.getElementById('invoiceSheetOverlay').style.display;
 },'none',{severity:'P0'});
 await check('There is a read-only customer object role distinct from an employee login',()=>{
  const p=state.projects.find(p=>p.id==='own');session={employeeId:'customer',name:'Test Customer',isAdmin:false,token:'test',role:'customer',projectId:p.id};window.session=session;
  state.employees.push({id:'customer',name:'Test Customer',role:'Заказчик',active:true,can_see_construction:true});state.projectMembers.push({id:'customer-membership',employee_id:'customer',project_id:p.id});openObjectView(p.id);switchObjTab('add');
  return Array.from(document.querySelectorAll('#objTabs .filter-chip')).some(e=>e.textContent.includes('Добавить'))||!!document.querySelector('#objTabContent button[onclick="addInvoiceFromView()"]');
 },false,{severity:'P0',requirement:true});
 // Two contexts demonstrate that local tasks do not reach the actual foreman device.
 await fresh();
 await check('Project tasks are written to the shared data store for a second device',()=>{
  __db.projects=[{id:'daily-task',name:'Daily task',category_id:'build',status_id:'active'}];document.getElementById('pf-task-name').value='Accept hidden plumbing work';document.getElementById('pf-task-priority').value='high';const before=__writes.length;addTask('daily-task');return __writes.slice(before).some(w=>['project_tasks','project_stages','audit_log'].includes(w.table));
 },true,{requirement:true});
 await browser.close();
 console.log(JSON.stringify({role:'construction_foreman',passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors},null,2));
 if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exit(1);});
