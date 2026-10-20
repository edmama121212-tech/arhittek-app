// Independent foreman/director acceptance scenarios. All requests use local fixtures.
// The DOM runtime executes the application's real handlers; it does not verify layout,
// native camera behavior or server RLS. No production request is permitted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,requestInterceptor,VirtualConsole}=require('jsdom');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
const results=[],runtimeErrors=[];
const localResources=requestInterceptor(request=>{
  const parsed=new URL(request.url);
  if(parsed.hostname==='app.test'){
   const file=path.join(root,parsed.pathname.slice(1));
   if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.css')?'text/css':'application/javascript'}});
  }
  // External CDN scripts are not needed by these money/record handlers.
  return new Response('',{headers:{'Content-Type':'application/javascript'}});
});
async function app(seed={}){
 const console=new VirtualConsole();console.on('jsdomError',error=>{
  if(!/Not implemented: (HTMLCanvasElement|window\.scrollTo)/.test(error.message))runtimeErrors.push(error.message);
 });
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{
  url:'https://app.test/',runScripts:'dangerously',resources:{interceptors:[localResources]},pretendToBeVisual:true,virtualConsole:console,
  beforeParse(w){
   w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.structuredClone=structuredClone;
   w.scrollTo=()=>{};w.Element.prototype.scrollIntoView=()=>{};
   w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   w.fetch=()=>Promise.reject(new Error('Operational tests forbid external fetch'));
   w.eval(fs.readFileSync(path.join(__dirname,'mock.js'),'utf8'));
   w.__operationalSeed=seed.database?JSON.parse(JSON.stringify(seed.database)):null;
   for(const [key,value]of Object.entries(seed.storage||{}))w.sessionStorage.setItem(key,value);
   // Faithful primary-key constraint and a server commit whose response is lost.
   // A retry must confirm the original UUID, not create another financial fact.
   w.__operationFault=null;w.__operationAttempts=[];
   const create=w.supabase.createClient;
   w.supabase.createClient=function(){
    const client=create.apply(this,arguments);if(client.__operationsAuditHook)return client;client.__operationsAuditHook=true;
    const from=client.from;
    client.from=function(table){
     const q=from.call(this,table),then=q.then;let op='select',payload;
     for(const method of ['insert','update','delete']){const original=q[method];q[method]=function(value){op=method;payload=value;return original.apply(this,arguments);};}
     q.then=function(resolve,reject){return(async()=>{
      const tracked=['invoices','ledger_entries'].includes(table),fault=w.__operationFault;
      if(tracked&&op==='insert'){
       w.__operationAttempts.push({table,id:payload?.id,amount:payload?.amount});
       if(payload?.id&&(w.__db[table]||[]).some(row=>row.id===payload.id))return {data:null,error:{code:'23505',message:'Duplicate primary key'}};
      }
      if(fault?.table===table&&fault.responseLost&&op==='select'&&fault.readFailures>0){fault.readFailures--;return {data:null,error:{message:'Lost verification response'}};}
      const result=await then.call(q,x=>x);
      if(fault?.table===table&&op==='insert'&&fault.afterCommit>0&&!result.error){fault.afterCommit--;fault.responseLost=true;return {data:null,error:{message:'Lost response after committed insert'}};}
      return result;
     })().then(resolve,reject);};return q;
    };return client;
   };
  }
 });
 const w=dom.window;
 for(let i=0;i<200;i++){
  if(w.eval("typeof state!=='undefined'&&typeof loadAll==='function'&&state.financialDataReady"))break;
  await new Promise(r=>setTimeout(r,10));
 }
 assert.equal(w.eval("typeof state!=='undefined'&&state.financialDataReady"),true,'Application failed to initialize');
 await w.eval(`(async()=>{
  if(window.__operationalSeed){__db=window.__operationalSeed;}
  else{
   __db.projects=[{id:'repair',name:'Ремонт квартиры: приёмка',category_id:'build',status_id:'active',employee_id:null,price:1000000,advance:0,balance:0,fee_percent:15,fee_base:'expenses',fee_paid:0,expenses:0,created_at:'2026-10-10T08:00:00Z',updated_at:'2026-10-10T08:00:00Z'}];
   __db.ledger_entries=[];__db.invoices=[];__db.project_stages=[];__db.project_members=[];__db.expense_photos=[];
  }
  await loadAll();__writes.length=0;window.__object=()=>state.projects.find(p=>p.id==='repair');
  window.__cash=()=>getConstructionFinancials(__object());
  window.__invoiceForm=(description,amount,type='Материал')=>{openObjectView('repair');switchObjTab('add');document.getElementById('inv-num-obj').value='AUDIT-'+description;document.getElementById('inv-desc-obj').value=description;document.getElementById('inv-amount-obj').value=String(amount);document.getElementById('inv-date-obj').value='2026-10-19';document.getElementById('inv-type-obj').value=type;};
  window.__payBill=async(id,amount)=>{openInvoicePayment(id);document.getElementById('cashInvoiceAmount').value=String(amount);document.getElementById('cashInvoiceDate').value='2026-10-19';await document.getElementById('cashInvoiceSave').onclick();};
  window.__receive=async(amount)=>{openPaymentSheet('repair');document.getElementById('payment-amount').value=String(amount);document.getElementById('payment-date').value='2026-10-19';await savePayment();};
 })()`);
 return {dom,w,run:async code=>{const value=await w.eval(code);return value===undefined?undefined:JSON.parse(JSON.stringify(value));}};
}
async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}}
(async()=>{
 let a=await app();const run=code=>a.run(code);
 await check('Opening an existing object preserves its documents and creates no money',async()=>{
  assert.deepEqual(await run(`(()=>{const before=JSON.stringify(__db);openObjectView('repair');return[JSON.stringify(__db)===before,__writes.filter(w=>w.table).length,__cash().received,__cash().companyMarkupAmount]})()`),[true,0,0,0]);
 });
 await check('A 100000 advance creates client cash and no markup',async()=>{
  assert.deepEqual(await run(`(async()=>{await __receive(100000);return[__cash().received,__cash().balance,__cash().companyMarkupAmount,__db.ledger_entries.filter(r=>!r.deleted_at).length]})()`),[100000,100000,0,1]);
 });
 await check('An unpaid 40000 materials invoice creates no cash outflow and retains the advance',async()=>{
  assert.deepEqual(await run(`(async()=>{__invoiceForm('Материалы',40000);await addInvoice('repair');return[__cash().directCosts,__cash().balance,__cash().unpaidInvoices,__cash().companyMarkupAmount]})()`),[40000,100000,40000,6000]);
 });
 await check('The first 10000 installment spends cash once without duplicating the cost or markup',async()=>{
  assert.deepEqual(await run(`(async()=>{await __payBill(__db.invoices[0].id,10000);return[__cash().balance,__cash().unpaidInvoices,__cash().directCosts,__cash().companyMarkupAmount]})()`),[90000,30000,40000,6000]);
 });
 await check('Linking an existing 5000 expense to the invoice does not charge the cash twice',async()=>{
  assert.deepEqual(await run(`(async()=>{__db.ledger_entries.push({id:'existing-payment',project_id:'repair',type:'expense',amount:5000,entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z',description:'Ранее записанная оплата'});await loadAll();const before=__cash().balance;openInvoicePayment(__db.invoices[0].id);const select=document.getElementById('cashInvoiceExisting');select.value='existing-payment';select.onchange();await document.getElementById('cashInvoiceSave').onclick();return[before,__cash().balance,__cash().unpaidInvoices,__cash().directCosts]})()`),[85000,85000,25000,40000]);
 });
 await check('Paying the remaining 25000 settles one 40000 bill and leaves cash60000',async()=>{
  assert.deepEqual(await run(`(async()=>{await __payBill(__db.invoices[0].id,25000);return[__cash().balance,__cash().unpaidInvoices,__cash().directCosts,__cash().companyMarkupAmount]})()`),[60000,0,40000,6000]);
 });
 await check('A direct client delivery purchase adds cost and markup without adding or spending company cash',async()=>{
  assert.deepEqual(await run(`(async()=>{__invoiceForm('Доставка',10000,'Доставка');document.getElementById('inv-paid-client-obj').checked=true;await addInvoice('repair');return[__cash().balance,__cash().directPaid,__cash().directCosts,__cash().companyMarkupAmount]})()`),[60000,10000,50000,7500]);
 });
 await check('A completed-work bill shows in works, but payment remains a separate event',async()=>{
  assert.deepEqual(await run(`(async()=>{__invoiceForm('Работы бригады',30000,'Работа');await addInvoice('repair');openObjectView('repair');switchObjTab('works');return[__cash().balance,__cash().workTotal,__cash().unpaidInvoices,__cash().companyMarkupAmount,document.getElementById('objTabContent').textContent.includes('Работы бригады')]})()`),[60000,30000,30000,12000,true]);
 });
 await check('A worker accrual is separate from material costs and cannot create a second company markup',async()=>{
  assert.deepEqual(await run(`(async()=>{__db.ledger_entries.push({id:'labor-accrual',project_id:'repair',type:'role_payout',amount:7000,payee_employee_id:'architect',entry_date:'2026-10-19',created_at:'2026-10-19T12:00:00Z'});await loadAll();return[__cash().balance,__cash().rolePayouts,__cash().directCosts,__cash().companyMarkupAmount]})()`),[60000,7000,80000,12000]);
 });
 await check('A building markup does not become a personal commission even after assigning a worker',async()=>{
  assert.deepEqual(await run(`(()=>{const p=__object();p.employee_id='architect';return[getProjectFee(p).feeAmount,__cash().companyMarkupAmount]})()`),[0,12000]);
 });
 await check('Changing an estimated budget cannot change the15percent markup on the same expenses',async()=>{
  assert.deepEqual(await run(`(()=>{const p=__object(),before=__cash().companyMarkupAmount;p.price=5000000;return[before,__cash().companyMarkupAmount]})()`),[12000,12000]);
 });
 await check('A paid invoice cannot be deleted or reclassified as a direct client purchase',async()=>{
  assert.deepEqual(await run(`(async()=>{const id=__db.invoices.find(i=>i.description==='Материалы').id;openInvoiceSheet(id);document.getElementById('invSheet-paid-client').checked=true;const count=__db.invoices.length;await saveInvoiceSheet();await deleteInvoiceSheet();return[__db.invoices.length===count,!!__db.invoices.find(i=>i.id===id),!!__db.invoices.find(i=>i.id===id).paid_by_client,__cash().balance]})()`),[true,true,false,60000]);
 });
 await check('Closing and reopening the object keeps cash and company reserve unchanged',async()=>{
  assert.deepEqual(await run(`(()=>{const p=__object(),summary=()=>{const f=ARHITTEKBudget.calculate(state,'2026-10-20');return[__cash().balance,f.cashBalance,f.projectsHeld,f.companyReserve,f.amortization];};const active=summary();p.status_id='done';p.end_date='2026-10-19';p.updated_at='2026-10-19T18:00:00Z';const done=summary();p.status_id='active';return[active,done,summary()]})()`),[[60000,80000,60000,20000,0],[60000,80000,60000,20000,0],[60000,80000,60000,20000,0]]);
 });
 await check('Future and deleted costs do not affect today cash or current markup',async()=>{
  assert.deepEqual(await run(`(()=>{const before=[__cash().balance,__cash().directCosts,__cash().companyMarkupAmount];state.invoices.push({id:'future',project_id:'repair',item_type:'Материал',amount:10000,invoice_date:'2099-01-01'},{id:'deleted',project_id:'repair',item_type:'Работа',amount:20000,invoice_date:'2026-10-19',deleted_at:'2026-10-20T08:00:00Z'});state.ledger.push({id:'future-manual',project_id:'repair',type:'expense',amount:30000,entry_date:'2099-01-01'});return[before,[__cash().balance,__cash().directCosts,__cash().companyMarkupAmount]]})()`),[[60000,80000,12000],[60000,80000,12000]]);
 });
 a.dom.window.close();a=await app();
 await check('All five purchase and work types are included once, with no cash effect before payment',async()=>{
  assert.deepEqual(await run(`(async()=>{await __receive(100000);for(const [i,type]of ['Материал','Работа','Доставка','Инструмент','Расходник'].entries()){__invoiceForm('Тип '+type,(i+1)*1000,type);await addInvoice('repair');}return[__db.invoices.length,__cash().directCosts,__cash().companyMarkupAmount,__cash().balance,__cash().unpaidInvoices]})()`),[5,15000,2250,100000,15000]);
 });
 await check('Existing0,10and20percent contracts and recorded fee counters survive reopening unchanged',async()=>{
  assert.deepEqual(await run(`(()=>{const original=__object(),results=[];for(const rate of[0,10,20]){original.fee_percent=rate;original.fee_paid=321;const before=JSON.stringify(original),writes=__writes.filter(w=>w.table).length;openObjectView('repair');results.push([__cash().companyMarkupAmount,JSON.stringify(original)===before,__writes.filter(w=>w.table).length===writes,original.fee_paid]);}return results;})()`),[[0,true,true,321],[1500,true,true,321],[3000,true,true,321]]);
 });
 await check('Explicit repair stages preserve an existing approved stage and create no cash movement',async()=>{
  assert.deepEqual(await run(`(async()=>{__db.project_stages=[{id:'approved-survey',project_id:'repair',name:'Обмеры и обследование',sort_order:0,done:true,due_date:'2026-10-19',done_at:'2026-10-19T09:00:00Z'}];await loadAll();const before=JSON.stringify(__db.project_stages[0]),cash=__cash().balance;openObjectView('repair');await ARHITTEKConstructionWorkflow.applyTemplate('repair');return[__db.project_stages.length,JSON.stringify(__db.project_stages.find(s=>s.id==='approved-survey'))===before,__cash().balance===cash,__writes.filter(w=>w.table==='project_stages').length]})()`),[8,true,true,1]);
 });
 a.dom.window.close();a=await app();
 await check('A repeated invoice after a lost successful response remains one40000document',async()=>{
  assert.deepEqual(await run(`(async()=>{await __receive(100000);__invoiceForm('Накладная с потерянным ответом',40000);__operationFault={table:'invoices',afterCommit:1,readFailures:0};await addInvoice('repair');await addInvoice('repair');await loadAll();return[__db.invoices.length,__cash().directCosts,__cash().companyMarkupAmount,__cash().balance]})()`),[1,40000,6000,100000]);
 });
 a.dom.window.close();a=await app();
 await check('An uncertain invoice retains its original40000value after edited retry input',async()=>{
  assert.deepEqual(await run(`(async()=>{__invoiceForm('Исходная накладная',40000);__operationFault={table:'invoices',afterCommit:1,readFailures:1};await addInvoice('repair');document.getElementById('inv-desc-obj').value='Изменённая накладная';document.getElementById('inv-amount-obj').value='60000';await addInvoice('repair');return[__db.invoices.length,__db.invoices[0].description,__db.invoices[0].amount,__operationAttempts.filter(r=>r.table==='invoices').length,document.getElementById('invoiceSheetOverlay').style.display,document.getElementById('invSheet-amount').value,document.getElementById('invSheet-desc').value,/первоначальн.*40.*не сохранены/.test(document.getElementById('toast').textContent)]})()`),[1,'Исходная накладная',40000,1,'flex','60000','Изменённая накладная',true]);
 });
 a.dom.window.close();a=await app();
 await check('Reloading an uncertain invoice confirms the stored UUID without duplicating its document',async()=>{
  const seed=await run(`(async()=>{__invoiceForm('Накладная после перезагрузки',40000);__operationFault={table:'invoices',afterCommit:1,readFailures:1};await addInvoice('repair');return{database:__db,storage:Object.fromEntries(Array.from({length:sessionStorage.length},(_,i)=>{const k=sessionStorage.key(i);return[k,sessionStorage.getItem(k)];}))};})()`);
  a.dom.window.close();a=await app(seed);
  assert.deepEqual(await run(`(async()=>{openObjectView('repair');switchObjTab('add');const restored=[document.getElementById('inv-desc-obj').value,document.getElementById('inv-amount-obj').value];await addInvoice('repair');return[restored,__db.invoices.length,__db.invoices[0].amount,__operationAttempts.filter(r=>r.table==='invoices').length]})()`),[['Накладная после перезагрузки','40000'],1,40000,0]);
 });
 a.dom.window.close();a=await app();
 await check('A delayed invoice response keeps its original object while another card is open',async()=>{
  assert.deepEqual(await run(`(async()=>{__db.projects.push({id:'other',name:'Вторая карточка',category_id:'build',status_id:'active',fee_percent:15});await loadAll();__invoiceForm('Медленная накладная',40000);const from=sb.from;let release;sb.from=function(table){const q=from.call(this,table),then=q.then,insert=q.insert;let inserting=false;q.insert=function(){inserting=true;return insert.apply(this,arguments);};q.then=function(resolve,reject){return(async()=>{const result=await then.call(q,x=>x);if(table==='invoices'&&inserting)await new Promise(r=>release=r);return result;})().then(resolve,reject);};return q;};const pending=addInvoice('repair');for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,1));if(!release)throw new Error('The invoice insert did not pause');openObjectView('other');release();await pending;sb.from=from;return[__db.invoices.length,__db.invoices[0].project_id,currentObjectId,document.getElementById('objTitle').textContent];})()`),[1,'repair','other','Вторая карточка']);
 });
 a.dom.window.close();a=await app();
 await check('Invalid, empty and infinite invoice amounts or missing dates create no records',async()=>{
  assert.deepEqual(await run(`(async()=>{for(const amount of['',0,-1,'Infinity']){__invoiceForm('Неверная сумма',1);const input=document.getElementById('inv-amount-obj');input.type='text';input.value=String(amount);await addInvoice('repair');}__invoiceForm('Неверная дата',1000);document.getElementById('inv-date-obj').value='2026-99-99';await addInvoice('repair');return[__db.invoices.length,__operationAttempts.filter(r=>r.table==='invoices').length];})()`),[0,0]);
 });
 a.dom.window.close();a=await app();
 await check('A partial payment after a lost successful response remains one10000payment',async()=>{
  assert.deepEqual(await run(`(async()=>{await __receive(100000);__invoiceForm('Оплата с потерянным ответом',40000);await addInvoice('repair');const id=__db.invoices[0].id;__operationFault={table:'ledger_entries',afterCommit:1,readFailures:0};openInvoicePayment(id);document.getElementById('cashInvoiceAmount').value='10000';document.getElementById('cashInvoiceDate').value='2026-10-19';await document.getElementById('cashInvoiceSave').onclick();await document.getElementById('cashInvoiceSave').onclick();await loadAll();return[__db.ledger_entries.filter(r=>r.type==='expense'&&!r.deleted_at).length,__cash().balance,__cash().unpaidInvoices]})()`),[1,90000,30000]);
 });
 a.dom.window.close();a=await app();
 await check('Closing and reopening an uncertain partial payment confirms its original operation',async()=>{
  assert.deepEqual(await run(`(async()=>{await __receive(100000);__invoiceForm('Неопределённая оплата',40000);await addInvoice('repair');const id=__db.invoices[0].id;__operationFault={table:'ledger_entries',afterCommit:1,readFailures:1};await __payBill(id,10000);document.getElementById('cashInvoiceClose').click();openInvoicePayment(id);await document.getElementById('cashInvoiceSave').onclick();await loadAll();return[__db.ledger_entries.filter(r=>r.type==='expense'&&!r.deleted_at).length,__cash().balance,__cash().unpaidInvoices]})()`),[1,90000,30000]);
 });
 a.dom.window.close();a=await app();
 await check('Changing uncertain payment fields cannot replace or duplicate the committed10000',async()=>{
  assert.deepEqual(await run(`(async()=>{await __receive(100000);__invoiceForm('Исходная оплата',40000);await addInvoice('repair');const id=__db.invoices[0].id;__operationFault={table:'ledger_entries',afterCommit:1,readFailures:1};await __payBill(id,10000);document.getElementById('cashInvoiceAmount').value='20000';await document.getElementById('cashInvoiceSave').onclick();await loadAll();return[__db.ledger_entries.filter(r=>r.type==='expense'&&!r.deleted_at).map(r=>r.amount),__cash().balance]})()`),[[10000],90000]);
 });
 a.dom.window.close();a=await app();
 await check('Reloading an uncertain partial payment restores its UUID and avoids a second cash charge',async()=>{
  const seed=await run(`(async()=>{await __receive(100000);__invoiceForm('Оплата после перезагрузки',40000);await addInvoice('repair');__operationFault={table:'ledger_entries',afterCommit:1,readFailures:1};await __payBill(__db.invoices[0].id,10000);return{database:__db,storage:Object.fromEntries(Array.from({length:sessionStorage.length},(_,i)=>{const k=sessionStorage.key(i);return[k,sessionStorage.getItem(k)];}))};})()`);
  a.dom.window.close();a=await app(seed);
  assert.deepEqual(await run(`(async()=>{const id=__db.invoices[0].id;openInvoicePayment(id);await document.getElementById('cashInvoiceSave').onclick();await loadAll();return[__db.ledger_entries.filter(r=>r.type==='expense'&&!r.deleted_at).length,__cash().balance,__cash().unpaidInvoices]})()`),[1,90000,30000]);
 });
 a.dom.window.close();a=await app();
 await check('A foreman adds a purchase only to their assigned object and cannot save cash payments',async()=>{
  assert.deepEqual(await run(`(async()=>{__db.employees.push({id:'foreman',name:'Прораб',role:'Прораб',active:true,can_see_construction:true});__db.projects[0].employee_id='foreman';__db.projects.push({id:'foreign',name:'Чужой объект',category_id:'build',status_id:'active',employee_id:'architect'});await loadAll();setSession({employeeId:'foreman',name:'Прораб',isAdmin:false,token:'isolated-foreman'});__invoiceForm('Покупка прораба',2500);await addInvoice('repair');__invoiceForm('Недоступная покупка',1500);await addInvoice('foreign');openPaymentSheet('repair');document.getElementById('payment-amount').value='10000';await savePayment();return[__db.invoices.filter(i=>i.project_id==='repair').length,__db.invoices.filter(i=>i.project_id==='foreign').length,__db.ledger_entries.length,canAccessConstructionProject('foreign')]})()`),[1,0,0,false]);
 });
 a.dom.window.close();a=await app();
 await check('Private image signing preserves stored canonical document paths',async()=>{
  assert.deepEqual(await run(`(async()=>{const canonical=SUPABASE_URL+'/storage/v1/object/public/construction-documents/repair/proof.jpg';__db.invoices=[{id:'private-proof',project_id:'repair',item_type:'Материал',amount:1000,invoice_date:'2026-10-19',photo_url:canonical}];await loadAll();const before=JSON.stringify(__db.invoices),requests=[];const from=sb.storage.from;sb.storage.from=function(bucket){return{createSignedUrl:async(path,ttl)=>{requests.push([bucket,path,ttl]);return{data:{signedUrl:'https://private.test/signed-proof'},error:null};}};};const signed=await ARHITTEKConstructionOperations.imageUrl(canonical);sb.storage.from=from;return[signed,JSON.stringify(__db.invoices)===before,requests];})()`),['https://private.test/signed-proof',true,[['construction-documents','repair/proof.jpg',300]]]);
 });
 await check('A signed image cache is scoped to the current session token',async()=>{
  assert.deepEqual(await run(`(async()=>{const canonical=SUPABASE_URL+'/storage/v1/object/public/construction-documents/repair/token-scope.jpg',requests=[],from=sb.storage.from;sb.storage.from=function(){return{createSignedUrl:async()=>{requests.push(session.token);return{data:{signedUrl:'https://private.test/'+session.token},error:null};}};};session.token='isolated-session-A';const one=await ARHITTEKConstructionOperations.imageUrl(canonical),cached=await ARHITTEKConstructionOperations.imageUrl(canonical);session.token='isolated-session-B';const two=await ARHITTEKConstructionOperations.imageUrl(canonical);sb.storage.from=from;return[one===cached,two!==one,requests];})()`),[true,true,['isolated-session-A','isolated-session-B']]);
 });
 await check('A signing response from a previous session is rejected before it can reach an image',async()=>{
  assert.deepEqual(await run(`(async()=>{const canonical=SUPABASE_URL+'/storage/v1/object/public/construction-documents/repair/late-token.jpg',from=sb.storage.from;let release;sb.storage.from=function(){return{createSignedUrl:async()=>{await new Promise(r=>release=r);return{data:{signedUrl:'https://private.test/old-user'},error:null};}};};session.token='old-session';const result=ARHITTEKConstructionOperations.imageUrl(canonical).then(()=>false,()=>true);session.token='new-session';release();const rejected=await result;sb.storage.from=from;return rejected;})()`),true);
 });
 await check('External image URLs and decoded path traversal are not sent to private Storage signing',async()=>{
  assert.deepEqual(await run(`(async()=>{const from=sb.storage.from;let requests=0;sb.storage.from=function(){requests++;throw new Error('External path unexpectedly signed');};const external='https://elsewhere.test/storage/v1/object/public/construction-documents/repair/proof.jpg';const unchanged=await ARHITTEKConstructionOperations.imageUrl(external);const bad=ARHITTEKConstructionOperations.privatePath(SUPABASE_URL+'/storage/v1/object/public/construction-documents/repair/%2e%2e%2fsecret');sb.storage.from=from;return[unchanged===external,bad,requests];})()`),[true,null,0]);
 });
 a.dom.window.close();a=await app();
 await run(`(()=>{window.__portalSettings={project_id:'repair',published:false,portal_enabled:true,cash_history_complete:false,revision:1,saved_markup_percent:15,grants:[]};window.__portalCalls=[];const rpc=sb.rpc;sb.rpc=async function(name,args){if(!/construction_client/.test(name))return rpc.apply(this,arguments);__portalCalls.push({name,args:structuredClone(args)});if(name==='configure_construction_client_project'){__portalSettings={...__portalSettings,published:args.p_published,cash_history_complete:args.p_confirm_history,revision:__portalSettings.revision+1};}if(name==='issue_construction_client_grant'){__portalSettings.grants.push({id:'test-grant',expires_at:args.p_expires_at,revoked_at:null});return{data:{access:'isolated-private-client-token'},error:null};}if(name==='revoke_construction_client_grant'){__portalSettings.grants.find(g=>g.id===args.p_grant_id).revoked_at=new Date().toISOString();return{data:{ok:true},error:null};}return{data:structuredClone(__portalSettings),error:null};};})()`);
 await check('Opening the admin client-access panel reads settings without publishing or issuing links',async()=>{
  assert.deepEqual(await run(`(async()=>{openObjectView('repair');await new Promise(r=>setTimeout(r,0));return[!!document.getElementById('obj-client-access'),__portalCalls.length>0,__portalCalls.every(c=>c.name==='get_construction_client_settings'),!!document.querySelector('#obj-client-access [data-issue]')];})()`),[true,true,true,false]);
 });
 await check('Client publication requires explicit markup confirmation and does not assert cash reconciliation',async()=>{
  assert.deepEqual(await run(`(async()=>{document.querySelector('#obj-client-access [data-publish]').click();await new Promise(r=>setTimeout(r,0));const blocked=__portalCalls.filter(c=>c.name==='configure_construction_client_project').length;document.querySelector('#obj-client-access [data-confirm-markup]').checked=true;document.querySelector('#obj-client-access [data-publish]').click();await new Promise(r=>setTimeout(r,0));const saved=__portalCalls.find(c=>c.name==='configure_construction_client_project');return[blocked,saved.args.p_project_id,saved.args.p_published,saved.args.p_confirm_markup,saved.args.p_confirm_history,__portalCalls.filter(c=>c.name==='issue_construction_client_grant').length];})()`),[0,'repair',true,true,false,0]);
 });
 await check('The admin creates a revocable object link only on click and never stores its secret token',async()=>{
  assert.deepEqual(await run(`(async()=>{document.querySelector('#obj-client-access [data-issue]').click();await new Promise(r=>setTimeout(r,0));const link=document.querySelector('#obj-client-access [data-link-result] textarea').value,parsed=new URL(link),storage=JSON.stringify({local:Object.assign({},localStorage),session:Object.assign({},sessionStorage)});return[__portalCalls.filter(c=>c.name==='issue_construction_client_grant').length,parsed.pathname.endsWith('client-portal.html'),parsed.search,parsed.hash.includes('isolated-private-client-token'),storage.includes('isolated-private-client-token')];})()`),[1,true,'',true,false]);
 });
 await check('Revoking a grant uses the original grant ID and removes its active control',async()=>{
  assert.deepEqual(await run(`(async()=>{document.querySelector('#obj-client-access [data-grants] button').click();await new Promise(r=>setTimeout(r,0));return[__portalCalls.find(c=>c.name==='revoke_construction_client_grant').args.p_grant_id,document.querySelectorAll('#obj-client-access [data-grants] button').length];})()`),['test-grant',0]);
 });
 await check('Closing publication explicitly withdraws access without creating a new link',async()=>{
  assert.deepEqual(await run(`(async()=>{document.querySelector('#obj-client-access [data-unpublish]').click();await new Promise(r=>setTimeout(r,0));const call=__portalCalls.filter(c=>c.name==='configure_construction_client_project').at(-1);return[call.args.p_published,call.args.p_confirm_history,!!document.querySelector('#obj-client-access [data-issue]'),__portalCalls.filter(c=>c.name==='issue_construction_client_grant').length];})()`),[false,false,false,1]);
 });
 await check('A delayed grant response is not displayed inside a subsequently opened object',async()=>{
  assert.deepEqual(await run(`(async()=>{__portalSettings.published=true;__db.projects.push({id:'other',name:'Другой заказчик',category_id:'build',status_id:'active',fee_percent:15});await loadAll();openObjectView('repair');await new Promise(r=>setTimeout(r,0));const rpc=sb.rpc;let release;sb.rpc=async function(name,args){if(name==='issue_construction_client_grant'){await new Promise(r=>release=r);return{data:{access:'late-private-token'},error:null};}return rpc.apply(this,arguments);};document.querySelector('#obj-client-access [data-issue]').click();for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,1));openObjectView('other');await new Promise(r=>setTimeout(r,0));release();await new Promise(r=>setTimeout(r,0));sb.rpc=rpc;return[currentObjectId,document.querySelectorAll('#obj-client-access textarea').length,document.body.textContent.includes('late-private-token'),JSON.stringify({local:Object.assign({},localStorage),session:Object.assign({},sessionStorage)}).includes('late-private-token')];})()`),['other',0,false,false]);
 });
 await check('Staff and signed-out users do not mount admin client-access controls or call their settings RPC',async()=>{
  assert.deepEqual(await run(`(async()=>{const before=__portalCalls.length;state.employees.push({id:'foreman',name:'Прораб',role:'Прораб',active:true,can_see_construction:true});setSession({employeeId:'foreman',name:'Прораб',isAdmin:false,token:'isolated-staff'});state.projects.find(p=>p.id==='repair').employee_id='foreman';openObjectView('repair');await new Promise(r=>setTimeout(r,0));const staff=!!document.getElementById('obj-client-access');setSession(null);renderObjectSummary(state.projects.find(p=>p.id==='repair'));await new Promise(r=>setTimeout(r,0));return[staff,!!document.getElementById('obj-client-access'),__portalCalls.length===before];})()`),[false,false,true]);
 });
 a.dom.window.close();a=await app();
 await check('A new repair card defaults to15percent company markup and saves without an employee commission',async()=>{
  assert.deepEqual(await run(`(async()=>{openProjectSheet(null);document.getElementById('pf-name').value='Новый ремонт без исполнителя';const category=document.getElementById('pf-category');category.value='build';category.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('pf-status').value='active';document.getElementById('pf-price').value='1000000';const rate=Number(document.getElementById('pf-feepercent').value);await saveProject();const p=__db.projects.find(row=>row.name==='Новый ремонт без исполнителя');if(!p)return{saved:false,toast:document.getElementById('toast').textContent};openObjectView(p.id);return[rate,p.fee_percent,p.employee_id,getProjectFee(p).feeAmount,getConstructionFinancials(p).companyMarkupAmount,currentObjectId===p.id,__db.ledger_entries.length];})()`),[15,15,null,0,0,true,0]);
 });
 await check('A salaried responsible employee does not prevent saving the company markup on a repair',async()=>{
  assert.deepEqual(await run(`(async()=>{openProjectSheet(null);document.getElementById('pf-name').value='Новый ремонт с ответственным на окладе';const category=document.getElementById('pf-category');category.value='build';category.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('pf-status').value='active';const employee=document.getElementById('pf-employee-fee');employee.value='designer';employee.dispatchEvent(new Event('change',{bubbles:true}));await saveProject();const p=__db.projects.find(row=>row.name==='Новый ремонт с ответственным на окладе');return p?[p.employee_id,p.fee_percent,getProjectFee(p).feeAmount]:{saved:false,toast:document.getElementById('toast').textContent};})()`),['designer',15,0]);
 });
 a.dom.window.close();
 const report={role:'foreman_and_director',runtime:'isolated_jsdom_real_application_handlers',passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),runtimeErrors};
 console.log(JSON.stringify(report,null,2));if(report.failed.length||runtimeErrors.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
