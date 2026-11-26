// ============================================================
// ОВЕРЛЕЙ НАКЛАДНОЙ — просмотр / редактирование / удаление
// ============================================================
let invSheetCurrentId = null;
let openedInvoice = null;
let invSheetNewPhotoBlob = null;
let invoiceFormGeneration = 0;
let invSheetRemoveAttachment = false;
const invoiceSheetSavesInFlight = new Set();

function syncInvoiceActions(){
  const busy=invoiceSheetSavesInFlight.has(invSheetCurrentId);
  for(const button of document.querySelectorAll('#invoiceSheetOverlay button[onclick="saveInvoiceSheet()"], #invoiceSheetOverlay button[onclick="deleteInvoiceSheet()"]')){
    button.disabled=busy;
  }
}

function updateInvoiceDateHint(){
  document.getElementById('invSheet-date-hint').hidden=document.getElementById('invSheet-date').value<=financeToday();
}
document.getElementById('invSheet-date').addEventListener('input',updateInvoiceDateHint);

function openInvoiceSheet(invId){
  const inv = state.invoices.find(i=>i.id===invId);
  if(!inv){ showToast('Накладная не найдена'); return; }
  if(!canAccessConstructionProject(inv.project_id)){showToast('Нет доступа к этому объекту');return;}
  invoiceFormGeneration++;
  invSheetCurrentId = invId;
  openedInvoice = {...inv};
  invSheetNewPhotoBlob = null;
  invSheetRemoveAttachment = false;

  // Заполняем поля
  document.getElementById('invSheet-number').value   = inv.number || '';
  document.getElementById('invSheet-date').value     = inv.invoice_date || '';
  updateInvoiceDateHint();
  document.getElementById('invSheet-type').value     = inv.item_type || 'Материал';
  document.getElementById('invSheet-amount').value   = inv.amount || '';
  document.getElementById('invSheet-category').value = inv.category || '';
  document.getElementById('invSheet-desc').value     = inv.description || '';
  document.getElementById('invSheet-paid-client').checked = !!inv.paid_by_client;
  document.getElementById('invSheet-photo-name').textContent = '';

  document.getElementById('invSheet-photo-input').value='';
  document.getElementById('invSheet-camera-input').value='';
  restoreInvoiceAttachment();

  const overlay = document.getElementById('invoiceSheetOverlay');
  overlay.querySelector('button[onclick="closeInvoiceSheet()"]').classList.add('sheet-close');
  syncInvoiceActions();
  overlay.style.display = 'flex';
}

function closeInvoiceSheet(){
  document.getElementById('invoiceSheetOverlay').style.display = 'none';
  invSheetCurrentId = null;
  openedInvoice = null;
  invSheetNewPhotoBlob = null;
  invSheetRemoveAttachment = false;
}

function restoreInvoiceAttachment(){
  const url=state.invoices.find(i=>i.id===invSheetCurrentId)?.photo_url || '';
  const wrap=document.getElementById('invSheet-photo-wrap');
  const img=document.getElementById('invSheet-photo-img');
  const pdf=document.getElementById('invSheet-pdf-link');
  wrap.style.display=url && !invSheetRemoveAttachment && !invSheetNewPhotoBlob ? '' : 'none';
  img.style.display=url && !isInvoicePdf(url) ? '' : 'none';
  if(url && !isInvoicePdf(url))img.src=url;
  else img.removeAttribute('src');
  pdf.style.display=url && isInvoicePdf(url) ? '' : 'none';
}
async function openInvoicePdf(){
  const invoice=state.invoices.find(i=>i.id===invSheetCurrentId);
  if(!invoice?.photo_url || !canAccessConstructionProject(invoice.project_id))return;
  const tab=window.open('','_blank');
  if(!tab){showToast('Разрешите открыть документ в новой вкладке');return;}
  tab.opener=null;
  try{
    const url=await ARHITTEKConstructionOperations.imageUrl(invoice.photo_url);
    if(!canAccessConstructionProject(invoice.project_id))throw new Error();
    tab.location.replace(url);
  }catch(_){
    tab.close();
    showToast('Не удалось открыть документ');
  }
}
function removeSavedInvoiceAttachment(){
  invSheetRemoveAttachment=true;
  document.getElementById('invoiceSheetOverlay').dataset.dirty='1';
  restoreInvoiceAttachment();
}
function onInvSheetPhotoChange(input){
  onInvoicePhotoPicked(input,'invSheet-photo-name');
  invSheetNewPhotoBlob=input.files[0] || null;
  restoreInvoiceAttachment();
}

