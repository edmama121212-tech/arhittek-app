/* Server-only scoped adapter. Never pass its source response to a browser. */
(function(root,factory){
 'use strict'; const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.ARHITTEKClientGateway=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const MAX_JSON=5*1024*1024,MAX_FILE=25*1024*1024;
 const TYPES=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 class Denied extends Error{constructor(status=403){super('Access denied');this.status=status;}}
 function iso(value){const n=Date.parse(value);if(!Number.isFinite(n))throw new Denied(503);return new Date(n).toISOString();}
 function day(value){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
 function incoming(row){return ['advance','final_payment','income','materials_budget','construction_budget'].includes(row.type);}
 function linked(row){return row.invoice_id||(String(row.description||'').match(/\[invoice-payment:([^\]]+)\]/)||[])[1]||null;}
 function isImported(row){return row.type==='project_expense'&&(row.description==='Ранее внесённые расходы'||String(row.description||'').startsWith('[cash:historical-expense]'));}
 function scopeRows(rows,pid){if(!Array.isArray(rows)||rows.length>10000)throw new Denied(503);const ids=new Set();for(const r of rows){if(!r||r.project_id!==pid||!UUID.test(r.id)||ids.has(r.id))throw new Denied(503);ids.add(r.id);}return rows;}
 function toSnapshot(source,finance,validate,now=Date.now()){
  if(!source||source.source_version!==2||source.complete!==true||!source.project||!UUID.test(source.project.id)||!UUID.test(source.scope_ref))throw new Denied(503);
  const pid=source.project.id,scope=source.scope_ref,generated=iso(source.generated_at),asOf=day(generated);
  if(Math.abs(Date.parse(generated)-now)>120000||Date.parse(source.access_expires_at)<=now)throw new Denied();
  const names=['ledger','invoices','costFacts','costCredits','allocations','directPayments','stages','work_items','documents'];
  for(const n of names)scopeRows(source[n],pid);
  const options={projectId:pid,asOf,contract:source.contract,ledger:source.ledger,invoices:source.invoices,costFacts:source.costFacts,costCredits:source.costCredits,allocations:source.allocations,directPayments:source.directPayments,costFactsComplete:source.costFactsComplete===true};
  const calc=finance.evaluate(options),m=calc.minor;
  if(!calc.cash_ok||!calc.invoices_ok||m.received_by_company===null||m.direct_client_paid===null||m.company_fee_allocated===null||m.client_refunds===null)throw new Denied(503);
  const terms=calc.contract_ok&&calc.contract.version===2,costs=calc.costs_ok===true;
  const classOk=calc.classification_ok&&calc.allocation_ok&&m.client_resources_with_advances!==null&&m.client_accountable_advances_issued===0&&source.cashHistoryComplete===true;
  const actual=r=>!r.deleted_at&&r.entry_date<=asOf;
  const ledger=source.ledger.filter(actual),invoiceMap=new Map(source.invoices.map(r=>[r.id,r]));
  const facts=new Map(source.costFacts.filter(r=>r.source_type==='ledger'&&r.cost_scope==='project').map(r=>[r.source_id,r]));
  const credits=new Map();for(const c of source.costCredits)credits.set(c.cost_fact_id,(credits.get(c.cost_fact_id)||0)+finance.toMinor(c.amount));
  const excluded=new Set(source.invoices.filter(r=>r.cost_scope==='company_fee').map(r=>r.id));
  const invoices=calc.invoices.filter(r=>!excluded.has(r.id)).map(r=>{
   const raw=invoiceMap.get(r.id),d=source.documents.filter(x=>x.invoice_id===r.id).map(x=>({id:x.id,scope_ref:scope,invoice_id:r.id,name:x.name,media_type:x.media_type,size_bytes:x.size_bytes}));
   const paid=ledger.filter(x=>linked(x)===r.id&&x.purpose!=='cash_handover'&&x.funding_source!=='company_fee'&&!incoming(x)&&!['role_payout','bonus','client_refund'].includes(x.type)&&(x.funding_source==='client'||(!x.payee_employee_id&&!['fee_payment','salary_payment','withdrawal'].includes(x.type)))).reduce((a,x)=>a+finance.toMinor(x.amount),0);
   return {id:r.id,scope_ref:scope,number:raw.number||'',date:raw.invoice_date,kind:raw.item_type||'Прочее',title:raw.public_title||'Накладная по объекту',amount_kopeks:r.minor.amount,credit_kopeks:r.minor.credit,net_amount_kopeks:r.minor.net_amount,company_paid_kopeks:paid,direct_paid_kopeks:r.minor.direct_paid,overpaid_kopeks:Math.max(0,paid+r.minor.direct_paid-r.minor.net_amount),documents:d};
  });
  const other=ledger.filter(r=>!incoming(r)&&!linked(r)&&!['role_payout','bonus','client_refund'].includes(r.type)&&r.purpose!=='client_refund'&&r.purpose!=='cash_handover'&&r.funding_source!=='company_fee'&&!isImported(r)&&(r.funding_source==='client'||(!r.payee_employee_id&&!['fee_payment','salary_payment','withdrawal'].includes(r.type)))).map(r=>{
   const amount=finance.toMinor(r.amount),f=facts.get(r.id),credit=f?(credits.get(f.id)||0):0;
   return {id:r.id,scope_ref:scope,title:'Затраты по объекту',date:r.entry_date,amount_kopeks:amount,credit_kopeks:credit,net_amount_kopeks:amount-credit};
  });
  const receipts=ledger.filter(incoming).map(r=>({id:r.id,scope_ref:scope,title:'Пополнение на объект',date:r.entry_date,amount_kopeks:finance.toMinor(r.amount)}));
  const refunds=ledger.filter(r=>r.type==='client_refund'||r.purpose==='client_refund').map(r=>({id:r.id,scope_ref:scope,title:'Возврат средств',date:r.entry_date,amount_kopeks:finance.toMinor(r.amount)}));
  const stages=source.stages.map(r=>({id:r.id,scope_ref:scope,name:r.name,status:r.done?'completed':'planned',due_date:r.due_date,completed_at:r.done&&r.done_at?iso(r.done_at):null}));
  const work=source.work_items.map(r=>({id:r.id,scope_ref:scope,stage_id:r.stage_id,name:r.name,zone:r.zone||'',quantity:r.quantity,unit:r.unit,unit_price_kopeks:finance.toMinor(r.unit_price),amount_kopeks:quantityAmount(r.quantity,finance.toMinor(r.unit_price)),status:r.status,planned_date:r.planned_date,completed_at:r.completed_at?iso(r.completed_at):null,inspected_at:r.inspected_at?iso(r.inspected_at):null,accepted_at:r.accepted_at?iso(r.accepted_at):null}));
  const s={schema_version:2,scope:'construction_client_readonly',complete:true,generated_at:generated,access_expires_at:iso(source.access_expires_at),project:{reference:scope,name:source.project.name,address:source.project.address||'',status:source.project.status},pricing:{terms_confirmed:!!terms,fee_basis:'actual_cost_markup',fee_rate_bps:finance.toMinor(source.project.company_markup_percent),fee_mode:'on_top',cost_facts_complete:costs,confirmed_cost_base_kopeks:costs?m.confirmed_project_costs:null,fee_total_kopeks:terms&&costs?m.company_fee_total:null,chargeable_cost_total_kopeks:terms&&costs?m.chargeable_cost_total:null},cash:{classification_ok:!!classOk,received_kopeks:m.received_by_company,direct_paid_kopeks:m.direct_client_paid,company_spent_kopeks:classOk?m.confirmed_client_cash_costs:null,fee_allocated_kopeks:m.company_fee_allocated,refunded_kopeks:m.client_refunds,held_kopeks:classOk?m.client_resources_with_advances:null,accountable_outstanding_kopeks:classOk?0:null},stages,work_items:work,invoices,other_costs:other,receipts,refunds,row_counts:{stages:stages.length,work_items:work.length,invoices:invoices.length,documents:invoices.reduce((n,r)=>n+r.documents.length,0),other_costs:other.length,receipts:receipts.length,refunds:refunds.length}};
  try{validate(s,now);}catch(e){throw new Denied(503);}return s;
 }
 function quantityAmount(q,unit){const [whole,fraction='']=q.split('.'),d=10n**BigInt(fraction.length);return Number((BigInt(whole+fraction)*BigInt(unit)+d/2n)/d);}
 function signature(b,t){const p=v=>v.every((x,i)=>b[i]===x);if(t==='application/pdf')return p([37,80,68,70,45]);if(t==='image/jpeg')return p([255,216,255]);if(t==='image/png')return p([137,80,78,71,13,10,26,10]);return t==='image/webp'&&p([82,73,70,70])&&b[8]===87&&b[9]===69&&b[10]===66&&b[11]===80;}
 async function bounded(response,max){const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>max))throw new Denied(503);const reader=response.body?.getReader();if(!reader){const b=new Uint8Array(await response.arrayBuffer());if(b.length>max)throw new Denied(503);return b;}const parts=[];let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max){await reader.cancel();throw new Denied(503);}parts.push(r.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let off=0;for(const b of parts){bytes.set(b,off);off+=b.length;}return bytes;}
 function createHandler({supabaseUrl,serviceKey,fetcher=fetch,cryptoApi=globalThis.crypto,finance,validate,allowedOrigins=['https://edmama121212-tech.github.io']}){
  const base=new URL(supabaseUrl);if(base.protocol!=='https:'||base.pathname!=='/'||!serviceKey)throw Error('Invalid server configuration');
  const origins=new Set(allowedOrigins);
  return async function handler(req){
   const origin=req.headers.get('origin'),allowed=origins.has(origin),headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
   if(allowed){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='POST, OPTIONS';headers['Access-Control-Allow-Headers']='authorization, content-type';}
   const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
   try{
    if(!allowed)throw new Denied();
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')throw new Denied(405);
    const url=new URL(req.url),endpoint=url.pathname.split('/').filter(Boolean).pop();if(url.search||!['snapshot','document'].includes(endpoint))throw new Denied(404);
    const auth=req.headers.get('authorization');if(!auth||!/^Bearer [a-f0-9]{64}$/.test(auth)||req.headers.has('x-session-token'))throw new Denied();
    if(!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))throw new Denied(400);
    const bodyBytes=await bounded(req,1024);let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bodyBytes));}catch(e){throw new Denied(400);}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==(endpoint==='document'?1:0)||(endpoint==='document'&&(!UUID.test(body.document_id)||Object.keys(body)[0]!=='document_id')))throw new Denied(400);
    const token=auth.slice(7),digest=[...new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const rpc=async(name,params)=>{
     const response=await fetcher(new URL('rest/v1/rpc/'+name,base),{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(params),redirect:'error',signal:AbortSignal.timeout(12000)});
     if(!response.ok)throw new Denied([401,403,404,429].includes(response.status)?response.status:503);
     const bytes=await bounded(response,MAX_JSON);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch(e){throw new Denied(503);}
    };
    const params={p_token_digest:digest,p_origin:origin};
    if(endpoint==='snapshot'){
     const raw=await rpc('construction_client_sources',params),safe=toSnapshot(raw,finance,validate);return reply(200,safe);
    }
    const doc=await rpc('construction_client_document',{...params,p_document_id:body.document_id});
    if(!doc||!UUID.test(doc.id)||doc.id!==body.document_id||!TYPES.has(doc.media_type)||!Number.isSafeInteger(doc.size_bytes)||doc.size_bytes<1||doc.size_bytes>MAX_FILE||typeof doc.bucket_id!=='string'||!/^[-a-z0-9]+$/.test(doc.bucket_id)||typeof doc.object_path!=='string'||doc.object_path.split('/').some(p=>!p||p==='.'||p==='..')||typeof doc.object_version!=='string'||!doc.object_version||typeof doc.name!=='string'||/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(doc.name)||!Number.isFinite(Date.parse(doc.access_expires_at))||Date.parse(doc.access_expires_at)<=Date.now())throw new Denied(503);
    const path='storage/v1/object/authenticated/'+encodeURIComponent(doc.bucket_id)+'/'+doc.object_path.split('/').map(encodeURIComponent).join('/');
    const stored=await fetcher(new URL(path,base),{method:'GET',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!stored.ok||(stored.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!==doc.media_type)throw new Denied(503);
    const bytes=await bounded(stored,doc.size_bytes);if(bytes.length!==doc.size_bytes||!signature(bytes,doc.media_type))throw new Denied(503);
    const current=await rpc('construction_client_document',{...params,p_document_id:body.document_id});if(!current||current.id!==doc.id||current.bucket_id!==doc.bucket_id||current.object_path!==doc.object_path||current.object_version!==doc.object_version||current.size_bytes!==doc.size_bytes||current.media_type!==doc.media_type||!Number.isFinite(Date.parse(current.access_expires_at))||Date.parse(current.access_expires_at)<=Date.now())throw new Denied();
    return new Response(bytes,{status:200,headers:{...headers,'Content-Type':doc.media_type,'Content-Length':String(bytes.length),'Content-Disposition':"attachment; filename=\"document\"; filename*=UTF-8''"+encodeURIComponent(doc.name)}});
   }catch(error){const status=error instanceof Denied?error.status:503;return reply(status,{error:status===429?'rate_limited':status>=500?'unavailable':'access_denied'});}
  };
 }
 return Object.freeze({createHandler,toSnapshot});
});
