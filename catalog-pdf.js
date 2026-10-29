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
  async function render(doc,n,side,job){
    check(job);const page=await doc.getPage(n),base=page.getViewport({scale:1}),v=page.getViewport({scale:side/Math.max(base.width,base.height)});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);
    try{job.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:v,background:'rgb(255,255,255)'});await job.renderTask.promise;check(job);return canvas;}
    catch(e){canvas.width=canvas.height=0;throw e;}
    finally{job.renderTask=null;page.cleanup();}
  }
  function photo(canvas){
    const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let colored=0,ink=0,count=0;
    for(let i=0;i<d.length;i+=32){count++;const max=Math.max(d[i],d[i+1],d[i+2]),min=Math.min(d[i],d[i+1],d[i+2]);if(min<235)ink++;if(max-min>24)colored++;}
    return ink/count>.5||colored/count>.18;
  }
  function exportImage(canvas,info,isPlan){
    const ctx=canvas.getContext('2d'),sx=canvas.width/info.width,sy=canvas.height/info.height;
    ctx.fillStyle='#fff';
    for(const w of info.items.filter(w=>/GSPublisherVersion/i.test(w.text)))ctx.fillRect(Math.max(0,w.x0*sx-3),Math.max(0,w.y0*sy-3),(w.x1-w.x0)*sx+6,(w.y1-w.y0)*sy+6);
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
  async function ocrPage(doc,pageInfo,job){
    if(!job.ocrWorker){
      progress(job,'Подготавливаю распознавание сканов…',40);
      await loadTesseractScript();check(job);
      job.ocrWorker=await Tesseract.createWorker('rus+eng',Tesseract.OEM.LSTM_ONLY,{logger:m=>{if(m.status==='recognizing text'&&!job.cancelled)job.onProgress?.('Распознаю скан, страница '+pageInfo.page+'…',45);}});
      check(job);await job.ocrWorker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.AUTO,preserve_interword_spaces:'1'});
    }
    const canvas=await render(doc,pageInfo.page,2400,job);
    try{
      const {data}=await job.ocrWorker.recognize(canvas,{}, {blocks:true,text:true});check(job);
      const sx=pageInfo.width/canvas.width,sy=pageInfo.height/canvas.height;
      const words=extractOcrWords(data).filter(w=>w.confidence==null||w.confidence>=35).map(w=>({text:w.text,x0:w.x0*sx,x1:w.x1*sx,y0:w.y0*sy,y1:w.y1*sy,confidence:w.confidence}));
      const result=CatalogPdfCore.pageFromItems(words,pageInfo.width,pageInfo.height,pageInfo.page,true);result.confidence=data.confidence;return result;
    }finally{canvas.width=canvas.height=0;}
  }
  async function read(file,options={}){
    const job=options.job||{...options,cancelled:false};let task;
    try{
      if(!file||file.size===0)throw new Error('PDF-файл пуст');
      if(file.size>350*1024*1024)throw new Error('PDF больше 350 МБ. Сохраните уменьшенную копию альбома');
      if(!(await file.slice(0,1024).text()).includes('%PDF-'))throw new Error('Выберите PDF-файл архитектурного альбома');
      progress(job,'Открываю PDF…',2);const pdfjs=await library();check(job);
      const bytes=await file.arrayBuffer();check(job);
      const digest=await crypto.subtle.digest('SHA-256',bytes),sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
      task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,enableXfa:false,stopAtErrors:true,canvasMaxAreaInBytes:16*1024*1024,standardFontDataUrl:PDF_BASE+'standard_fonts/',cMapUrl:PDF_BASE+'cmaps/',cMapPacked:true,wasmUrl:PDF_BASE+'wasm/'});job.loadingTask=task;
      const doc=await task.promise;check(job);
      if(doc.numPages>160)throw new Error('В альбоме больше 160 страниц. Загрузите отдельно архитектурную часть');
      let pages=[];
      for(let n=1;n<=doc.numPages;n++){
        progress(job,'Читаю листы: '+n+' из '+doc.numPages,5+n/doc.numPages*30);
        const page=await doc.getPage(n),v=page.getViewport({scale:1}),content=await page.getTextContent();check(job);
        pages.push(CatalogPdfCore.pageFromItems(pdfItems(pdfjs,page,content),v.width,v.height,n));page.cleanup();
      }
      const meaningful=p=>p.text.replace(/GSPublisherVersion[^\n]*/g,'').trim().length>80;
      const withText=pages.filter(meaningful),mostlyScanned=withText.length<Math.min(3,pages.length/3),lastText=withText.at(-1)?.page||0,facades=[];
      for(let i=0;i<pages.length;i++)if(!meaningful(pages[i])){
        const p=pages[i];check(job);
        if(!mostlyScanned&&p.page>lastText&&facades.length>=2)continue;
        progress(job,'Ищу планы и визуализации: '+p.page+' из '+pages.length,36+i/pages.length*25);
        const thumbnail=await render(doc,p.page,640,job);const isPhoto=photo(thumbnail);thumbnail.width=thumbnail.height=0;
        if(isPhoto&&p.page>2){if(facades.length<2)facades.push(p.page);continue;}
        if(mostlyScanned||p.page>1&&p.page<lastText)pages[i]=await ocrPage(doc,p,job);
      }
      const result=CatalogPdfCore.analyze(pages);check(job);
      if(pages.some(p=>p.ocr&&(!Number.isFinite(p.confidence)||p.confidence<70)))result.blocking.push('Качество скана требует проверки распознанных данных');
      const images=CatalogFloors.slots(),thumbnails=CatalogFloors.slots();
      if(!facades.length)result.blocking.push('Не найдена визуализация фасада');
      const assets=[...facades.map((page,index)=>({page,index,plan:false})),...CatalogFloors.definitions.filter(f=>result.levels[f.key]?.plan).map(f=>({page:result.levels[f.key].plan.page,index:f.image,plan:true}))];
      for(let i=0;i<assets.length;i++){
        const asset=assets[i];progress(job,asset.plan?'Извлекаю план, страница '+asset.page+'…':'Извлекаю визуализацию, страница '+asset.page+'…',65+i/assets.length*25);
        const canvas=await render(doc,asset.page,asset.plan?2400:1920,job);
        try{const item=exportImage(canvas,pages[asset.page-1],asset.plan);images[asset.index]=item.image;thumbnails[asset.index]=item.thumbnail;}
        finally{canvas.width=canvas.height=0;}
      }
      result.sources.facades=facades;result.images=images;result.thumbnails=thumbnails;result.sha256=sha256;
      progress(job,'Карточка заполнена',95);return result;
    }catch(e){
      if(e.name==='PasswordException')throw new Error('PDF защищён паролем. Загрузите копию без пароля');
      if(e.name==='InvalidPDFException')throw new Error('Не удалось открыть PDF. Проверьте файл или экспортируйте альбом повторно');
      throw e;
    }finally{job.loadingTask=null;if(job.ocrWorker){await job.ocrWorker.terminate().catch(()=>{});job.ocrWorker=null;}if(task)await task.destroy().catch(()=>{});}
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
    job.cancelled=true;unlock(job);active=null;job.renderTask?.cancel();job.loadingTask?.destroy().catch(()=>{});job.ocrWorker?.terminate().catch(()=>{});status('Импорт отменён. Можно выбрать другой PDF',null);
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
  root.CatalogPdfImport=Object.freeze({read,start,cancel,reset,busyReading:()=>!!active&&!active.saving,apply,pdfItems,exportImage});
})(window);
