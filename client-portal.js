/* Customer-only construction portal. No employee client, database key, or table fallback. */
(function (root) {
  'use strict';
  const MAX_MONEY = 1000000000000; // Integer kopeks; calculations remain within safe integers.
  const MAX_ROWS = 10000, MAX_DOCUMENT_BYTES = 25 * 1024 * 1024, MAX_JSON_BYTES = 5 * 1024 * 1024;
  const MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  const FILE_EXTENSIONS = {'application/pdf':['pdf'],'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/webp':['webp']};
  const STATES = new Set(['planned', 'in_progress', 'completed', 'accepted']);
  const STATUS_LABELS = {planned:'Запланировано',in_progress:'В работе',completed:'Выполнено',accepted:'Принято'};
  const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
  function invalid() { throw new Error('Invalid client portal response'); }
  function object(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const own = Object.keys(value);
    if (own.length !== keys.length || own.some(key => !keys.includes(key))) invalid();
    return value;
  }
  function text(value, max = 250, empty = false) {
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
    return value;
  }
  function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) invalid(); return value; }
  function money(value, signed = false) {
    if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY || (!signed && value < 0)) invalid();
    return value;
  }
  function add(a, b) { const result = a + b; if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_MONEY) invalid(); return result; }
  function date(value, nullable = true) {
    if (value === null && nullable) return value;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
    const parsed = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) invalid();
    return value;
  }
  function instant(value, nullable = false) {
    if (value === null && nullable) return value;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) invalid();
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) invalid();
    date(value.slice(0,10), false);
    return parsed;
  }
  function collection(value) { if (!Array.isArray(value) || value.length > MAX_ROWS) invalid(); return value; }
  function unique(rows) { const set = new Set(); for (const row of rows) { if (set.has(row.id)) invalid(); set.add(row.id); } return set; }
  function scope(row, expected) { if (id(row.scope_ref) !== expected) invalid(); }
  function exactFee(amount,rateBps = 1500) { if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10000) invalid(); return Number((BigInt(amount) * BigInt(rateBps) + 5000n) / 10000n); }
  function quantityAmount(quantity,unitPrice) {
    const [whole,fraction = ''] = quantity.split('.'), denominator = 10n ** BigInt(fraction.length);
    return Number((BigInt(whole + fraction) * BigInt(unitPrice) + denominator / 2n) / denominator);
  }
  function validatePricing(p) {
    object(p,['terms_confirmed','fee_basis','fee_rate_bps','fee_mode','cost_facts_complete','confirmed_cost_base_kopeks','fee_total_kopeks','chargeable_cost_total_kopeks']);
    if (typeof p.terms_confirmed !== 'boolean' || typeof p.cost_facts_complete !== 'boolean' || (!Number.isSafeInteger(p.fee_rate_bps) || p.fee_rate_bps < 0 || p.fee_rate_bps > 10000) || p.fee_basis !== 'actual_cost_markup' || p.fee_mode !== 'on_top') invalid();
    if (p.cost_facts_complete) money(p.confirmed_cost_base_kopeks);
    else if (p.confirmed_cost_base_kopeks !== null) invalid();
    if (!p.terms_confirmed || !p.cost_facts_complete) {
      if (p.fee_total_kopeks !== null || p.chargeable_cost_total_kopeks !== null) invalid();
      return;
    }
    const fee = exactFee(p.confirmed_cost_base_kopeks,p.fee_rate_bps);
    if (money(p.fee_total_kopeks) !== fee || money(p.chargeable_cost_total_kopeks) !== add(p.confirmed_cost_base_kopeks,fee)) invalid();
  }
  function validateSnapshot(s, now = Date.now()) {
    object(s,['schema_version','scope','complete','generated_at','access_expires_at','project','pricing','cash','stages','work_items','invoices','other_costs','receipts','refunds','row_counts']);
    if (s.schema_version !== 2 || s.scope !== 'construction_client_readonly' || s.complete !== true) invalid();
    const generated = instant(s.generated_at), expires = instant(s.access_expires_at);
    if (generated > now + 120000 || generated < now - 300000 || expires <= now) invalid();
    const asOf = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(generated));
    function actualDate(value) { date(value,false); if (value > asOf) invalid(); }
    function actualInstant(value) { const timestamp = instant(value,true); if (timestamp !== null && timestamp > generated) invalid(); }
    object(s.project,['reference','name','address','status']);
    const project = id(s.project.reference);
    text(s.project.name,250); text(s.project.address,500,true); text(s.project.status,100);
    validatePricing(s.pricing);
    object(s.cash,['classification_ok','received_kopeks','direct_paid_kopeks','company_spent_kopeks','fee_allocated_kopeks','refunded_kopeks','held_kopeks','accountable_outstanding_kopeks']);
    if (typeof s.cash.classification_ok !== 'boolean') invalid();
    for (const key of ['received_kopeks','direct_paid_kopeks','fee_allocated_kopeks','refunded_kopeks']) money(s.cash[key]);
    if (s.cash.classification_ok) {
      money(s.cash.company_spent_kopeks); money(s.cash.held_kopeks,true); money(s.cash.accountable_outstanding_kopeks);
      add(s.cash.held_kopeks,-s.cash.accountable_outstanding_kopeks);
      if (s.cash.held_kopeks !== add(add(add(s.cash.received_kopeks,-s.cash.company_spent_kopeks),-s.cash.fee_allocated_kopeks),-s.cash.refunded_kopeks)) invalid();
      if (s.pricing.terms_confirmed && s.pricing.fee_total_kopeks !== null && s.cash.fee_allocated_kopeks > s.pricing.fee_total_kopeks) invalid();
    } else if (s.cash.company_spent_kopeks !== null || s.cash.held_kopeks !== null || s.cash.accountable_outstanding_kopeks !== null) invalid();
    collection(s.stages); collection(s.work_items); collection(s.invoices); collection(s.other_costs); collection(s.receipts); collection(s.refunds);
    const stageIds = unique(s.stages); unique(s.work_items); unique(s.invoices); unique(s.other_costs); unique(s.receipts); unique(s.refunds);
    for (const st of s.stages) {
      object(st,['id','scope_ref','name','status','due_date','completed_at']);
      id(st.id); scope(st,project); text(st.name,250);
      if (!STATES.has(st.status) || st.status === 'accepted') invalid();
      date(st.due_date); actualInstant(st.completed_at);
      if ((st.status === 'completed') !== (st.completed_at !== null)) invalid();
    }
    for (const w of s.work_items) {
      object(w,['id','scope_ref','stage_id','name','zone','quantity','unit','unit_price_kopeks','amount_kopeks','status','planned_date','completed_at','inspected_at','accepted_at']);
      id(w.id); scope(w,project);
      if (w.stage_id !== null && !stageIds.has(id(w.stage_id))) invalid();
      text(w.name,250); text(w.zone,150,true); text(w.unit,30);
      if (typeof w.quantity !== 'string' || !/^\d{1,9}(\.\d{1,4})?$/.test(w.quantity)) invalid();
      money(w.unit_price_kopeks); money(w.amount_kopeks);
      if (w.amount_kopeks !== quantityAmount(w.quantity,w.unit_price_kopeks)) invalid();
      if (!STATES.has(w.status)) invalid();
      date(w.planned_date); actualInstant(w.completed_at); actualInstant(w.inspected_at); actualInstant(w.accepted_at);
      if (['completed','accepted'].includes(w.status) !== (w.completed_at !== null) || (w.status === 'accepted') !== (w.accepted_at !== null)) invalid();
      if (w.inspected_at && !w.completed_at) invalid();
      if (w.completed_at && w.inspected_at && Date.parse(w.inspected_at) < Date.parse(w.completed_at)) invalid();
      if (w.completed_at && w.accepted_at && Date.parse(w.accepted_at) < Date.parse(w.completed_at)) invalid();
    }
    let invoiceCompanyPaid = 0, invoiceDirectPaid = 0, documentCount = 0, costBase = 0;
    const docIds = new Set();
    for (const invoice of s.invoices) {
      object(invoice,['id','scope_ref','number','date','kind','title','amount_kopeks','credit_kopeks','net_amount_kopeks','company_paid_kopeks','direct_paid_kopeks','overpaid_kopeks','documents']);
      id(invoice.id); scope(invoice,project); text(invoice.number,100,true); actualDate(invoice.date); text(invoice.kind,80); text(invoice.title,300);
      money(invoice.amount_kopeks); money(invoice.credit_kopeks); money(invoice.net_amount_kopeks); money(invoice.company_paid_kopeks); money(invoice.direct_paid_kopeks); money(invoice.overpaid_kopeks);
      if (invoice.credit_kopeks > invoice.amount_kopeks || invoice.net_amount_kopeks !== invoice.amount_kopeks - invoice.credit_kopeks || invoice.overpaid_kopeks !== Math.max(0,add(invoice.company_paid_kopeks,invoice.direct_paid_kopeks) - invoice.net_amount_kopeks)) invalid();
      costBase = add(costBase,invoice.net_amount_kopeks);
      invoiceCompanyPaid = add(invoiceCompanyPaid,invoice.company_paid_kopeks);
      invoiceDirectPaid = add(invoiceDirectPaid,invoice.direct_paid_kopeks);
      if (collection(invoice.documents).length > 50) invalid();
      for (const document of invoice.documents) {
        object(document,['id','scope_ref','invoice_id','name','media_type','size_bytes']);
        id(document.id); scope(document,project);
        if (document.invoice_id !== invoice.id || docIds.has(document.id)) invalid();
        docIds.add(document.id); text(document.name,200);
        if (!MIME_TYPES.has(document.media_type) || !Number.isSafeInteger(document.size_bytes) || document.size_bytes <= 0 || document.size_bytes > MAX_DOCUMENT_BYTES) invalid();
        if (/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(document.name) || !FILE_EXTENSIONS[document.media_type].includes(document.name.split('.').pop().toLowerCase())) invalid();
        documentCount++;
      }
    }
    let otherSpent = 0, received = 0, refunded = 0;
    for (const row of s.other_costs) {
      object(row,['id','scope_ref','title','date','amount_kopeks','credit_kopeks','net_amount_kopeks']); id(row.id); scope(row,project); text(row.title,300); actualDate(row.date); otherSpent = add(otherSpent,money(row.amount_kopeks)); money(row.credit_kopeks); money(row.net_amount_kopeks); if (row.credit_kopeks > row.amount_kopeks || row.net_amount_kopeks !== row.amount_kopeks - row.credit_kopeks) invalid(); costBase = add(costBase,row.net_amount_kopeks);
    }
    for (const row of s.receipts) {
      object(row,['id','scope_ref','title','date','amount_kopeks']); id(row.id); scope(row,project); text(row.title,300); actualDate(row.date); received = add(received,money(row.amount_kopeks));
    }
    for (const row of s.refunds) {
      object(row,['id','scope_ref','title','date','amount_kopeks']); id(row.id); scope(row,project); text(row.title,300); actualDate(row.date); refunded = add(refunded,money(row.amount_kopeks));
    }
    if (s.pricing.cost_facts_complete && costBase !== s.pricing.confirmed_cost_base_kopeks) invalid();
    if (received !== s.cash.received_kopeks || refunded !== s.cash.refunded_kopeks || invoiceDirectPaid !== s.cash.direct_paid_kopeks || (s.cash.classification_ok && add(invoiceCompanyPaid,otherSpent) !== s.cash.company_spent_kopeks)) invalid();
    object(s.row_counts,['stages','work_items','invoices','documents','other_costs','receipts','refunds']);
    for (const key of ['stages','work_items','invoices','other_costs','receipts','refunds']) if (s.row_counts[key] !== s[key].length) invalid();
    if (s.row_counts.documents !== documentCount || documentCount > MAX_ROWS) invalid();
    return s;
  }
  const exported = Object.freeze({validateSnapshot,exactFee,quantityAmount});
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (root) root.ARHITTEKClientPortal = exported;
  if (!root || !root.document) return;
  const doc = root.document, $ = id => doc.getElementById(id);
  const numberFormat = new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2});
  const rubles = value => numberFormat.format(value / 100);
  const dayFormat = value => new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'});
  const timeFormat = value => new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  function el(tag,className,value) { const node = doc.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; }
  function row(label,value) { const node = el('div','detail-row'); node.append(el('span','',label),el('strong','',value)); return node; }
  function listPanel(rows,render,empty) { const panel = el('div',rows.length ? 'list-panel' : 'empty'); if (!rows.length) panel.textContent = empty; else rows.forEach(item => panel.append(render(item))); return panel; }
  function metric(label,value,note,featured = false) { const node = el('div','metric' + (featured ? ' featured' : '') + (value !== null && value < 0 ? ' negative' : '')), formatted = value === null ? '—' : rubles(value); node.append(el('div','metric-label',label),el('div','metric-value' + (formatted.length > 12 ? ' compact' : ''),formatted)); if (note) node.append(el('div','metric-note',note)); return node; }
  function renderMoney(s) {
    const b = s.pricing, feePercent = b.fee_rate_bps / 100, c = s.cash, section = $('money-content'), metrics = el('div','metrics');
    metrics.append(metric('Остаток средств объекта',c.held_kopeks,c.classification_ok ? 'По журналу после затрат, гонорара и возвратов' : 'Станет известен после сверки платежей',true),metric('Вы передали компании',c.received_kopeks,'Переводы на ведение этого объекта'),metric('Оплачено на объект',c.company_spent_kopeks,c.classification_ok ? 'Затраты из переданных вами средств' : 'Распределение затрат требует сверки'),metric('Вы оплатили напрямую',c.direct_paid_kopeks,'Эти деньги не поступали компании'));
    section.append(metrics);
    if (c.held_kopeks !== null && c.held_kopeks < 0) section.append(el('p','warning','Оплаченные затраты, выделенный гонорар и возвраты превышают переданные компании средства. Остаток отрицательный.'));
    if (!c.classification_ok) section.append(el('p','warning','Часть платежей объекта требует сверки. Непроверенный остаток и распределение затрат пока не показаны; переводы и возвраты сохранены как отдельные факты.'));
    const panel = el('div','budget-panel'); panel.append(el('h3','panel-title','Расходы + ' + feePercent + '% услуг ARHITTEK'));
    if (b.cost_facts_complete) panel.append(row('Расходы по документам объекта',rubles(b.confirmed_cost_base_kopeks)));
    else panel.append(el('p','warning','Подтверждение расходов ещё не завершено. Итоговая база, наценка и полная сумма появятся после сверки документов.'));
    if (!b.terms_confirmed) panel.append(el('p','warning','Условия услуг ещё не подтверждены. Сохранённая ставка: ' + feePercent + '% сверху расходов объекта.'));
    if (b.fee_total_kopeks !== null) panel.append(row('Услуги ARHITTEK · ' + feePercent + '% сверху',rubles(b.fee_total_kopeks)),row('Расходы с услугами компании',rubles(b.chargeable_cost_total_kopeks)));
    panel.append(el('p','money-note','Наценка рассчитывается от расходов по документам. Поступление аванса само по себе не создаёт гонорар. Оплата и остаток показаны отдельно по журналу.'));
    panel.append(row('Из денег объекта выделено на гонорар',rubles(c.fee_allocated_kopeks)));
    if (!b.terms_confirmed && c.fee_allocated_kopeks) panel.append(el('p','money-note','В журнале уже есть выделенный гонорар. Его условия нужно подтвердить; записанная сумма сохраняется как отдельный факт.'));
    panel.append(row('Возвращено вам',rubles(c.refunded_kopeks)));
    if (c.classification_ok && c.accountable_outstanding_kopeks !== null && c.held_kopeks !== null && c.accountable_outstanding_kopeks > 0) {
      const withoutAdvance = c.held_kopeks - c.accountable_outstanding_kopeks;
      panel.append(row('Непогашенный подотчёт',rubles(c.accountable_outstanding_kopeks)),row('Расчётный остаток без подотчёта',rubles(withoutAdvance)));
      if (withoutAdvance < 0) panel.append(el('p','warning','Без непогашенного подотчёта расчётная денежная часть объекта имеет дефицит ' + rubles(-withoutAdvance) + '. Требуется сверка финансирования.'));
    }
    panel.append(el('p','money-note','Остаток = передано компании − оплаченные затраты из ваших средств − выделенный гонорар − возвраты вам. Прямые оплаты заказчика показаны отдельно. Подотчёт показан отдельно; его выдача не считается окончательным расходом. Накладные и начисления сами по себе деньги не списывают.'));
    section.append(panel);
  }
  function renderStages(s) {
    const section = $('stages-content'), done = s.stages.filter(st => st.status === 'completed').length;
    section.append(el('div','progress-note',`Выполнено этапов: ${done} из ${s.stages.length}`));
    const progress = el('div','progress-track'), fill = el('i'); fill.style.width = (s.stages.length ? Math.round(done / s.stages.length * 100) : 0) + '%'; progress.append(fill); section.append(progress);
    section.append(listPanel(s.stages,st => { const item = el('div','item stage-item ' + st.status), copy = el('div','stage-copy'); item.append(el('span','stage-mark',st.status === 'completed' ? '✓' : '')); copy.append(el('div','item-title',st.name),el('span','badge ' + st.status,STATUS_LABELS[st.status])); if (st.due_date) copy.append(el('div','item-meta','Плановый срок: ' + dayFormat(st.due_date))); if (st.completed_at) copy.append(el('div','item-meta','Завершён: ' + dayFormat(st.completed_at))); item.append(copy); return item; },'Этапы появятся после публикации плана объекта.'));
  }
  function renderWorks(s) {
    $('works-content').append(listPanel(s.work_items,w => { const item = el('div','item'), header = el('div','item-heading'); header.append(el('div','item-title',w.name),el('div','item-amount',rubles(w.amount_kopeks))); item.append(header); if (w.zone) item.append(el('div','item-meta',w.zone)); item.append(el('div','item-meta',`${w.quantity} ${w.unit} × ${rubles(w.unit_price_kopeks)}`),el('span','badge ' + w.status,STATUS_LABELS[w.status])); for (const [key,label] of [['planned_date','План'],['completed_at','Выполнено'],['inspected_at','Проверено прорабом'],['accepted_at','Принято заказчиком']]) if (w[key]) item.append(el('div','item-meta',label + ': ' + dayFormat(w[key]))); return item; },'Виды работ появятся после публикации сметы.'));
  }
  function renderDocuments(s) {
    const section = $('documents-content');
    section.append(listPanel(s.invoices,invoice => {
      const item = el('div','item'), header = el('div','item-heading'), paid = invoice.company_paid_kopeks + invoice.direct_paid_kopeks;
      header.append(el('div','item-title',invoice.title),el('div','item-amount',rubles(invoice.net_amount_kopeks))); item.append(header,el('div','item-meta',`${invoice.number ? '№ ' + invoice.number + ' · ' : ''}${dayFormat(invoice.date)} · ${invoice.kind}`));
      item.append(el('span','badge ' + (paid === invoice.net_amount_kopeks ? 'completed' : paid ? 'in_progress' : 'planned'),paid === invoice.net_amount_kopeks ? 'Оплачена' : paid ? 'Оплачена частично' : 'Не оплачена'));
      if (invoice.credit_kopeks) item.append(el('div','item-meta','Стоимость документа: ' + rubles(invoice.amount_kopeks) + ' · Уменьшение: ' + rubles(invoice.credit_kopeks)));
      if (invoice.overpaid_kopeks) item.append(el('p','warning','Переплата по документу: ' + rubles(invoice.overpaid_kopeks) + '. Уменьшение стоимости само по себе не возвращает деньги.'));
      item.append(el('div','item-meta','Оплачено компанией: ' + rubles(invoice.company_paid_kopeks)));
      if (invoice.direct_paid_kopeks) item.append(el('div','item-meta','Оплачено вами напрямую: ' + rubles(invoice.direct_paid_kopeks)));
      if (invoice.documents.length) { const buttons = el('div','document-buttons'); for (const file of invoice.documents) { const button = el('button','document-button','↓ ' + file.name); button.type = 'button'; button.dataset.document = file.id; buttons.append(button); } item.append(buttons); }
      else item.append(el('div','item-meta','Файл накладной пока не опубликован.'));
      return item;
    },'Накладных по объекту пока нет.'));
    if (s.other_costs.length) { section.append(el('h3','panel-title','Другие оплаченные затраты')); section.append(listPanel(s.other_costs,cost => { const item = el('div','item'), header = el('div','item-heading'); header.append(el('div','item-title',cost.title),el('div','item-amount',rubles(cost.amount_kopeks))); item.append(header,el('div','item-meta',dayFormat(cost.date))); return item; },'')); }
  }
  function renderReceipts(s) { $('receipts-content').append(listPanel(s.receipts,receipt => { const item = el('div','item'), header = el('div','item-heading'); header.append(el('div','item-title',receipt.title),el('div','item-amount','+ ' + rubles(receipt.amount_kopeks))); item.append(header,el('div','item-meta',dayFormat(receipt.date))); return item; },'Переводов компании пока нет.')); }
  function renderRefunds(s) { $('refunds-section').hidden = !s.refunds.length; if (s.refunds.length) $('refunds-content').append(listPanel(s.refunds,refund => { const item = el('div','item'), header = el('div','item-heading'); header.append(el('div','item-title',refund.title),el('div','item-amount',rubles(refund.amount_kopeks))); item.append(header,el('div','item-meta',dayFormat(refund.date))); return item; },'')); }
  let access = null, snapshot = null, epoch = 0, request = null, refreshTimer = null, expiryTimer = null;
  const controllers = new Set(), downloading = new Set(), blobURLs = new Set();
  const enabled = doc.querySelector('meta[name="arhittek-client-portal-enabled"]')?.content === 'true';
  const API_ORIGIN = 'https://chbkkoxwzpaghanofvqk.supabase.co', API_PATH = '/functions/v1/construction-client-portal/';
  const apiBase = new URL(doc.querySelector('meta[name="arhittek-client-portal-api"]')?.content || API_ORIGIN + API_PATH);
  const apiAllowed = apiBase.origin === API_ORIGIN && apiBase.pathname === API_PATH && !apiBase.search && !apiBase.hash;
  function resetView(title,message,retry = false) {
    snapshot = null; $('portal-content').hidden = true; $('portal-state').hidden = false;
    $('state-title').textContent = title; $('state-message').textContent = message;
    $('state-retry').hidden = !(retry && access && enabled); $('document-status').textContent = '';
    for (const key of ['money-content','stages-content','works-content','documents-content','receipts-content','refunds-content']) $(key).replaceChildren();
    $('refunds-section').hidden = true;
    $('project-name').textContent = ''; $('project-address').textContent = ''; $('project-status').textContent = ''; $('updated-at').textContent = '';
    root.document.title = 'Объект · ARHITTEK';
    root.clearTimeout(refreshTimer); root.clearTimeout(expiryTimer); refreshTimer = expiryTimer = null;
    for (const url of blobURLs) root.URL.revokeObjectURL(url); blobURLs.clear();
  }
  function stop(title,message) {
    epoch++; access = null; request = null;
    for (const controller of controllers) controller.abort(); controllers.clear(); downloading.clear();
    resetView(title,message);
  }
  function expire() { stop('Ссылка больше не действует','Запросите у ARHITTEK новую ссылку на ваш объект.'); }
  function schedule(s) {
    const remaining = Date.parse(s.access_expires_at) - Date.now();
    expiryTimer = root.setTimeout(() => remaining > 2147480000 ? schedule(s) : expire(),Math.min(remaining,2147480000));
    refreshTimer = root.setTimeout(() => { if (!doc.hidden) refresh(); },60000);
  }
  function render(s) {
    $('project-name').textContent = s.project.name; $('project-address').textContent = s.project.address; $('project-status').textContent = s.project.status;
    $('updated-at').textContent = 'Обновлено ' + timeFormat(s.generated_at) + ' · МСК';
    renderMoney(s); renderStages(s); renderWorks(s); renderDocuments(s); renderReceipts(s); renderRefunds(s);
    $('portal-state').hidden = true; $('portal-content').hidden = false;
    doc.title = s.project.name + ' · ARHITTEK'; schedule(s);
  }
  async function responseBytes(response,max) {
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) invalid();
    if (!response.body?.getReader) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > max) invalid(); return bytes; }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { for (;;) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); invalid(); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; } return bytes;
  }
  async function call(endpoint,body,controller) {
    if (!enabled || !access || root.location.protocol !== 'https:' || !apiAllowed) invalid();
    const response = await root.fetch(new URL(endpoint,apiBase),{method:'POST',headers:{Authorization:'Bearer ' + access,'Content-Type':'application/json',Accept:endpoint === 'snapshot' ? 'application/json' : 'application/pdf,image/jpeg,image/png,image/webp'},body:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
    if ([401,403,404].includes(response.status)) { const error = new Error('Access denied'); error.denied = true; throw error; }
    if (!response.ok) throw new Error('Portal unavailable');
    return response;
  }
  function fileSignature(bytes,type) {
    const prefix = values => values.every((value,index) => bytes[index] === value);
    if (type === 'application/pdf') return prefix([37,80,68,70,45]);
    if (type === 'image/jpeg') return prefix([255,216,255]);
    if (type === 'image/png') return prefix([137,80,78,71,13,10,26,10]);
    if (type === 'image/webp') return prefix([82,73,70,70]) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
    return false;
  }
  function refresh() {
    if (request) return request;
    if (!enabled || !access || doc.hidden) return Promise.resolve();
    const currentEpoch = ++epoch, controller = new AbortController(); controllers.add(controller);
    resetView('Обновляем данные','Проверяем доступ и актуальное состояние вашего объекта.');
    const pending = (async () => {
      try {
        const response = await call('snapshot',{},controller);
        if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) invalid();
        const bytes = await responseBytes(response,MAX_JSON_BYTES), raw = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        const valid = validateSnapshot(raw);
        if (currentEpoch !== epoch || !access) return;
        snapshot = valid; render(valid);
      } catch (error) {
        if (currentEpoch !== epoch || !access) return;
        if (error.denied) expire();
        else resetView('Данные недоступны','Не удалось проверить актуальные данные. Попробуйте обновить кабинет. Если ошибка повторится, свяжитесь с ARHITTEK.',true);
      } finally { controllers.delete(controller); if (request === pending) request = null; }
    })();
    request = pending; return pending;
  }
  async function downloadDocument(documentId,button) {
    if (!snapshot || !access || downloading.has(documentId)) return;
    if (Date.parse(snapshot.access_expires_at) <= Date.now()) { expire(); return; }
    const file = snapshot.invoices.flatMap(invoice => invoice.documents).find(candidate => candidate.id === documentId);
    if (!file) return;
    const currentEpoch = epoch, controller = new AbortController(); controllers.add(controller); downloading.add(documentId); button.disabled = true; $('document-status').textContent = 'Проверяем и загружаем документ…';
    try {
      const response = await call('document',{document_id:file.id},controller);
      const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (mediaType !== file.media_type || !MIME_TYPES.has(mediaType)) invalid();
      const bytes = await responseBytes(response,Math.min(file.size_bytes,MAX_DOCUMENT_BYTES));
      if (bytes.length !== file.size_bytes || !fileSignature(bytes,mediaType)) invalid();
      if (currentEpoch !== epoch || !access || !snapshot) return;
      if (Date.parse(snapshot.access_expires_at) <= Date.now()) { expire(); return; }
      const url = root.URL.createObjectURL(new Blob([bytes],{type:mediaType})); blobURLs.add(url);
      const link = el('a'); link.href = url; link.download = file.name.replace(/[\\/\u0000-\u001f\u007f]/g,'_'); link.rel = 'noreferrer noopener'; doc.body.append(link); link.click(); link.remove();
      root.setTimeout(() => { root.URL.revokeObjectURL(url); blobURLs.delete(url); },1000);
      $('document-status').textContent = 'Документ передан в загрузки.';
    } catch (error) {
      if (currentEpoch !== epoch || !access) return;
      if (error.denied) expire();
      else $('document-status').textContent = 'Документ не загружен. Повторите попытку или обратитесь в ARHITTEK.';
    } finally { controllers.delete(controller); downloading.delete(documentId); button.disabled = false; }
  }
  function init() {
    const initial = new URL(root.location.href), params = new URLSearchParams(initial.hash.slice(1));
    const candidate = params.get('access');
    // Fragment secrets never become query strings, persisted browser storage, or future referrers.
    root.history.replaceState(null,'',initial.pathname);
    if (!enabled || !apiAllowed) { resetView('Кабинет ещё не подключён','ARHITTEK подготовит защищённый доступ к вашему объекту и передаст вам ссылку.'); return; }
    if (initial.search || Array.from(params.keys()).some(key => key !== 'access') || params.getAll('access').length !== 1 || !TOKEN_PATTERN.test(candidate || '') || root.location.protocol !== 'https:') {
      resetView('Нужна ссылка на ваш объект','Откройте персональную ссылку, которую вам передали в ARHITTEK.'); return;
    }
    access = candidate; refresh();
  }
  $('refresh-portal').addEventListener('click',refresh); $('state-retry').addEventListener('click',refresh);
  $('close-portal').addEventListener('click',() => stop('Доступ на устройстве закрыт','Чтобы вернуться к объекту, откройте исходную ссылку ещё раз.'));
  $('documents-content').addEventListener('click',event => { const button = event.target.closest('button[data-document]'); if (button && $('documents-content').contains(button)) downloadDocument(button.dataset.document,button); });
  doc.addEventListener('visibilitychange',() => {
    if (doc.hidden) { epoch++; request = null; for (const controller of controllers) controller.abort(); controllers.clear(); resetView('Информация скрыта','Обновим кабинет после возвращения на страницу.'); }
    else if (access) refresh();
  });
  root.addEventListener('pagehide',() => stop('Откройте ссылку ещё раз','Для доступа к объекту нужна ваша персональная ссылка.'));
  init();
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
