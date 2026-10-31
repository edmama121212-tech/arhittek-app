(function(root){
 'use strict';
 function words(data){
  const all=[...(data?.words||[])];
  for(const b of data?.blocks||[])for(const p of b.paragraphs||[])for(const l of p.lines||[])all.push(...(l.words||[]));
  const seen=new Set();return all.filter(w=>w.bbox&&String(w.text||'').trim()).map(w=>({text:w.text.trim(),confidence:w.confidence,...w.bbox})).filter(w=>{const key=[w.text,w.x0,w.y0,w.x1,w.y1].join('|');if(seen.has(key))return false;seen.add(key);return true;});
 }
 function lines(input){
  const kept=input.filter(w=>w.confidence==null||w.confidence>=15||/^[\d\s.,]+$/.test(w.text)),out=[];
  for(const w of kept.slice().sort((a,b)=>a.y0-b.y0||a.x0-b.x0)){
   const cy=(w.y0+w.y1)/2,h=Math.max(1,w.y1-w.y0);let row=out.find(r=>Math.abs(r.cy-cy)<=Math.max(2,Math.min(r.h,h)*.65));
   if(!row){row={cy,h,words:[]};out.push(row);}row.words.push(w);
  }
  return out.sort((a,b)=>a.cy-b.cy).map(r=>r.words.sort((a,b)=>a.x0-b.x0).map(w=>w.text).join(' '));
 }
 function parse(text){
  const out=[];
  for(const line of String(text||'').split('\n')){
   const stripped=line.trim().replace(/^\s*(?:№\s*)?\d{1,3}(?:[.:-]\d{1,3})?[.)]?\s+/, '');
   if(/^(?:итого|всего|общая\s+площадь|сумма|экспликац|наименование|площадь)(?:\s|:|,|$)/iu.test(stripped))continue;
   const m=stripped.match(/^(.*?)[\s:;–—-]+(\d{1,5}(?:\s*[.,]\s*\d{1,2})?)\s*(?:м\s*[²2]|кв\.?\s*м\.?)?\.?\s*$/iu);if(!m)continue;
   const name=m[1].replace(/[\s:;–—-]+$/,'').trim(),value=Number(m[2].replace(/\s/g,'').replace(',','.'));
   if(name.length>=2&&/[а-яёa-z]/iu.test(name)&&value>0&&value<100000)out.push({name,area:value.toFixed(2).replace('.',',')});
  }return out;
 }
 function result(data,width,height){
  const list=words(data),text=lines(list).join('\n')||data.text||'';
  const page=root.CatalogPdfCore.pageFromItems(list,width,height,1,true),tables=root.CatalogPdfCore.tables(page);
  const table=tables.sort((a,b)=>(Number(b.verified)-Number(a.verified))*1000+b.rows.length-a.rows.length)[0];
  return {words:list,text,rows:table?.rows||parse(text),table,confidence:data.confidence};
 }
 function cropped(canvas,list){
  const header=list.find(w=>/наименование/iu.test(w.text));if(!header)return null;
  const h=Math.max(8,header.y1-header.y0),x=Math.max(0,header.x0-5*h),y=Math.max(0,header.y0-2*h),width=canvas.width-x,height=canvas.height-y;
  if(width>canvas.width*.9&&height>canvas.height*.9)return null;
  const scale=Math.min(3,3200/Math.max(width,height)),crop=document.createElement('canvas');crop.width=Math.ceil(width*scale);crop.height=Math.ceil(height*scale);
  crop.getContext('2d').drawImage(canvas,x,y,width,height,0,0,crop.width,crop.height);return {canvas:crop,x,y,scale};
 }
 async function recognize(worker,canvas,{check=()=>{},onProgress=()=>{}}={}){
  let best=null,crop=null;const modes=[3,11,6];
  const score=r=>(r.table?.verified?100000:0)+(r.table?.hasTotal?1000:0)+r.rows.length*100+(r.confidence||0);
  try{for(let i=0;i<modes.length;i++){
   check();onProgress(i+1);if(i===2&&best)crop=cropped(canvas,best.words);
   const target=crop?.canvas||canvas;await worker.setParameters({tessedit_pageseg_mode:modes[i],preserve_interword_spaces:'1'});check();
   const {data}=await worker.recognize(target,{}, {blocks:true,text:true});check();const current=result(data,target.width,target.height);
   if(crop){current.words=current.words.map(w=>({...w,x0:w.x0/crop.scale+crop.x,x1:w.x1/crop.scale+crop.x,y0:w.y0/crop.scale+crop.y,y1:w.y1/crop.scale+crop.y}));current.region={x0:crop.x,y0:crop.y,x1:canvas.width,y1:canvas.height};}
   if(!best||score(current)>score(best))best=current;
   if(best.table?.verified&&best.table.hasTotal)break;
   if(i===1&&best.rows.length>=2)break;
  }return best;}finally{if(crop)crop.canvas.width=crop.canvas.height=0;}
 }
 root.CatalogOcr=Object.freeze({words,lines,parse,result,recognize});
 if(typeof module!=='undefined')module.exports=root.CatalogOcr;
})(typeof window!=='undefined'?window:globalThis);
