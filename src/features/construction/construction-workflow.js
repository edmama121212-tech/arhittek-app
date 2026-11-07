(function(root){
'use strict';
const VERSION='repair-v1';
if(root.ARHITTEKConstructionWorkflow?.version===VERSION)return;
const NAMESPACE='2a9e56c6-a93f-5e3f-b234-c47df7c3ef5b';
const NAMES=Object.freeze(['Обмеры и обследование','Смета и согласование','Подготовка и демонтаж','Черновые работы','Инженерные сети','Чистовая отделка','Комплектация и монтаж','Проверка и сдача']);
function normalizeName(value){return String(value||'').trim().replace(/\s+/g,' ').toLowerCase().replace(/ё/g,'е');}
function rotate(value,bits){return (value<<bits)|(value>>>(32-bits));}
// Standard synchronous SHA-1 for UUID v5 resource IDs. These IDs grant no access.
// Computing them before any request makes an uncertain retry idempotent across devices.
function sha1(bytes){
 const size=(((bytes.length+8)>>>6)+1)*16,words=new Uint32Array(size);
 for(let i=0;i<bytes.length;i++)words[i>>>2]|=bytes[i]<<(24-(i%4)*8);
 words[bytes.length>>>2]|=0x80<<(24-(bytes.length%4)*8);words[size-1]=bytes.length*8;
 const h=[0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0],w=new Uint32Array(80);
 for(let offset=0;offset<size;offset+=16){
  for(let i=0;i<16;i++)w[i]=words[offset+i];
  for(let i=16;i<80;i++)w[i]=rotate(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);
  let [a,b,c,d,e]=h;
  for(let i=0;i<80;i++){
   const f=i<20?(b&c)|((~b)&d):i<40?b^c^d:i<60?(b&c)|(b&d)|(c&d):b^c^d;
   const k=i<20?0x5a827999:i<40?0x6ed9eba1:i<60?0x8f1bbcdc:0xca62c1d6;
   const next=(rotate(a,5)+f+e+k+w[i])>>>0;e=d;d=c;c=rotate(b,30);b=a;a=next;
  }
  [a,b,c,d,e].forEach((value,i)=>{h[i]=(h[i]+value)>>>0;});
 }
 const result=new Uint8Array(20);
 for(let i=0;i<20;i++)result[i]=(h[i>>>2]>>>(24-(i%4)*8))&255;
 return result;
}
function stageId(projectId,name){
 const hex=NAMESPACE.replace(/-/g,''),namespace=Uint8Array.from(hex.match(/../g),part=>parseInt(part,16));
 const label=new TextEncoder().encode('arhittek:'+VERSION+':'+String(projectId).trim().toLowerCase()+':'+name);
 const bytes=new Uint8Array(namespace.length+label.length);bytes.set(namespace);bytes.set(label,namespace.length);
 const id=sha1(bytes).slice(0,16);id[6]=(id[6]&15)|80;id[8]=(id[8]&63)|128;
 const text=Array.from(id,byte=>byte.toString(16).padStart(2,'0')).join('');
 return [text.slice(0,8),text.slice(8,12),text.slice(12,16),text.slice(16,20),text.slice(20)].join('-');
}
function createPlan(projectId){
 if(typeof projectId!=='string'||!projectId.trim())throw new Error('Объект не выбран');
 return Object.freeze({version:VERSION,projectId,rows:Object.freeze(NAMES.map((name,sort_order)=>Object.freeze({id:stageId(projectId,name),project_id:projectId,name,sort_order,done:false,due_date:null})))});
}
function missingRows(plan,existing){
 const live=(existing||[]).filter(row=>row.project_id===plan.projectId&&!row.deleted_at);
 const ids=new Set(live.map(row=>row.id)),names=new Set(live.map(row=>normalizeName(row.name)));
 const max=live.reduce((value,row)=>Number.isFinite(Number(row.sort_order))?Math.max(value,Number(row.sort_order)):value,-1);
 return plan.rows.filter(row=>!ids.has(row.id)&&!names.has(normalizeName(row.name))).map((row,index)=>({...row,sort_order:max+1+index}));
}
const api={version:VERSION,namespace:NAMESPACE,names:NAMES,stageId,createPlan,missingRows};
root.ARHITTEKConstructionWorkflow=api;
if(typeof document==='undefined')return;
const inFlight=new Map(),messages=new Map();
let scheduled=false;
const appState=()=>typeof state!=='undefined'?state:null;
const currentId=()=>typeof currentObjectId!=='undefined'?currentObjectId:null;
const currentSession=()=>typeof session!=='undefined'?session:null;
function project(id){return (appState()?.projects||[]).find(row=>row.id===id&&!row.deleted_at);}
function construction(row){return !!row&&typeof isConstructionProject==='function'&&isConstructionProject(row);}
function canApply(id){const s=currentSession(),st=appState();return !!(s?.isAdmin&&s.token&&st?.financialDataReady&&!st.stageDataError&&construction(project(id)));}
function canToggle(id){const s=currentSession(),st=appState();return !!(s?.token&&st?.financialDataReady&&!st.stageDataError&&!st.projectMembersDataError&&construction(project(id))&&typeof isProjectMember==='function'&&isProjectMember(id)&&typeof canSeeConstruction==='function'&&canSeeConstruction());}
function sameActor(actor){const s=currentSession();return !!s&&s.employeeId===actor.employeeId&&s.token===actor.token&&s.isAdmin;}
function assertActor(actor,id){if(!sameActor(actor)||!canApply(id))throw new Error('Права или данные изменились. Обновите объект перед повтором.');}
function notify(message){if(typeof showToast==='function')showToast(message);}
function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function queueRender(){if(scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;render();});}
function rowsFor(id){return (appState()?.projectStages||[]).filter(row=>row.project_id===id&&!row.deleted_at).slice().sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||String(a.created_at||'').localeCompare(String(b.created_at||'')));}
function ensureSection(){
 let section=document.getElementById('constructionWorkflow');
 if(section)return section;
 const summary=document.getElementById('objSummary');if(!summary)return null;
 section=document.createElement('section');section.id='constructionWorkflow';section.className='card';section.style.marginTop='14px';
 summary.after(section);
 section.addEventListener('click',event=>{
  const button=event.target.closest('[data-construction-workflow]');if(!button)return;
  const id=button.dataset.projectId;
  if(button.dataset.constructionWorkflow==='apply'){applyTemplate(id);return;}
  if(button.dataset.constructionWorkflow==='toggle'&&currentId()===id&&canToggle(id)){
   const row=(appState()?.projectStages||[]).find(row=>row.id===button.dataset.stageId&&row.project_id===id);
   if(!row)return;
   const action=row.done?root.markStageUndone:root.markStageDone;
   if(typeof action!=='function')return;
   const promise=action(row.id,id);render();
   Promise.resolve(promise).finally(()=>{if(currentId()===id)render();});
  }
 });
 return section;
}
function render(){
 const section=ensureSection();if(!section)return;
 const id=currentId(),p=project(id),active=document.getElementById('view-object')?.classList.contains('active');
 if(!active||!construction(p)||!currentSession()){section.hidden=true;return;}
 section.hidden=false;section.dataset.projectId=id;
 const st=appState(),rows=rowsFor(id),busy=inFlight.has(id),message=messages.get(id),admin=!!currentSession()?.isAdmin;
 const remaining=missingRows(createPlan(id),rows).length;
 section.innerHTML='<h3 style="margin:0 0 8px">Этапы ремонта</h3>'+(st.stageDataError?'<div class="note" role="status">Не удалось обновить этапы. Показаны последние загруженные данные; изменения временно недоступны.</div>':'')+
  (rows.length?rows.map(row=>'<div class="list-item stage-item"><button type="button" class="stage-check'+(row.done?' done':'')+'" data-construction-workflow="toggle" data-project-id="'+escape(id)+'" data-stage-id="'+escape(row.id)+'" aria-label="'+escape((row.done?'Снять отметку: ':'Выполнить: ')+row.name)+'" aria-pressed="'+!!row.done+'"'+(canToggle(id)?'':' disabled')+'>'+(row.done?'✓':'')+'</button><div style="flex:1;min-width:0"><div class="li-name">'+escape(row.name)+'</div>'+(row.due_date?'<div class="li-meta">Срок: '+escape(typeof fmtDate==='function'?fmtDate(row.due_date):row.due_date)+'</div>':'')+'</div></div>').join(''):'<div class="note">Этапов пока нет. Их можно добавить из шаблона или в редакторе объекта.</div>')+
  (admin?'<button class="btn btn-secondary" type="button" data-construction-workflow="apply" data-project-id="'+escape(id)+'"'+(!canApply(id)||busy||(!remaining&&!message)?' disabled':'')+'>'+(busy?'Добавляем этапы…':message?'Повторить добавление этапов':remaining?'Добавить этапы ремонта':'Этапы ремонта уже добавлены')+'</button><div class="note" style="margin-top:8px">Шаблон добавляется только по нажатию. Существующие этапы сохраняются; изменять и удалять этапы можно в редакторе объекта.</div>':'')+
  (message?'<div class="note" role="status" style="margin-top:8px">'+escape(message)+'</div>':'');
}
async function readStages(id,actor){
 assertActor(actor,id);
 if(typeof fetchAllRows!=='function')throw new Error('Загрузка этапов недоступна');
 const read=typeof beginStageRead==='function'?beginStageRead():null;
 const result=await fetchAllRows(()=>sb.from('project_stages').select('*',{count:'exact'}).eq('project_id',id).order('sort_order').order('id'));
 if(result.error)throw result.error;if(!Array.isArray(result.data))throw new Error('Не удалось подтвердить список этапов');
 return {rows:result.data,read};
}
function publishStages(id,result,actor){
 if(!sameActor(actor))return;
 const st=appState(),combined=[...(st.projectStages||[]).filter(row=>row.project_id!==id),...result.rows];
 st.projectStages=result.read&&typeof mergeStageRead==='function'?mergeStageRead(combined,result.read):combined;
 // A late response may update object A's state, but must not repaint object B.
 if(currentId()===id){if(typeof renderCurrentStages==='function')renderCurrentStages(id);render();}
}
function applyTemplate(id){
 if(inFlight.has(id))return inFlight.get(id);
 if(currentId()!==id||!canApply(id)){notify('Добавление этапов доступно администратору после загрузки объекта.');return Promise.resolve(false);}
 const capturedProject={...project(id)},actor={employeeId:currentSession().employeeId,token:currentSession().token};
 const plan=createPlan(id); // All eight deterministic UUIDs exist before the first await.
 messages.delete(id);
 const task=(async()=>{
  try{
   const before=await readStages(id,actor),missing=missingRows(plan,before.rows);
   if(!missing.length){publishStages(id,before,actor);if(sameActor(actor))notify('Этапы ремонта уже добавлены');return true;}
   assertActor(actor,id);
   let inserted;
   try{inserted=await sb.from('project_stages').insert(missing).select('id,project_id,name,sort_order,done,due_date,created_at');}
   catch(error){inserted={error};}
   // Even an error may be a lost commit response or a concurrent identical insert.
   // A fresh complete read proves which stable IDs remain; never invent success.
   const verified=await readStages(id,actor),left=missingRows(plan,verified.rows);
   publishStages(id,verified,actor);
   if(left.length){if(inserted.error)throw inserted.error;throw new Error('Не все этапы подтверждены сервером');}
   if(typeof logAudit==='function'&&sameActor(actor)){
    try{await logAudit('project',id,capturedProject.name||'','update',{repair_stages_template:{old:null,new:{version:VERSION,stage_ids:verified.rows.filter(row=>plan.rows.some(planned=>planned.id===row.id||normalizeName(planned.name)===normalizeName(row.name))).map(row=>row.id)}}});}
    catch(error){console.warn('Этапы подтверждены, но история добавления не записана',error);}
   }
   if(sameActor(actor))notify(currentId()===id?'Этапы ремонта добавлены':'Этапы ремонта объекта «'+(capturedProject.name||'Объект')+'» добавлены');
   return true;
  }catch(error){
   console.warn('Не удалось подтвердить шаблон этапов ремонта',error);
   if(sameActor(actor)){messages.set(id,'Не удалось подтвердить добавление всех этапов. Повтор добавит только недостающие и не создаст дубликаты.');if(currentId()===id)notify('Не удалось подтвердить все этапы. Повторите добавление.');}
   return false;
  }finally{
   inFlight.delete(id);if(currentId()===id)render();
  }
 })();
 inFlight.set(id,task);render();return task;
}
api.render=render;api.applyTemplate=applyTemplate;
function start(){
 ensureSection();
 const observer=new MutationObserver(queueRender);
 for(const id of ['objTitle','objSummary','constructionList','pf-stages-list']){const node=document.getElementById(id);if(node)observer.observe(node,{childList:true,subtree:false});}
 const view=document.getElementById('view-object');if(view)observer.observe(view,{attributes:true,attributeFilter:['class']});
 render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window!=='undefined'?window:globalThis);
