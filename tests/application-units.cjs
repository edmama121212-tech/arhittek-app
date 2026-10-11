const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const results=[];
async function check(name,fn){await fn();results.push(name)}
const context={window:{},Set,Number,Math,Array,Error};vm.createContext(context);vm.runInContext(fs.readFileSync('data-access.js','utf8'),context);
const read=context.window.fetchAllRows;
function pages(rows,{cap=Infinity,countAt,failAt,mutate}={}){
 return ()=>{let offset=0,size=0;return {order(){return this},range(from,to){offset=from;size=to-from+1;const data=rows.slice(offset,offset+Math.min(size,cap));return Promise.resolve({data:mutate?mutate(data,offset):data,error:offset===failAt?new Error('Connection lost'):null,count:countAt?countAt(offset):rows.length})}}};
}
(async()=>{
 await check('Reads continue when the server cap is smaller than the requested page',async()=>{
  const rows=Array.from({length:705},(_,id)=>({id})),r=await read(pages(rows,{cap:200}));assert.equal(r.error,null);assert.equal(r.data.length,705);assert.equal(r.truncated,false);
 });
 await check('A failure on a later page never returns partial money data',async()=>{
  const r=await read(pages(Array.from({length:705},(_,id)=>({id})),{failAt:500}));assert.equal(r.data,null);assert(r.error);
 });
 await check('Changes in record count invalidate the complete-read result',async()=>{
  const r=await read(pages(Array.from({length:705},(_,id)=>({id})),{countAt:n=>n?706:705}));assert.equal(r.data,null);assert(r.error);
 });
 await check('Overlapping pages invalidate a result instead of double counting',async()=>{
  const r=await read(pages(Array.from({length:705},(_,id)=>({id})),{mutate:(rows,n)=>n?[{id:0},...rows.slice(1)]:rows}));assert.equal(r.data,null);assert(r.error);
 });
 await check('An empty page before the declared count is an error',async()=>{
  const r=await read(pages([{id:1}],{countAt:()=>2}));assert.equal(r.data,null);assert(r.error);
 });
 await check('A deliberately bounded history reports truncation',async()=>{
  const r=await read(pages(Array.from({length:705},(_,id)=>({id}))),{maxRows:300});assert.equal(r.error,null);assert.equal(r.data.length,300);assert.equal(r.truncated,true);
 });
 const listeners={},deleted=[],cached=[],notifications=[],opened=[],navigated=[],focused=[],own='https://example.test/arhittek-app/';
 const cache={addAll:async urls=>cached.push(...urls),add:async()=>{},put:async()=>{},match:async()=>null};
 const sw={location:{href:own+'sw.js',origin:'https://example.test'},addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{},registration:{showNotification:async(t,o)=>notifications.push({t,o})},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async u=>opened.push(u)}};
 const scope={self:sw,URL,Request,Response,Promise,caches:{open:async()=>cache,keys:async()=>['arhittek-v3.13-project-budget','arhittek-v3.14-full-audit','other-app-cache'],delete:async k=>deleted.push(k)},fetch:async()=>new Response('ok')};
 vm.createContext(scope);vm.runInContext(fs.readFileSync('sw.js','utf8'),scope);
 const run=async(name,data={})=>{let pending;listeners[name]({...data,waitUntil:p=>pending=p});if(pending)await pending};
 await check('An app update preserves caches belonging to other sites',async()=>{await run('activate');assert.deepEqual(deleted,['arhittek-v3.13-project-budget'])});
 await check('Offline installation includes the complete-read helper',async()=>{await run('install');assert(cached.includes('./data-access.js'))});
 await check('Private requests and other site paths do not enter the asset cache',async()=>{
  for(const url of ['https://private.example.test/payroll','https://example.test/other-app/index.html']){let intercepted=false;listeners.fetch({request:new Request(url),respondWith(){intercepted=true}});assert.equal(intercepted,false)}
 });
 await check('Cache refresh preserves the original request headers',async()=>{
  let received;scope.fetch=async request=>{received=request;return new Response('ok')};let pending;listeners.fetch({request:new Request(own+'index.html',{headers:{'X-Example':'keep'}}),respondWith:p=>pending=p});await pending;assert.equal(received.headers.get('X-Example'),'keep');assert.equal(received.cache,'no-store');
 });
 await check('Plain text push notifications still display',async()=>{await run('push',{data:{json(){throw new Error('Not JSON')},text:()=> 'Project updated'}});assert.equal(notifications[0].o.body,'Project updated')});
 await check('Clicking a notification navigates the existing app window',async()=>{
  sw.clients.matchAll=async()=>[{url:own+'index.html',navigate:async u=>navigated.push(u),focus:async()=>focused.push(true)}];await run('notificationclick',{notification:{close(){},data:{url:'./index.html?project=1'}}});assert.deepEqual(navigated,[own+'index.html?project=1']);assert.equal(focused.length,1);
 });
 await check('A notification URL outside the app opens the app itself',async()=>{
  sw.clients.matchAll=async()=>[];await run('notificationclick',{notification:{close(){},data:{url:'https://outside.example.test/'}}});assert.deepEqual(opened,[own+'index.html']);
 });
 console.log(JSON.stringify({passed:results.length,total:results.length,failed:[]}));
})().catch(error=>{console.error(error);process.exitCode=1});
