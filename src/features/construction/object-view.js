// ============================================================
// OBJECT DETAIL VIEW (separate screen)
// ============================================================
let currentObjectId = null;
let constructionReturnScrollY = 0;
let activeObjTab = 'materials';

function openObjectView(id){
  if(!canAccessConstructionProject(id)){showToast('Нет доступа к этому объекту');return;}
  const activeView=document.querySelector('.view.active');
  if(activeView?.id==='view-construction') constructionReturnScrollY=window.scrollY||0;
  currentObjectId = id;
  activeObjTab = 'materials';
  const p = state.projects.find(x=>x.id===id);
  if(!p) return;

  document.getElementById('objTitle').textContent = p.name;
  renderObjectSummary(p);

  // Always show and render tabs regardless of admin/non-admin
  const tabsEl = document.getElementById('objTabs');
  if(tabsEl) tabsEl.style.display = '';
  renderObjTabs();
  renderObjTabContent();

  // Navigate to object view
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-object').classList.add('active');
  document.querySelector('.nav-btn[data-view="view-construction"]')?.classList.add('active');
  const fab = document.getElementById('addProjectFab');
  if(fab) fab.style.display = 'none';
  window.scrollTo(0,0);
}

function renderObjectSummary(p){
  const showFinance = !!session?.isAdmin;
  const el = document.getElementById('objSummary');
  const pdfBtn = document.getElementById('objPdfBtn');
  const editBtn = document.getElementById('objEditBtn');

  if(pdfBtn){ pdfBtn.style.display = showFinance&&state.financialDataReady!==false ? '' : 'none'; pdfBtn.onclick = ()=>exportConstrPdf(p.id); }
  if(editBtn){ editBtn.style.display = ''; editBtn.onclick = ()=>openProjectSheet(p.id); }

  if(!showFinance){
    el.innerHTML = '';
    return;
  }

  if(state.financialDataReady===false){el.innerHTML='<div class="note">Финансовые данные не подтверждены. Обновите приложение.</div>';return;}
  const fin=getConstructionFinancials(p);
  const {received, directPaid, matTotal, workTotal, otherTotal, manualTotal, expenses, cashOutgoing, unpaidInvoices, rolePayouts, undatedCashRows, balance, isOverspent} = fin;

  const noBudgetWarning = received === 0 && cashOutgoing > 0
    ? `<div style="background:rgba(232,163,61,0.12); border:1px solid rgba(232,163,61,0.3); border-radius:10px; padding:10px 12px; margin-bottom:10px; font-size:12px; color:var(--gold);">⚠ Приход от заказчика не зарегистрирован — добавьте поступление для корректного расчёта остатка.</div>`
    : '';
  const overspentWarning = isOverspent
    ? `<div style="background:rgba(224,82,82,0.12); border:1px solid rgba(224,82,82,0.3); border-radius:10px; padding:10px 12px; margin-bottom:10px; font-size:12px; color:var(--red);">Выплаты превышают полученные деньги на ${fmtMoney(Math.abs(balance))}. Проверьте финансирование объекта.</div>`
    : '';

  document.getElementById('objSummary').innerHTML = `
    ${noBudgetWarning}${overspentWarning}
    <div class="note">Остаток рассчитан по денежному журналу объекта. Неоплаченные накладные и начисления показаны отдельно; фактическое наличие денег требует сверки.</div>
    ${undatedCashRows?'<div class="note" style="color:var(--red)">Есть денежные записи без даты: '+undatedCashRows+'. Историю нужно уточнить.</div>':''}
    <div class="fee-card">
      <div class="fee-row"><div class="fl">Получено компанией от заказчика</div><div class="fv" style="color:var(--green)">${fmtMoney(received)}</div></div>
      <div class="fee-row"><div class="fl">Выплачено из денег объекта</div><div class="fv" style="color:var(--red)">${fmtMoney(cashOutgoing)}</div></div>
      <div class="fee-row total"><div class="fl">Деньги объекта по журналу</div><div class="fv" style="color:${isOverspent?'var(--red)':'var(--gold)'}">${fmtMoney(balance)}</div></div>
      ${directPaid > 0 ? `<div class="fee-row"><div class="fl">Заказчик оплатил поставщикам напрямую</div><div class="fv">${fmtMoney(directPaid)}</div></div>` : ''}
      <div class="fee-row"><div class="fl">Накладные на материалы</div><div class="fv">${fmtMoney(matTotal)}</div></div>
      <div class="fee-row"><div class="fl">Накладные на работы</div><div class="fv">${fmtMoney(workTotal)}</div></div>
      ${otherTotal>0?`<div class="fee-row"><div class="fl">Прочие накладные</div><div class="fv">${fmtMoney(otherTotal)}</div></div>`:''}
      ${manualTotal>0?`<div class="fee-row"><div class="fl">Расходы без накладной</div><div class="fv">${fmtMoney(manualTotal)}</div></div>`:''}
      <div class="fee-row"><div class="fl">Оплата накладных не подтверждена</div><div class="fv">${fmtMoney(unpaidInvoices)}</div></div>
      ${rolePayouts>0?`<div class="fee-row"><div class="fl">Начисления за объёмы работ</div><div class="fv">${fmtMoney(rolePayouts)}</div></div>`:''}
    </div>
    ${constructionCompanyFeePlanHtml(p,fin)}
    <div id="objIncomeHistoryBlock"></div>
  `;
  renderObjectIncomeHistory(p.id);
}

