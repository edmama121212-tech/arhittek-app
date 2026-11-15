/* Private brief images: authenticated bytes become temporary in-memory blob URLs.
   Never persist download tickets, blob URLs or credentials in answers/storage. */
(function(root){
 'use strict';
 const ORIGIN='https://chbkkoxwzpaghanofvqk.supabase.co',MAX=50*1024*1024;
 let detach=null,clearCurrent=()=>{};
 function path(value){
  try{
   if(typeof value!=='string'||decodeURIComponent(value).split('/').some(x=>x==='.'||x==='..'))return null;
   const u=new URL(value);
   if(u.origin!==ORIGIN||u.search||u.hash)return null;
   const prefix='/storage/v1/object/public/tz-references/';
   if(!u.pathname.startsWith(prefix))return null;
   const p=decodeURIComponent(u.pathname.slice(prefix.length));
   if(!p||p.includes('\\')||p.split('/').some(x=>!x||x==='.'||x==='..'))return null;
   return p;
  }catch(_){return null;}
 }
 function attach({client,actor,document:doc=root.document}){
  detach?.();let epoch=0,hidden=false;
  const urls=new Map(),pending=new WeakMap();
  function drop(node){const url=urls.get(node);if(url){root.URL.revokeObjectURL(url);urls.delete(node);if(node.getAttribute('src')===url)node.removeAttribute('src');}}
  function clear(){epoch++;for(const node of urls.keys())drop(node);}
  async function load(node){
   const value=node.getAttribute('data-brief-ref'),p=path(value),who=actor();
   if(hidden||!who||!p||urls.has(node)||pending.get(node)===epoch)return;
   const generation=epoch;pending.set(node,generation);node.alt='Загрузка защищённого референса…';
   try{
    const r=await client().storage.from('tz-references').download(p);
    if(r.error||!r.data||r.data.size>MAX||!r.data.type.startsWith('image/')||r.data.type==='image/svg+xml')throw Error('Reference unavailable');
    if(generation!==epoch||who!==actor()||hidden||!node.isConnected||node.getAttribute('data-brief-ref')!==value)return;
    const url=root.URL.createObjectURL(r.data);urls.set(node,url);node.src=url;node.alt='Референс ТЗ';
   }catch(_){if(generation===epoch&&who===actor()&&node.isConnected)node.alt='Референс недоступен. Обновите ТЗ и проверьте доступ.';}
   finally{if(pending.get(node)===generation)pending.delete(node);}
  }
  function scan(node){
   if(node.nodeType!==1)return;
   if(node.matches('img[data-brief-ref]'))load(node);
   node.querySelectorAll('img[data-brief-ref]').forEach(load);
  }
  const observer=new root.MutationObserver(records=>{
   for(const node of urls.keys())if(!node.isConnected)drop(node);
   for(const r of records)if(r.type==='attributes')load(r.target);else r.addedNodes.forEach(scan);
  });
  observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-brief-ref']});
  const visibility=()=>{hidden=doc.hidden;clear();if(!hidden)scan(doc.documentElement);};
  const pagehide=()=>{hidden=true;clear();};
  doc.addEventListener('visibilitychange',visibility);root.addEventListener('pagehide',pagehide);root.addEventListener('pageshow',visibility);
  scan(doc.documentElement);
  clearCurrent=clear;
  detach=()=>{observer.disconnect();doc.removeEventListener('visibilitychange',visibility);root.removeEventListener('pagehide',pagehide);root.removeEventListener('pageshow',visibility);clear();};
  return {clear,scan:()=>scan(doc.documentElement),detach};
 }
 const api={path,attach,clear:()=>clearCurrent()};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.ARHITTEKBriefMedia=api;
})(typeof window!=='undefined'?window:globalThis);
