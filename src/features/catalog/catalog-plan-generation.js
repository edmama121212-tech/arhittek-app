/* Generation supplies presentation. Measured dimensions are drawn locally. */
(function(root){
 'use strict';
 const VERSION='catalog-generated-1',checks=['walls','openings','stairs','columns','rooms','labels','noArtifacts'];
 function verified(review){
  const b=review?.bounds;
  return review?.confidence>=.97&&review.confidence<=1&&checks.every(k=>review[k]===true)&&Array.isArray(review.issues)&&review.issues.length===0&&
   Array.isArray(b)&&b.length===4&&b.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&b[2]-b[0]>.1&&b[3]-b[1]>.1;
 }
 function client({url,key,token,check=()=>{},fetch:request=root.fetch,delay=ms=>new Promise(r=>setTimeout(r,ms))}){
  const endpoint=url+'/functions/v1/catalog-plan-generate';
  async function call(payload){
   check();const response=await request(endpoint,{method:'POST',headers:{apikey:key,'Content-Type':'application/json','x-session-token':token},body:JSON.stringify(payload)});
   check();const data=await response.json();if(!response.ok||data.error&&!data.state)throw Error(data.error||'Ошибка сервера генерации');return data;
  }
  async function available(){
   check();const response=await request(endpoint,{headers:{apikey:key}});check();
   if(!response.ok)throw Error('Сервер генерации недоступен');
   const data=await response.json();
   if(data.version!==VERSION)return false;
   if(!data.configured)throw Error('Не подключена генерация: проверьте OPENAI_API_KEY на сервере');
   return true;
  }
  async function generate(source,manifest,onProgress=()=>{}){
   let result=await call({action:'start',source,manifest});
   if(result.state==='failed')result=await call({action:'retry',id:result.id});
   const started=Date.now();
   for(;;){
    check();if(Date.now()-started>600000)throw Error('Генерация заняла больше времени. Повторный импорт проверит готовое задание');
    onProgress(result.state,result.attempt);
    if(result.state==='approved'){
     if(result.version!==VERSION||!verified(result.review)||JSON.stringify(result.manifest)!==JSON.stringify({version:VERSION,...manifest})||!result.image?.startsWith('data:image/png;base64,'))throw Error('Сервер не подтвердил соответствие плана');
     return result;
    }
    if(result.state==='failed')throw Error(result.error||'Генерация не завершилась');
    if(result.state==='rejected'&&result.attempt>=2)throw Error('План не прошёл проверку: '+(result.review?.issues||[]).join('. '));
    if(!['generating','generated','reviewing','rejected'].includes(result.state))throw Error('Неизвестный статус генерации');
    const action=result.state==='generated'?'review':result.state==='rejected'?'retry':'status';
    await delay(1500);check();result=await call({action,id:result.id});
   }
  }
  return {available,generate};
 }
 function drawDimensions(image,manifest,bounds,createCanvas=()=>document.createElement('canvas')){
  if(![manifest.widthMm,manifest.heightMm].every(n=>Number.isFinite(n)&&n>=500&&n<=500000))throw Error('Не подтверждены общие размеры');
  const canvas=createCanvas(),pad=Math.ceil(Math.max(image.width,image.height)*.07);
  canvas.width=image.width+pad*2;canvas.height=image.height+pad*2;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,pad,pad);
  const [x0,y0,x1,y1]=bounds.map((n,i)=>pad+n*(i%2?image.height:image.width));
  const dx=pad*.5,dy=pad+image.height+pad*.45,stroke=Math.max(1,image.width/1200),font=Math.max(16,image.width*.016);
  ctx.strokeStyle='#6d716c';ctx.fillStyle='#464d48';ctx.lineWidth=stroke;ctx.font='500 '+font+'px Arial, sans-serif';ctx.textAlign='center';
  ctx.beginPath();ctx.moveTo(x0,dy);ctx.lineTo(x1,dy);ctx.moveTo(dx,y0);ctx.lineTo(dx,y1);ctx.stroke();
  ctx.strokeStyle='#b6bcb7';ctx.beginPath();
  for(const x of [x0,x1]){ctx.moveTo(x,y1+6);ctx.lineTo(x,dy+5);ctx.moveTo(x-4,dy+4);ctx.lineTo(x+4,dy-4);}
  for(const y of [y0,y1]){ctx.moveTo(dx-5,y);ctx.lineTo(x0-6,y);ctx.moveTo(dx-4,y+4);ctx.lineTo(dx+4,y-4);}
  ctx.stroke();
  const label=n=>(n/1000).toLocaleString('ru-RU',{maximumFractionDigits:3})+' м';
  ctx.fillText(label(manifest.widthMm),(x0+x1)/2,dy+font*1.35);
  ctx.save();ctx.translate(dx-font*.6,(y0+y1)/2);ctx.rotate(-Math.PI/2);ctx.fillText(label(manifest.heightMm),0,0);ctx.restore();
  return canvas;
 }
 async function prepare({source,connection,check=()=>{},onProgress=()=>{}}){
  if(!source.ok)return source;
  const manifest={floor:source.key,rooms:source.rooms,widthMm:source.report.widthMm,heightMm:source.report.heightMm};
  const result=await connection.generate(source.image,manifest,onProgress);check();
  const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Не удалось открыть сгенерированный план'));img.src=result.image;});check();
  const canvas=drawDimensions(image,manifest,result.review.bounds);
  const full=canvas.toDataURL('image/png'),thumb=document.createElement('canvas');thumb.width=270;thumb.height=Math.round(270*canvas.height/canvas.width);thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);
  const thumbnail=thumb.toDataURL('image/jpeg',.86),quality=CatalogQuality.reviewGeneratedPlan({image:full,rows:source.rooms,review:result.review,dimensions:manifest,jobId:result.id});
  canvas.width=canvas.height=thumb.width=thumb.height=0;check();
  return {ok:quality.passed,image:full,thumbnail,reason:quality.issues.join('. '),report:{...source.report,style:VERSION,renderer:'ai-furnished-source-reviewed',sourceGeometry:false,quality,serverJobId:result.id,review:result.review,rooms:source.rooms.length,roomNames:source.rooms.map(r=>r.name)}};
 }
 root.CatalogPlanGeneration=Object.freeze({version:VERSION,client,verified,drawDimensions,prepare});
 if(typeof module!=='undefined'&&module.exports)module.exports=root.CatalogPlanGeneration;
})(typeof window!=='undefined'?window:globalThis);