async function refreshInvoiceExpenseTotal(projectId,actor){
  const result=await fetchAllRows(()=>sb.from('invoices').select('*',{count:'exact'}).eq('project_id',projectId));
  if(result.error)throw result.error;
  const project=state.projects.find(row=>row.id===projectId);
  if(!project||!canAccessConstructionProject(projectId,actor))throw new Error('Сеанс или доступ к объекту изменился');
  const total=getConstructionExpenses(project,null,result.data).expenses;
  const update=await sb.from('projects').update({expenses:Math.round(total*100)/100}).eq('id',projectId);
  if(update.error)throw update.error;
}

function matchOpenedInvoice(query,invoice){
  query=query.eq('id',invoice.id).eq('project_id',invoice.project_id);
  for(const key of ['amount','invoice_date','number','item_type','description','category','photo_url','paid_by_client','updated_at']){
    if(Object.hasOwn(invoice,key))query=invoice[key]==null?query.is(key,null):query.eq(key,invoice[key]);
  }
  return query;
}

async function saveInvoiceSheet(){
  if(!invSheetCurrentId) return;
  const invoiceId=invSheetCurrentId,generation=invoiceFormGeneration;
  if(invoiceSheetSavesInFlight.has(invoiceId))return;
  const currentInvoice = state.invoices.find(i=>i.id===invoiceId);
  if(!currentInvoice) return;
  if(!canAccessConstructionProject(currentInvoice.project_id)){showToast('Нет доступа к этому объекту');return;}
  const actor={employeeId:session.employeeId,token:session.token,isAdmin:!!session.isAdmin};
  const inv=openedInvoice,photoBlob=invSheetNewPhotoBlob,removeAttachment=invSheetRemoveAttachment;

  const number       = document.getElementById('invSheet-number').value.trim();
  const invoice_date = document.getElementById('invSheet-date').value || null;
  const item_type    = document.getElementById('invSheet-type').value;
  const amount       = parseFloat(document.getElementById('invSheet-amount').value);
  const category     = document.getElementById('invSheet-category').value.trim();
  const description  = document.getElementById('invSheet-desc').value.trim();
  const paid_by_client = document.getElementById('invSheet-paid-client').checked;
  if(paid_by_client&&typeof ARHITTEKCash!=='undefined'&&ARHITTEKCash.invoicePaymentState(state,inv).rows.length){
    showToast('У накладной есть оплата компании. Сначала отмените её в истории оплаты.');return;
  }

  if(!Number.isFinite(amount) || amount <= 0){ showToast('Укажите сумму'); return; }
  if(!Number.isSafeInteger(Math.round(amount*100))||amount!==Math.round(amount*100)/100){showToast('Введите сумму с точностью до копейки');return;}
  if(typeof ARHITTEKCash!=='undefined' && Math.round(amount*100)<Math.round(ARHITTEKCash.invoicePaymentState(state,inv).paid*100)){
    showToast('Сумма меньше уже записанной оплаты. Сначала исправьте оплату в истории.');return;
  }
  if(!invoice_date){ showToast('Укажите дату накладной'); return; }

  invoiceSheetSavesInFlight.add(invoiceId);
  syncInvoiceActions();
  let persisted=false;
  showToast('Сохранение…');
  try{
    const changes={number,invoice_date,item_type,amount,category,description,paid_by_client};
    if(removeAttachment)changes.photo_url='';
    if(photoBlob){
      const fileName = `${inv.project_id}/${crypto.randomUUID()}_edit.jpg`;
      changes.photo_url = await uploadInvoiceDocument(photoBlob, fileName,()=>canAccessConstructionProject(inv.project_id,actor));
    }

    if(!canAccessConstructionProject(inv.project_id,actor))throw new Error('Сеанс или доступ к объекту изменился');
    const {data,error} = await matchOpenedInvoice(sb.from('invoices').update(changes),inv).select('id').maybeSingle();
    if(error) throw error;
    if(!data){
      await loadAll();
      if(currentObjectId===inv.project_id){
        const current=state.projects.find(project=>project.id===inv.project_id);
        if(current){renderObjectSummary(current);renderObjTabContent();}
      }
      showToast('Накладная изменена или удалена. Скопируйте нужные правки и откройте документ заново.');
      return;
    }
    persisted=true;

    // Read the complete server total: another invoice may have changed while
    // this photo was uploading. Never copy the amount into the next open row.
    await refreshInvoiceExpenseTotal(inv.project_id,actor);

    if(!canAccessConstructionProject(inv.project_id,actor))throw new Error('Сеанс или доступ к объекту изменился');
    await logAudit('project', inv.project_id, (state.projects.find(p=>p.id===inv.project_id)||{}).name||'', 'update', {invoice_edited:{old:`${inv.number}—${fmtMoney(inv.amount)}`, new:`${number}—${fmtMoney(amount)}`}});

    if(invoiceFormGeneration===generation&&invSheetCurrentId===invoiceId){
      document.getElementById('invoiceSheetOverlay').dataset.dirty='0';
      closeInvoiceSheet();
    }
    const refreshed=await loadAll();
    if(currentObjectId === inv.project_id){ const p=state.projects.find(x=>x.id===inv.project_id); if(p) renderObjectSummary(p); if(['materials','works'].includes(activeObjTab))renderObjTabContent(); }
    showToast(refreshed===false?'Накладная сохранена. Не удалось обновить список — повторите обновление':'Накладная обновлена');
  }catch(e){
    console.error(e);
    showToast(persisted?'Накладная сохранена. Не удалось обновить итог проекта — повторите обновление':'Ошибка сохранения накладной');
  }finally{
    invoiceSheetSavesInFlight.delete(invoiceId);
    syncInvoiceActions();
  }
}

