// ============================================================
// СВЕРКА ОБЪЕКТА — проверка накладных на пропуски/дубли/аномалии
// (инструмент для самостоятельной проверки объекта, например Митаева 21)
// ============================================================
function buildObjectAuditHtml(projectId){
  const invs = state.invoices.filter(inv=>inv.project_id===projectId&&!inv.deleted_at);
  const p = state.projects.find(x=>x.id===projectId);

  const matTotal = invs.filter(i=>['Материал','Инструмент','Расходник','Доставка'].includes(i.item_type)).reduce((s,i)=>s+Number(i.amount||0),0);
  const workTotal = invs.filter(i=>i.item_type==='Работа').reduce((s,i)=>s+Number(i.amount||0),0);
  const noDate = invs.filter(i=>!i.invoice_date);
  const zeroAmt = invs.filter(i=>!i.amount || Number(i.amount)<=0);
  const noDesc = invs.filter(i=>!i.number && !i.description);

  // Похожие дубликаты: совпадают номер+сумма+дата (частая причина "куда-то делась накладная" —
  // на самом деле задвоение, а не пропажа)
  const seen = {};
  const dups = [];
  invs.forEach(i=>{
    const key = (i.number||'').trim().toLowerCase()+'|'+i.amount+'|'+(i.invoice_date||'');
    if(seen[key]) dups.push(i); else seen[key]=i;
  });

  const otherTotal=invs.filter(i=>!['Материал','Инструмент','Расходник','Доставка','Работа'].includes(i.item_type)).reduce((s,i)=>s+Number(i.amount||0),0);
  const invoiceTotal = matTotal + workTotal + otherTotal;
  const expectedExpenses = p?getProjectExpenses(p):invoiceTotal;
  const storedExpenses = Number(p?.expenses) || 0;
  const mismatch = Math.round(expectedExpenses*100) !== Math.round(storedExpenses*100);

  let html = `<div class="card">
    <div class="fee-row"><div class="fl">Всего накладных</div><div class="fv">${invs.length}</div></div>
    <div class="fee-row"><div class="fl">Материалы (сумма)</div><div class="fv">${fmtMoney(matTotal)}</div></div>
    <div class="fee-row"><div class="fl">Работы (сумма)</div><div class="fv">${fmtMoney(workTotal)}</div></div>
    ${otherTotal?`<div class="fee-row"><div class="fl">Прочие типы накладных</div><div class="fv">${fmtMoney(otherTotal)}</div></div>`:''}
    <div class="fee-row total"><div class="fl">Итого по накладным</div><div class="fv">${fmtMoney(invoiceTotal)}</div></div>
    ${mismatch ? `<div class="fee-row"><div class="fl" style="color:var(--red);">⚠ Расход в проекте</div><div class="fv" style="color:var(--red);">${fmtMoney(storedExpenses)} (не совпадает)</div></div>` : ''}
  </div>`;

  const issues = [];
  if(noDate.length) issues.push({label:'Без даты', items:noDate, color:'var(--red)'});
  if(zeroAmt.length) issues.push({label:'Нулевая / пустая сумма', items:zeroAmt, color:'var(--red)'});
  if(noDesc.length) issues.push({label:'Нет номера и описания', items:noDesc, color:'var(--gold)'});
  if(dups.length) issues.push({label:'Похожие дубликаты (номер+сумма+дата совпадают)', items:dups, color:'var(--red)'});

  if(!issues.length && !mismatch){
    html += `<div class="empty-state" style="margin-top:10px;">Явных нестыковок в накладных не найдено. Если сумма всё равно кажется неверной — сверьте вручную с бумажными накладными: возможно, часть расходов ещё не занесена в приложение.</div>`;
    return html;
  }

  issues.forEach(group=>{
    html += `<div class="section-label" style="margin-top:14px;"><span class="lbl-text" style="color:${group.color};">${group.label} (${group.items.length})</span><span class="section-label-line"></span></div><div class="card">`;
    group.items.forEach(inv=>{
      html += `<div class="list-item" onclick="openInvoiceSheet('${inv.id}')" style="cursor:pointer;">
        <div>
          <div class="li-name">${escapeHtml(inv.number||inv.description||'—')}</div>
          <div class="li-meta">${inv.invoice_date ? fmtDate(inv.invoice_date) : 'нет даты'} · ${fmtMoney(inv.amount)} · ${escapeHtml(inv.item_type||'')}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  });

  return html;
}

const INVOICE_DOCUMENT_LIMIT = 25 * 1024 * 1024;
const invoiceDocumentMessage = 'Выберите один PDF, JPG, JPEG или PNG до 25 МБ';

function isInvoicePdf(url){
  return /\.pdf(?:[?#]|$)/i.test(String(url || ''));
}
function invoiceDocumentType(name){
  if(isInvoicePdf(name))return 'application/pdf';
  if(/\.jpe?g$/i.test(name))return 'image/jpeg';
  if(/\.png$/i.test(name))return 'image/png';
  return '';
}
function validInvoiceDocument(file){
  if(!file || !file.size || file.size > INVOICE_DOCUMENT_LIMIT)return false;
  const type=invoiceDocumentType(file.name);
  return !!type && (!file.type || file.type.toLowerCase() === type);
}
function selectInvoiceDocument(input,file){
  const transfer=new DataTransfer();
  transfer.items.add(file);
  input.files=transfer.files;
  input.dispatchEvent(new Event('change',{bubbles:true}));
}
function invoiceDocumentDrop(event,id){
  event.preventDefault();
  event.stopPropagation();
  const input=document.getElementById(id), files=event.dataTransfer?.files;
  if(!input || files?.length !== 1 || !validInvoiceDocument(files[0])){
    showToast(invoiceDocumentMessage);
    return;
  }
  selectInvoiceDocument(input,files[0]);
}
function invoiceAttachmentStatus(input,statusId){
  const file=input.files[0], status=document.getElementById(statusId);
  if(!status)return;
  status.replaceChildren();
  if(!file)return;
  status.append(document.createTextNode(file.name+' · '));
  const preview=document.createElement('button');
  preview.type='button';
  preview.textContent='Просмотр';
  preview.onclick=()=>{
    const typedFile=file.type ? file : file.slice(0,file.size,invoiceDocumentType(file.name));
    const url=URL.createObjectURL(typedFile);
    window.open(url,'_blank','noopener');
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  };
  const remove=document.createElement('button');
  remove.type='button';
  remove.textContent='Убрать';
  remove.onclick=()=>{
    input.dataset.discardAttachment='1';
    input.value='';
    input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  status.append(preview,remove);
}
function onInvoicePhotoPicked(input,statusId){
  if(input.files[0] && !validInvoiceDocument(input.files[0])){
    input.value='';
    showToast(invoiceDocumentMessage);
  }
  if(input.files[0])delete input.dataset.discardAttachment;
  invoiceAttachmentStatus(input,statusId);
}
function handleInvoicePhotoCapture(camera,targetId){
  const input=document.getElementById(targetId);
  if(!input || !camera.files.length)return;
  if(!validInvoiceDocument(camera.files[0])){
    showToast(invoiceDocumentMessage);
  }else{
    selectInvoiceDocument(input,camera.files[0]);
  }
  camera.value='';
}
async function uploadInvoiceDocument(file,path,canUpload){
  if(!validInvoiceDocument(file))throw new Error(invoiceDocumentMessage);
  if(!canUpload())throw new Error('Сеанс или доступ к объекту изменился');
  let body=file, type=invoiceDocumentType(file.name);
  if(type === 'application/pdf'){
    if(await file.slice(0,5).text() !== '%PDF-')throw new Error('Некорректный PDF');
  }else{
    body=await compressImage(file);
    type=body.type || type;
  }
  if(!canUpload())throw new Error('Сеанс или доступ к объекту изменился');
  const ext={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg'}[type];
  const objectPath=path.replace(/\.jpg$/i,'.'+ext);
  const bucket=sb.storage.from('construction-documents');
  const {error}=await bucket.upload(objectPath,body,{contentType:type,upsert:true});
  if(error)throw error;
  return bucket.getPublicUrl(objectPath).data.publicUrl;
}

async function addInvoiceFromView(){
  if(!currentObjectId) return;
  await addInvoice(currentObjectId);
}


let invoiceSaveInFlight=false;
async function addInvoice(projectId){
  return ARHITTEKConstructionOperations.addInvoice(projectId);
}

