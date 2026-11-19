// Share the named PDF attachment. iOS may require a fresh tap after generation.
async function deliverDocumentPdf(doc,name){
  if(typeof navigator.canShare!=='function'||typeof navigator.share!=='function'){
    doc.save(name);
    return;
  }
  const file=new File([doc.output('blob')],name,{type:'application/pdf'});
  const attachment={files:[file]};
  if(!navigator.canShare(attachment)){doc.save(name);return;}
  try{await navigator.share(attachment);return;}
  catch(error){if(error.name==='AbortError')return;}
  const dialog=document.createElement('dialog');
  dialog.style.cssText='max-width:90vw;padding:20px;border:0;border-radius:16px';
  const label=document.createElement('p');
  label.textContent=file.name;
  const close=document.createElement('button');
  close.textContent='Закрыть';
  close.onclick=()=>dialog.close();
  const send=document.createElement('button');
  send.className='btn btn-primary';
  send.textContent='Отправить PDF';
  send.onclick=async()=>{
    try{await navigator.share(attachment);dialog.close();}
    catch(error){if(error.name!=='AbortError')label.textContent='Отправка недоступна. Можно сохранить PDF в файлы.';}
  };
  const save=document.createElement('button');
  save.textContent='Сохранить файл';
  save.onclick=()=>{doc.save(name);dialog.close();};
  dialog.append(label,send,save,close);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);dialog.showModal();
}
