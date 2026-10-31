(()=>{
window.__writes=[];window.__reads=[];window.__subscriptions=[];window.__fail=null;window.__rowLimit=Infinity;
window.__db={projects:[],employees:[{id:'admin',name:'Мансур',role:'Директор',is_admin:true,active:true,is_salaried:true,fixed_salary:50000,created_at:'2026-01-01T00:00:00Z'},{id:'designer',name:'Амина',role:'Ведущий дизайнер',active:true,is_salaried:true,fixed_salary:50000,created_at:'2026-01-01T00:00:00Z'},{id:'visual',name:'Ислам',role:'Визуализатор',active:true},{id:'architect',name:'Адам',role:'Архитектор',active:true}],categories:[{id:'design',name:'Дизайн интерьера',department_id:'d',fee_percent:0,fee_base:'m2'},{id:'arch',name:'Архитектурное решение',department_id:'d',fee_percent:40,fee_base:'profit'},{id:'land',name:'Ландшафтный дизайн',department_id:'d',fee_percent:40,fee_base:'profit'},{id:'build',name:'Строительство',department_id:'b',fee_percent:10}],statuses:[{id:'active',name:'В процессе'},{id:'done',name:'Завершён'},{id:'frozen',name:'Заморожен'},{id:'new',name:'Запись'}],departments:[{id:'d',name:'Проектный отдел'},{id:'b',name:'Строительный отдел'}],company_info:[{id:'company',name:'ARHITTEK',company_name:'ARHITTEK'}]};
// Real reference lists have an explicit order; id is only the pagination tie breaker.
for(const table of ['categories','statuses','departments'])__db[table].forEach((row,index)=>row.sort_order=index);
const clone=x=>JSON.parse(JSON.stringify(x));
// Simulate the SQL projection in full-app fixtures. Independent PGlite tests
// execute the actual migration, constraints and transactional RPC.
const paidOpenings=new WeakMap();
const sourceSummary=p=>{
 const entries=(__db.ledger_entries||[]).filter(r=>r.project_id===p.id&&!r.deleted_at),documents=(__db.invoices||[]).filter(r=>r.project_id===p.id&&!r.deleted_at),c=(__db.categories||[]).find(c=>c.id===p.category_id),construction=c?.department_id==='b'||/строительств|ремонт|монтаж/i.test(c?.name||'');
 const sum=(types,predicate=()=>true)=>entries.filter(r=>types.includes(r.type)&&predicate(r)).reduce((a,r)=>a+Number(r.amount||0),0);
 const received=sum(['advance','final_payment','income','materials_budget','construction_budget']),refunds=sum(['client_refund']);
 const linked=r=>documents.some(d=>String(r.description||'').includes('[invoice-payment:'+d.id+']'));
 const costs=sum(['expense','project_expense','payment'],r=>!r.payee_employee_id&&!linked(r))+documents.filter(d=>construction||!d.paid_by_client).reduce((a,r)=>a+Number(r.amount||0),0);
 return{entries,construction,received,refunds,costs,outgoing:sum(['expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund'],r=>!String(r.description||'').startsWith('[cash:historical-expense]')&&r.description!=='Ранее внесённые расходы')};
};
function captureProjectSources(){if(!window.ProjectMoney)return;for(const p of __db.projects||[]){const s=sourceSummary(p);if(p.received_opening===undefined)p.received_opening=s.construction?0:Math.max(0,Number(p.advance||0)-s.received+s.refunds);if(p.expenses_opening===undefined)p.expenses_opening=s.construction?0:Math.max(0,Number(p.expenses||0)-s.costs);if(!paidOpenings.has(p))paidOpenings.set(p,{main:Math.max(0,Number(p.fee_paid||0)-s.entries.filter(r=>r.type==='fee_payment'&&(!r.payee_employee_id||r.payee_employee_id===p.employee_id)).reduce((a,r)=>a+Number(r.amount||0),0)),co:Math.max(0,Number(p.co_fee_paid||0)-s.entries.filter(r=>r.type==='fee_payment'&&r.payee_employee_id&&r.payee_employee_id===p.co_employee_id).reduce((a,r)=>a+Number(r.amount||0),0))});}}
function refreshProjectSources(){if(!window.ProjectMoney)return;for(const p of __db.projects||[]){const s=sourceSummary(p),o=paidOpenings.get(p)||{main:0,co:0};p.advance=Number(p.received_opening||0)+s.received-(s.construction?0:s.refunds);p.balance=s.construction?Number(p.received_opening||0)+s.received-s.outgoing:Math.max(0,Number(p.price||0)-p.advance);p.expenses=Number(p.expenses_opening||0)+s.costs;p.fee_paid=o.main+s.entries.filter(r=>r.type==='fee_payment'&&(!r.payee_employee_id||r.payee_employee_id===p.employee_id)).reduce((a,r)=>a+Number(r.amount||0),0);p.co_fee_paid=o.co+s.entries.filter(r=>r.type==='fee_payment'&&r.payee_employee_id&&r.payee_employee_id===p.co_employee_id).reduce((a,r)=>a+Number(r.amount||0),0);}}

function query(table){let op='select',val,filters=[],single=false,limit=Infinity,offset=0,orders=[],countRequested=false;
const q={select(columns,options){countRequested=options?.count==='exact';return q},insert(v){op='insert';val=clone(v);return q},upsert(v){return q.insert(v)},update(v){op='update';val=clone(v);return q},delete(){op='delete';return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>v===null?r[k]==null:r[k]===v);return q},not(k){filters.push(r=>r[k]!=null);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(k,options){orders.push([k,options?.ascending!==false]);return q},limit(n){limit=n;return q},range(from,to){offset=from;limit=to-from+1;return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(resolve,reject){return Promise.resolve().then(()=>{if(op==='select')__reads.push({table,offset,limit,countRequested});if(__fail?.table===table&&(!__fail.op||__fail.op===op)&&(__fail.offset===undefined||__fail.offset===offset))return {data:null,error:{message:'Simulated database failure'}};if(op!=='select'&&['projects','ledger_entries','invoices'].includes(table))captureProjectSources();const rows=__db[table]||=[];let matches=rows.filter(r=>filters.every(f=>f(r)));if(op!=='select'&&!window.__serverProjectRpc)__writes.push({table,op,val});if(op==='insert'){matches=(Array.isArray(val)?val:[val]).map(v=>({id:crypto.randomUUID(),created_at:new Date().toISOString(),...v}));rows.push(...matches)}if(op==='update')matches.forEach(r=>Object.assign(r,val));if(op==='delete')__db[table]=rows.filter(r=>!matches.includes(r));if(op!=='select'&&['projects','ledger_entries','invoices'].includes(table)){if(table==='projects'&&op==='insert')captureProjectSources();refreshProjectSources();}if(orders.length)matches.sort((a,b)=>{for(const [k,asc] of orders){if(a[k]===b[k])continue;return (a[k]>b[k]?1:-1)*(asc?1:-1)}return 0});const count=matches.length;matches=matches.slice(offset,offset+Math.min(limit,op==='select'?__rowLimit:Infinity));return {data:clone(single?matches[0]||null:matches),error:null,count:countRequested?count:null}}).then(resolve,reject)}};return q;}
const client={from:query,rpc:async(n,a={})=>{
 if(n==='confirm_project_payment'){
  __writes.push({rpc:n,args:clone(a)});if(__fail?.rpc===n)return {data:null,error:{message:'Simulated project payment failure'}};
  if(window.session?.employeeId!=='admin')return {data:null,error:{code:'42501',message:'Owner required'}};
  const requests=window.__projectPaymentRequests||=new Map(),request=JSON.stringify([a.p_action,a.p_payload]),prior=requests.get(a.p_operation),savedDb=clone(__db);let entry;
  try{if(prior){if(prior.request!==request)throw Error('Changed retry payload');entry=__db.ledger_entries.find(r=>r.id===prior.entry);}
   else{window.__serverProjectRpc=true;
    if(__fail?.table==='projects'&&(!__fail.op||__fail.op==='update'))throw Error('Simulated atomic projection failure');
    const p=a.p_payload;if(a.p_action==='create'){const r=await query('ledger_entries').insert({...p,id:a.p_operation}).select().single();if(r.error)throw Error(r.error.message);entry=r.data;}
    else{const r=await query('ledger_entries').update({deleted_at:new Date().toISOString()}).eq('id',p.entry_id).select().single();if(r.error)throw Error(r.error.message);entry=r.data;}
    requests.set(a.p_operation,{request,entry:entry.id});
   }
   return {data:{entry:clone(entry),project:clone(__db.projects.find(p=>p.id===entry.project_id))},error:null};
  }catch(e){window.__db=savedDb;return {data:null,error:{code:'23514',message:e.message}}}finally{window.__serverProjectRpc=false;}
 }
 if(n==='get_financial_journal'){if(__fail?.rpc===n)return {data:null,error:{message:'Journal unavailable'}};return {data:window.__journal||{version:1,active:false,revision:0,balances:{},operations:[],fingerprint:'fixture'},error:null};}
 // Compatibility fixture: transactional invoice RPC has its own server tests.
 if(n==='save_invoice_payment')return {data:null,error:{code:'PGRST202',message:'Invoice RPC unavailable in compatibility fixture'}};
 if(n==='get_construction_client_settings'){
  (window.__rpcCalls||=[]).push({rpc:n,args:clone(a)});
  return {data:null,error:{code:'PGRST202',message:'Client access RPC unavailable in compatibility fixture'}};
 }
 if(n==='get_employee_access'){
  (window.__rpcCalls||=[]).push({rpc:n,args:clone(a)});
  if(__fail?.rpc===n)return {data:null,error:{code:'42501',message:'Access unavailable'}};
  const e=(__db.employees||[]).find(x=>x.id===window.session?.employeeId&&x.active!==false&&!x.deleted_at);
  if(!e||!window.session?.token)return {data:[],error:null};
  const owner=e.id==='admin';
  return {data:[{employee_id:e.id,name:e.name,role:e.role,is_owner:owner,can_documents:owner||['ведущий архитектор','ведущий дизайнер'].includes(String(e.role||'').trim().toLowerCase()),access_policy:'owner-only-v1'}],error:null};
 }
 if(n==='get_employee_login_options'||n==='get_employee_profiles'){
  (window.__rpcCalls||=[]).push({rpc:n,args:clone(a)});
  if(__fail?.rpc===n||(__fail?.table==='employees'&&(!__fail.op||__fail.op==='select')))return {data:null,error:{message:'Simulated employee read failure'}};
  const rows=__db.employees||[];
  if(n==='get_employee_login_options')return {data:clone(rows.filter(e=>e.active!==false&&!e.deleted_at).map(e=>({id:e.id,name:e.name,active:e.active}))),error:null};
  const employee=rows.find(e=>e.id===window.session?.employeeId&&e.active!==false&&!e.deleted_at);
  if(!window.session?.token||!employee)return {data:null,error:{code:'42501',message:'Session required'}};
  const keys=['id','name','role','is_admin','active','can_edit_cards','can_see_projects','can_see_construction','is_salaried','fixed_salary','deleted_at','created_at'];
  return {data:clone(rows.filter(e=>employee.is_admin||!e.deleted_at).map(e=>{
   const safe={};for(const key of keys)if(Object.hasOwn(e,key))safe[key]=e[key];
   safe.fixed_salary=employee.is_admin||e.id===employee.id?(e.fixed_salary??null):null;
   return safe;
  })),error:null};
 }
 __writes.push({rpc:n,args:clone(a)});if(n==='get_tz_form_by_token')return {data:window.__tz||null,error:null};return {data:null,error:null}
},channel(){const c={state:'joined',on(kind,filter){if(filter?.table)__subscriptions.push(filter.table);return c},subscribe(){return c}};return c},removeChannel(){},storage:{from(){return {upload:async()=>({data:{path:'test'},error:null}),getPublicUrl:()=>({data:{publicUrl:'https://example.invalid/test.jpg'}}),remove:async()=>({error:null})}}}};
window.supabase={createClient:()=>client};window.confirm=()=>true;window.alert=()=>{};
localStorage.setItem('arhittek_session',JSON.stringify({employeeId:'admin',name:'Мансур',isAdmin:true,token:'test',createdAt:Date.now()}));sessionStorage.setItem('arhittek_frozen_tried','1');sessionStorage.setItem('arhittek_landscape_tried','1');
})();