async function deleteInvoiceSheet(){
  const inv=openedInvoice;
  if(!inv||invoiceSheetSavesInFlight.has(inv.id))return;
  const invoiceId=inv.id,generation=invoiceFormGeneration;
  if(!canAccessConstructionProject(inv.project_id)){showToast('Нет доступа к этому объекту');return;}
  const actor={employeeId:session.employeeId,token:session.token,isAdmin:!!session.isAdmin};
  if(typeof ARHITTEKCash!=='undefined'&&ARHITTEKCash.invoicePaymentState(state,inv).rows.length){
    showToast('У накладной есть связанные оплаты. Сначала отмените их в истории.');return;
  }
  if(!confirm('Удалить накладную '+(inv.number||'без номера')+' на '+constructionMoney(inv.amount)+'? Это необратимо.'))return;
  invoiceSheetSavesInFlight.add(invoiceId);
  syncInvoiceActions();
  let persisted=false;
  try{
    if(!canAccessConstructionProject(inv.project_id,actor))throw new Error('Сеанс или доступ к объекту изменился');
    const {data,error}=await matchOpenedInvoice(sb.from('invoices').delete(),inv).select('id').maybeSingle();
    if(error)throw error;
    if(!data){
      if(invSheetCurrentId===invoiceId&&invoiceFormGeneration===generation)closeInvoiceSheet();
      await loadAll();
      if(currentObjectId===inv.project_id){
        const current=state.projects.find(p=>p.id===inv.project_id);
        if(current){renderObjectSummary(current);renderObjTabContent();}
      }
      showToast('Накладная изменена или уже удалена. Проверьте актуальный список.');
      return;
    }
    persisted=true;

    await refreshInvoiceExpenseTotal(inv.project_id,actor);

    if(invSheetCurrentId===invoiceId&&invoiceFormGeneration===generation)closeInvoiceSheet();
    await loadAll();
    if(currentObjectId === inv.project_id){ const p=state.projects.find(x=>x.id===inv.project_id); if(p) renderObjectSummary(p); renderObjTabContent(); }
    showToast('Накладная удалена');
  }catch(e){ console.error(e); showToast(persisted?'Накладная удалена. Не удалось обновить итоги — обновите объект':'Ошибка удаления'); }finally{
    invoiceSheetSavesInFlight.delete(invoiceId);
    syncInvoiceActions();
  }
}


