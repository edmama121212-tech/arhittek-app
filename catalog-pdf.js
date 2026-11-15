(function(root){
 'use strict';
 const VERSION='catalog-quality-1';
 function fingerprint(value){let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
 function scheduleFingerprint(rows){return fingerprint(JSON.stringify((rows||[]).map(r=>[String(r.name||'').toLowerCase().replace(/\s+/g,' ').trim(),Number(String(r.area).replace(',','.')).toFixed(2)])));}
 function reviewPlan({roomSchedule,image,wallSamples,wallLost,labelsComplete,details,wallCount,dimensions}){
  const checks={sourceWalls:wallCount>0,wallIntegrity:wallSamples>20&&wallLost/wallSamples<=.004,roomLabels:!!labelsComplete,stairScope:(details?.stairs||0)<3000,approvedPrimitives:!!details&&Object.keys(details).every(k=>['stairs','doors','windows'].includes(k))};
  const reasons={sourceWalls:'Не подтверждены стены исходного плана',wallIntegrity:'Подписи или графика перекрывают контур стен',roomLabels:'Не все помещения подписаны достоверно',stairScope:'Слишком много графики распознано как лестница',approvedPrimitives:'В плане обнаружены неподтверждённые элементы'};
  const issues=Object.keys(checks).filter(k=>!checks[k]).map(k=>reasons[k]);
  return {version:VERSION,passed:!issues.length,checks,issues,wallLoss:wallSamples?wallLost/wallSamples:1,dimensionsConfirmed:dimensions?.widthMm>0&&dimensions?.heightMm>0,imageFingerprint:fingerprint(image),scheduleFingerprint:roomSchedule?scheduleFingerprint(roomSchedule):null};
 }
 const floors=[['basement','basement_area','expl_basement',5,'Цоколь'],['floor1','floor1_area','expl1',2,'1-й этаж'],['floor2','floor2_area','expl2',3,'2-й этаж'],['floor3','floor3_area','expl3',4,'3-й этаж']];
 const num=s=>Number(String(s??'').replace(/\s/g,'').replace(',','.'));
 function reviewCard(card,meta,{strict=!!meta}={}){
  const issues=[],plans=meta?.sources?.plans||{};
  if(!strict)return {version:VERSION,passed:true,issues:[],scope:'manual-card'};
  if(!String(card.project_number||'').trim())issues.push('Укажите номер проекта');
  else if(!/^[\p{L}\d][\p{L}\d._\/-]{0,39}$/u.test(String(card.project_number).trim()))issues.push('В номере проекта есть лишний текст или недопустимые символы');
  if(!String(card.title||'').replace(/^Проект\s*№.*?—\s*/u,'').trim())issues.push('Укажите название проекта');
  if(!Number.isInteger(+card.floors)||+card.floors<1||+card.floors>3)issues.push('Укажите от 1 до 3 надземных этажей');
  if(!(num(card.total_area)>0))issues.push('Не подтверждена общая площадь');
  if(card.price&&!Number.isFinite(num(card.price))||card.price&&num(card.price)<0)issues.push('Цена должна быть корректным неотрицательным числом');
  if(!card.images?.[0])issues.push('Не добавлена визуализация фасада');
  const active=floors.filter(([key])=>key==='basement'?(card.tags||[]).includes('Цокольный этаж'):+key.slice(5)<=+card.floors),rooms=[];let total=0;
  for(const [key,areaId,rowsId,slot,label]of active){
   const rows=card[rowsId]||[],area=num(card[areaId]);rooms.push(...rows);
   if(!rows.length||rows.some(r=>!r.name?.trim()||!(num(r.area)>0)))issues.push(label+': нужна полная экспликация с площадями');
   const sum=rows.reduce((n,r)=>n+num(r.area),0);if(!(area>0)||!Number.isFinite(sum)||Math.abs(sum-area)>.03)issues.push(label+': площадь не совпадает с суммой помещений');total+=area;
   if(!card.images?.[slot])issues.push(label+': не добавлен проверенный план');
   else {const report=plans[key],q=report?.quality;
    if(!q?.passed||q.version!==VERSION)issues.push(label+': план не прошёл автоматическую проверку качества; загрузите исходный PDF');
    else {if(report.rooms!==rows.length||report.roomNames?.length!==rows.length)issues.push(label+': подписи плана не соответствуют экспликации');if(q.scheduleFingerprint&&q.scheduleFingerprint!==scheduleFingerprint(rows))issues.push(label+': экспликация изменена после проверки плана');if(!['sourceWalls','wallIntegrity','roomLabels','stairScope','approvedPrimitives'].every(k=>q.checks?.[k]===true)||!q.dimensionsConfirmed)issues.push(label+': не подтверждены контуры, подписи или общие размеры');if(String(card.images[slot]).startsWith('data:')&&fingerprint(card.images[slot])!==q.imageFingerprint)issues.push(label+': изображение изменено после проверки');}
   }
  }
  if(!Number.isFinite(total)||Math.abs(total-num(card.total_area))>.05)issues.push('Общая площадь не совпадает с суммой площадей этажей');
  const beds=rooms.filter(r=>/спальн|^сп(?:\s|[-–—.]|\d|$)|детск/iu.test(r.name)).length,baths=rooms.filter(r=>/^(?:с\s*[\/.]?\s*у)(?:\s|[-–.]|\d|$)|сануз|ванн|душев|туалет/iu.test(r.name)).length;
  if(Number(card.beds||0)!==beds)issues.push('Количество спален не совпадает с экспликациями');if(Number(card.baths||0)!==baths)issues.push('Количество санузлов не совпадает с экспликациями');
  return {version:VERSION,passed:!issues.length,issues:[...new Set(issues)],scope:'pdf-card'};
 }

 function show(review){const box=document.getElementById('ce-quality-status');if(!box)return;box.hidden=false;box.textContent=review.passed?(review.scope==='manual-card'?'Заполненные данные проверены. Автоматическая проверка геометрии доступна для планов из PDF.':'Проверка пройдена: планы, экспликации и данные согласованы. Можно сохранить проект.'):'Сохранение заблокировано. Исправьте:\n• '+review.issues.join('\n• ');box.style.whiteSpace='pre-line';}
 function checkEditor(){
  const value=id=>document.getElementById(id)?.value||'',card={project_number:value('ce-num'),title:value('ce-title'),floors:ceFloorsSelected,total_area:value('ce-area'),price:value('ce-price'),beds:value('ce-beds'),baths:value('ce-baths'),tags:ceFeatureSelected.includes('basement')?['Цокольный этаж']:[],images:ceImages};
  for(const f of CatalogFloors.definitions){card[f.area]=value('ce-area'+f.suffix);card[f.rooms]=parseExpl(value('ce-expl'+f.suffix));}
  let meta=cePdfImportMeta||cardsData.find(c=>c.id===ceCurrentId)?.pdf_import_meta;const screenshots=typeof ceScreenshotPlans==='undefined'?{}:ceScreenshotPlans;if(Object.keys(screenshots).length)meta={...meta,sources:{...meta?.sources,plans:{...meta?.sources?.plans,...screenshots}}};
  const review=reviewCard(card,meta);show(review);return review;
 }
 // An already open pre-quality shell still owns its older inline saveCard.
 // Attach the current publication gate when an import is applied, after that
 // shell has finished declaring its functions. No page reload or draft loss.
 function protectSave(){
  const original=root.saveCard;if(typeof original!=='function'||original.catalogQualityGuard)return;
  const legacyImporter=root.CatalogPdfImport&&root.CatalogPdfImport.draftOnly!==true;let userSave=false;
  if(legacyImporter&&typeof document!=='undefined')document.addEventListener('click',event=>{if(event.isTrusted&&event.target?.closest?.('#ce-save-btn'))userSave=true;},true);
  async function guardedSave(...args){
   if(legacyImporter&&!userSave)return {ok:false,awaitingManualSave:true};userSave=false;
   if(typeof canEditCards==='function'&&!canEditCards())return original.apply(this,args);
   const review=checkEditor();if(!review.passed){if(typeof showToast==='function')showToast('Сохранение заблокировано: нужна проверка карточки');return {ok:false,qualityBlocked:true,error:review.issues.join('. ')};}
   return original.apply(this,args);
  }
  guardedSave.catalogQualityGuard=true;root.saveCard=guardedSave;
 }
 root.CatalogQuality=Object.freeze({version:VERSION,fingerprint,scheduleFingerprint,reviewPlan,reviewCard,show,checkEditor,protectSave});
 if(typeof module!=='undefined')module.exports=root.CatalogQuality;
})(typeof window!=='undefined'?window:globalThis);
(function(root){
  'use strict';
  const PDF_BASE='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/';
  let pdfPromise=null,planPromise=null,active=null;
  const abort=()=>new DOMException('Импорт отменён','AbortError');
  function check(job){if(job.cancelled||job.shouldStop?.())throw abort();}
  function progress(job,text,value){check(job);job.onProgress?.(text,value);}
  async function library(){
    if(!pdfPromise)pdfPromise=import(PDF_BASE+'legacy/build/pdf.min.mjs').then(p=>{p.GlobalWorkerOptions.workerSrc=PDF_BASE+'legacy/build/pdf.worker.min.mjs';return p;}).catch(()=>{pdfPromise=null;throw new Error('Не удалось загрузить обработчик PDF. Проверьте интернет и повторите загрузку');});
    return pdfPromise;
  }
  function pdfItems(pdfjs,page,content){
    const v=page.getViewport({scale:1});
    return content.items.filter(i=>i.str?.trim()).map(i=>{
      const t=pdfjs.Util.transform(v.transform,i.transform),len=Math.hypot(t[0],t[1])||1,dx=t[0]/len,dy=t[1]/len,h=i.height||len;
      const points=[[t[4],t[5]],[t[4]+dx*i.width,t[5]+dy*i.width],[t[4]+dy*h,t[5]-dx*h],[t[4]+dx*i.width+dy*h,t[5]+dy*i.width-dx*h]];
      return {text:i.str,x0:Math.min(...points.map(p=>p[0])),x1:Math.max(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),y1:Math.max(...points.map(p=>p[1])),vertical:Math.abs(dy)>.7};
    });
  }
  async function readTextContent(page,job){
    check(job);
    // PDF.js getTextContent() uses ReadableStream async iteration, absent in
    // shipping Safari versions. The reader API works there without global patches.
    const reader=page.streamTextContent().getReader(),content={items:[],styles:Object.create(null),lang:null};
    let finished=false;job.textReader=reader;
    try{
      for(;;){
        check(job);const {value,done}=await reader.read();check(job);
        if(done){finished=true;return content;}
        content.lang??=value.lang;Object.assign(content.styles,value.styles);content.items.push(...value.items);
      }
    }finally{
      if(!finished)await reader.cancel().catch(()=>{});
      reader.releaseLock();if(job.textReader===reader)job.textReader=null;
    }
  }
  async function render(doc,n,side,job){
    check(job);const page=await doc.getPage(n),base=page.getViewport({scale:1}),v=page.getViewport({scale:side/Math.max(base.width,base.height)});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);
    try{job.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:v,background:'rgb(255,255,255)'});await job.renderTask.promise;check(job);return canvas;}
    catch(e){canvas.width=canvas.height=0;throw e;}
    finally{job.renderTask=null;page.cleanup();}
  }
  function photo(canvas,bounds,info){
    const x=bounds?Math.max(0,Math.floor(bounds.x0*canvas.width/info.width)):0,y=bounds?Math.max(0,Math.floor(bounds.y0*canvas.height/info.height)):0,w=bounds?Math.min(canvas.width-x,Math.ceil((bounds.x1-bounds.x0)*canvas.width/info.width)):canvas.width,h=bounds?Math.min(canvas.height-y,Math.ceil((bounds.y1-bounds.y0)*canvas.height/info.height)):canvas.height;
    if(w<1||h<1)return false;const d=canvas.getContext('2d').getImageData(x,y,w,h).data;let colored=0,ink=0,count=0;
    for(let i=0;i<d.length;i+=32){count++;const max=Math.max(d[i],d[i+1],d[i+2]),min=Math.min(d[i],d[i+1],d[i+2]);if(min<235)ink++;if(max-min>24)colored++;}
    return ink/count>.5||colored/count>.18;
  }
  function imageRegions(pdfjs,operators,viewport){
    const O=pdfjs.OPS,out=[],stack=[];let matrix=[1,0,0,1,0,0];
    const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
    for(let i=0;i<operators.fnArray.length;i++){
      const op=operators.fnArray[i],args=operators.argsArray[i];
      if(op===O.save)stack.push(matrix.slice());else if(op===O.restore)matrix=stack.pop()||[1,0,0,1,0,0];
      else if(op===O.transform)matrix=multiply(matrix,args);
      else if(op===O.paintFormXObjectBegin){stack.push(matrix.slice());if(args[0])matrix=multiply(matrix,args[0]);}
      else if(op===O.paintFormXObjectEnd)matrix=stack.pop()||[1,0,0,1,0,0];
      else if(op===O.paintImageXObject||op===O.paintInlineImageXObject){
        const points=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>viewport.convertToViewportPoint(matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]));
        const r={x0:Math.max(0,Math.min(...points.map(p=>p[0]))),y0:Math.max(0,Math.min(...points.map(p=>p[1]))),x1:Math.min(viewport.width,Math.max(...points.map(p=>p[0]))),y1:Math.min(viewport.height,Math.max(...points.map(p=>p[1])))};
        if((r.x1-r.x0)*(r.y1-r.y0)>viewport.width*viewport.height*.045&&r.x1-r.x0>viewport.width*.12&&r.y1-r.y0>viewport.height*.1&&!out.some(b=>Math.abs(b.x0-r.x0)+Math.abs(b.y0-r.y0)+Math.abs(b.x1-r.x1)+Math.abs(b.y1-r.y1)<2))out.push(r);
      }
    }return out;
  }
  function exportImage(canvas,info,isPlan,bounds){
    const ctx=canvas.getContext('2d'),sx=canvas.width/info.width,sy=canvas.height/info.height;
    ctx.fillStyle='#fff';
    for(const w of info.items.filter(w=>/GSPublisherVersion/i.test(w.text)))ctx.fillRect(Math.max(0,w.x0*sx-3),Math.max(0,w.y0*sy-3),(w.x1-w.x0)*sx+6,(w.y1-w.y0)*sy+6);
    if(bounds){ctx.fillRect(0,0,canvas.width,Math.max(0,bounds.y0*sy));ctx.fillRect(0,bounds.y1*sy,canvas.width,canvas.height);ctx.fillRect(0,0,Math.max(0,bounds.x0*sx),canvas.height);ctx.fillRect(bounds.x1*sx,0,canvas.width,canvas.height);}
    if(isPlan){
      // Remove only the long, thin outer sheet frame before finding the drawing bounds.
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),d=pixels.data,W=canvas.width,H=canvas.height;
      for(let x=0;x<W;x++)if(x<W*.08||x>W*.92){let ink=0;for(let y=0;y<H;y+=3){const i=(y*W+x)*4;if(d[i]<190&&d[i+1]<190&&d[i+2]<190)ink++;}if(ink>H/3*.8)ctx.fillRect(x-2,0,5,H);}
      for(let y=0;y<H;y++)if(y<H*.04||y>H*.96){let ink=0;for(let x=0;x<W;x+=3){const i=(y*W+x)*4;if(d[i]<190&&d[i+1]<190&&d[i+2]<190)ink++;}if(ink>W/3*.45)ctx.fillRect(0,y-2,W,5);}
      const stamp=info.items.filter(w=>w.cy>info.height*.7&&/^(стадия|изм\.?|кол\.уч\.?|подп\.?|дата|№док\.?)$/iu.test(w.text));
      if(stamp.length){const x=Math.min(...stamp.map(w=>w.x0))-info.width*.01,y=Math.min(...stamp.map(w=>w.y0))-info.height*.075;ctx.fillRect(x*sx,y*sy,canvas.width-x*sx,canvas.height-y*sy);}
      const table=info.tables?.find(t=>t.left>info.width*.55);
      if(table)ctx.fillRect((table.left-info.width*.012)*sx,0,canvas.width,canvas.height);
      const lowerTable=info.tables?.find(t=>t.top>info.height*.7);
      const legend=info.items.find(w=>/условные\s+обозначения/iu.test(w.text)&&w.y0>info.height*.6);
      if(lowerTable&&legend)ctx.fillRect(0,(Math.min(lowerTable.top-info.height*.05,legend.y0)-info.height*.01)*sy,canvas.width,canvas.height);
    }
    const W=canvas.width,H=canvas.height,d=ctx.getImageData(0,0,W,H).data;let x0=W,y0=H,x1=0,y1=0;
    for(let y=0;y<H;y+=2)for(let x=0;x<W;x+=2){const i=(y*W+x)*4;if(Math.min(d[i],d[i+1],d[i+2])<225){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}
    if(x1<=x0||y1<=y0)throw new Error('На выбранном листе нет изображения');
    x0=Math.max(0,x0-12);y0=Math.max(0,y0-12);x1=Math.min(W,x1+14);y1=Math.min(H,y1+14);
    const crop=document.createElement('canvas');crop.width=x1-x0;crop.height=y1-y0;
    crop.getContext('2d').drawImage(canvas,x0,y0,crop.width,crop.height,0,0,crop.width,crop.height);
    const image=crop.toDataURL('image/jpeg',.92),thumb=document.createElement('canvas'),scale=240/Math.max(crop.width,crop.height);
    thumb.width=Math.max(1,Math.round(crop.width*scale));thumb.height=Math.max(1,Math.round(crop.height*scale));thumb.getContext('2d').drawImage(crop,0,0,thumb.width,thumb.height);
    const thumbnail=thumb.toDataURL('image/jpeg',.75);crop.width=crop.height=thumb.width=thumb.height=0;
    return {image,thumbnail};
  }
  async function ocrPage(doc,pageInfo,job,region,{mergeNative=false,digitsOnly=false}={}){
    if(!job.ocrWorker){
      progress(job,'Подготавливаю распознавание таблиц…',40);await loadTesseractScript();check(job);
      job.ocrWorker=await Tesseract.createWorker('rus+eng',Tesseract.OEM.LSTM_ONLY,{logger:m=>{if(m.status==='recognizing text'&&!job.cancelled)job.onProgress?.('Распознаю таблицу, страница '+pageInfo.page+'…',45);}});check(job);
    }
    const page=await doc.getPage(pageInfo.page),base=page.getViewport({scale:1}),box=region||{x0:0,y0:0,x1:base.width,y1:base.height},scale=3000/Math.max(box.x1-box.x0,box.y1-box.y0),viewport=page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil((box.x1-box.x0)*scale);canvas.height=Math.ceil((box.y1-box.y0)*scale);
    try{
      job.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-box.x0*scale,-box.y0*scale],background:'rgb(255,255,255)'});await job.renderTask.promise;job.renderTask=null;check(job);
      if(digitsOnly)await job.ocrWorker.setParameters({tessedit_char_whitelist:'0123456789'});
      const recognized=await CatalogOcr.recognize(job.ocrWorker,canvas,{check:()=>check(job),onProgress:pass=>progress(job,'Перечитываю таблицу: лист '+pageInfo.page+', проход '+pass,45)});
      const words=recognized.words.map(w=>({...w,x0:w.x0/scale+box.x0,x1:w.x1/scale+box.x0,y0:w.y0/scale+box.y0,y1:w.y1/scale+box.y0}));
      const native=mergeNative?pageInfo.items:region?pageInfo.items.filter(w=>w.cx<box.x0||w.cx>box.x1||w.cy<box.y0||w.cy>box.y1):[];
      const fresh=mergeNative?words.filter(w=>!native.some(n=>String(n.text).replace(/\s/g,'')===String(w.text).replace(/\s/g,'')&&Math.abs(n.cx-(w.x0+w.x1)/2)<Math.max(n.h,w.y1-w.y0)&&Math.abs(n.cy-(w.y0+w.y1)/2)<Math.max(n.h,w.y1-w.y0))):words;
      const result=CatalogPdfCore.pageFromItems([...native,...fresh],pageInfo.width,pageInfo.height,pageInfo.page,true);result.confidence=recognized.confidence;return result;
    }finally{if(digitsOnly)await job.ocrWorker.setParameters({tessedit_char_whitelist:''});job.renderTask=null;canvas.width=canvas.height=0;page.cleanup();}
  }
  function tableRegion(info,table){
    const header=info.items.find(w=>/^наименование/iu.test(w.text));if(!table&&!header)return null;
    const h=header?.h||10,left=table?.left??header.x0-h*4,top=table?.top??header.y0;
    const area=info.items.find(w=>/^площадь/iu.test(w.text)&&w.x0>left&&Math.abs(w.cy-top)<h*3);
    return {x0:Math.max(0,left-h*2),y0:Math.max(0,top-h*3),x1:Math.min(info.width,(table?.right??area?.x1??info.width)+h*4),y1:info.height};
  }
  async function ocrRoomMarkers(doc,info,job,region,markers){
    if(!job.ocrWorker)return info;
    const page=await doc.getPage(info.page),scale=3000/Math.max(region.x1-region.x0,region.y1-region.y0),canvas=document.createElement('canvas'),strip=document.createElement('canvas');
    canvas.width=Math.ceil((region.x1-region.x0)*scale);canvas.height=Math.ceil((region.y1-region.y0)*scale);
    try{
      job.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale}),transform:[1,0,0,1,-region.x0*scale,-region.y0*scale],background:'#fff'});await job.renderTask.promise;job.renderTask=null;check(job);
      // Room bubbles can be fragmented paths or raster glyphs, invisible to
      // text extraction. Find closed circular ink components in the source.
      const W=canvas.width,H=canvas.height,pixels=canvas.getContext('2d').getImageData(0,0,W,H).data,seen=new Uint8Array(W*H),circles=[];
      const ink=i=>pixels[i*4]<220&&pixels[i*4+1]<220&&pixels[i*4+2]<220;
      for(let seed=0;seed<seen.length;seed++){
        if(seen[seed]||!ink(seed))continue;const queue=[seed];seen[seed]=1;let minX=W,maxX=0,minY=H,maxY=0;
        for(let n=0;n<queue.length;n++){const i=queue[n],x=i%W,y=Math.floor(i/W);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
          for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||x+dx<0||x+dx>=W||y+dy<0||y+dy>=H)continue;const q=i+dy*W+dx;if(!seen[q]&&ink(q)){seen[q]=1;queue.push(q);}}
        }
        const w=maxX-minX,h=maxY-minY,cx=(minX+maxX)/2,cy=(minY+maxY)/2,r=(w+h)/4;
        if(w<15||w>Math.min(W,H)*.09||Math.abs(w/h-1)>.12||queue.length<25||queue.length>w*h*.3)continue;
        if(queue.filter(i=>Math.abs(Math.hypot(i%W-cx,Math.floor(i/W)-cy)/r-1)<.16).length<queue.length*.94)continue;
        circles.push({x0:region.x0+minX/scale,y0:region.y0+minY/scale,x1:region.x0+maxX/scale,y1:region.y0+maxY/scale});
      }
      if(circles.length>=3){const groups=circles.map(b=>circles.filter(q=>Math.abs((q.x1-q.x0)/(b.x1-b.x0)-1)<.15)).sort((a,b)=>b.length-a.length);if(groups[0].length>=3)markers=groups[0];}
      if(markers.length<3){info.markerRecovery={detected:markers.length,decoded:0};return info;}
      strip.width=180;strip.height=markers.length*110;
      const ctx=strip.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,strip.width,strip.height);
      markers.forEach((b,i)=>{const w=b.x1-b.x0,h=b.y1-b.y0;ctx.drawImage(canvas,(b.x0-region.x0+w*.19)*scale,(b.y0-region.y0+h*.22)*scale,w*.62*scale,h*.56*scale,34,i*110+20,112,70);});
      await job.ocrWorker.setParameters({tessedit_pageseg_mode:6,tessedit_char_whitelist:'0123456789',preserve_interword_spaces:'1'});
      const {data}=await job.ocrWorker.recognize(strip,{}, {blocks:true,text:true});check(job);
      const decoded=CatalogOcr.words(data).filter(w=>/^\d{1,3}$/.test(w.text)&&w.confidence>=40),items=[];
      for(let i=0;i<markers.length;i++){
        const matches=decoded.filter(w=>Math.floor((w.y0+w.y1)/2/110)===i);if(matches.length!==1)continue;
        const b=markers[i],h=(b.y1-b.y0)*.45,cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2,w=matches[0];items.push({text:w.text,confidence:w.confidence,markerVerified:true,x0:cx-h*.3*w.text.length,x1:cx+h*.3*w.text.length,y0:cy-h/2,y1:cy+h/2});
      }
      const recovered=CatalogPdfCore.pageFromItems([...info.items,...items],info.width,info.height,info.page,true);recovered.markerRecovery={detected:markers.length,decoded:items.length,ids:items.map(w=>w.text)};return recovered;
    }finally{await job.ocrWorker.setParameters({tessedit_char_whitelist:''});canvas.width=canvas.height=strip.width=strip.height=0;page.cleanup();}
  }
  async function read(file,options={}){
    const job=options.job||{...options,cancelled:false};let task;
    try{
      if(!file||file.size===0)throw new Error('PDF-файл пуст');
      if(!(await file.slice(0,1024).text()).includes('%PDF-'))throw new Error('Выберите PDF-файл архитектурного альбома');
      progress(job,'Открываю PDF…',2);const pdfjs=await library();check(job);
      const prepared=await CatalogPdfIO.prepare(file,job);check(job);
      progress(job,'Проверяю альбом…',3);const sha256=await CatalogPdfIO.hash(file,job);
      const source=await CatalogPdfIO.rangeSource(pdfjs,prepared.file,job);check(job);
      task=pdfjs.getDocument({...source,isEvalSupported:false,enableXfa:false,stopAtErrors:true,canvasMaxAreaInBytes:16*1024*1024,standardFontDataUrl:PDF_BASE+'standard_fonts/',cMapUrl:PDF_BASE+'cmaps/',cMapPacked:true,wasmUrl:PDF_BASE+'wasm/'});job.loadingTask=task;
      const doc=await task.promise;check(job);
      if(doc.numPages>160)throw new Error('В альбоме больше 160 страниц. Загрузите отдельно архитектурную часть');
      let pages=[];
      for(let n=1;n<=doc.numPages;n++){
        progress(job,'Читаю листы: '+n+' из '+doc.numPages,5+n/doc.numPages*30);
        const page=await doc.getPage(n),v=page.getViewport({scale:1}),content=await readTextContent(page,job);check(job);
        pages.push(CatalogPdfCore.pageFromItems(pdfItems(pdfjs,page,content),v.width,v.height,n));page.cleanup();
      }
      const meaningful=p=>p.text.replace(/GSPublisherVersion[^\n]*/g,'').trim().length>80;
      const withText=pages.filter(meaningful),mostlyScanned=withText.length<Math.min(3,pages.length/3),lastText=withText.at(-1)?.page||0;let unlabelledPhotos=0;
      for(let i=0;i<pages.length;i++)if(!meaningful(pages[i])){
        const p=pages[i];check(job);if(!mostlyScanned&&p.page>lastText&&unlabelledPhotos>=2)continue;progress(job,'Проверяю лист '+p.page+' из '+pages.length,36+i/pages.length*15);
        const thumbnail=await render(doc,p.page,640,job),isPhoto=photo(thumbnail);thumbnail.width=thumbnail.height=0;
        if(isPhoto){p.photoHint=true;unlabelledPhotos++;continue;}
        if(mostlyScanned||p.page>1&&p.page<lastText)pages[i]=await ocrPage(doc,p,job);
      }
      let result=CatalogPdfCore.analyze(pages);check(job);
      const quality=r=>Object.values(r.levels).filter(l=>l.table?.verified).length*1000-r.blocking.length;
      // Native PDF text can be incomplete even on an otherwise textual sheet.
      // Re-read only failed/missing floor tables, never every page of the album.
      const recoveryWarnings=[],retryPages=[...new Set(Object.values(result.levels).filter(l=>!l.table?.verified).map(l=>l.table?.page||l.plan?.page).filter(Boolean))];
      for(const n of retryPages.slice(0,4)){
        const old=pages[n-1];if(old.ocr)continue;check(job);
        const table=Object.values(result.levels).find(l=>l.table?.page===n&&!l.table.verified)?.table;
        try{const replacement=await ocrPage(doc,old,job,tableRegion(old,table)),trialPages=pages.map(p=>p.page===n?replacement:p),trial=CatalogPdfCore.analyze(trialPages);
          if(quality(trial)>quality(result)){pages=trialPages;result=trial;}
        }catch(e){if(e.name==='AbortError')throw e;recoveryWarnings.push('Не удалось повторно распознать таблицу на листе '+n+'. Проверьте её вручную');}
      }
      result.warnings.push(...recoveryWarnings);
      const folderNumber=options.projectNumber||CatalogPdfCore.folderNumber(options.sourceFolder||file.webkitRelativePath);
      if(folderNumber&&/^\d{4,5}$/.test(folderNumber)){
        result.data.project_number=folderNumber;result.sources.project_number={from:'folder',value:folderNumber};
        result.blocking=result.blocking.filter(w=>!/^Номер проекта:|Не указан номер проекта/iu.test(w));
        result.warnings=result.warnings.filter(w=>!/^Номер проекта выбран/iu.test(w));
      }

      const facadeCandidates=[],isVisual=p=>/визуализац|перспектив|экстерьер|общий\s+вид|3[dд]\s*вид/iu.test(p.text);
      for(const p of pages.slice().sort((a,b)=>Number(isVisual(b))-Number(isVisual(a))||Number(meaningful(a))-Number(meaningful(b))||a.page-b.page)){
        check(job);if(CatalogPdfCore.planInfos(p,result.data.floors).length||p.tables.length)continue;
        const technical=!isVisual(p)&&(/разрез|генплан|генеральный\s+план|стропильн|план\s+(?:фундамента|кровли)|монолитное\s+перекрытие/iu.test(p.text)||/фасад/iu.test(p.text)&&p.items.filter(w=>/^[+−-]?\d{1,2}[.,]\d{3}$/.test(w.text)).length>=2);if(technical)continue;
        if(p.photoHint){facadeCandidates.push({page:p.page,bounds:null,score:p.page>2?30:10});if(facadeCandidates.filter(f=>f.page>2).length>=2)break;continue;}
        const page=await doc.getPage(p.page),viewport=page.getViewport({scale:1});let regions;
        try{regions=imageRegions(pdfjs,await page.getOperatorList(),viewport);}catch(e){page.cleanup();throw e;}
        const named=isVisual(p);
        if(!regions.length&&meaningful(p)&&!named){page.cleanup();continue;}
        progress(job,'Ищу фасады: лист '+p.page+' из '+pages.length,56);
        const thumbnail=await render(doc,p.page,640,job);
        try{for(const bounds of regions.length?regions:[null])if(photo(thumbnail,bounds,p)){
          const coverage=bounds?(bounds.x1-bounds.x0)*(bounds.y1-bounds.y0)/(p.width*p.height):1;
          facadeCandidates.push({page:p.page,bounds,score:(named?100:0)+(p.page>2?20:0)+coverage*10});
        }}finally{thumbnail.width=thumbnail.height=0;}
        if(facadeCandidates.filter(f=>f.page>2).length>=2)break;
      }
      const selected=facadeCandidates.sort((a,b)=>b.score-a.score||a.page-b.page).slice(0,2),facades=selected.map(f=>f.page);
      const usedPages=new Set(Object.values(result.levels).map(l=>l.table?.page));
      if(pages.some(p=>usedPages.has(p.page)&&p.ocr&&(!Number.isFinite(p.confidence)||p.confidence<70)))result.blocking.push('Качество скана требует проверки распознанных данных');
      const optionalContent=await doc.getOptionalContentConfig({intent:'display'});check(job);
      const images=CatalogFloors.slots(),thumbnails=CatalogFloors.slots();
      if(!facades.length)result.blocking.push('Не найдена визуализация фасада');
      const assets=[...selected.map((f,index)=>({...f,index,plan:false})),...CatalogFloors.definitions.filter(f=>result.levels[f.key]?.plan).map(f=>({page:result.levels[f.key].plan.page,index:f.image,key:f.key,plan:true}))];
      for(let i=0;i<assets.length;i++){
        const asset=assets[i];progress(job,asset.plan?'Извлекаю план, страница '+asset.page+'…':'Извлекаю визуализацию, страница '+asset.page+'…',65+i/assets.length*25);
        if(asset.plan){
          progress(job,'Оформляю чистый план: '+(asset.key==='basement'?'цоколь':asset.key.slice(5)+'-й этаж')+'…',65+i/assets.length*25);
          planPromise??=import('./catalog-plan.js').catch(e=>{planPromise=null;throw e;});await planPromise;check(job);
          const candidates=[...new Set([asset.page,...(result.levels[asset.key].planCandidates||[]).map(p=>p.page)])].slice(0,8);
          let failure=null;const attempts=[];
          for(const candidate of candidates){
          progress(job,'Перепроверяю план: попытка '+(attempts.length+1)+' из '+candidates.length+'…',65+i/assets.length*25);
          const page=await doc.getPage(candidate);
          try{
            let prepared=await CatalogPlan.prepare({pdfjs,page,info:pages[candidate-1],table:result.levels[asset.key].table,key:asset.key,optionalContent,reference:asset.key!=='floor1'?result.sources.plans?.floor1:null,knownFootprint:result.sources.footprint?.from==='dimension_lines'?{value:result.data.footprint,page:result.sources.footprint.page}:null,check:()=>check(job)});check(job);
            if(!prepared.ok&&prepared.code==='room-labels'&&prepared.region&&!job.planOcrUnavailable){
              try{
              progress(job,'Распознаю номера и подписи комнат на плане, лист '+candidate+'…',70);
              const recovered=await ocrPage(doc,pages[candidate-1],job,prepared.region,{mergeNative:true});check(job);
              prepared=await CatalogPlan.prepare({pdfjs,page,info:recovered,table:result.levels[asset.key].table,key:asset.key,optionalContent,reference:asset.key!=='floor1'?result.sources.plans?.floor1:null,check:()=>check(job)});
              if(!prepared.ok&&prepared.code==='room-labels'){
                const digits=await ocrPage(doc,pages[candidate-1],job,prepared.region,{mergeNative:true,digitsOnly:true});
                prepared=await CatalogPlan.prepare({pdfjs,page,info:digits,table:result.levels[asset.key].table,key:asset.key,optionalContent,reference:asset.key!=='floor1'?result.sources.plans?.floor1:null,check:()=>check(job)});
              }
              if(!prepared.ok&&prepared.code==='room-labels'){
                const markerInfo=await ocrRoomMarkers(doc,pages[candidate-1],job,prepared.region,prepared.markers||[]);
                (result.sources.marker_recovery??={})[asset.key]=markerInfo.markerRecovery;
                prepared=await CatalogPlan.prepare({pdfjs,page,info:markerInfo,table:result.levels[asset.key].table,key:asset.key,optionalContent,reference:asset.key!=='floor1'?result.sources.plans?.floor1:null,check:()=>check(job)});
              }
              if(prepared.ok)(result.sources.plan_ocr??={})[asset.key]={page:candidate,confidence:recovered.confidence};
              }catch(e){check(job);if(e.name==='AbortError')throw e;job.planOcrUnavailable=true;(result.sources.plan_ocr_unavailable??=[]).push({page:candidate,error:e.name||'Error'});result.warnings.push('Дополнительное распознавание подписей временно недоступно. Найденные данные сохранены в черновике; неподтверждённые планы не опубликованы');}
            }
            attempts.push({page:candidate,passed:prepared.ok,reason:prepared.reason||null,foundRooms:prepared.foundRooms,diagnostics:prepared.diagnostics});
            if(prepared.ok){result.levels[asset.key].plan.page=candidate;(result.sources[asset.key]??={}).planPage=candidate;images[asset.index]=prepared.image;thumbnails[asset.index]=prepared.thumbnail;(result.sources.plans??={})[asset.key]=prepared.report;
              if(prepared.report.basis==='source-room-area-consensus')result.warnings.push('Габариты '+(asset.key==='basement'?'цоколя':asset.key.slice(5)+'-го этажа')+' рассчитаны по геометрии и площадям '+prepared.report.calibratedRooms+' помещений');
              if(prepared.report.basis==='matching-scale-and-footprint')result.warnings.push('Габариты '+asset.key.slice(5)+'-го этажа перенесены с 1-го по совпадающим контуру и масштабу');
              if(prepared.report.basis==='unavailable')result.warnings.push('Габариты '+(asset.key==='basement'?'цоколя':asset.key.slice(5)+'-го этажа')+' не подтверждены — план подготовлен без размеров');
              if(asset.key==='floor1'&&!result.data.footprint&&prepared.report.widthMm>0&&prepared.report.heightMm>0)result.data.footprint=(prepared.report.widthMm/1000).toLocaleString('ru-RU')+' × '+(prepared.report.heightMm/1000).toLocaleString('ru-RU');
              failure=null;break;
            }else if(!failure||(prepared.foundRooms||0)>(failure.foundRooms||0))failure=prepared;
          }finally{page.cleanup();}
          }
          (result.sources.plan_review??={})[asset.key]={passed:!failure,attempts};
          if(failure)result.blocking.push('План '+(asset.key==='basement'?'цоколя':asset.key.slice(5)+'-го этажа')+': '+failure.reason+'. Нужна проверка исходного листа');
          continue;
        }
        const canvas=await render(doc,asset.page,1920,job);
        try{const item=exportImage(canvas,pages[asset.page-1],asset.plan,asset.bounds);images[asset.index]=item.image;thumbnails[asset.index]=item.thumbnail;}
        finally{canvas.width=canvas.height=0;}
      }
      if(result.data.footprint)result.warnings=result.warnings.filter(w=>w!=='Габариты не найдены');
      result.sources.facades=facades;result.sources.file={originalBytes:file.size,workingBytes:prepared.file.size,optimized:prepared.optimized,lossless:true};result.images=images;result.thumbnails=thumbnails;result.sha256=sha256;
      progress(job,'Карточка заполнена',95);return result;
    }catch(e){
      if(job.readError)e=job.readError;
      if(e.name==='PasswordException')throw new Error('PDF защищён паролем. Загрузите копию без пароля');
      if(e.name==='InvalidPDFException')throw new Error('Не удалось открыть PDF. Проверьте файл или экспортируйте альбом повторно');
      throw e;
    }finally{job.loadingTask=null;if(job.ocrWorker){await job.ocrWorker.terminate().catch(()=>{});job.ocrWorker=null;}if(task)await task.destroy().catch(()=>{});job.fileTransport?.abort();job.fileTransport=null;await CatalogPdfIO.cleanup(job);}
  }
  function status(text,value){
    const label=document.getElementById('ce-pdf-status'),bar=document.getElementById('ce-pdf-progress');
    if(label)label.textContent=text;if(bar){bar.hidden=value==null;bar.value=value||0;}
  }
  function unlock(job){if(job.unlocked)return;job.unlocked=true;for(const [el,disabled]of job.controls||[])if(el.isConnected)el.disabled=disabled;const c=document.getElementById('ce-pdf-cancel');if(c)c.hidden=true;}
  function cancel(){
    const job=active;if(!job)return;
    // A database save has its own snapshot/confirmation guard and must finish.
    if(job.saving)return;
    job.cancelled=true;job.optimizeReject?.(abort());job.fileTransport?.abort();unlock(job);active=null;job.textReader?.cancel().catch(()=>{});job.renderTask?.cancel();job.loadingTask?.destroy().catch(()=>{});job.ocrWorker?.terminate().catch(()=>{});status('Импорт отменён. Можно выбрать другой PDF',null);
  }
  function apply(result){
    CatalogQuality.protectSave();
    if(typeof ceScreenshotPlans!=='undefined')ceScreenshotPlans={};
    const d=result.data;
    const fields={project_number:'ce-num',title:'ce-title',total_area:'ce-area',footprint:'ce-footprint',beds:'ce-beds',baths:'ce-baths'};
    for(const [key,id]of Object.entries(fields))setVal(id,d[key]??'');
    selectFloors(d.floors||1);ceFeatureSelected=[];
    if(d.tags.includes('Цокольный этаж'))toggleFeature('basement');
    if(d.tags.includes('Мансарда'))toggleFeature('mansard');
    if(d.tags.includes('Плоская кровля'))toggleFeature('flat');
    selectStyle(d.tags.includes('Классический')?'classic':d.tags.includes('Современный')?'modern':'');setVal('ce-tags',d.tags.join(', '));
    for(const f of CatalogFloors.definitions){const level=result.levels[f.key];setVal('ce-area'+f.suffix,level?.table?CatalogPdfCore.area(level.table.total):'');setVal('ce-expl'+f.suffix,level?.table?.rows.map(r=>r.name+': '+r.area).join('\n')||'');}
    ceImages=result.images;ceThumbs=result.thumbnails;
    const previews=['ce-facade-preview','ce-facade2-preview','ce-plan1-preview','ce-plan2-preview','ce-plan3-preview','ce-planb-preview'];
    previews.forEach((id,i)=>{const el=document.getElementById(id);if(el&&ceImages[i]){el.src=ceImages[i];el.style.display='block';}});
    cePdfImportMeta={sha256:result.sha256,pages:result.pages,version:1,sources:result.sources,warnings:result.warnings};
    ceAutoPrice();markCardEditorDirty();cePreview();
  }
  async function start(input){
    const file=input?.files?.[0];if(input)input.value='';return startFile(file);
  }
  async function startFile(file){
    if(!file)return;
    if(file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name||'')){showToast('Перетащите PDF-файл архитектурного альбома');return;}
    if(!canEditCards()){showToast('Нет доступа к импорту каталога');return;}
    if(active){showToast('Дождитесь завершения текущего импорта');return;}
    openCardEditor(null);const generation=cardEditorGeneration,actor=session?.token;
    const job={cancelled:false,saving:false,onProgress:status,shouldStop:()=>generation!==cardEditorGeneration||!canEditCards()||session?.token!==actor};active=job;
    const panel=document.getElementById('cardEditorOverlay');job.controls=[...panel.querySelectorAll('input,textarea,select,button')].filter(el=>el.id!=='ce-pdf-cancel'&&!String(el.getAttribute('onclick')).includes('closeCardEditor')).map(el=>[el,el.disabled]);
    job.controls.forEach(([el])=>el.disabled=true);document.getElementById('ce-pdf-cancel').hidden=false;
    try{
      const result=await read(file,{job});check(job);unlock(job);apply(result);
      const note=result.blocking.length?'Нужна проверка: '+result.blocking.join('. ')+'. ':'Данные из PDF извлечены. ';
      status(note+'Черновик не сохранён. Проверьте карточку и нажмите «Сохранить проект».',null);
      const report=document.getElementById('cards-pdf-result');if(report){report.hidden=false;report.textContent='PDF прочитан. Открыт черновик карточки — сохранение только по кнопке «Сохранить проект».';}
    }catch(e){if(generation===cardEditorGeneration)status(e.name==='AbortError'?'Импорт отменён':e.message||'Не удалось прочитать PDF. Попробуйте другой файл',null);}
    finally{if(generation===cardEditorGeneration)unlock(job);if(active===job)active=null;}
  }
  function installDrop(){
    const catalog=document.getElementById('view-cards'),block=document.getElementById('ce-pdf-import'),button=document.getElementById('cards-pdf-button');
    if(!catalog||!block||!button)return;
    for(const [target,id] of [[button,'cards-pdf-drop-hint'],[block.querySelector('button'),'ce-pdf-drop-hint']]){
      const hint=document.createElement('p');hint.id=id;hint.className='catalog-pdf-drop-hint';hint.textContent='Или перетащите сюда PDF-файл альбома';target.after(hint);target.setAttribute('aria-describedby',id);
    }
    const isFile=e=>Array.from(e.dataTransfer?.types||[]).includes('Files')||!!e.dataTransfer?.files?.length;
    let highlighted=null;
    function clear(){highlighted?.classList.remove('catalog-pdf-drop-active');highlighted=null;}
    function zone(event){
      if(!canEditCards())return null;
      const editor=document.getElementById('cardEditorOverlay');
      if(editor&&getComputedStyle(editor).display!=='none')return !ceCurrentId&&!block.hidden&&block.contains(event.target)?block:null;
      return catalog.classList.contains('active')&&catalog.contains(event.target)?catalog:null;
    }
    document.addEventListener('dragover',event=>{
      if(!isFile(event))return;event.preventDefault();const target=zone(event);
      if(target!==highlighted){clear();highlighted=target;highlighted?.classList.add('catalog-pdf-drop-active');}
      event.dataTransfer.dropEffect=target&&!active?'copy':'none';
    });
    document.addEventListener('dragleave',event=>{if(!event.relatedTarget)clear();});
    document.addEventListener('dragend',clear);window.addEventListener('blur',clear);
    document.addEventListener('drop',event=>{
      if(!isFile(event))return;event.preventDefault();const target=zone(event);clear();
      if(!target)return;
      if(active){showToast('Дождитесь завершения текущего импорта');return;}
      const files=Array.from(event.dataTransfer.files||[]),items=Array.from(event.dataTransfer.items||[]);
      if(items.some(item=>item.webkitGetAsEntry?.()?.isDirectory)){showToast('Перетащите PDF-файл, а не папку');return;}
      if(files.length!==1){showToast('Загружайте по одному PDF-альбому');return;}
      if(target===block&&document.getElementById('cardEditorOverlay').dataset.dirty==='1'){showToast('Сначала сохраните карточку или закройте её перед загрузкой другого альбома');return;}
      void startFile(files[0]);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installDrop,{once:true});else installDrop();
  function reset(){cancel();status('Загрузите альбом — приложение заполнит черновик. Сохранение только по кнопке «Сохранить проект».',null);const block=document.getElementById('ce-pdf-import');if(block)block.hidden=!!ceCurrentId;}
  root.CatalogPdfImport=Object.freeze({draftOnly:true,read,start,startFile,cancel,reset,busyReading:()=>!!active&&!active.saving,apply,pdfItems,exportImage,readTextContent,imageRegions,photo});
})(window);