function constructionCompanyFeePlanHtml(p,fin=null){
  const f=fin||getConstructionFinancials(p),rate=f.companyMarkupRate;
  const rateText=rate===null?'Ставка не указана':constructionAmount(rate)+'% сверх расходов';
  const legacyNote=rate!==null&&rate!==15?'<p class="note">Сохранена ставка этого объекта '+constructionAmount(rate)+'%. Для новых объектов применяется 15%.</p>':'';
  return '<div class="card construction-company-fee-plan"><strong>Открытая наценка ARHITTEK</strong>'+
    '<p class="note">'+rateText+'. Расчёт по документам объекта; аванс сам по себе наценку не создаёт.</p>'+
    '<div class="fee-row"><div class="fl">Расходы по документам</div><div class="fv">'+constructionMoney(f.companyMarkupBase)+'</div></div>'+
    '<div class="fee-row"><div class="fl">Расчётная наценка компании</div><div class="fv">'+constructionMoney(f.companyMarkupAmount)+'</div></div>'+
    '<div class="fee-row total"><div class="fl">Расходы с наценкой</div><div class="fv">'+constructionMoney(f.totalWithMarkup)+'</div></div>'+
    '<div class="fee-row"><div class="fl">Гонорар компании, записанный ранее</div><div class="fv">'+constructionMoney(f.companyMarkupRecordedPaid)+'</div></div>'+
    '<div class="fee-row"><div class="fl">Расчётный остаток аванса после расходов и наценки</div><div class="fv" style="color:'+(f.isCalculatedDeficit?'var(--red)':'var(--text)')+'">'+constructionMoney(f.calculatedAdvanceBalance)+'</div></div>'+
    '<p class="note">Прямые оплаты заказчика учтены в расходах и наценке, но не вычитаются повторно из переданного нам аванса. Оплата накладных подтверждается отдельно. Этот расчёт не изменяет деньги по журналу и свободный резерв.</p>'+legacyNote+'</div>';
}

