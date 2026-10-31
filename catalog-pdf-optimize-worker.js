/* Lossless structural optimisation only: no JPEG conversion or downsampling.
 * The pinned QPDF build exposes WORKERFS and its node operations. Input stays a
 * File; output is written directly to OPFS rather than duplicated in JS heaps. */
'use strict';
self.onmessage=async({data:{file,outputName}})=>{
 let handle,pendingSize=0,pendingStart=0;const pending=new Uint8Array(256*1024);
 const flush=()=>{if(pendingSize){const count=handle.write(pending.subarray(0,pendingSize),{at:pendingStart});if(count!==pendingSize)throw Error('Incomplete PDF write');pendingSize=0;}};
 const write=(bytes,position)=>{
  const length=bytes.length;let offset=0;
  if(pendingSize&&position!==pendingStart+pendingSize)flush();
  while(offset<length){if(!pendingSize)pendingStart=position+offset;const count=Math.min(pending.length-pendingSize,length-offset);pending.set(bytes.subarray(offset,offset+count),pendingSize);pendingSize+=count;offset+=count;if(pendingSize===pending.length)flush();}
  return length;
 };
 try{
  const directory=await navigator.storage.getDirectory(),entry=await directory.getFileHandle(outputName,{create:true});
  handle=await entry.createSyncAccessHandle();handle.truncate(0);
  importScripts('https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js');
  const q=await self.Module({noInitialRun:true,locateFile:()=> 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm',print:()=>{},printErr:()=>{}}),FS=q.FS,W=q.WORKERFS;
  if(!FS?.createNode||!W?.pa?.ya||!W?.qa?.va)throw Error('Unsupported QPDF filesystem');
  // QPDF probes tiny byte ranges frequently. Cache one bounded input block
  // instead of performing a synchronous FileReader disk read for each probe.
  let inputNode,inputStart=-1,inputBytes;const inputReader=new FileReaderSync(),blockSize=512*1024;
  W.qa.read=(stream,buffer,offset,length,position)=>{
   const node=stream.node;length=Math.min(length,node.size-position);if(length<=0)return 0;
   let copied=0;
   while(copied<length){const at=position+copied;
    if(inputNode!==node||at<inputStart||at>=inputStart+inputBytes.length){inputNode=node;inputStart=Math.floor(at/blockSize)*blockSize;inputBytes=new Uint8Array(inputReader.readAsArrayBuffer(node.ra.slice(inputStart,inputStart+blockSize)));}
    const start=at-inputStart,count=Math.min(length-copied,inputBytes.length-start);if(!count)throw Error('Incomplete PDF read');buffer.set(inputBytes.subarray(start,start+count),offset+copied);copied+=count;
   }return copied;
  };
  FS.mkdir('/source');FS.mount(W,{files:[file]},'/source');FS.mkdir('/result');
  const makeNode=(parent,name,mode)=>{
   const node=W.createNode(parent,name,mode,0,{size:0});node.size=FS.isFile(mode)?0:4096;
   node.pa={...W.pa,ua:(node,attrs)=>{W.pa.ua(node,attrs);if(FS.isFile(node.mode)&&attrs.size!=null){flush();handle.truncate(attrs.size);node.size=attrs.size;}},Aa:(p,n,m)=>makeNode(p,n,m)};
   node.qa={...W.qa,
    read:(stream,buffer,offset,length,position)=>{flush();return handle.read(buffer.subarray(offset,offset+length),{at:position});},
    write:(stream,buffer,offset,length,position)=>{const count=write(buffer.subarray(offset,offset+length),position);stream.node.size=Math.max(stream.node.size,position+count);return count;}
   };return node;
  };
  FS.mount({sa:()=>makeNode(null,'/',16895)}, {},'/result');
  let code=0;
  try{code=q.callMain(['/source/'+file.name,'--object-streams=generate','--stream-data=compress','--recompress-flate','--compression-level=9','--deterministic-id','/result/optimized.pdf']);}
  catch(e){if(e.status!==0&&e.status!==3)throw e;code=e.status;}
  if(code!==0&&code!==3)throw Error('PDF optimisation failed');
  flush();handle.flush();handle.close();handle=null;
  const result=await entry.getFile();if(!(await result.slice(0,1024).text()).includes('%PDF-'))throw Error('Invalid optimised PDF');
  self.postMessage({ok:true,file:result});
 }catch(e){try{handle?.close();}catch(_){}self.postMessage({ok:false,error:String(e.message||e)});}
};
