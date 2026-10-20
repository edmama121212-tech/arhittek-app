// The UI prefers the transactional server path. Monetary writes stay in local fixtures.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const results=[];
async function check(name,fn){await fn();results.push(name);console.log('PASS: '+name);}
const copy=value=>JSON.parse(JSON.stringify(value));
function app(){
 const dom=new JSDOM('<body></body>',{url:'https://app.test/',runScripts:'outside-only'}),w=dom.window;
 w.setInterval=()=>0;w.setTimeout=()=>0;w.session={isAdmin:true,employeeId:'admin'};w.getCompanyReserveBalance=()=>0;
 const invoice={id:'5f577d0f-e93b-4cb6-b451-44fef553676f',project_id:'repair',amount:40000,description:'Материалы',invoice_date:'2026-10-19'};
 const db={invoices:[invoice],ledger_entries:[{id:'advance',project_id:'repair',type:'advance',amount:100000,entry_date:'2026-10-19',created_at:'2026-10-19T08:00:00Z'}]};
 w.state={projects:[{id:'repair',category_id:'build',status_id:'active'}],categories:[{id:'build',name:'Ремонт'}],employees:[],statuses:[],invoices:copy(db.invoices),ledger:copy(db.ledger_entries),companyIncome:[],companyExpenses:[]};
 w.escapeHtml=s=>String(s);w.fmtMoney=v=>String(v);w.fmtDate=d=>d;w.findEmployee=()=>null;w.logAudit=async()=>{};w.toasts=[];w.showToast=s=>w.toasts.push(s);
 const calls=[],rawWrites=[];let mode='success';
 const from=table=>{
  let op='select',value,single=false,filters=[];
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>r[k]==null&&v===null||r[k]===v);return q;},order(){return q;},range(){return q;},maybeSingle(){single=true;return q;},insert(v){op='insert';value=v;return q;},update(v){op='update';value=v;return q;},then(resolve,reject){return Promise.resolve().then(()=>{
   const rows=db[table]||[],matched=rows.filter(r=>filters.every(f=>f(r)));
   if(op!=='select')rawWrites.push({table,op,value:copy(value)});
   if(op==='insert'){if(rows.some(r=>r.id===value.id))return{data:null,error:{code:'23505',message:'Duplicate UUID'}};rows.push({...copy(value),created_at:'2026-10-20T05:00:00Z'});}
   if(op==='update')matched.forEach(r=>Object.assign(r,copy(value)));
   return{data:copy(single?matched[0]||null:matched),error:null,count:matched.length};
  }).then(resolve,reject);}};return q;
 };
 w.sb={from,rpc:async(name,args)=>{
  calls.push({name,args:copy(args)});
  if(mode==='missing')return{data:null,error:{code:'PGRST202',message:'Function is not installed'}};
  if(mode==='denied')return{data:null,error:{code:'42501',message:'Administrator session required'}};
  if(mode==='offline')throw new Error('Connection lost before save');
  let row=db.ledger_entries.find(r=>r.id===args.p_operation_id);
  if(args.p_existing_entry_id){assert(row);row.description=args.p_description;}
  else if(!row){row={id:args.p_operation_id,project_id:invoice.project_id,type:'expense',amount:args.p_amount,entry_date:args.p_entry_date,description:args.p_description,created_at:'2026-10-20T05:00:00Z'};db.ledger_entries.push(row);}
  return mode==='lost'?{data:null,error:{code:'network',message:'Committed response lost'}}:{data:copy(row),error:null};
 }};
 w.fetchAllRows=async create=>await create().order('id').range(0,499);
 w.loadAll=async()=>{w.state.ledger=copy(db.ledger_entries);w.state.invoices=copy(db.invoices);return true;};
 for(const file of['project-budget.js','cash-finance.js'])w.eval(fs.readFileSync(file,'utf8'));
 const open=()=>{w.openInvoicePayment(invoice.id);w.document.getElementById('cashInvoiceAmount').value='10000';w.document.getElementById('cashInvoiceDate').value='2026-10-19';};
 const save=async()=>await w.document.getElementById('cashInvoiceSave').onclick();
 return{dom,w,db,calls,rawWrites,open,save,setMode:x=>mode=x,invoice};
}
(async()=>{
 await check('A new invoice installment uses the server RPC and its stable operation UUID',async()=>{
  const a=app();a.open();await a.save();assert.equal(a.calls.length,1);assert.equal(a.calls[0].name,'save_invoice_payment');const p=a.calls[0].args;assert.equal(p.p_invoice_id,a.invoice.id);assert.equal(p.p_amount,10000);assert.equal(p.p_existing_entry_id,null);assert.match(p.p_operation_id,/^[0-9a-f-]{36}$/i);assert.equal(a.rawWrites.length,0);assert.equal(a.db.ledger_entries.filter(r=>r.type==='expense').length,1);a.dom.window.close();
 });
 await check('A lost successful RPC response is confirmed by UUID without using the raw writer',async()=>{
  const a=app();a.setMode('lost');a.open();await a.save();await a.save();assert.equal(a.calls.length,1);assert.equal(a.rawWrites.length,0);assert.equal(a.db.ledger_entries.filter(r=>r.type==='expense').length,1);assert.equal(a.w.ARHITTEKCash.invoicePaymentState(a.w.state,a.invoice).remaining,30000);a.dom.window.close();
 });
 await check('An authorization error never falls back to a direct financial insert',async()=>{
  const a=app();a.setMode('denied');a.open();await a.save();assert.equal(a.calls.length,1);assert.equal(a.rawWrites.length,0);assert.equal(a.db.ledger_entries.filter(r=>r.type==='expense').length,0);assert(a.w.toasts.some(t=>t.includes('Недостаточно прав')));a.dom.window.close();
 });
 await check('A transient RPC failure keeps the original payload and UUID when fields are changed before retry',async()=>{
  const a=app();a.setMode('offline');a.open();await a.save();a.w.document.getElementById('cashInvoiceAmount').value='20000';a.setMode('success');await a.save();assert.equal(a.calls.length,2);assert.equal(a.calls[0].args.p_operation_id,a.calls[1].args.p_operation_id);assert.equal(a.calls[1].args.p_amount,10000);assert.equal(a.rawWrites.length,0);assert.equal(a.db.ledger_entries.filter(r=>r.type==='expense').length,1);a.dom.window.close();
 });
 await check('The compatibility writer is used only while the named server function is absent',async()=>{
  const a=app();a.setMode('missing');a.open();await a.save();assert.equal(a.calls.length,1);assert.equal(a.rawWrites.length,1);assert.equal(a.rawWrites[0].value.id,a.calls[0].args.p_operation_id);assert.equal(a.db.ledger_entries.filter(r=>r.type==='expense').length,1);a.dom.window.close();
 });
 await check('Linking an already paid expense uses its existing UUID and creates no new outflow',async()=>{
  const a=app(),id='44f4c4c6-45eb-4333-840a-f891bb5f26fe';a.db.ledger_entries.push({id,project_id:'repair',type:'expense',amount:10000,entry_date:'2026-10-19',created_at:'2026-10-19T08:00:00Z',description:'Оплачено ранее'});await a.w.loadAll();a.open();const field=a.w.document.getElementById('cashInvoiceExisting');field.value=id;field.onchange();await a.save();assert.equal(a.calls.length,1);assert.equal(a.calls[0].args.p_operation_id,id);assert.equal(a.calls[0].args.p_existing_entry_id,id);assert.equal(a.rawWrites.length,0);assert.equal(a.db.ledger_entries.filter(r=>r.type==='expense').length,1);assert.equal(a.w.ARHITTEKCash.invoicePaymentState(a.w.state,a.invoice).paid,10000);a.dom.window.close();
 });
 console.log('PASS: '+results.length+' transactional invoice UI scenarios');
})().catch(error=>{console.error(error);process.exitCode=1;});
