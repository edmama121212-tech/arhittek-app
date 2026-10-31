(function(root){
  'use strict';
  const PDF_BASE='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/';
  let pdfPromise=null,active=null;
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
  async function ocrPage(doc,pageInfo,job,region){
    if(!job.ocrWorker){
      progress(job,'Подготавливаю распознавание таблиц…',40);await loadTesseractScript();check(job);
      job.ocrWorker=await Tesseract.createWorker('rus+eng',Tesseract.OEM.LSTM_ONLY,{logger:m=>{if(m.status==='recognizing text'&&!job.cancelled)job.onProgress?.('Распознаю таблицу, страница '+pageInfo.page+'…',45);}});check(job);
    }
    const page=await doc.getPage(pageInfo.page),base=page.getViewport({scale:1}),box=region||{x0:0,y0:0,x1:base.width,y1:base.height},scale=3000/Math.max(box.x1-box.x0,box.y1-box.y0),viewport=page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil((box.x1-box.x0)*scale);canvas.height=Math.ceil((box.y1-box.y0)*scale);
    try{
      job.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-box.x0*scale,-box.y0*scale],background:'rgb(255,255,255)'});await job.renderTask.promise;job.renderTask=null;check(job);
      const recognized=await CatalogOcr.recognize(job.ocrWorker,canvas,{check:()=>check(job),onProgress:pass=>progress(job,'Перечитываю таблицу: лист '+pageInfo.page+', проход '+pass,45)});
      const words=recognized.words.map(w=>({...w,x0:w.x0/scale+box.x0,x1:w.x1/scale+box.x0,y0:w.y0/scale+box.y0,y1:w.y1/scale+box.y0}));
      const native=region?pageInfo.items.filter(w=>w.cx<box.x0||w.cx>box.x1||w.cy<box.y0||w.cy>box.y1):[];
      const result=CatalogPdfCore.pageFromItems([...native,...words],pageInfo.width,pageInfo.height,pageInfo.page,true);result.confidence=recognized.confidence;return result;
    }finally{job.renderTask=null;canvas.width=canvas.height=0;page.cleanup();}
  }
  function tableRegion(info,table){
    const header=info.items.find(w=>/^наименование/iu.test(w.text));if(!table&&!header)return null;
    const h=header?.h||10,left=table?.left??header.x0-h*4,top=table?.top??header.y0;
    const area=info.items.find(w=>/^площадь/iu.test(w.text)&&w.x0>left&&Math.abs(w.cy-top)<h*3);
    return {x0:Math.max(0,left-h*2),y0:Math.max(0,top-h*3),x1:Math.min(info.width,(table?.right??area?.x1??info.width)+h*4),y1:info.height};
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
      const facadeCandidates=[];
      for(const p of pages.slice().sort((a,b)=>Number(meaningful(a))-Number(meaningful(b))||a.page-b.page)){
        check(job);if(CatalogPdfCore.planInfos(p,result.data.floors).length||p.tables.length)continue;
        const technical=/фасад|разрез/iu.test(p.text)&&p.items.filter(w=>/^[+−-]?\d{1,2}[.,]\d{3}$/.test(w.text)).length>=4&&!/визуализац|перспектив|3[dд]/iu.test(p.text);if(technical)continue;
        if(p.photoHint){facadeCandidates.push({page:p.page,bounds:null,score:p.page>2?30:10});if(facadeCandidates.filter(f=>f.page>2).length>=2)break;continue;}
        const page=await doc.getPage(p.page),viewport=page.getViewport({scale:1});let regions;
        try{regions=imageRegions(pdfjs,await page.getOperatorList(),viewport);}catch(e){page.cleanup();throw e;}
        const named=/визуализац|перспектив|3[dд]/iu.test(p.text);
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
      const images=CatalogFloors.slots(),thumbnails=CatalogFloors.slots();
      if(!facades.length)result.blocking.push('Не найдена визуализация фасада');
      const assets=[...selected.map((f,index)=>({...f,index,plan:false})),...CatalogFloors.definitions.filter(f=>result.levels[f.key]?.plan).map(f=>({page:result.levels[f.key].plan.page,index:f.image,plan:true}))];
      for(let i=0;i<assets.length;i++){
        const asset=assets[i];progress(job,asset.plan?'Извлекаю план, страница '+asset.page+'…':'Извлекаю визуализацию, страница '+asset.page+'…',65+i/assets.length*25);
        const canvas=await render(doc,asset.page,asset.plan?2400:1920,job);
        try{const item=exportImage(canvas,pages[asset.page-1],asset.plan,asset.bounds);images[asset.index]=item.image;thumbnails[asset.index]=item.thumbnail;}
        finally{canvas.width=canvas.height=0;}
      }
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
    const d=result.data;
    const fields={project_number:'ce-num',title:'ce-title',total_area:'ce-area',footprint:'ce-footprint',beds:'ce-beds',baths:'ce-baths'};
    for(const [key,id]of Object.entries(fields))setVal(id,d[key]??'');
    selectFloors(d.floors||1);ceFeatureSelected=[];
    if(d.tags.includes('Цокольный этаж'))toggleFeature('basement');
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
    const file=input?.files?.[0];if(input)input.value='';if(!file)return;
    if(!canEditCards()){showToast('Нет доступа к импорту каталога');return;}
    if(active){showToast('Дождитесь завершения текущего импорта');return;}
    openCardEditor(null);const generation=cardEditorGeneration,actor=session?.token;
    const job={cancelled:false,saving:false,onProgress:status,shouldStop:()=>generation!==cardEditorGeneration||!canEditCards()||session?.token!==actor};active=job;
    const panel=document.getElementById('cardEditorOverlay');job.controls=[...panel.querySelectorAll('input,textarea,button')].filter(el=>el.id!=='ce-pdf-cancel'&&!String(el.getAttribute('onclick')).includes('closeCardEditor')).map(el=>[el,el.disabled]);
    job.controls.forEach(([el])=>el.disabled=true);document.getElementById('ce-pdf-cancel').hidden=false;
    try{
      const result=await read(file,{job});check(job);unlock(job);apply(result);
      if(result.blocking.length){status('Нужна проверка: '+result.blocking.join('. ')+'. Найденные данные уже в карточке',null);return;}
      job.saving=true;status('Сохраняю проект №'+result.data.project_number+'…',98);
      const saved=await saveCard();
      if(saved?.ok){
        const report=document.getElementById('cards-pdf-result');report.hidden=false;
        report.textContent=(saved.duplicate?'Проект №'+result.data.project_number+' уже есть в каталоге. Повторная карточка не создана.':'Создан проект №'+result.data.project_number+' из PDF. ')+(result.warnings.length?'Проверьте: '+result.warnings.join('. ')+'.':'');
      }else if(generation===cardEditorGeneration)status('Данные извлечены. Сохранение не подтверждено — нажмите «Сохранить проект» для повтора',null);
    }catch(e){if(generation===cardEditorGeneration)status(e.name==='AbortError'?'Импорт отменён':e.message||'Не удалось прочитать PDF. Попробуйте другой файл',null);}
    finally{if(generation===cardEditorGeneration)unlock(job);if(active===job)active=null;}
  }
  function reset(){cancel();status('Загрузите альбом — приложение заполнит и создаст карточку',null);const block=document.getElementById('ce-pdf-import');if(block)block.hidden=!!ceCurrentId;}
  root.CatalogPdfImport=Object.freeze({read,start,cancel,reset,busyReading:()=>!!active&&!active.saving,apply,pdfItems,exportImage,readTextContent,imageRegions,photo});
})(window);