// История поступлений от заказчика по объекту стройки — когда и сколько пришло
function renderObjectIncomeHistory(projectId){
  const container = document.getElementById('objIncomeHistoryBlock');
  if(!container) return;
  const incomeTypes = ['advance','final_payment','materials_budget','construction_budget','income'];
  const entries = (state.ledger||[])
    .filter(l=>l.project_id===projectId && !l.deleted_at && incomeTypes.includes(l.type)&&(!l.entry_date||l.entry_date<=financeToday()))
    .sort((a,b)=> new Date(b.entry_date) - new Date(a.entry_date) || new Date(b.created_at) - new Date(a.created_at));

  const received = entries.reduce((s,e)=>s+Number(e.amount||0),0);

  const addBtn = `<button class="btn btn-secondary" style="width:auto;padding:6px 14px;font-size:12px;" onclick="openPaymentSheet('${projectId}')">+ Приход</button>`;

  const rows = entries.length
    ? entries.map(e=>{
        const emp = e.received_by ? findEmployee(e.received_by) : null;
        return `<div class="list-item">
          <div>
            <div class="li-name" style="color:var(--green);">+ ${fmtMoney(e.amount)}</div>
            <div class="li-meta">${fmtDate(e.entry_date)}${emp?' · принял: '+escapeHtml(emp.name):''}${e.description?' · '+escapeHtml(e.description):''}</div>
          </div>
          <div class="li-actions">
            <button class="icon-btn danger" title="Отменить приход" onclick="cancelPayment('${e.id}')">↩</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty-state">Поступлений пока нет</div>';

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
      <div class="section-label" style="margin:0;flex:1;">
        <span class="lbl-text">История поступлений${entries.length ? ' · получено '+fmtMoney(received) : ''}</span>
        <span class="section-label-line"></span>
      </div>
    </div>
    <div style="margin-bottom:10px;">${addBtn}</div>
    ${rows}
  `;
}

// Строка накладной (с категорией) для плоского списка материалов/работ
function makeInvoiceRow(inv){
  const typeCls = inv.item_type==='Работа'?'work':inv.item_type==='Доставка'?'del':'mat';
  return `<div class="inv-row" onclick="openInvoiceSheet('${inv.id}')" style="cursor:pointer;" title="Открыть накладную">
      <div style="min-width:0;">
        <div class="inv-num">${escapeHtml(inv.number||inv.description||'—')}</div>
        ${inv.description && inv.number && inv.description!==inv.number ? `<div class="inv-desc">${escapeHtml(inv.description)}</div>` : ''}
        <span class="inv-type-badge inv-type-${typeCls}">${escapeHtml(inv.item_type)}</span>
        ${inv.category ? `<span class="inv-type-badge" style="background:rgba(22,35,58,0.08);color:var(--text-dim);">${escapeHtml(inv.category)}</span>` : ''}
        ${inv.paid_by_client ? `<span class="inv-type-badge" style="background:rgba(232,163,61,0.15);color:var(--gold);" title="Заказчик оплатил напрямую, минуя компанию">🤝 Оплачено заказчиком</span>` : ''}
      </div>
      <div class="inv-right">
        <div class="inv-amount ${typeCls}">${fmtMoney(inv.amount)}</div>
        ${inv.invoice_date ? `<div class="inv-date">${fmtDate(inv.invoice_date)}</div>` : ''}
        ${inv.photo_url ? `<span style="font-size:14px;" title="Есть фото">📎</span>` : ''}
      </div>
    </div>`;
}

// Поиск по накладной: номер / цена / дата / описание
function invoiceMatchesQuery(inv, q){
  if(!q) return true;
  q = q.trim().toLowerCase();
  if(!q) return true;
  const num  = (inv.number||'').toLowerCase();
  const desc = (inv.description||'').toLowerCase();
  const amt  = String(inv.amount||'').toLowerCase();
  const dISO = (inv.invoice_date||'').toLowerCase();
  const dRu  = inv.invoice_date ? fmtDate(inv.invoice_date).toLowerCase() : '';
  return num.indexOf(q)!==-1 || desc.indexOf(q)!==-1 || amt.indexOf(q)!==-1 || dISO.indexOf(q)!==-1 || dRu.indexOf(q)!==-1;
}

let objSearch = {materials:'', works:''};

// Рендер плоского списка накладных с учётом поиска и сортировки по дате (новые сверху)
function renderObjInvoiceList(kind){
  const listEl = document.getElementById('objInvList');
  if(!listEl) return;
  const projInvoices = state.invoices.filter(inv=>inv.project_id===currentObjectId&&!inv.deleted_at);
  let base = kind==='works'
    ? projInvoices.filter(i=>i.item_type==='Работа')
    : projInvoices.filter(i=>i.item_type!=='Работа');
  const q = objSearch[kind] || '';
  const filtered = base.filter(inv=>invoiceMatchesQuery(inv, q));
  // сортировка по дате, самая новая запись сверху
  filtered.sort((a,b)=>(b.invoice_date||'').localeCompare(a.invoice_date||'') || String(b.created_at||'').localeCompare(String(a.created_at||'')));
  if(!filtered.length){
    listEl.innerHTML = `<div class="empty-state">${q ? 'Ничего не найдено' : 'Записей нет'}</div>`;
    return;
  }
  const total = filtered.reduce((s,i)=>s+Number(i.amount||0),0);
  listEl.innerHTML =
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 2px 8px;font-size:11px;color:var(--text-dim);">
       <span>${filtered.length} ${q?'найдено':'записей'}</span>
       <span style="font-weight:700;color:var(--text);">Итого: ${fmtMoney(total)}</span>
     </div>` +
    filtered.map(makeInvoiceRow).join('');
}

function onObjSearchInput(kind, val){
  objSearch[kind] = val;
  renderObjInvoiceList(kind);
}

function renderObjTabs(){
  const el = document.getElementById('objTabs');
  const tabs = [
    {id:'materials', label:'📦 Материалы'},
    {id:'works', label:'🔨 Работы'},
    {id:'add', label:'+ Добавить'},
    {id:'photos', label:'📷 Фото'},
    {id:'audit', label:'🔍 Сверка'},
  ];
  el.innerHTML = tabs.map(t=>`<div class="filter-chip ${activeObjTab===t.id?'active':''}" onclick="switchObjTab('${t.id}')">${t.label}</div>`).join('');
}

function switchObjTab(tab){
  activeObjTab = tab;
  renderObjTabs();
  renderObjTabContent();
}

function buildInvoiceGroupsHtml(invoices){
  if(!invoices.length) return '<div class="empty-state">Записей нет</div>';
  const catGroups = {};
  invoices.forEach(inv=>{
    const cat = inv.category || 'Прочее';
    if(!catGroups[cat]) catGroups[cat] = [];
    catGroups[cat].push(inv);
  });
  return Object.entries(catGroups)
    .sort((a,b)=>b[1].reduce((s,x)=>s+Number(x.amount),0)-a[1].reduce((s,x)=>s+Number(x.amount),0))
    .map(([catName, items])=>{
      const catTotal = items.reduce((s,i)=>s+Number(i.amount),0);
      const sorted = [...items].sort((a,b)=>(b.invoice_date||'').localeCompare(a.invoice_date||''));
      const makeRow = inv => `<div class="inv-row" onclick="openInvoiceSheet('${inv.id}')" style="cursor:pointer;" title="Открыть накладную">
          <div>
            <div class="inv-num">${escapeHtml(inv.number||inv.description||'—')}</div>
            ${inv.description && inv.number && inv.description!==inv.number ? `<div class="inv-desc">${escapeHtml(inv.description)}</div>` : ''}
            <span class="inv-type-badge inv-type-${inv.item_type==='Работа'?'work':inv.item_type==='Доставка'?'del':'mat'}">${escapeHtml(inv.item_type)}</span>
          </div>
          <div class="inv-right">
            <div class="inv-amount ${inv.item_type==='Работа'?'work':inv.item_type==='Доставка'?'del':'mat'}">${fmtMoney(inv.amount)}</div>
            ${inv.invoice_date ? `<div class="inv-date">${fmtDate(inv.invoice_date)}</div>` : ''}
            ${inv.photo_url ? `<span style="font-size:14px;" title="Есть фото">📎</span>` : ''}
          </div>
        </div>`;
      const top5Html = sorted.slice(0,5).map(makeRow).join('');
      const restHtml = sorted.length > 5 ? sorted.slice(5).map(makeRow).join('') : '';
      const uid = 'cat_' + Math.random().toString(36).slice(2,8);
      const hasMore = sorted.length > 5;
      const moreCount = sorted.length - 5;
      return `<div class="inv-cat-group">
        <div class="inv-cat-head" style="cursor:pointer;" onclick="(function(h){
          const rest=document.getElementById('${uid}');
          const btn=document.getElementById('${uid}_btn');
          const tog=h.querySelector('.cat-toggle');
          if(!rest)return;
          const open=rest.style.display!=='none';
          rest.style.display=open?'none':'block';
          tog.textContent=open?'▶':'▼';
          if(btn)btn.style.display=open?'flex':'none';
        })(this)">
          <div class="inv-cat-name">${escapeHtml(catName)}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="inv-cat-total">${fmtMoney(catTotal)}</div>
            ${hasMore?`<span style="font-size:10px;color:var(--text-muted)">${sorted.length} шт.</span>`:''}
            <span class="cat-toggle" style="font-size:10px;color:var(--text-muted)">▼</span>
          </div>
        </div>
        ${hasMore?`<div id="${uid}" style="display:block;">${restHtml}</div>
        <div id="${uid}_btn" onclick="(function(btn){
          const rest=document.getElementById('${uid}');
          const tog=btn.parentElement.querySelector('.cat-toggle');
          rest.style.display='none';
          tog.textContent='▶';
          btn.style.display='none';
        })(this)" style="display:flex;align-items:center;justify-content:center;gap:4px;padding:6px 0;color:var(--text-muted);font-size:11px;cursor:pointer;border-top:1px solid var(--line)">▲ Свернуть</div>`:''}
        <div style="border-top:${hasMore?'1px solid var(--line)':''}">${top5Html}</div>
      </div>`;
    }).join('');
}
function renderObjTabContent(){
  const el = document.getElementById('objTabContent');
  const projInvoices = state.invoices.filter(inv=>inv.project_id===currentObjectId&&!inv.deleted_at);

  if(activeObjTab === 'materials'){
    objSearch.materials = '';
    el.innerHTML = `
      <div class="field" style="margin:4px 0 8px;">
        <input type="text" id="objSearchInput" placeholder="🔍 Поиск: номер / цена / дата" oninput="onObjSearchInput('materials', this.value)">
      </div>
      <div class="card" style="margin-top:4px;"><div id="objInvList"></div></div>`;
    renderObjInvoiceList('materials');
  }
  else if(activeObjTab === 'works'){
    objSearch.works = '';
    el.innerHTML = `
      <div class="field" style="margin:4px 0 8px;">
        <input type="text" id="objSearchInput" placeholder="🔍 Поиск: запись / цена / дата" oninput="onObjSearchInput('works', this.value)">
      </div>
      <div class="card" style="margin-top:4px;"><div id="objInvList"></div></div>`;
    renderObjInvoiceList('works');
  }
  else if(activeObjTab === 'add'){
    const categories = [...new Set(projInvoices.map(i=>i.category).filter(Boolean))];
    el.innerHTML = `<div class="card" style="margin-top:4px;">
      <div class="add-invoice-form">
        <label>Номер накладной</label>
        <input type="text" id="inv-num-obj" placeholder="например: БИ 14.04.26">
        <label>Дата</label>
        <input type="date" id="inv-date-obj" value="${financeToday()}">
        <label>Категория</label>
        <select id="inv-cat-obj" onchange="(function(s){var c=document.getElementById('inv-cat-obj-custom');c.style.display=s.value==='__other__'?'block':'none';})(this)">
          <option value="">— выберите —</option>
          ${categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
          <option value="__other__">Другое…</option>
        </select>
        <input type="text" id="inv-cat-obj-custom" placeholder="Введите категорию вручную" style="display:none;margin-top:6px">
        <label>Описание</label>
        <input type="text" id="inv-desc-obj" placeholder="что куплено / какая работа">
        <label>Тип записи</label>
        <select id="inv-type-obj">
          <option value="Материал">Материал</option>
          <option value="Работа">Работа</option>
          <option value="Доставка">Доставка</option>
          <option value="Инструмент">Инструмент</option>
          <option value="Расходник">Расходник</option>
        </select>
        <label>Сумма, ₽</label>
        <input type="number" id="inv-amount-obj" placeholder="0">
        <div style="display:flex;align-items:center;gap:8px;margin:6px 0;">
          <input type="checkbox" id="inv-paid-client-obj" style="width:auto;">
          <label style="margin:0;" for="inv-paid-client-obj">🤝 Оплачено заказчиком напрямую (минуя компанию)</label>
        </div>
        <label>Фото накладной (необязательно)</label>
        <div style="display:flex; gap:8px; margin-bottom:6px;">
          <label class="photo-upload-label" style="flex:1; margin:0;" for="inv-photo-obj">🖼 Из галереи</label>
          <label class="photo-upload-label" style="flex:1; margin:0;" for="inv-camera-obj">📷 Сделать фото</label>
        </div>
        <input type="file" id="inv-photo-obj" accept="image/*" style="display:none;" onchange="onInvoicePhotoPicked(this,'inv-photo-status-obj')">
        <input type="file" id="inv-camera-obj" accept="image/*" capture="environment" style="display:none;" onchange="handleInvoicePhotoCapture(this,'inv-photo-obj','inv-photo-status-obj')">
        <div id="inv-photo-status-obj" style="font-size:11px; color:var(--text-dim); margin-bottom:8px;"></div>
        <button class="btn btn-primary" onclick="addInvoiceFromView()">Добавить запись</button>
      </div>
    </div>`;
  }
  else if(activeObjTab === 'photos'){
    const photoMap=new Map();
    state.photos.filter(ph=>ph.project_id===currentObjectId&&!ph.deleted_at&&ph.photo_url).forEach(ph=>photoMap.set(ph.photo_url,{...ph,sourceLabel:'Фото объекта'}));
    projInvoices.filter(inv=>!inv.deleted_at&&inv.photo_url).forEach(inv=>photoMap.set(inv.photo_url,{photo_url:inv.photo_url,amount:inv.amount,invoice_id:inv.id,sourceLabel:inv.description||inv.number||'Накладная'}));
    const photos=[...photoMap.values()];
    el.innerHTML = `<div class="card" style="margin-top:4px;">
      <div class="photo-grid">
        ${photos.length ? photos.map(ph=>`
          <div class="photo-thumb">
            <img src="${escapeHtml(ph.photo_url)}" alt="" loading="lazy">
            ${ph.amount ? `<div class="photo-amt">${fmtMoney(ph.amount)}</div>` : ''}
            ${ph.invoice_id?`<button type="button" class="btn btn-secondary" style="padding:6px;font-size:11px" data-photo-invoice="${escapeHtml(ph.invoice_id)}">${escapeHtml(ph.sourceLabel)}</button>`:''}
          </div>`).join('') : '<div class="empty-state" style="grid-column:1/-1; padding:14px;">Фото пока нет</div>'}
      </div>
    </div>`;
    el.querySelectorAll('[data-photo-invoice]').forEach(button=>button.addEventListener('click',()=>openInvoiceSheet(button.dataset.photoInvoice)));
  }
  else if(activeObjTab === 'audit'){
    el.innerHTML = buildObjectAuditHtml(currentObjectId);
  }
}

