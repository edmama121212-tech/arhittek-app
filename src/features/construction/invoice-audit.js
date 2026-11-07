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

// Фото накладной выбрано из галереи — просто показываем имя файла
function onInvoicePhotoPicked(input, statusId){
  const file = input.files[0];
  const span = document.getElementById(statusId);
  if(span) span.textContent = file ? '✓ '+file.name : '';
}

// Фото сделано камерой — переносим файл в основной input (тот, который читает addInvoice при сохранении)
function handleInvoicePhotoCapture(captureInput, targetInputId, statusId){
  const file = captureInput.files[0];
  if(!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  const target = document.getElementById(targetInputId);
  if(target) target.files = dt.files;
  const span = document.getElementById(statusId);
  if(span) span.textContent = '✓ '+file.name;
}

async function addInvoiceFromView(){
  if(!currentObjectId) return;
  await addInvoice(currentObjectId);
}


let invoiceSaveInFlight=false;
async function addInvoice(projectId){
  return ARHITTEKConstructionOperations.addInvoice(projectId);
}

