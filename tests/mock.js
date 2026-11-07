(()=>{
window.__writes=[];window.__reads=[];window.__subscriptions=[];window.__fail=null;window.__rowLimit=Infinity;
window.__db={projects:[],employees:[{id:'admin',name:'Мансур',role:'Директор',is_admin:true,active:true,is_salaried:true,fixed_salary:50000,created_at:'2026-01-01T00:00:00Z'},{id:'designer',name:'Амина',role:'Ведущий дизайнер',active:true,is_salaried:true,fixed_salary:50000,created_at:'2026-01-01T00:00:00Z'},{id:'visual',name:'Ислам',role:'Визуализатор',active:true},{id:'architect',name:'Адам',role:'Архитектор',active:true}],categories:[{id:'design',name:'Дизайн интерьера',department_id:'d',fee_percent:0,fee_base:'m2'},{id:'arch',name:'Архитектурное решение',department_id:'d',fee_percent:40,fee_base:'profit'},{id:'land',name:'Ландшафтный дизайн',department_id:'d',fee_percent:40,fee_base:'profit'},{id:'build',name:'Строительство',department_id:'b',fee_percent:10}],statuses:[{id:'active',name:'В процессе'},{id:'done',name:'Завершён'},{id:'frozen',name:'Заморожен'},{id:'new',name:'Запись'}],departments:[{id:'d',name:'Проектный отдел'},{id:'b',name:'Строительный отдел'}],company_info:[{id:'company',name:'ARHITTEK',company_name:'ARHITTEK'}]};
// Real reference lists have an explicit order; id is only the pagination tie breaker.
for(const table of ['categories','statuses','departments'])__db[table].forEach((row,index)=>row.sort_order=index);
const clone=x=>JSON.parse(JSON.stringify(x));
const payrollRoster=new Map();let salaryVersion=0;
const moscowDay=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
function captureMockSalary(row,deleted=false){
 const old=payrollRoster.get(row.id),now=new Date().toISOString();
 const fields={is_salaried:!!row.is_salaried,fixed_salary:Math.max(0,Number(row.fixed_salary)||0),active:row.active!==false,deleted:deleted||!!row.deleted_at};
 const current={id:row.id,name:row.name,role:row.role||'',created_at:row.created_at||'2026-01-01T00:00:00Z',active:fields.active,is_salaried:fields.is_salaried,fixed_salary:fields.fixed_salary,deleted_at:fields.deleted?(row.deleted_at||now):null,versions:old?.versions||[]};
 const previous=current.versions.at(-1);
 if(!previous||Object.keys(fields).some(k=>previous[k]!==fields[k])){
  const changed_at=previous?now:current.created_at;
  current.versions.push({id:String(++salaryVersion),effective_from:moscowDay(changed_at),changed_at,...fields,source:previous?'server':'legacy_baseline',uncertain:!previous});
 }
 payrollRoster.set(row.id,current);
}

function query(table){let op='select',val,filters=[],single=false,limit=Infinity,offset=0,orders=[],countRequested=false;
const q={select(columns,options){countRequested=options?.count==='exact';return q},insert(v){op='insert';val=clone(v);return q},upsert(v){return q.insert(v)},update(v){op='update';val=clone(v);return q},delete(){op='delete';return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>v===null?r[k]==null:r[k]===v);return q},not(k){filters.push(r=>r[k]!=null);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(k,options){orders.push([k,options?.ascending!==false]);return q},limit(n){limit=n;return q},range(from,to){offset=from;limit=to-from+1;return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(resolve,reject){return Promise.resolve().then(()=>{if(op==='select')__reads.push({table,offset,limit,countRequested});if(__fail?.table===table&&(!__fail.op||__fail.op===op)&&(__fail.offset===undefined||__fail.offset===offset))return {data:null,error:{message:'Simulated database failure'}};const rows=__db[table]||=[];let matches=rows.filter(r=>filters.every(f=>f(r)));if(op!=='select')__writes.push({table,op,val});if(op==='insert'){matches=(Array.isArray(val)?val:[val]).map(v=>({id:crypto.randomUUID(),created_at:new Date().toISOString(),...v}));rows.push(...matches)}if(op==='update')matches.forEach(r=>{if(table==='employees'&&!payrollRoster.has(r.id))captureMockSalary(r);Object.assign(r,val);if(table==='employees')captureMockSalary(r)});if(op==='delete'){if(table==='employees')matches.forEach(r=>captureMockSalary(r,true));__db[table]=rows.filter(r=>!matches.includes(r));}if(orders.length)matches.sort((a,b)=>{for(const [k,asc] of orders){if(a[k]===b[k])continue;return (a[k]>b[k]?1:-1)*(asc?1:-1)}return 0});const count=matches.length;matches=matches.slice(offset,offset+Math.min(limit,op==='select'?__rowLimit:Infinity));return {data:clone(single?matches[0]||null:matches),error:null,count:countRequested?count:null}}).then(resolve,reject)}};return q;}
const client={from:query,rpc:async(n,a={})=>{
 if(n==='get_employee_salary_history'){
  (window.__rpcCalls||=[]).push({rpc:n,args:clone(a)});
  if(__fail?.rpc===n)return {data:null,error:{code:__fail.code||'PGRST202',message:'Salary history unavailable'}};
  if(window.session?.employeeId!=='admin'||!window.session?.token)return {data:null,error:{code:'42501',message:'Owner session required'}};
  if(window.__salaryHistory!==undefined)return {data:clone(window.__salaryHistory),error:null};
  (__db.employees||[]).forEach(e=>captureMockSalary(e));
  return {data:clone({version:1,history_policy:'effective-salary-v1',employees:[...payrollRoster.values()]}),error:null};
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
