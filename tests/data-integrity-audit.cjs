const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));

// All database access is replaced by the local fixture. No production requests.
// Stale snapshots model a second device before it receives realtime updates.
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.addInitScript(()=>{
  // Model a UUID primary key, lost commit responses, failed verification reads,
  // and a slow response while the user opens another money form.
  window.__moneyAttempts=[];window.__moneyHeld=[];window.__moneyFault=null;window.__moneyHold=null;
  const seed=sessionStorage.getItem('__moneyServerFixture');
  if(seed){Object.assign(__db,JSON.parse(seed));sessionStorage.removeItem('__moneyServerFixture');}
  const create=supabase.createClient;
  supabase.createClient=function(){
   const client=create.apply(this,arguments);if(client.__moneyAuditHooks)return client;client.__moneyAuditHooks=true;
   const from=client.from;
   client.from=function(table){
    const q=from.call(this,table),then=q.then;let op='select',payload;
    for(const method of ['insert','update','delete']){const original=q[method];q[method]=function(value){op=method;payload=value;return original.apply(this,arguments);};}
    q.then=function(resolve,reject){return (async()=>{
     const financial=['company_expenses','company_income'].includes(table),fault=window.__moneyFault;
     if(financial&&op==='insert'){
      __moneyAttempts.push({table,id:payload?.id,amount:payload?.amount});
      if(payload?.id&&(__db[table]||[]).some(r=>r.id===payload.id))return {data:null,error:{code:'23505',message:'Duplicate primary key'}};
     }
     if(fault?.table===table&&fault.responseLost&&op==='select'){
      if(fault.readFailures>0){fault.readFailures--;return {data:null,error:{message:'Verification connection lost'}};}
      if(fault.readNulls>0){fault.readNulls--;return {data:null,error:null};}
     }
     const result=await then.call(q,x=>x),hold=window.__moneyHold;
     if(hold?.table===table&&hold.op===op&&hold.remaining>0){hold.remaining--;await new Promise(release=>__moneyHeld.push(release));}
     if(fault?.table===table&&op==='insert'&&fault.afterCommit>0&&!result.error){fault.afterCommit--;fault.responseLost=true;return {data:null,error:{message:'Response lost after commit'}};}
     return result;
    })().then(resolve,reject);};return q;
   };return client;
  };
  window.__releaseMoneyQueries=()=>{for(const release of __moneyHeld.splice(0))release();};
 });
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function fresh(){
  if(page.url().startsWith('https://app.test/'))await page.evaluate(()=>{for(const key of Object.keys(sessionStorage))if(key.startsWith('arhittek_company_money_pending_v1:')||key==='__moneyServerFixture')sessionStorage.removeItem(key);});
  await page.goto('https://app.test/');await page.waitForFunction(()=>typeof loadAll==='function'&&state.financialDataReady);await page.waitForTimeout(80);
 }
 async function check(name,fn,expected,args){try{const actual=await page.evaluate(fn,args);assert.deepEqual(actual,expected);results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}finally{await page.evaluate(()=>{__moneyFault=null;__moneyHold=null;__releaseMoneyQueries();}).catch(()=>{});}}
 await fresh();
 await check('Critical tables load past a server cap below page size',async()=>{
  __rowLimit=200;__db.ledger_entries=Array.from({length:705},(_,i)=>({id:'entry-'+String(i).padStart(4,'0'),type:'income',amount:1,entry_date:'2026-10-10',created_at:'2026-10-10T10:00:00Z'}));
  await loadAll();return [state.ledger.length,state.financialDataReady];
 },[705,true]);
 await check('Late page failure clears the old financial snapshot without publishing partial rows',async()=>{
  __rowLimit=200;__fail={table:'ledger_entries',op:'select',offset:400};await loadAll();const r=[state.financialDataReady,!!state.financialDataError,state.ledger.length];__fail=null;return r;
 },[false,true,0]);
 await fresh();
 await check('Cash-count read failure also hides all unconfirmed financial totals',async()=>{
  __fail={table:'audit_log',op:'select'};await loadAll();const r=[state.financialDataReady,!!state.financialDataError];__fail=null;return r;
 },[false,true]);
 await fresh();
 await check('A rejected company-expense insert creates no money movement and keeps the form',async()=>{
  openCompanyExpenseSheet();document.getElementById('cex-category').value='Прочее';document.getElementById('cex-amount').value='500';document.getElementById('cex-date').value='2026-10-19';document.getElementById('cex-desc').value='Rejected expense';
  __fail={table:'company_expenses',op:'insert'};await saveCompanyExpense();__fail=null;
  return [(__db.company_expenses||[]).length,document.getElementById('companyExpenseSheetOverlay').classList.contains('active'),document.getElementById('toast').textContent.includes('Ошибка сохранения')];
 },[0,true,true]);
 await fresh();
 await check('A receipt restored from a stale second-device trash snapshot increments the project only once',async()=>{
  const old={id:'restore-receipt',project_id:'restore-project',type:'advance',amount:10000,entry_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z',deleted_at:'2026-10-19T10:00:00Z'};
  __db.projects=[{id:'restore-project',name:'Restore project',category_id:'arch',status_id:'active',price:100000,advance:0,balance:100000,updated_at:'2026-10-19T10:00:00Z'}];__db.ledger_entries=[JSON.parse(JSON.stringify(old))];await loadAll();
  state.trash.ledger=[JSON.parse(JSON.stringify(old))];await restoreItem('ledger_entries',old.id,'Receipt');
  state.trash.ledger=[JSON.parse(JSON.stringify(old))];await restoreItem('ledger_entries',old.id,'Receipt');
  return [__db.projects[0].advance,__db.ledger_entries.filter(r=>!r.deleted_at).length];
 },[10000,1]);
 await fresh();
 await check('A stale restore cannot change a project after the server refuses to restore its row',async()=>{
  const old={id:'missing-receipt',project_id:'missing-project',type:'advance',amount:10000,entry_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z',deleted_at:'2026-10-19T10:00:00Z'};
  __db.projects=[{id:'missing-project',name:'Missing receipt',category_id:'arch',status_id:'active',price:100000,advance:0,balance:100000,updated_at:'2026-10-19T10:00:00Z'}];__db.ledger_entries=[];await loadAll();state.trash.ledger=[old];await restoreItem('ledger_entries',old.id,'Receipt');
  return [__db.projects[0].advance,(__db.ledger_entries||[]).length];
 },[0,0]);
 await fresh();
 await check('Restore uses the server amount instead of a stale trash amount',async()=>{
  const old={id:'changed-receipt',project_id:'changed-project',type:'advance',amount:10000,entry_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z',deleted_at:'2026-10-19T10:00:00Z'};
  __db.projects=[{id:'changed-project',name:'Changed receipt',category_id:'arch',status_id:'active',price:100000,advance:0,balance:100000,updated_at:'2026-10-19T10:00:00Z'}];__db.ledger_entries=[{...old,amount:20000}];await loadAll();state.trash.ledger=[old];await restoreItem('ledger_entries',old.id,'Receipt');return [__db.projects[0].advance,__db.ledger_entries[0].amount];
 },[20000,20000]);
 await fresh();
 await check('A failed dependent project update returns the receipt to trash and leaves its amount unchanged',async()=>{
  const old={id:'failed-restore-receipt',project_id:'failed-restore-project',type:'advance',amount:10000,entry_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z',deleted_at:'2026-10-19T10:00:00Z'};
  __db.projects=[{id:'failed-restore-project',name:'Rejected restore',category_id:'arch',status_id:'active',price:100000,advance:0,balance:100000,updated_at:'2026-10-19T10:00:00Z'}];__db.ledger_entries=[{...old}];await loadAll();state.trash.ledger=[old];__fail={table:'projects',op:'update'};await restoreItem('ledger_entries',old.id,'Receipt');__fail=null;
  return [__db.projects[0].advance,__db.ledger_entries[0].deleted_at,document.getElementById('toast').textContent.includes('Восстановлено')];
 },[0,'2026-10-19T10:00:00Z',false]);
 await fresh();
 await check('Invoice payment rechecks the complete journal and cannot overpay a row beyond the server cap',async()=>{
  __rowLimit=1000;__db.projects=[{id:'invoice-cap-project',name:'Long history',category_id:'build',status_id:'active',price:100000,advance:100000}];
  __db.invoices=[{id:'invoice-cap',project_id:'invoice-cap-project',description:'Material',amount:5000,item_type:'Материал',invoice_date:'2026-10-19'}];
  __db.ledger_entries=Array.from({length:1000},(_,i)=>({id:'invoice-old-'+String(i).padStart(4,'0'),project_id:'invoice-cap-project',type:'expense',amount:1,description:'Other expense',entry_date:'2026-10-10',created_at:'2026-10-10T10:00:00Z'}));
  __db.ledger_entries.push({id:'invoice-already-paid',project_id:'invoice-cap-project',type:'expense',amount:5000,description:'[invoice-payment:invoice-cap] Payment',entry_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z'});
  await loadAll();openInvoicePayment('invoice-cap');document.getElementById('cashInvoiceAmount').value='5000';await document.getElementById('cashInvoiceSave').onclick();
  return __db.ledger_entries.filter(r=>!r.deleted_at&&String(r.description||'').includes('[invoice-payment:invoice-cap]')).reduce((sum,r)=>sum+r.amount,0);
 },5000);
 await fresh();
 await check('A failed late invoice-payment page never authorizes a new payment',async()=>{
  __rowLimit=1000;__db.projects=[{id:'invoice-error-project',name:'Read error',category_id:'build',status_id:'active'}];__db.invoices=[{id:'invoice-error',project_id:'invoice-error-project',description:'Material',amount:5000,item_type:'Материал',invoice_date:'2026-10-19'}];
  __db.ledger_entries=Array.from({length:1001},(_,i)=>({id:'invoice-read-'+String(i).padStart(4,'0'),project_id:'invoice-error-project',type:'expense',amount:1,description:'Other expense',entry_date:'2026-10-10',created_at:'2026-10-10T10:00:00Z'}));await loadAll();openInvoicePayment('invoice-error');document.getElementById('cashInvoiceAmount').value='5000';__fail={table:'ledger_entries',op:'select',offset:1000};await document.getElementById('cashInvoiceSave').onclick();__fail=null;
  return [__db.ledger_entries.length,document.getElementById('cashInvoiceOverlay').classList.contains('active')];
 },[1001,true]);
 await fresh();
 await check('An invoice marked client-paid on another device cannot spend company money from an old payment form',async()=>{
  __db.projects=[{id:'invoice-client-project',name:'Direct payment',category_id:'build',status_id:'active'}];__db.invoices=[{id:'invoice-client',project_id:'invoice-client-project',description:'Material',amount:5000,item_type:'Материал',invoice_date:'2026-10-19',paid_by_client:false}];__db.ledger_entries=[];await loadAll();openInvoicePayment('invoice-client');__db.invoices[0].paid_by_client=true;await document.getElementById('cashInvoiceSave').onclick();return (__db.ledger_entries||[]).length;
 },0);
 await fresh();
 await check('Putting a project in trash preserves its cash and unpaid team obligations',async()=>{
  __db.projects=[{id:'archive-project',name:'Archived',category_id:'arch',status_id:'done',price:100000,advance:100000,employee_id:'architect',fee_base:'profit',fee_percent:40,created_at:'2026-10-10T10:00:00Z',updated_at:'2026-10-19T09:00:00Z',end_date:'2026-10-19'}];
  __db.ledger_entries=[{id:'archive-receipt',project_id:'archive-project',type:'advance',amount:100000,entry_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z'}];await loadAll();const before=[ARHITTEKCash.balance(state),getCompanyReserveBalance()];__db.projects[0].deleted_at='2026-10-19T10:00:00Z';await loadAll();return [before,[ARHITTEKCash.balance(state),getCompanyReserveBalance()],state.projects.length];
 },[[120000,75000],[120000,75000],0]);
 for(const kind of ['expense','income']){
  await fresh();
  await check(kind+': a committed insert with a lost response is confirmed by exact UUID and never inserted twice',async kind=>{
   const expense=kind==='expense',table=expense?'company_expenses':'company_income',prefix=expense?'cex':'cin';
   if(expense)openCompanyExpenseSheet();else openCompanyIncomeSheet();
   document.getElementById(prefix+'-category').value=expense?'Прочее':'Прочий доход';document.getElementById(prefix+'-amount').value='500';document.getElementById(prefix+'-date').value='2026-10-19';document.getElementById(prefix+'-desc').value='Uncertain operation';
   __moneyFault={table,afterCommit:1};const save=expense?saveCompanyExpense:saveCompanyIncome;await save();await save();
   const rows=__db[table]||[];return [rows.length,rows[0]?.amount,/^[0-9a-f-]{36}$/i.test(rows[0]?.id||''),__moneyAttempts.filter(x=>x.table===table).length,document.getElementById(expense?'companyExpenseSheetOverlay':'companyIncomeSheetOverlay').classList.contains('active')];
  },[1,500,true,1,false],kind);
  await fresh();
  await check(kind+': a failed verification preserves the draft UUID and a retry reads the existing row',async kind=>{
   const expense=kind==='expense',table=expense?'company_expenses':'company_income',prefix=expense?'cex':'cin',overlay=expense?'companyExpenseSheetOverlay':'companyIncomeSheetOverlay';
   if(expense)openCompanyExpenseSheet();else openCompanyIncomeSheet();
   document.getElementById(prefix+'-category').value=expense?'Прочее':'Прочий доход';document.getElementById(prefix+'-amount').value='500';document.getElementById(prefix+'-date').value='2026-10-19';document.getElementById(prefix+'-desc').value='Verification pending';
   __moneyFault={table,afterCommit:1,readFailures:1};const save=expense?saveCompanyExpense:saveCompanyIncome;await save();const waiting=document.getElementById(overlay).classList.contains('active'),original=__db[table][0].id;await save();
   return [waiting,__db[table].length,__db[table][0].id===original,__moneyAttempts.filter(x=>x.table===table).length,document.getElementById(overlay).classList.contains('active')];
  },[true,1,true,1,false],kind);
  await fresh();
  await check(kind+': changed fields after an uncertain commit are kept and require an explicit edit of the confirmed row',async kind=>{
   const expense=kind==='expense',table=expense?'company_expenses':'company_income',prefix=expense?'cex':'cin',overlay=expense?'companyExpenseSheetOverlay':'companyIncomeSheetOverlay';
   if(expense)openCompanyExpenseSheet();else openCompanyIncomeSheet();
   document.getElementById(prefix+'-category').value=expense?'Прочее':'Прочий доход';document.getElementById(prefix+'-amount').value='500';document.getElementById(prefix+'-date').value='2026-10-19';document.getElementById(prefix+'-desc').value='Changed pending operation';
   __moneyFault={table,afterCommit:1,readFailures:1};const save=expense?saveCompanyExpense:saveCompanyIncome;await save();document.getElementById(prefix+'-amount').value='700';await save();
   const retained=[__db[table].length,__db[table][0].amount,document.getElementById(prefix+'-amount').value,document.getElementById(overlay).classList.contains('active'),document.getElementById(prefix+'-save-status').textContent.includes('ещё не сохранены')];await save();
   return [retained,[__db[table].length,__db[table][0].amount,document.getElementById(overlay).classList.contains('active')]];
  },[[1,500,'700',true,true],[1,700,false]],kind);
  await fresh();
  await check(kind+': a rejected insert retries changed input with the same UUID without silently sending old values',async kind=>{
   const expense=kind==='expense',table=expense?'company_expenses':'company_income',prefix=expense?'cex':'cin';
   if(expense)openCompanyExpenseSheet();else openCompanyIncomeSheet();
   document.getElementById(prefix+'-category').value=expense?'Прочее':'Прочий доход';document.getElementById(prefix+'-amount').value='500';document.getElementById(prefix+'-date').value='2026-10-19';document.getElementById(prefix+'-desc').value='Rejected draft';
   __fail={table,op:'insert'};const save=expense?saveCompanyExpense:saveCompanyIncome;await save();__fail=null;document.getElementById(prefix+'-amount').value='700';await save();const attempts=__moneyAttempts.filter(x=>x.table===table);
   return [__db[table].length,__db[table][0].amount,attempts.length,attempts[0].id===attempts[1].id,attempts.map(x=>x.amount)];
  },[1,700,2,true,[500,700]],kind);
  await fresh();
  await check(kind+': a late save of form A never closes form B or replaces its unsaved amount',async kind=>{
   const expense=kind==='expense',table=expense?'company_expenses':'company_income',prefix=expense?'cex':'cin',overlay=expense?'companyExpenseSheetOverlay':'companyIncomeSheetOverlay',date=expense?'expense_date':'income_date';
   __db[table]=[{id:'existing-form-b',category:expense?'Прочее':'Прочий доход',amount:200,[date]:'2026-10-19',description:'Existing B'}];await loadAll();
   if(expense)openCompanyExpenseSheet();else openCompanyIncomeSheet();document.getElementById(prefix+'-category').value=expense?'Прочее':'Прочий доход';document.getElementById(prefix+'-amount').value='500';document.getElementById(prefix+'-date').value='2026-10-19';document.getElementById(prefix+'-desc').value='New A';
   __moneyHold={table,op:'insert',remaining:1};const pending=(expense?saveCompanyExpense:saveCompanyIncome)();for(let i=0;i<100&&!__moneyHeld.length;i++)await new Promise(r=>setTimeout(r,5));if(!__moneyHeld.length)throw new Error('Insert did not pause');
   if(expense)openCompanyExpenseSheet('existing-form-b');else openCompanyIncomeSheet('existing-form-b');document.getElementById(prefix+'-amount').value='250';__releaseMoneyQueries();await pending;
   return [document.getElementById(overlay).classList.contains('active'),expense?editingCompanyExpenseId:editingCompanyIncomeId,document.getElementById(prefix+'-amount').value,__db[table].find(r=>r.id==='existing-form-b').amount,__db[table].find(r=>r.description==='New A').amount];
  },[true,'existing-form-b','250',200,500],kind);
 }
 await fresh();
 await check('Reopening an uncertain expense recovers its UUID and input instead of starting a duplicate',async()=>{
  openCompanyExpenseSheet();document.getElementById('cex-category').value='Прочее';document.getElementById('cex-amount').value='500';document.getElementById('cex-date').value='2026-10-19';document.getElementById('cex-desc').value='Recovered expense';__moneyFault={table:'company_expenses',afterCommit:1,readFailures:1};await saveCompanyExpense();const id=__db.company_expenses[0].id;closeCompanyExpenseSheet();openCompanyExpenseSheet();const recovered=[document.getElementById('cex-amount').value,document.getElementById('cex-desc').value];await saveCompanyExpense();return [recovered,__db.company_expenses.length,__db.company_expenses[0].id===id,__moneyAttempts.filter(x=>x.table==='company_expenses').length];
 },[['500','Recovered expense'],1,true,1]);
 await fresh();
 await check('A primary-key collision after a hidden commit recovers the same row and does not overwrite it',async()=>{
  openCompanyExpenseSheet();document.getElementById('cex-category').value='Прочее';document.getElementById('cex-amount').value='500';document.getElementById('cex-date').value='2026-10-19';document.getElementById('cex-desc').value='Hidden commit';__moneyFault={table:'company_expenses',afterCommit:1,readNulls:1};await saveCompanyExpense();__moneyFault.readNulls=1;await saveCompanyExpense();const attempts=__moneyAttempts.filter(x=>x.table==='company_expenses');return [__db.company_expenses.length,__db.company_expenses[0].amount,attempts.length,attempts[0].id===attempts[1].id];
 },[1,500,2,true]);
 await fresh();
 await page.evaluate(async()=>{
  openCompanyExpenseSheet();document.getElementById('cex-category').value='Прочее';document.getElementById('cex-amount').value='500';document.getElementById('cex-date').value='2026-10-19';document.getElementById('cex-desc').value='Reloaded pending expense';__moneyFault={table:'company_expenses',afterCommit:1,readFailures:1};await saveCompanyExpense();sessionStorage.setItem('__moneyServerFixture',JSON.stringify({company_expenses:__db.company_expenses}));
 });
 await page.reload();await page.waitForFunction(()=>state.financialDataReady);
 await check('Reloading the page retains an uncertain expense UUID until exact-row verification',async()=>{
  const id=__db.company_expenses[0].id;openCompanyExpenseSheet();const amount=document.getElementById('cex-amount').value;await saveCompanyExpense();return [amount,__db.company_expenses.length,__db.company_expenses[0].id===id,__moneyAttempts.filter(x=>x.table==='company_expenses').length];
 },['500',1,true,0]);
 await fresh();
 await check('Confirming an uncertain withdrawal does not require having the already spent money twice',async()=>{
  openCompanyExpenseSheet(null,COMPANY_WITHDRAWAL_CATEGORY);document.getElementById('cex-amount').value='15000';document.getElementById('cex-date').value='2026-10-19';document.getElementById('cex-desc').value='Withdraw once';__moneyFault={table:'company_expenses',afterCommit:1,readFailures:1};await saveCompanyExpense();await loadAll();const available=getCompanyAvailableCash();await saveCompanyExpense();
  return [available,__db.company_expenses.length,__db.company_expenses[0].amount,document.getElementById('companyExpenseSheetOverlay').classList.contains('active')];
 },[5000,1,15000,false]);
 await fresh();
 await check('Editing the same form during a slow save preserves the newer input for an explicit subsequent edit',async()=>{
  openCompanyExpenseSheet();document.getElementById('cex-category').value='Прочее';document.getElementById('cex-amount').value='500';document.getElementById('cex-date').value='2026-10-19';document.getElementById('cex-desc').value='Slow saved expense';__moneyHold={table:'company_expenses',op:'insert',remaining:1};const pending=saveCompanyExpense();for(let i=0;i<100&&!__moneyHeld.length;i++)await new Promise(r=>setTimeout(r,5));if(!__moneyHeld.length)throw new Error('Insert did not pause');document.getElementById('cex-amount').value='700';__releaseMoneyQueries();await pending;
  const retained=[__db.company_expenses[0].amount,document.getElementById('cex-amount').value,document.getElementById('companyExpenseSheetOverlay').classList.contains('active'),document.getElementById('cex-save-status').textContent.includes('ещё не сохранены')];await saveCompanyExpense();return [retained,__db.company_expenses.length,__db.company_expenses[0].amount];
 },[[500,'700',true,true],1,700]);
 await fresh();
 await check('A stale expense editor cannot overwrite a different amount saved by another device',async()=>{
  __db.company_expenses=[{id:'concurrent-expense',category:'Прочее',amount:500,expense_date:'2026-10-19',description:'Original expense'}];await loadAll();openCompanyExpenseSheet('concurrent-expense');document.getElementById('cex-amount').value='700';__db.company_expenses[0].amount=900;await saveCompanyExpense();
  return [__db.company_expenses[0].amount,document.getElementById('cex-amount').value,document.getElementById('companyExpenseSheetOverlay').classList.contains('active'),document.getElementById('toast').textContent.includes('Текущие поля')||document.getElementById('toast').textContent.includes('текущие поля')];
 },[900,'700',true,true]);
 await fresh();
 await check('An uncertain entry deleted on another device cannot be recreated or silently restored by retry',async()=>{
  openCompanyIncomeSheet();document.getElementById('cin-category').value='Прочий доход';document.getElementById('cin-amount').value='500';document.getElementById('cin-date').value='2026-10-19';document.getElementById('cin-desc').value='Deleted after commit';__moneyFault={table:'company_income',afterCommit:1,readFailures:1};await saveCompanyIncome();__db.company_income[0].deleted_at='2026-10-19T12:00:00Z';await saveCompanyIncome();
  return [__db.company_income.length,__db.company_income.filter(r=>!r.deleted_at).length,document.getElementById('companyIncomeSheetOverlay').classList.contains('active'),document.getElementById('cin-save-status').textContent.includes('корзине')];
 },[1,0,true,true]);
 results.push({name:'No uncaught browser exceptions',pass:errors.length===0,...(errors.length?{error:errors.join('; ')}:{})});
 await browser.close();const failed=results.filter(r=>!r.pass);console.log(JSON.stringify({passed:results.length-failed.length,total:results.length,failed,results},null,2));if(failed.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
