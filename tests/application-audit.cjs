const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
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
 const page=await context.newPage(),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function fresh(){await page.goto('https://app.test/');await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);await page.waitForTimeout(50)}
 async function check(name,fn,expected){try{const actual=await page.evaluate(fn);assert.deepEqual(actual,expected);results.push({name,pass:true})}catch(e){results.push({name,pass:false,error:e.message})}}
 await fresh();
 await check('All 1205 invoices and 1210 money operations load beyond server cap',async()=>{
  __rowLimit=1000;
  __db.invoices=Array.from({length:1205},(_,i)=>({id:'invoice-'+String(i).padStart(4,'0'),project_id:'build',amount:100,item_type:'Материал',invoice_date:'2026-10-10'}));
  __db.ledger_entries=Array.from({length:1210},(_,i)=>({id:'ledger-'+String(i).padStart(4,'0'),type:'advance',amount:100,entry_date:'2026-10-10',created_at:'2026-10-10T10:00:00Z'}));
  await loadAll();return [state.invoices.length,state.ledger.length];
 },[1205,1210]);
 await check('A later-page failure cannot publish a partial financial snapshot',async()=>{
  __db.company_expenses=Array.from({length:900},(_,i)=>({id:'expense-'+i,amount:1,expense_date:'2026-10-10'}));
  __fail={table:'company_expenses',op:'select',offset:500};await loadAll();
  const r=[state.financialDataReady,state.companyExpenses.length,!!state.financialDataError];__fail=null;return r;
 },[false,0,true]);
 await fresh();
 await check('Failed refresh marks previously loaded finances unavailable',async()=>{
  __fail={table:'company_expenses',op:'select'};await loadAll();const r=[state.financialDataReady,!!state.financialDataError];__fail=null;return r;
 },[false,true]);
 await fresh();
 await check('Project members survive an insertion failure',async()=>{
  __db.projects=[{id:'member-project',name:'Members',category_id:'arch',status_id:'active',fee_base:'profit',price:100000,advance:0,updated_at:'2026-10-01T00:00:00Z'}];
  __db.project_members=[{id:'original-member',project_id:'member-project',employee_id:'visual'}];await loadAll();openProjectSheet('member-project');currentProjectMembers.push({employee_id:'architect'});
  __fail={table:'project_members',op:'insert'};await saveProject();__fail=null;return __db.project_members.map(m=>m.employee_id);
 },['visual']);
 await check('Retry after member failure does not duplicate a newly created project',async()=>{
  closeProjectSheet();openProjectSheet(null);document.getElementById('pf-name').value='Retry project';currentProjectMembers=[{employee_id:'visual'}];
  __fail={table:'project_members',op:'insert'};await saveProject();__fail=null;await saveProject();return __db.projects.filter(p=>p.name==='Retry project').length;
 },1);
 await fresh();
 await check('A failed stage update reports an error',async()=>{
  __db.projects=[{id:'stage-project',name:'Stages',category_id:'arch',status_id:'active'}];__db.project_stages=[{id:'stage-1',project_id:'stage-project',name:'Custom',done:false}];await loadAll();document.getElementById('toast').textContent='';
  __fail={table:'project_stages',op:'update'};await markStageDone('stage-1','stage-project');__fail=null;return document.getElementById('toast').textContent.includes('Ошибка');
 },true);
 await check('Two canonical-stage clicks create one stage',async()=>{
  await Promise.all([toggleStageByName('stage-project',encodeURIComponent('Планировка'),true),toggleStageByName('stage-project',encodeURIComponent('Планировка'),true)]);
  return __db.project_stages.filter(s=>s.name==='Планировка').length;
 },1);
 await fresh();
 await check('A saved proposal keeps its service and price when tariffs change',async()=>{
  __db.kp_catalog=[{id:'tariff-a',group_name:'Архитектура',name:'Original service',description:'Original scope',unit:'м²',rate:1500,sort_order:0}];await loadAll();resetKpForm();kpServices[0].qty=100;await saveKpForm();const saved=JSON.parse(JSON.stringify(__db.kp_forms[0]));
  __db.kp_catalog=[{id:'tariff-b',group_name:'Архитектура',name:'Other service',description:'Other scope',unit:'м²',rate:9000,sort_order:0}];await loadAll();loadKpForm(saved);const d=getKpData();return [d.services[0].name,d.services[0].desc,d.total,kpRowSummary(saved)];
 },['Original service','Original scope',150000,150000]);
 await check('Loading a proposal preserves a zero quantity',()=>{loadKpForm({id:'zero-proposal',services:[{catalogIndex:0,qty:0,customRate:100}]});return getKpData().total},0);
 await check('Two proposal submits create one record',async()=>{resetKpForm();const before=__db.kp_forms.length;await Promise.all([saveKpForm(),saveKpForm()]);return __db.kp_forms.length-before},1);
 await check('Failed proposal save keeps unsaved-changes protection',async()=>{
  resetKpForm();const view=document.getElementById('view-kp');view.dataset.dirty='1';__fail={table:'kp_forms',op:'insert'};document.getElementById('kpSaveBtn').click();await new Promise(r=>setTimeout(r,850));__fail=null;return view.dataset.dirty;
 },'1');
 await fresh();
 await check('Two invoice submits create one invoice',async()=>{
  __db.projects=[{id:'invoice-project',name:'Build',category_id:'build',status_id:'active'}];await loadAll();openObjectView('invoice-project');switchObjTab('add');
  document.getElementById('inv-num-obj').value='1';document.getElementById('inv-desc-obj').value='Material';document.getElementById('inv-amount-obj').value='5000';document.getElementById('inv-date-obj').value='2026-10-10';
  await Promise.all([addInvoice('invoice-project'),addInvoice('invoice-project')]);return __db.invoices.length;
 },1);
 await check('Invoice cannot be reduced below its recorded company payment',async()=>{
  const inv=__db.invoices[0];__db.ledger_entries=[{id:'invoice-paid',project_id:inv.project_id,type:'project_expense',amount:5000,entry_date:'2026-10-10',description:'[invoice-payment:'+inv.id+'] payment'}];await loadAll();openInvoiceSheet(inv.id);document.getElementById('invSheet-amount').value='4000';await saveInvoiceSheet();return __db.invoices[0].amount;
 },5000);
 await fresh();
 await check('Invoice cost and its cash payment are counted once in construction',()=>{
  const p={id:'cost-project',name:'Build',category_id:'build',status_id:'active',employee_id:'architect',fee_percent:10};state.projects=[p];
  state.invoices=[{id:'cost-invoice',project_id:p.id,amount:30000,item_type:'Материал',invoice_date:'2026-10-10'}];
  state.ledger=[{id:'build-in',project_id:p.id,type:'advance',amount:100000,entry_date:'2026-10-10'},{id:'build-pay',project_id:p.id,type:'project_expense',amount:30000,entry_date:'2026-10-10',description:'[invoice-payment:cost-invoice] payment'}];
  const f=getConstructionFinancials(p);return [getProjectExpenses(p),f.directCosts,f.balance];
 },[30000,30000,70000]);
 await check('Construction fee is zero without an assigned executor',()=>getProjectFee({id:'cost-project',category_id:'build',fee_percent:10}).mainFeeAmount,0);
 await check('Construction lists use the same category rules as financial calculations',()=>{
  state.categories.push({id:'repair',name:'Ремонт',department_id:'d'});state.projects=[{id:'repair-project',category_id:'repair',name:'Repair'}];state.invoices=[];return [isConstructionProject(state.projects[0]),getConstrProjects().length];
 },[true,1]);
 await fresh();
 await check('Putting an unfinished project in trash does not release its advance',async()=>{
  __db.projects=[{id:'held-project',name:'Held advance',category_id:'arch',status_id:'active',price:100000,advance:40000,fee_base:'profit',fee_percent:40,employee_id:'architect',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-10T00:00:00Z'}];
  __db.ledger_entries=[{id:'held-receipt',project_id:'held-project',type:'advance',amount:40000,entry_date:'2026-10-10',created_at:'2026-10-10T10:00:00Z'}];await loadAll();const before=getCompanyReserveBalance();__db.projects[0].deleted_at='2026-10-11T10:00:00Z';await loadAll();return [before,getCompanyReserveBalance(),state.projects.length];
 },[20000,20000,0]);
 await check('Completed-project debt stays in reserve and payroll after archiving',async()=>{
  __db.projects=[{id:'closed-project',name:'Closed fee',category_id:'arch',status_id:'done',price:100000,advance:100000,fee_base:'profit',fee_percent:40,employee_id:'architect',end_date:'2026-10-10',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-10T10:00:00Z'}];
  __db.ledger_entries=[{id:'closed-receipt',project_id:'closed-project',type:'advance',amount:100000,entry_date:'2026-10-10',created_at:'2026-10-10T10:00:00Z'}];await loadAll();const before=getCompanyReserveBalance();__db.projects[0].deleted_at='2026-10-11T10:00:00Z';await loadAll();return [before,getCompanyReserveBalance(),completedProjectEarningsForRange('2026-10-01','2026-10-31').employees.architect?.earned||0];
 },[75000,75000,40000]);
 await fresh();
 await check('Realtime covers company money, payroll, tariffs and team membership',()=>{
  __subscriptions=[];setupRealtime();return ['company_expenses','company_income','timesheet_payments','kp_catalog','project_members'].every(t=>__subscriptions.includes(t));
 },true);
 await check('A failed realtime reload retains its offline indication',async()=>{
  __fail={table:'company_expenses',op:'select'};scheduleReload('company_expenses');await new Promise(r=>setTimeout(r,800));__fail=null;return document.getElementById('syncDot').classList.contains('off');
 },true);
 await fresh();
 await check('Negative employee salary is rejected',async()=>{
  openEmployeeSheet('admin');document.getElementById('ef-fixed-salary').value='-1';await saveEmployee();return __db.employees.find(e=>e.id==='admin').fixed_salary;
 },50000);
 await fresh();
 await check('A denied card deletion does not claim success',async()=>{
  __db.project_cards=[{id:'card-1',title:'Card',images:[],thumbnails:[]}];await loadCards();openCardEditor('card-1');document.getElementById('toast').textContent='';__fail={table:'project_cards',op:'update'};await deleteCard();__fail=null;return document.getElementById('toast').textContent.includes('Ошибка');
 },true);
 await check('Restoring names with quotes and backslashes keeps the complete label',()=>{
  const name="O'Reilly \\ New \"office\"";state.trash.projects=[{id:'quote-project',name,deleted_at:'2026-10-10'}];
  state.trash.employees=[];state.trash.categories=[];state.trash.ledger=[];state.trash.companyExpenses=[];state.trash.companyIncome=[];state.trash.tariffs=[];
  renderTrash();let received=null;const original=restoreItem;restoreItem=(...args)=>{received=args};document.querySelector('#trashCard button').click();restoreItem=original;return received;
 },['projects','quote-project',"O'Reilly \\ New \"office\""]);
 await check('Internal catalogue images cannot inject event attributes',()=>{
  const html=buildCardHTML({id:'escaped-card',title:'Card',images:['bad\" onerror=\"window.__injected=1'],tags:[],expl1:[],expl2:[],floors:1},0);
  const node=document.createElement('div');node.innerHTML=html;return node.querySelector('img')?.getAttribute('onerror')||null;
 },null);
 await check('Logged-out startup only loads the employee login directory',async()=>{
  session=null;window.session=null;localStorage.removeItem('arhittek_session');__reads=[];await loadAll();return [...new Set(__reads.map(r=>r.table))];
 },['employees']);
 await check('Staff without catalog access cannot invoke card save directly',async()=>{
  session={employeeId:'architect',name:'Адам',isAdmin:false,token:'test'};window.session=session;const n=__writes.length;await saveCard();return __writes.length===n;
 },true);
 const catalog=await context.newPage();catalog.on('pageerror',e=>errors.push(e.message));await catalog.goto('https://app.test/catalog.html');await catalog.waitForFunction(()=>typeof buildCardHTML==='function');
 try{assert.equal(await catalog.evaluate(()=>{const n=document.createElement('div');n.innerHTML=buildCardHTML({id:'escaped-card',title:'Card',images:['bad\" onerror=\"window.__injected=1'],floors:1},0);return n.querySelector('img')?.getAttribute('onerror')||null}),null);results.push({name:'Public catalogue images cannot inject event attributes',pass:true})}catch(e){results.push({name:'Public catalogue images cannot inject event attributes',pass:false,error:e.message})}
 await catalog.close();
 const tz=await context.newPage();tz.on('pageerror',e=>errors.push(e.message));
 await tz.addInitScript(()=>{window.__tz={id:'brief',answers:{full_name:'Client',ar_refs_files:['https://example.invalid/a.jpg','https://example.invalid/b.jpg','https://example.invalid/c.jpg']}}});
 await tz.goto('https://app.test/tz.html?token=test');await tz.waitForFunction(()=>typeof answers!=='undefined'&&!!tzForm);
 async function tzcheck(name,fn,expected){try{const actual=await tz.evaluate(fn);assert.deepEqual(actual,expected);results.push({name,pass:true})}catch(e){results.push({name,pass:false,error:e.message})}}
 await tzcheck('Previously uploaded brief photos can be removed',()=>{answers.service_type=['Архитектурное проектирование (АР)'];renderForm();document.querySelector('#refgrid-ar_refs .ref-remove').click();return answers.ar_refs_files},['https://example.invalid/b.jpg','https://example.invalid/c.jpg']);
 await tzcheck('Removing several newly uploaded photos keeps indices correct',()=>{
  answers.ar_refs_files=[];renderForm();answers.ar_refs_files=['a','b','c'];answers.ar_refs_files.forEach((u,i)=>addRefThumbFromUrl('ar_refs',u,i));const grid=document.getElementById('refgrid-ar_refs');grid.querySelector('.ref-remove').click();grid.querySelector('.ref-remove').click();return answers.ar_refs_files;
 },['c']);
 await tzcheck('Brief progress retains the section counter and updates the percentage',()=>{
  answers={full_name:'Client'};renderForm();answers.other_notes='Note';updateProgressBar();const sections=briefSchema(answers).filter(s=>!s.requiresService);const filled=sections.filter(s=>s.fields.some(f=>!!answers[f.id])).length;
  return [document.querySelector('.pbl-current').textContent,document.querySelector('.progress-bar-labels').lastElementChild.textContent,filled+' из '+sections.length,Math.round(filled/sections.length*100)+'%'];
 },['2 из 2','100%','2 из 2','100%']);
 await tzcheck('An archived landscape tariff does not erase an existing brief choice',()=>{
  const a={service_type:[LandscapeBrief.service],ld_tariff:'Saved tariff',ld_scope:'Saved scope',_ld_tariffs:[{id:'old-tariff',name:'Saved tariff',desc:'Saved scope',rate:500,unit:'м²'}]};LandscapeBrief.sync(a,[]);return [a.ld_tariff,a.ld_scope,LandscapeBrief.selected(a)?.rate];
 },['Saved tariff','Saved scope',500]);
 await browser.close();
 console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors}));
 if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
