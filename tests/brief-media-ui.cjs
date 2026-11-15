'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..'),png=fs.readFileSync(path.join(root,'icon-32.png'));
(async()=>{
 const browser=await(process.env.CATALOG_BROWSER==='webkit'?webkit:chromium).launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:process.env.CATALOG_BROWSER==='webkit'?[]:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const prepare=()=>{
  const form='00000000-0000-4000-8000-000000000001',url='https://chbkkoxwzpaghanofvqk.supabase.co/storage/v1/object/public/tz-references/tz-refs/'+form+'/own.png';
  window.__tz={id:form,answers:{ar_refs_files:[url]}};window.__privateCache=[];
  const native=window.fetch;window.fetch=(u,o)=>{if(String(u).startsWith('https://media.test/'))__privateCache.push(o?.cache);return native.call(window,u,o);};
  const create=supabase.createClient;supabase.createClient=function(u,k,options){
   window.__mediaOptions=options;
   const c=create(u,k,options),from=c.storage.from;c.storage.from=function(bucket){
    const object=from.call(this,bucket);object.download=async path=>{const r=await options.global.fetch('https://media.test/'+path,{headers:options.global.headers});return r.ok?{data:await r.blob(),error:null}:{data:null,error:{message:'denied'}};};return object;
   };return c;
  };
 };
 await context.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+';('+prepare.toString()+')()'});
 let deny=false,raw=0;
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.protocol==='blob:')return route.continue();
  if(u.hostname==='media.test'){
   const headers={'Access-Control-Allow-Origin':'https://app.test','Access-Control-Allow-Headers':'x-tz-token','Access-Control-Allow-Methods':'GET,OPTIONS'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   return route.fulfill(deny?{status:403,headers,body:'denied'}:{body:png,headers,contentType:'image/png'});
  }
  if(u.hostname==='chbkkoxwzpaghanofvqk.supabase.co'){raw++;return route.fulfill({status:403,body:'no direct image'});}
  if(u.hostname==='app.test'){
   const f=path.join(root,u.pathname.slice(1));if(fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':undefined});
  }
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://app.test/tz.html?token=private-fixture');
 await page.waitForFunction(()=>typeof tzForm!=='undefined'&&tzForm&&window.ARHITTEKBriefMedia);
 await page.evaluate(()=>{document.getElementById('app').innerHTML=renderField({id:'ar_refs',type:'refs',label:'Референсы'});});
 await page.waitForFunction(()=>{const i=document.querySelector('img[data-brief-ref]');return i?.src.startsWith('blob:')&&i.complete&&i.naturalWidth===32;}).catch(async e=>{throw Error(e.message+' '+JSON.stringify({errors,detail:await page.evaluate(()=>({html:document.getElementById('app').innerHTML,cache:window.__privateCache,actor:token,form:tzForm?.id}))}));});
 assert.equal(raw,0);
 assert.deepEqual(await page.evaluate(()=>__privateCache),['no-store']);
 assert.equal(await page.evaluate(()=>__mediaOptions.auth.persistSession),false);
 assert.equal(await page.evaluate(()=>answers.ar_refs_files[0].includes('blob:')),false);
 assert.equal(await page.locator('meta[name="referrer"]').getAttribute('content'),'no-referrer');
 deny=true;
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('img[data-brief-ref]').getAttribute('src'),null);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>document.querySelector('img[data-brief-ref]').alt.includes('недоступен'));
 assert.equal(await page.locator('img[data-brief-ref]').getAttribute('src'),null);
 assert.deepEqual(errors,[]);
 console.log('Private references on mobile '+(process.env.CATALOG_BROWSER||'chromium')+': authorized image, no public fetch, no HTTP cache, unchanged answers and revoked access passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
