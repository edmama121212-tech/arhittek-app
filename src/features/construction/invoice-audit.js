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
  const mismatch = Math.abs(expectedExpenses - storedExpenses) > 1;

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

// Shared attachment handling for invoice creation and editing.
function isInvoicePdf(url){return /\.pdf(?:[?#]|$)/i.test(String(url||''));}
function validInvoiceDocument(file){
  if(!file||!file.size||file.size>20*1024*1024)return false;
  const type=String(file.type||'').toLowerCase();
  return /\.(pdf|jpe?g|png)$/i.test(file.name)&&(!type||['application/pdf','image/jpeg','image/png'].includes(type))&&(!type||(isInvoicePdf(file.name)===(type==='application/pdf')));
}
function invoiceDocumentDrop(event,id){
  event.preventDefault();event.stopPropagation();
  const input=document.getElementById(id),files=event.dataTransfer?.files;
  if(!input||!files||files.length!==1||!validInvoiceDocument(files[0])){showToast('Выберите один PDF, JPG или PNG до 20 МБ');return;}
  const dt=new DataTransfer();dt.items.add(files[0]);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
}
function invoiceAttachmentStatus(input,statusId){
  const file=input.files[0],span=document.getElementById(statusId);
  if(!span)return;
  span.replaceChildren();
  if(!file)return;
  const name=document.createElement('span');name.textContent='✓ '+file.name+' · ';span.append(name);
  const preview=document.createElement('button');preview.type='button';preview.textContent='Просмотр';preview.onclick=()=>{const url=URL.createObjectURL(file);window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);};span.append(preview);
  const remove=document.createElement('button');remove.type='button';remove.textContent='Убрать';remove.onclick=()=>{input.value='';span.replaceChildren();if(statusId==='invSheet-photo-name'){invSheetNewPhotoBlob=null;invoiceAttachmentGeneration++;restoreInvoiceAttachment();}};span.append(remove);
}
function onInvoicePhotoPicked(input,statusId){
  if(input.files[0]&&!validInvoiceDocument(input.files[0])){input.value='';showToast('Выберите PDF, JPG или PNG до 20 МБ');}
  invoiceAttachmentStatus(input,statusId);
}
function handleInvoicePhotoCapture(captureInput,targetInputId,statusId){
  const file=captureInput.files[0],target=document.getElementById(targetInputId);
  if(!file||!target)return;
  if(!validInvoiceDocument(file)){showToast('Недопустимый файл');return;}
  const dt=new DataTransfer();dt.items.add(file);target.files=dt.files;onInvoicePhotoPicked(target,statusId);
}
async function uploadInvoiceDocument(file,path,canUpload){
  if(file.type!=='application/pdf'&&!isInvoicePdf(file.name))return compressAndUpload(file,'construction-documents',path,canUpload);
  if(!canUpload())throw new Error('Сеанс или доступ к объекту изменился');
  if(await file.slice(0,5).text()!=='%PDF-')throw new Error('Некорректный PDF');
  if(!canUpload())throw new Error('Сеанс или доступ к объекту изменился');
  const bucket=sb.storage.from('construction-documents'),pdfPath=path.replace(/\.jpg$/i,'.pdf');
  const {error}=await bucket.upload(pdfPath,file,{contentType:'application/pdf',upsert:true});
  if(error)throw error;
  return bucket.getPublicUrl(pdfPath).data.publicUrl;
}

async function addInvoiceFromView(){
  if(!currentObjectId) return;
  await addInvoice(currentObjectId);
}


let invoiceSaveInFlight=false;
async function addInvoice(projectId){
  return ARHITTEKConstructionOperations.addInvoice(projectId);
}