async function exportConstrPdf(projectId){
  if(state.financialDataReady===false){showToast('Финансовые данные не подтверждены. Обновите приложение.');return;}
  if(!session?.isAdmin||!canAccessConstructionProject(projectId)){showToast('Нет доступа к финансовому отчёту объекта');return;}
  const p = state.projects.find(x=>x.id===projectId);
  if(!p) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4'});
  registerPdfFonts(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin*2;

  // Header
  const logoSize = 12;
  doc.addImage(ARHITTEK_LOGO_B64, 'PNG', margin, 10, logoSize, logoSize * (87/100));
  const textX = margin + logoSize + 4;
  doc.setFont('Roboto','bold'); doc.setFontSize(16);
  doc.setTextColor(0); doc.text('ARHIT', textX, 18);
  const aw = doc.getTextWidth('ARHIT');
  doc.setTextColor(69,134,236); doc.text('TEK', textX+aw, 18);
  doc.setTextColor(0);
  doc.setFont('Roboto','normal'); doc.setFontSize(10);
  doc.text('Отчёт по объекту', textX, 24);

  doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`Дата отчёта: ${fmtDate(financeToday())}`, pageWidth-margin, 18, {align:'right'});
  doc.setTextColor(0);

  let y = 34;
  doc.setFont('Roboto','bold'); doc.setFontSize(14);
  doc.text(p.name, margin, y); y += 7;

  // Summary block — расходы всегда пересчитываются из накладных (см. getProjectExpenses),
  // чтобы отчёт клиенту совпадал с тем, что видно на экране «Стройка».
  const price = Number(p.price)||0;
  const constrFin = getConstructionFinancials(p);
  const expenses = constrFin.expenses;
  const balance = constrFin.cashRemaining;
  const received = constrFin.received;

  doc.setFont('Roboto','normal'); doc.setFontSize(9);
  const summaryRows = [
    ['Приход от заказчика:', `${fmt(received)} руб.`],
    ['Выплачено из денег объекта:', `${fmt(constrFin.cashOutgoing)} руб.`],
    ['Деньги объекта по журналу:', `${fmt(balance)} руб.`],
    ...(constrFin.isOverspent?[['Перерасход по журналу:', `${fmt(constrFin.cashOverspend)} руб.`]]:[]),
    ['Заказчик оплатил напрямую:', `${fmt(constrFin.directPaid)} руб.`],
    ['Стоимость документов и начислений:', `${fmt(expenses)} руб.`],
    ['Оплата накладных не подтверждена:', `${fmt(constrFin.unpaidInvoices)} руб.`],
    ['Расходы по документам:', `${constructionAmount(constrFin.companyMarkupBase)} руб.`],
    ['Расчётная наценка ARHITTEK'+(constrFin.companyMarkupRate===null?'':` ${constructionAmount(constrFin.companyMarkupRate)}%`)+':', constrFin.companyMarkupAmount===null?'Ставка не указана':`${constructionAmount(constrFin.companyMarkupAmount)} руб.`],
    ['Расходы с наценкой:', constrFin.totalWithMarkup===null?'Не определены':`${constructionAmount(constrFin.totalWithMarkup)} руб.`],
    ['Гонорар компании, записанный ранее:', `${constructionAmount(constrFin.companyMarkupRecordedPaid)} руб.`],
    ['Расчётный остаток аванса:', constrFin.advanceRemaining===null?'Не определён':`${constructionAmount(constrFin.advanceRemaining)} руб.`],
    ...(constrFin.isCalculatedDeficit?[['Не хватает аванса по расчёту:', `${constructionAmount(constrFin.advanceShortfall)} руб.`]]:[]),
  ];
  summaryRows.forEach(([lbl,val])=>{
    doc.setFont('Roboto','bold');
    doc.text(lbl, margin, y);
    doc.setFont('Roboto','normal');
    doc.text(val, pageWidth-margin, y, {align:'right'});
    y += 5.5;
  });

  doc.setFont('Roboto','normal');doc.setFontSize(8);doc.setTextColor(100);
  const calculationNote=doc.splitTextToSize('Наценка рассчитана сверх расходов по документам. Аванс сам по себе не создаёт наценку. Оплата накладных и фактическое наличие денег подтверждаются отдельно.',contentWidth);
  doc.text(calculationNote,margin,y);y+=calculationNote.length*4+2;doc.setTextColor(0);

  y += 4;
  doc.setDrawColor(200); doc.line(margin, y, pageWidth-margin, y); y += 6;

  const projInvoices = state.invoices.filter(inv=>inv.project_id===projectId&&!inv.deleted_at&&(!inv.invoice_date||inv.invoice_date<=financeToday()));
  const materials = projInvoices.filter(i=>i.item_type!=='Работа');
  const works = projInvoices.filter(i=>i.item_type==='Работа');

  function printSection(title, items){
    if(!items.length) return;
    if(y > 255){ doc.addPage(); y = 20; }

    doc.setFont('Roboto','bold'); doc.setFontSize(11);
    doc.text(title, margin, y); y += 7;

    // Group by category
    const catGroups = {};
    items.forEach(inv=>{
      const cat = inv.category || 'Прочее';
      if(!catGroups[cat]) catGroups[cat] = [];
      catGroups[cat].push(inv);
    });

    Object.entries(catGroups).sort((a,b)=>b[1].reduce((s,x)=>s+Number(x.amount),0)-a[1].reduce((s,x)=>s+Number(x.amount),0)).forEach(([catName, invItems])=>{
      if(y > 268){ doc.addPage(); y = 20; }
      const catTotal = invItems.reduce((s,i)=>s+Number(i.amount),0);

      doc.setFillColor(230,238,248);
      doc.rect(margin, y-4, contentWidth, 7, 'F');
      doc.setFont('Roboto','bold'); doc.setFontSize(9);
      doc.text(catName.toUpperCase(), margin+2, y);
      doc.text(`${fmt(catTotal)} руб.`, pageWidth-margin, y, {align:'right'});
      y += 6;

      doc.setFont('Roboto','normal'); doc.setFontSize(8);
      invItems.forEach(inv=>{
        if(y > 275){ doc.addPage(); y = 20; }
        const dateStr = inv.invoice_date ? fmtDate(inv.invoice_date) : '';
        const numStr = (inv.number||'').slice(0,30);
        const descStr = (inv.description||'').slice(0,50);
        const label = numStr === descStr ? numStr : (numStr ? numStr + (descStr ? ' / '+descStr : '') : descStr);
        doc.setTextColor(0);
        // Ширина колонки названия должна заканчиваться ДО колонки даты (margin+80),
        // иначе длинные названия накладных наезжают на дату — как на скриншоте отчёта.
        doc.text(doc.splitTextToSize(label, 74)[0], margin+2, y);
        if(dateStr){ doc.setTextColor(140); doc.text(dateStr, margin+80, y); doc.setTextColor(0); }
        doc.setFont('Roboto','bold');
        doc.text(`${fmt(inv.amount)} руб.`, pageWidth-margin, y, {align:'right'});
        doc.setFont('Roboto','normal');
        y += 4.5;
      });
      y += 2;
    });

    // Section total
    const secTotal = items.reduce((s,i)=>s+Number(i.amount),0);
    doc.setFont('Roboto','bold'); doc.setFontSize(9);
    doc.text(`Итого ${title.toLowerCase()}:`, margin, y);
    doc.text(`${fmt(secTotal)} руб.`, pageWidth-margin, y, {align:'right'});
    doc.setFont('Roboto','normal');
    y += 8;
  }

  printSection('Материалы и чеки', materials);
  printSection('Работы', works);

  // Grand total
  if(y > 265){ doc.addPage(); y = 20; }
  doc.setDrawColor(0); doc.line(margin, y, pageWidth-margin, y); y += 6;
  doc.setFont('Roboto','bold'); doc.setFontSize(11);
  const invTotal = projInvoices.reduce((s,i)=>s+Number(i.amount),0);
  doc.text('Итого накладных:', margin, y);
  doc.text(`${fmt(invTotal)} руб.`, pageWidth-margin, y, {align:'right'});

  // Footer
  y = 285;
  doc.setFont('Roboto','normal'); doc.setFontSize(7); doc.setTextColor(140);
  doc.text('ARHITTEK — архитектурное проектирование, дизайн интерьера, ремонт под ключ', margin, y);
  pdfCompanyAddress(doc, margin, y+4, 0);

  const fileName = `Otchet-${p.name.replace(/[^a-zA-Zа-яА-Я0-9]/g,'_')}-${financeToday()}.pdf`;
  deliverDocumentPdf(doc,fileName);
}



