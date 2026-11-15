'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{createCanvas}=require('@napi-rs/canvas');
const frontend=require('../src/features/catalog/catalog-plan-generation.js');
(async()=>{
 const source=fs.readFileSync('supabase/functions/catalog-plan-generate/handler.js','utf8');
 const {createHandler,approved}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 const image=createCanvas(512,512),data=image.toDataURL('image/png'),bytes=Buffer.from(data.split(',')[1],'base64');
 const m={floor:'floor1',rooms:[{name:'Спальня',area:20}],widthMm:10630,heightMm:13160};
 const good={walls:true,openings:true,stairs:true,columns:true,rooms:true,labels:true,noArtifacts:true,confidence:.99,issues:[],bounds:[.08,.08,.92,.92]};
 let checks=0,paidCalls=0,reviewCalls=0,currentOwner=owner,verdict=good,failGenerate=false,failReview=false;
 const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 const jobs=[],storage=new Map(),tasks=[];
 function matches(row,url){for(const [key,value]of url.searchParams){if(value.startsWith('eq.')&&String(row[key])!==value.slice(3))return false;}return true;}
 async function mock(url,options={}){
  const u=new URL(url);
  if(u.pathname.endsWith('get_employee_access'))return Response.json(options.headers['x-session-token']==='valid-token-'.repeat(4)?[{employee_id:currentOwner,is_owner:true}]:[]);
  if(u.pathname.endsWith('catalog_plan_jobs')){
   let rows=jobs.filter(r=>matches(r,u));
   if(options.method==='POST'){
    const job=JSON.parse(options.body);
    if(jobs.some(j=>j.request_hash===job.request_hash&&j.actor===job.actor))return Response.json({}, {status:409});
    job.created_at=job.updated_at=new Date().toISOString();jobs.push(job);rows=[job];
   }else if(options.method==='PATCH')for(const row of rows)Object.assign(row,JSON.parse(options.body));
   return Response.json(structuredClone(rows));
  }
  if(u.pathname.includes('/storage/')){
   const file=u.pathname.split('catalog-plan-jobs/')[1];
   if(options.method==='POST'){storage.set(file,new Uint8Array(options.body));return Response.json({});}
   return new Response(storage.get(file)||null,{status:storage.has(file)?200:404});
  }
  assert.equal(options.headers.Authorization,'Bearer secret-value-never-returned');
  if(u.pathname.endsWith('/images/edits')){
   paidCalls++;if(failGenerate){failGenerate=false;return Response.json({error:{code:'credit_balance_exhausted'}},{status:429});}assert.match(options.body.get('prompt'),/columns.*merge/i);return Response.json({data:[{b64_json:bytes.toString('base64')}]});
  }
  if(u.pathname.endsWith('/responses')){reviewCalls++;if(failReview){failReview=false;return Response.json({error:{code:'rate_limit_exceeded'}},{status:429});}return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(verdict)}]}]});}
  throw Error('Unexpected call '+u.pathname);
 }
 const handler=createHandler({url:'https://db.test',serviceKey:'server-key',anonKey:'anon-key',openaiKey:'secret-value-never-returned',fetch:mock,waitUntil:p=>tasks.push(p)});
 const post=async body=>{const r=await handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':'valid-token-'.repeat(4)},body:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
 const drain=async()=>{while(tasks.length)await Promise.all(tasks.splice(0));};
 eq((await handler(new Request('https://edge.test'))).status,200);
 const publicHealth=await (await handler(new Request('https://edge.test'))).text();eq(publicHealth.includes('secret-value'),false);
 eq((await handler(new Request('https://edge.test',{method:'POST',body:'{}'}))).status,403);eq(paidCalls,0);
 const pending=await post({action:'start',source:data,manifest:m});eq(pending.state,'generating');
 const duplicate=await post({action:'start',source:data,manifest:m});eq(duplicate.id,pending.id);await drain();eq(paidCalls,1);
 let result=await post({action:'status',id:pending.id});eq(result.state,'generated');eq(result.image,undefined);
 await Promise.all([post({action:'review',id:pending.id}),post({action:'review',id:pending.id})]);await drain();eq(reviewCalls,1);
 result=await post({action:'status',id:pending.id});eq(result.state,'approved');eq(result.image,data);
 currentOwner=other;eq((await post({action:'status',id:pending.id})).status,404);currentOwner=owner;
 for(const key of ['walls','openings','stairs','columns','rooms','labels','noArtifacts']){eq(approved({...good,[key]:false}),false);eq(frontend.verified({...good,[key]:false}),false);}
 eq(approved({...good,confidence:.5}),false);eq(approved({...good,bounds:[1,1,0,0]}),false);eq(frontend.verified({...good,issues:['Лишнее окно']}),false);
 // A failed geometric comparison is retried once, with persisted feedback.
 verdict={...good,columns:false,issues:['Колонна стала окном']};
 const failed=await post({action:'start',source:data,manifest:{...m,floor:'floor2'}});await drain();
 await post({action:'review',id:failed.id});await drain();eq((await post({action:'status',id:failed.id})).state,'rejected');
 await Promise.all([post({action:'retry',id:failed.id}),post({action:'retry',id:failed.id})]);await drain();eq(paidCalls,3);
 await post({action:'review',id:failed.id});await drain();
 await post({action:'retry',id:failed.id});await drain();eq(paidCalls,3);eq((await post({action:'status',id:failed.id})).attempt,2);
 // A manual retry after billing recovery resumes generation. Review failures
 // resume the existing candidate instead of paying for another image.
 verdict=good;failGenerate=true;
 const billing=await post({action:'start',source:data,manifest:{...m,floor:'floor3'}});await drain();
 eq((await post({action:'status',id:billing.id})).state,'failed');
 await post({action:'retry',id:billing.id});await drain();eq((await post({action:'status',id:billing.id})).state,'generated');
 const paidBeforeReviewRetry=paidCalls;failReview=true;
 await post({action:'review',id:billing.id});await drain();eq((await post({action:'status',id:billing.id})).review.failureStage,'review');
 await post({action:'retry',id:billing.id});await drain();eq((await post({action:'status',id:billing.id})).state,'approved');eq(paidCalls,paidBeforeReviewRetry);
 // Client rejection, cancellation and exact dimension labels.
 const labels=[],canvasFactory=()=>{const c=createCanvas(1,1),context=c.getContext('2d'),fill=context.fillText.bind(context);context.fillText=(text,...args)=>{labels.push(text);return fill(text,...args)};c.getContext=()=>context;return c;};
 frontend.drawDimensions(image,m,good.bounds,canvasFactory);eq(labels,['10,63 м','13,16 м']);
 let cancelled=false;
 const client=frontend.client({url:'https://edge.test',key:'anon',token:'owner',check:()=>{if(cancelled)throw new DOMException('Cancelled','AbortError')},delay:async()=>{cancelled=true},fetch:async()=>Response.json({state:'generating',attempt:1,id:pending.id})});
 await assert.rejects(()=>client.generate(data,m),{name:'AbortError'});checks++;
 console.log(JSON.stringify({generatedPlans:checks,paidCalls,reviewCalls}));
})().catch(e=>{console.error(e);process.exitCode=1});
