(function(root){
 'use strict';
 const LIMIT=350*1024*1024,CHUNK=512*1024,MAX=2*1024*1024*1024;let hashLibrary;
 const abort=()=>new DOMException('Импорт отменён','AbortError');
 const check=job=>{if(job.cancelled||job.shouldStop?.())throw abort();};
 const tell=(job,text,value)=>{check(job);job.onProgress?.(text,value);};
 const mb=size=>(size/1024/1024).toFixed(1).replace('.',',');
 async function hash(file,job){
  if(!root.sha256){if(!hashLibrary)hashLibrary=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/js-sha256@0.11.1/build/sha256.min.js';script.onload=resolve;script.onerror=()=>{hashLibrary=null;script.remove();reject(Error('Не удалось загрузить проверку PDF. Проверьте интернет и повторите'));};document.head.appendChild(script);});await hashLibrary;}
  check(job);const digest=root.sha256.create();
  for(let offset=0;offset<file.size;offset+=CHUNK){check(job);digest.update(new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer()));}
  check(job);return digest.hex();
 }
 async function cleanup(job){
  job.optimizeWorker?.terminate();job.optimizeWorker=null;
  if(job.optimizedFileName&&/^arhittek-pdf-opt-[a-z0-9-]+\.pdf$/.test(job.optimizedFileName)){
   const name=job.optimizedFileName;job.optimizedFileName=null;try{const d=await navigator.storage.getDirectory();await d.removeEntry(name);}catch(_){}
  }
 }
 async function prepare(file,job,options={}){
  const limit=options.limitBytes??LIMIT;check(job);
  if(file.size>MAX)throw Error('PDF больше 2 ГБ. Безопасная обработка такого альбома пока не поддерживается');
  if(file.size<=limit)return {file,optimized:false,originalSize:file.size};
  tell(job,'PDF больше рабочего размера. Оптимизирую без ухудшения визуализаций…',1);
  job.optimizedFileName='arhittek-pdf-opt-'+crypto.randomUUID()+'.pdf';
  try{
   const fileResult=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('catalog-pdf-optimize-worker.js',document.baseURI));job.optimizeWorker=worker;
    const timer=setTimeout(()=>{worker.terminate();reject(Error('Оптимизация заняла слишком много времени'));},120000);
    const finish=fn=>value=>{clearTimeout(timer);job.optimizeReject=null;worker.terminate();job.optimizeWorker=null;fn(value);};
    job.optimizeReject=finish(reject);worker.onmessage=({data})=>data.ok?finish(resolve)(data.file):finish(reject)(Error(data.error));worker.onerror=()=>finish(reject)(Error('Оптимизация недоступна в этом браузере'));
    worker.postMessage({file,outputName:job.optimizedFileName});
   });
   check(job);
   if(fileResult.size<file.size){tell(job,'Без потерь: '+mb(file.size)+' → '+mb(fileResult.size)+' МБ. Читаю альбом…',2);return {file:fileResult,optimized:true,originalSize:file.size};}
   await cleanup(job);tell(job,'Файл уже сжат. Читаю его частями, сохраняя качество…',2);
  }catch(e){await cleanup(job);check(job);tell(job,'Безопасное сжатие не уменьшило файл. Читаю его частями без изменения качества…',2);}
  return {file,optimized:false,originalSize:file.size};
 }
 async function rangeSource(pdfjs,file,job){
  check(job);const initial=new Uint8Array(await file.slice(0,CHUNK).arrayBuffer());check(job);
  class FileTransport extends pdfjs.PDFDataRangeTransport{
   constructor(){super(file.size,initial,true,file.name);this.stopped=false;this.queue=Promise.resolve();}
   requestDataRange(begin,end){
    this.queue=this.queue.then(async()=>{
     if(this.stopped)return;check(job);
     // PDF.js closes each requested range after one onDataRange callback.
     // Its requested range can span multiple 512 KiB chunks; never split it.
     const bytes=new Uint8Array(await file.slice(begin,end).arrayBuffer());if(this.stopped)return;check(job);this.onDataRange(begin,bytes);
    }).catch(e=>{if(!this.stopped&&!job.cancelled){job.readError=e;void job.loadingTask?.destroy().catch(()=>{});}});
   }
   abort(){this.stopped=true;}
  }
  const range=new FileTransport();job.fileTransport=range;return {range,length:file.size,rangeChunkSize:CHUNK,disableAutoFetch:true,disableStream:true};
 }
 root.CatalogPdfIO=Object.freeze({limitBytes:LIMIT,chunkBytes:CHUNK,prepare,hash,rangeSource,cleanup});
})(window);