async function updateObjField(id, field, value){
  if(!canAccessConstructionProject(id)){showToast('Нет доступа к этому объекту');return false;}
  // Deprecated legacy entry point: there is no current UI or validated field
  // schema for these inline writes. Use the project editor and payment forms.
  showToast('Измените данные объекта в карточке проекта');
  return false;
}

async function uploadExpensePhoto(projectId, inputEl){
  if(!canAccessConstructionProject(projectId)){showToast('Нет доступа к этому объекту');return;}
  const actor={employeeId:session.employeeId,token:session.token,isAdmin:!!session.isAdmin};
  const file = inputEl.files[0];
  if(!file) return;

  const descField=document.getElementById(`photo-desc-${projectId}`),amountField=document.getElementById(`photo-amt-${projectId}`);
  const desc = descField?.value.trim()||'';
  const amtRaw = amountField?.value||'';
  const amount = amtRaw ? parseFloat(amtRaw) : null;

  showToast('Загрузка фото…');

  let persisted=false;
  try{
    const ext = file.name.split('.').pop();
    const fileName = `${projectId}/${Date.now()}.${ext}`;
    const {error: upErr} = await sb.storage.from('construction-documents').upload(fileName, file);
    if(upErr) throw upErr;

    const {data: urlData} = sb.storage.from('construction-documents').getPublicUrl(fileName);
    const photo_url = urlData.publicUrl;

    if(!canAccessConstructionProject(projectId,actor))throw new Error('Сеанс или доступ к объекту изменился');
    const {error: insErr} = await sb.from('expense_photos').insert({
      project_id: projectId,
      description: desc,
      amount: amount,
      photo_url: photo_url,
    });
    if(insErr) throw insErr;
    persisted=true;

    const p = state.projects.find(x=>x.id===projectId);
    if(!canAccessConstructionProject(projectId,actor))throw new Error('Сеанс или доступ к объекту изменился');
    await logAudit('project', projectId, p?p.name:'', 'update', {photo: {old:null, new: desc || 'фото расхода'}});

    if(descField?.isConnected)descField.value='';
    if(amountField?.isConnected)amountField.value='';
    inputEl.value = '';

    showToast('Фото добавлено');
    await loadAll();
  }catch(e){
    console.error(e);
    showToast(persisted?'Фото добавлено. Не удалось обновить объект — повторите обновление':'Ошибка загрузки фото');
  }
}

