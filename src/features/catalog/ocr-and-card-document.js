// ============================================================
// СКАНИРОВАНИЕ ЭКСПЛИКАЦИИ (OCR) — фото/камера → список комнат с площадями
// ============================================================
let ceScanPending = {};
let ceScanTokens = {}; // fieldId -> распознанные строки, ждут подтверждения

// Библиотека распознавания грузится только когда реально нужна — не тормозит
// обычную загрузку приложения (Tesseract.js — это ~500КБ+ данные языка).
function loadTesseractScript(){
  return new Promise((resolve, reject)=>{
    if(window.Tesseract){ resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку распознавания'));
    document.head.appendChild(s);
  });
}

// Готовит фото для OCR: увеличивает мелкий текст и повышает контраст —
// сильно улучшает распознавание таблиц (тонкие линии сетки, неровный свет
// на фото с телефона) по сравнению с сырым фото без обработки.
async function preprocessForOcr(file){
  const {source, width, height} = await loadOrientedImage(file);
  const TARGET_SIDE = 3200;
  const scale = TARGET_SIDE / Math.max(width, height);
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  if(source.close) source.close();
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for(let i=0;i<d.length;i+=4){
    const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    const contrasted = Math.min(255, Math.max(0, (gray-128)*1.2 + 128));
    d[i] = d[i+1] = d[i+2] = contrasted;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Tesseract сам решает, в каком порядке склеивать распознанные слова в
// строки текста — и на многоколоночных таблицах (№ / Наименование / Площадь)
// он регулярно перемешивает соседние колонки в одну «кашу» из букв и цифр.
// Поэтому строку с raw text не используем вообще: берём слова с их
// координатами (bbox) и сами группируем их в строки по вертикали, а внутри
// строки сортируем по горизонтали — это даёт правильный порядок «слева направо».
function extractOcrWords(data){ return CatalogOcr.words(data); }

function wordsToRowLines(words, minConfidence){
  const kept = words.filter(w => w.confidence == null || w.confidence >= minConfidence);
  if(!kept.length) return [];
  const heights = kept.map(w => w.y1 - w.y0).sort((a,b) => a-b);
  const medianH = heights[Math.floor(heights.length/2)] || 20;
  const yTol = Math.max(medianH * 0.6, 8);
  const sorted = kept.slice().sort((a,b) => (a.y0+a.y1) - (b.y0+b.y1));
  const rows = [];
  for(const w of sorted){
    const cy = (w.y0 + w.y1) / 2;
    let row = rows.find(r => Math.abs(r.cy - cy) <= yTol);
    if(!row){ row = { cy, words: [] }; rows.push(row); }
    row.words.push(w);
    row.cy = row.words.reduce((s,x) => s + (x.y0+x.y1)/2, 0) / row.words.length;
  }
  rows.sort((a,b) => a.cy - b.cy);
  return rows.map(r => r.words.slice().sort((a,b) => a.x0-b.x0).map(w => w.text).join(' '));
}

// Разбирает строки (уже собранные из слов по координатам, см. выше) на пары
// «название комнаты — площадь». Рассчитано на строки вида «1 Кухня 12,5»,
// «Спальня: 14.0 м²» и т.п. — реальный OCR по table-фото шумный, поэтому
// результат всегда показывается на подтверждение, а не вставляется молча.
function parseOcrExplicationText(text){ return CatalogOcr.parse(text); }

async function scanExplication(input, fieldId){
  const file = input.files[0];
  if(!file) return;
  const statusEl = document.getElementById(fieldId+'-scan-status');
  statusEl.className = 'ce-scan-status';
  statusEl.innerHTML = '⏳ Загружаем распознавание…';

  let worker = null,prepared=null;const generation=cardEditorGeneration,scanToken=(ceScanTokens[fieldId]||0)+1;ceScanTokens[fieldId]=scanToken;ceScanPending[fieldId]=null;
  const check=()=>{if(generation!==cardEditorGeneration||ceScanTokens[fieldId]!==scanToken||!statusEl.isConnected)throw new DOMException('Отменено','AbortError');};
  try{
    await loadTesseractScript();check();
    statusEl.innerHTML = '⏳ Готовим фото…';
    prepared = await preprocessForOcr(file);check();

    statusEl.innerHTML = '⏳ Распознаём текст на фото…';
    // Важно: НЕ используем Tesseract.recognize() напрямую — у него нет доступа
    // к setParameters. PSM.AUTO (движок сам ищет разметку страницы) точнее
    // находит отдельные слова на таблице, чем SINGLE_BLOCK — но сам порядок
    // склейки слов в строки от Tesseract всё равно ненадёжен на колонках,
    // поэтому строки мы собираем сами из координат слов (см. wordsToRowLines).
    worker = await Tesseract.createWorker('rus', Tesseract.OEM.LSTM_ONLY, {
      logger: m => {
        if(generation===cardEditorGeneration&&ceScanTokens[fieldId]===scanToken&&m.status === 'recognizing text' && m.progress != null){
          statusEl.innerHTML = `⏳ Распознаём… ${Math.round(m.progress*100)}%`;
        }
      }
    });
    const recognized=await CatalogOcr.recognize(worker,prepared,{check,onProgress:pass=>{statusEl.textContent='⏳ Распознаём таблицу: проход '+pass+' из 3…';}});
    check();const rows=recognized.rows,rebuiltText=recognized.text;
    if(!rows.length){
      ceScanPending[fieldId] = null;
      const fallbackText = rebuiltText || '';
      statusEl.innerHTML = `
        <div class="ce-scan-preview">
          Не найдены пары «комната — площадь». Нужна вся таблица, включая правый столбец с числами; снимите её крупнее. Распознанный текст:<br>
          <div style="margin-top:4px;color:#9ca3af;white-space:pre-wrap;">${escapeHtml(fallbackText.trim().slice(0,400)) || '(пусто)'}</div>
        </div>`;
    } else {
      ceScanPending[fieldId] = rows;
      statusEl.innerHTML = `
        <div class="ce-scan-preview">
          Распознано комнат: ${rows.length}${recognized.table&&!recognized.table.verified?'<div>⚠ Сумма комнат не совпала с итогом таблицы. Проверьте числа перед добавлением.</div>':''}
          ${rows.map(r=>`<div class="row"><span>${escapeHtml(r.name)}</span><span>${escapeHtml(r.area)}</span></div>`).join('')}
          <div class="ce-scan-actions">
            <button type="button" class="ce-scan-add" onclick="applyScannedExplication('${fieldId}')">Добавить в список</button>
            <button type="button" class="ce-scan-cancel" onclick="cancelScannedExplication('${fieldId}')">Отмена</button>
          </div>
        </div>`;
    }
  }catch(e){
    if(e.name==='AbortError')return;
    console.error('OCR error', e);
    statusEl.innerHTML = '⚠ Не удалось распознать фото — попробуйте другое фото или впишите вручную';
  }finally{
    if(worker) await worker.terminate().catch(()=>{});
    if(prepared)prepared.width=prepared.height=0;
    input.value = '';
  }
}

function applyScannedExplication(fieldId){
  const rows = ceScanPending[fieldId];
  if(!rows || !rows.length) return;
  const ta = document.getElementById(fieldId);
  const newLines = rows.map(r=>`${r.name}: ${r.area}`).join('\n');
  ta.value = ta.value.trim() ? ta.value.trim()+'\n'+newLines : newLines;
  const areaId=fieldId.replace('ce-expl','ce-area'),sum=parseExpl(ta.value).reduce((s,r)=>s+CatalogPdfCore.number(r.area),0);
  if(sum>0)setVal(areaId,CatalogPdfCore.area(sum));
  cancelScannedExplication(fieldId);markCardEditorDirty();
  cePreview();
}

function cancelScannedExplication(fieldId){
  ceScanPending[fieldId] = null;
  const statusEl = document.getElementById(fieldId+'-scan-status');
  if(statusEl) statusEl.innerHTML = '';
}

function initCardFloorEditor(){
  const container=document.getElementById('ce-floor-sections');
  if(!container||container.dataset.ready)return;
  container.innerHTML=CatalogFloors.editor();
  document.getElementById('prev-tabs').insertAdjacentHTML('beforeend',CatalogFloors.previewTabs());
  document.getElementById('prev-floor-panels').innerHTML=CatalogFloors.previewPanels();
  container.dataset.ready='1';
}
function markCardEditorDirty(){
  const overlay=document.getElementById('cardEditorOverlay');
  if(overlay&&overlay.style.display!=='none')overlay.dataset.dirty='1';
}
function cePreview(){
  initCardFloorEditor();
  const v=id=>document.getElementById(id)?.value||'';
  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  const num=v('ce-num'),title=v('ce-title');
  const card={floors:ceFloorsSelected,tags:ceFeatureSelected.includes('basement')?['Цокольный этаж']:[]};
  set('prev-title',num?`Проект №${num}${title?' — '+title:''}`:'Проект №—');
  set('prev-num',num?'№ '+num:'№ —');
  set('prev-area',v('ce-area')||'—');set('prev-beds',v('ce-beds')||'—');set('prev-footprint',v('ce-footprint')||'—');
  set('prev-floors-stat',ceFloorsSelected);set('prev-price',(v('ce-price')||'—')+' ₽');
  const tags=v('ce-tags').split(',').map(t=>t.trim()).filter(t=>t&&t!=='Цокольный этаж');
  if(ceFeatureSelected.includes('basement')&&!tags.includes('Цокольный этаж'))tags.push('Цокольный этаж');
  document.getElementById('prev-tags').innerHTML=tags.map(t=>`<div class="tag" style="color:#2a72c0">${escapeHtml(t)}</div>`).join('');
  CatalogFloors.definitions.forEach(f=>{
    const visible=CatalogFloors.enabled(f,card);
    document.getElementById('ce-section-'+f.key).style.display=visible?'':'none';
    document.getElementById('prev-tab-'+f.key).style.display=visible?'':'none';
    const panel=document.getElementById('prev-'+f.key);
    if(!visible&&panel.style.display==='block')cePrevTab('prev-facade',document.querySelector('#prev-tabs > div'));
    const area=v('ce-area'+f.suffix)||'—';
    set('prev-a'+f.suffix+'-badge',area+' м²');set('prev-total'+f.suffix,area+' м²');
    document.getElementById('prev-expl'+f.suffix+'-rows').innerHTML=CatalogFloors.rows(parseExpl(v('ce-expl'+f.suffix)));
    const img=document.getElementById('prev-plan'+f.suffix+'-img'),src=ceImages[f.image];
    if(src)img.src=src;else img.removeAttribute('src');
    img.style.display=src?'block':'none';
    document.getElementById('prev-plan'+f.suffix+'-ph').style.display=src?'none':'block';
  });
  const facade=document.getElementById('prev-facade-img');
  if(ceImages[0])facade.src=ceImages[0];else facade.removeAttribute('src');
  facade.style.display=ceImages[0]?'block':'none';
  document.getElementById('prev-facade-ph').style.display=ceImages[0]?'none':'flex';
  ['basement','mansard','flat'].forEach(id=>document.getElementById('feature-btn-'+id)?.setAttribute('aria-pressed',String(ceFeatureSelected.includes(id))));
}

function parseExpl(text){
  return (text||'').split('\n').filter(l=>l.trim()).map((l,i)=>{
    const parts = l.split(':');
    const area = parts.pop().trim().replace('.',',');
    const name = parts.join(':').trim();
    return { name, area };
  });
}

// dataURL → Blob (для выгрузки base64-картинок в Storage)
function dataURLtoBlob(dataurl){
  const arr = dataurl.split(',');
  const mime = (arr[0].match(/:(.*?);/)||[])[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length; const u8 = new Uint8Array(n);
  while(n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], {type:mime});
}

// Выгружаем изображения карточки в Storage и возвращаем массив URL.
// Уже загруженные (http…) остаются как есть; base64 — грузятся; при ошибке фоллбэк на base64.
async function uploadCardImages(images,targetId=ceCurrentId){
  const out = [];
  for(let i=0;i<images.length;i++){
    const img = images[i];
    if(!img){ out.push(null); continue; }
    if(typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))){ out.push(img); continue; }
    if(typeof img === 'string' && img.startsWith('data:')){
      try{
        const blob = dataURLtoBlob(img),contentType=blob.type==='image/png'?'image/png':'image/jpeg',extension=contentType==='image/png'?'png':'jpg';
        const fileName = `cards/${targetId||'new'}_${Date.now()}_${i}_${Math.random().toString(36).slice(2,7)}.${extension}`;
        const {error: upErr} = await sb.storage.from('expense-photos').upload(fileName, blob, {contentType, upsert:true});
        if(upErr) throw upErr;
        const {data: urlData} = sb.storage.from('expense-photos').getPublicUrl(fileName);
        out.push(urlData.publicUrl || img);
      }catch(e){
        console.warn('Не удалось выгрузить фото карточки в Storage, оставляю base64', e);
        out.push(img); // безопасный фоллбэк — карточка не теряет фото
      }
    } else {
      out.push(img);
    }
  }
  return out;
}

async function saveCard(){
  if(!canEditCards()){showToast('Нет доступа к редактированию каталога');return;}
  if(CatalogPdfImport.busyReading()){showToast('Дождитесь завершения чтения PDF');return;}
  const cardId=ceCurrentId,generation=cardEditorGeneration,saveKey=cardId || 'new:'+generation;
  const importMeta=cePdfImportMeta?JSON.parse(JSON.stringify(cePdfImportMeta)):null;
  const screenshotPlans=JSON.parse(JSON.stringify(ceScreenshotPlans));
  const saveActor=session?.token;
  if(cardSavesInFlight.has(saveKey))return;
  const images=ceImages.slice(),thumbs=ceThumbs.slice();
  const btn = document.getElementById('ce-save-btn');
  cardSavesInFlight.add(saveKey);
  btn.disabled = true;
  btn.textContent = 'Сохранение…';
  let persisted=false;

  try{
    // Snapshot all fields before the first await. Another editor may open
    // while photos upload, and it must never become the target of this save.
    const payload = {
      project_number: document.getElementById('ce-num').value.trim(),
      title: 'Проект №'+(document.getElementById('ce-num').value.trim())+' — '+(document.getElementById('ce-title').value.trim()),
      floors: ceFloorsSelected,
      total_area: document.getElementById('ce-area').value.trim(),
      footprint: document.getElementById('ce-footprint').value.trim(),
      beds: parseInt(document.getElementById('ce-beds').value)||null,
      baths: parseInt(document.getElementById('ce-baths').value)||null,
      price: document.getElementById('ce-price').value.trim(),
      tags: (()=>{
        const systemTags = ['Классический','Современный','Цокольный этаж','Мансарда','Плоская кровля'];
        const userTags = document.getElementById('ce-tags').value.split(',').map(t=>t.trim()).filter(Boolean).filter(t=>!systemTags.includes(t));
        if(ceStyleSelected==='classic') userTags.push('Классический');
        if(ceStyleSelected==='modern') userTags.push('Современный');
        if(ceFeatureSelected.includes('basement')) userTags.push('Цокольный этаж');
        if(ceFeatureSelected.includes('mansard')) userTags.push('Мансарда');
        if(ceFeatureSelected.includes('flat')) userTags.push('Плоская кровля');
        return userTags;
      })(),
      ...Object.fromEntries(CatalogFloors.definitions.flatMap(f=>[
        [f.area,document.getElementById('ce-area'+f.suffix).value.trim()],
        [f.rooms,parseExpl(document.getElementById('ce-expl'+f.suffix).value)]
      ])),
      images,
      thumbnails: thumbs,
      updated_at: new Date().toISOString(),
    };
    payload.images=await uploadCardImages(images,cardId);
    payload.thumbnails=await uploadCardImages(thumbs,cardId);
    if(cardEditorGeneration===generation){
      if(images.length===ceImages.length&&images.every((image,index)=>image===ceImages[index]))ceImages=payload.images.slice();
      if(thumbs.length===ceThumbs.length&&thumbs.every((image,index)=>image===ceThumbs[index]))ceThumbs=payload.thumbnails.slice();
    }

    if(Object.keys(screenshotPlans).length){
      const meta=importMeta||JSON.parse(JSON.stringify(cardsData.find(c=>c.id===cardId)?.pdf_import_meta||{}));
      meta.sources={...meta.sources,plans:{...meta.sources?.plans,...screenshotPlans}};
      payload.pdf_import_meta=meta;
    }
    let result,duplicate=false,planRefresh=null;
    let savedId = cardId;
    if(cardId){
      result = await sb.from('project_cards').update(payload).eq('id', cardId).select('id').maybeSingle();
    } else if(importMeta){
      payload.pdf_import_meta=importMeta;
      result=await sb.rpc('import_catalog_pdf',{p_card:payload});
      if(result.data){savedId=result.data.id;duplicate=result.data.created===false;}
    } else {
      payload.created_at = new Date().toISOString();
      result = await sb.from('project_cards').insert(payload).select('id').single();
      if(result.data) savedId = result.data.id;
    }

    if(result.error) throw result.error;
    if(!result.data?.id)throw new Error('Не получено подтверждение сохранения карточки');
    persisted=true;
    if(duplicate&&window.CatalogPlan)planRefresh=await CatalogPlan.refreshExisting({id:savedId,incoming:payload,client:sb,allowed:canEditCards,actor:saveActor});
    if(cardEditorGeneration===generation)ceCurrentId=savedId;

    // Синхронизация с WordPress
    let siteSyncFailed=false;
    try {
      if(!duplicate||planRefresh?.updated)await syncCardToWordPress(planRefresh?.card||payload, savedId);
    } catch(wpErr) {
      siteSyncFailed=true;
      console.warn('WordPress sync error:', wpErr.message);
    }

    if(cardEditorGeneration===generation){
      document.getElementById('cardEditorOverlay').dataset.dirty='0';
      closeCardEditor();
    }
    await loadCards();
    showToast(planRefresh?.updated?'Планы обновлены по шаблону. Повторная карточка не создана':duplicate?'Проект уже есть в каталоге. Повторная карточка не создана':siteSyncFailed?'Карточка сохранена. Не удалось обновить сайт':cardId?'Проект обновлён':'Проект создан');
    return {ok:true,id:savedId,duplicate,updatedPlans:!!planRefresh?.updated};
  } catch(e){
    console.error('saveCard error', e);
    showToast(persisted?'Карточка сохранена. Не удалось обновить список — повторите обновление':'Ошибка сохранения: '+(e.message||e));
    return {ok:false,error:e.message||String(e)};
  } finally{
    cardSavesInFlight.delete(saveKey);
    const saving=cardSavesInFlight.has(ceCurrentId || 'new:'+cardEditorGeneration);
    btn.disabled=saving;
    btn.textContent=saving?'Сохранение…':'Сохранить проект';
  }
}

// Синхронизация карточки с WordPress через приёмник.
// Секрет интеграции больше не хранится в клиентском коде — он живёт только
// в Supabase Edge Function 'sync-card', недоступной для чтения из браузера.
async function syncCardToWordPress(card, supabaseId){
  const payload = Object.assign({}, card, { supabase_id: supabaseId || '' });
  const { data, error } = await sb.functions.invoke('sync-card', { body: payload });
  if(error){
    throw new Error('Receiver error: ' + (error.message || error));
  }
  return data;
}

async function deleteCard(){
  if(!canEditCards())return;
  if(!ceCurrentId) return;
  if(!confirm('Удалить эту карточку?')) return;
  try{
    const {error}=await sb.from('project_cards').update({ deleted_at: new Date().toISOString() }).eq('id', ceCurrentId);
    if(error)throw error;
    showToast('Проект удалён');
    closeCardEditor();
    await loadCards();
  } catch(e){
    showToast('Ошибка удаления');
  }
}

// ── Просмотр карточки внутри приложения (для всех) ──
let cardViewerList = [];   // список карточек для листания (с учётом фильтров)
let cardViewerIndex = 0;

function viewCard(id){
  // Определяем список для листания — текущий отфильтрованный (или все)
  let list = (cardViewerList && cardViewerList.length) ? cardViewerList : cardsData;
  let idx = list.findIndex(c=>c.id===id);
  if(idx < 0){ list = cardsData; idx = list.findIndex(c=>c.id===id); }
  if(idx < 0) return;
  cardViewerList = list;
  openCardViewerAt(idx);
}

function openCardViewerAt(index){
  if(!cardViewerList.length) return;
  cardViewerIndex = Math.max(0, Math.min(cardViewerList.length-1, index));
  const card = cardViewerList[cardViewerIndex];
  if(!card) return;
  const frame = document.getElementById('cardViewerFrame');
  if(frame) frame.srcdoc = buildCardHTML(card);
  const counter = document.getElementById('cardViewerCounter');
  if(counter) counter.textContent = `${cardViewerIndex+1} / ${cardViewerList.length}`;
  // Кнопки листания — прячем на краях
  const prev = document.getElementById('cardViewerPrev');
  const next = document.getElementById('cardViewerNext');
  if(prev) prev.style.visibility = cardViewerIndex > 0 ? 'visible' : 'hidden';
  if(next) next.style.visibility = cardViewerIndex < cardViewerList.length-1 ? 'visible' : 'hidden';
  // Кнопка редактировать — только редакторам
  const editBtn = document.getElementById('cardViewerEditBtn');
  if(editBtn) editBtn.style.display = canEditCards() ? '' : 'none';
  const overlay = document.getElementById('cardViewerOverlay');
  if(overlay) overlay.style.display = 'flex';
}

function cardViewerNav(dir){
  openCardViewerAt(cardViewerIndex + dir);
}

function closeCardViewer(){
  const overlay = document.getElementById('cardViewerOverlay');
  if(overlay) overlay.style.display = 'none';
  const frame = document.getElementById('cardViewerFrame');
  if(frame) frame.srcdoc = '';
}

function editCurrentCard(){
  const card = cardViewerList[cardViewerIndex];
  if(!card) return;
  if(!canEditCards()){ showToast('Нет доступа'); return; }
  closeCardViewer();
  openCardEditor(card.id);
}

// Закрытие по Esc и листание стрелками клавиатуры
document.addEventListener('keydown', (e)=>{
  const overlay = document.getElementById('cardViewerOverlay');
  if(!overlay || overlay.style.display === 'none') return;
  if(e.key === 'Escape') closeCardViewer();
  else if(e.key === 'ArrowLeft') cardViewerNav(-1);
  else if(e.key === 'ArrowRight') cardViewerNav(1);
});

// ── Ссылки для клиентов ──
let shareLinksData = [];
let shareLinkProjectId = null; // если задан — ссылка ведёт на один конкретный проект каталога

async function renderShareLinks(){
  if(!canEditCards()) return;
  try{
    const { data, error } = await fetchAllRows(()=>sb.from('share_links')
      .select('*',{count:'exact'})
      .is('deleted_at', null)
      .order('created_at', { ascending: false }));
    if(error) throw error;
    shareLinksData = data || [];
  } catch(e){ shareLinksData = []; }

  const container = document.getElementById('cards-links-list');
  if(!container) return;

  if(!shareLinksData.length){
    container.innerHTML = '<div class="note" style="opacity:0.5;">Нет активных ссылок</div>';
    return;
  }

  const base = location.origin + location.pathname.replace('index.html','');
  const now = Date.now();

  container.innerHTML = shareLinksData.map(link => {
    const isExpired = link.expires_at && new Date(link.expires_at).getTime() < now;
    const expiresText = link.expires_at
      ? isExpired
        ? `<span style="color:var(--red);">⛔ Истекла ${new Date(link.expires_at).toLocaleDateString('ru')}</span>`
        : `<span style="color:var(--green);">✓ до ${new Date(link.expires_at).toLocaleDateString('ru')}</span>`
      : `<span style="color:var(--text-dim);">Бессрочная</span>`;

    return `<div style="padding:10px 0;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;${isExpired?'opacity:0.55;':''}">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;">${escapeHtml(link.label||'Ссылка')}${link.project_id ? ' <span style="color:var(--gold);font-weight:600;">· один проект</span>' : ''}</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">
          ${link.project_id ? 'Ссылка на один проект' : (link.floors_filter==='all' ? 'Все карточки' : link.floors_filter+'-этажные')}
          · создана ${new Date(link.created_at).toLocaleDateString('ru')}
        </div>
        <div style="font-size:11px;margin-top:2px;">${expiresText}</div>
        ${!isExpired ? `<div style="font-size:10px;color:var(--blue);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${base}catalog.html?t=${link.token}
        </div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        ${!isExpired ? `<button style="background:rgba(0,113,235,0.15);color:var(--blue);border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;"
          onclick="navigator.clipboard.writeText('${base}catalog.html?t=${link.token}').then(()=>showToast('Скопировано!'))">
          Копировать
        </button>` : ''}
        <button style="background:rgba(224,82,82,0.12);color:var(--red);border:none;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;"
          onclick="deactivateLink('${link.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function createShareLink(){
  shareLinkProjectId = null;
  document.getElementById('sl-name').value = '';
  document.getElementById('sl-result').style.display = 'none';
  document.getElementById('sl-filter-row').style.display = '';
  document.getElementById('sl-single-note').style.display = 'none';
  document.getElementById('shareLinkOverlay').classList.add('active');
}

// Ссылка на один конкретный проект каталога — видна только тем, у кого есть
// доступ к разделу «Каталог» (canEditCards): администратору и сотрудникам
// с правом видеть готовые проекты.
function createShareLinkForProject(cardId, cardTitle){
  if(!canEditCards()) return;
  shareLinkProjectId = cardId;
  document.getElementById('sl-name').value = cardTitle || 'Проект';
  document.getElementById('sl-result').style.display = 'none';
  document.getElementById('sl-filter-row').style.display = 'none';
  document.getElementById('sl-single-note').style.display = '';
  document.getElementById('shareLinkOverlay').classList.add('active');
}

async function generateShareLink(){
  if(!canEditCards())return;
  const label = document.getElementById('sl-name').value.trim() || 'Ссылка';
  const filter = shareLinkProjectId ? 'all' : document.getElementById('sl-filter').value;
  const expiresDays = parseInt(document.getElementById('sl-expires').value);
  const token = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g,'')
    : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const expires_at = expiresDays > 0
    ? new Date(Date.now() + expiresDays*24*60*60*1000).toISOString()
    : null;

  try{
    const { error } = await sb.from('share_links').insert({
      label, floors_filter: filter, token, project_id: shareLinkProjectId || null,
      created_at: new Date().toISOString(),
      expires_at,
    });
    if(error) throw error;

    const base = location.origin + location.pathname.replace('index.html','');
    const url = base + 'catalog.html?t=' + token;
    document.getElementById('sl-url').value = url;
    document.getElementById('sl-result').style.display = 'block';
    await renderShareLinks();
  } catch(e){
    const details = [e.message, e.code, e.details, e.hint].filter(Boolean).join(' · ');
    showToast('Ошибка создания ссылки: ' + (details || 'неизвестная ошибка'));
    console.error('generateShareLink error:', e);
  }
}

function copyShareUrl(){
  const url = document.getElementById('sl-url').value;
  navigator.clipboard.writeText(url).then(()=>showToast('Ссылка скопирована!'));
}

async function deactivateLink(id){
  if(!canEditCards())return;
  if(!confirm('Деактивировать эту ссылку? Клиент больше не сможет открыть каталог по ней.')) return;
  try{
    const {error}=await sb.from('share_links').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if(error)throw error;
    showToast('Ссылка деактивирована');
    await renderShareLinks();
  } catch(e){ showToast('Ошибка'); }
}

// ── Построить HTML карточки ──
function buildCardHTML(card){
  const images = card.images || [];
  const facade1 = images[0] || '';
  const facade2 = images[1] || '';
  const tags = (card.tags||[]).map(t=>`<div class="tag">${escapeHtml(t)}</div>`).join('');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Проект №${escapeHtml(card.project_number||'')} — ARHITTEK</title>
<style>
:root{--blue:#3D8FE0;--blue-dark:#2A72C0;--blue-light:#E8F3FC;--black:#0A0A0A;--border:#D0D0D0;--border-soft:#DCDCDC;--text-primary:#1A1A1A;--text-sub:#888;--text-label:#BBB;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#C8C8C8;min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:24px 16px;}
.card{background:#F2F2F2;border-radius:20px;width:390px;max-width:100%;box-shadow:0 12px 60px rgba(0,0,0,.18);overflow:hidden;}
.card-header{background:var(--black);padding:13px 16px 11px;display:flex;align-items:center;justify-content:space-between;}
.header-badge{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.4);}
.tabs{display:flex;flex-wrap:wrap;background:#F2F2F2;border-bottom:2px solid var(--border);}
.tab{flex:1 1 72px;min-height:44px;white-space:nowrap;padding:12px 8px;text-align:center;font-size:13px;font-weight:500;color:var(--text-sub);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s;user-select:none;}
.tab.active{color:var(--blue);border-bottom-color:var(--blue);font-weight:600;}
.panel{display:none;}.panel.active{display:block;}
.swiper-wrap{position:relative;overflow:hidden;background:#000;cursor:grab;transition:height .25s ease;}
.swiper-track{display:flex;height:100%;transition:transform .35s cubic-bezier(.4,0,.2,1);}
.swiper-slide{width:100%;min-width:100%;max-width:100%;height:100%;position:relative;flex-shrink:0;overflow:hidden;}
.swiper-slide img{width:100%;height:auto;display:block;opacity:.93;}
.swiper-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.38) 0%,transparent 55%);pointer-events:none;}
.swiper-caption{position:absolute;bottom:12px;left:14px;font-size:11px;font-weight:600;letter-spacing:.04em;color:rgba(255,255,255,.9);text-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none;}
.swiper-num{position:absolute;top:12px;right:14px;background:var(--blue);color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;padding:4px 10px;border-radius:20px;pointer-events:none;}
.swiper-dots{position:absolute;bottom:12px;right:14px;display:flex;gap:5px;pointer-events:none;}
.swiper-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.4);transition:all .2s;}
.swiper-dot.active{background:#fff;width:16px;border-radius:3px;}
.swiper-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:3;background:rgba(0,0,0,.4);color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;}
.swiper-arrow:hover{background:rgba(0,0,0,.65);}
.swiper-arrow.left{left:10px;}.swiper-arrow.right{right:10px;}
.plan-wrap{padding:14px 14px 10px;background:#E8E8E8;}
.plan-label{font-size:10px;font-weight:700;color:var(--text-label);letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;}
.plan-label span{background:var(--blue-light);color:var(--blue);font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;}
.plan-img-container{background:#E8EDF4;border:1px solid var(--border);border-radius:12px;padding:12px;}
.catalog-plan-empty{padding:22px 8px;text-align:center;color:#888;font-size:12px}.plan-img{width:100%;height:auto;display:block;border-radius:4px;}
.explication{margin:10px 14px 0;border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.expl-header{background:var(--blue);padding:9px 14px;display:flex;justify-content:space-between;align-items:center;}
.expl-header-title{font-size:10px;font-weight:700;color:rgba(255,255,255,.8);letter-spacing:.08em;text-transform:uppercase;}
.expl-header-total{font-size:13px;font-weight:700;color:#fff;}
.expl-row{display:flex;align-items:center;padding:7px 14px;border-top:1px solid var(--border-soft);}
.expl-row:nth-child(even){background:#EBEBEB;}
.expl-num{width:20px;height:20px;background:var(--blue-light);color:var(--blue);border-radius:50%;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:10px;}
.expl-name{flex:1;font-size:13px;color:var(--text-primary);}
.expl-area{font-size:13px;font-weight:600;color:var(--text-primary);}
.expl-area sup{font-size:9px;font-weight:400;color:var(--text-sub);}
.info-block{padding:16px 14px 0;}
.project-title{font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:12px;line-height:1.3;}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px;}
.stat{background:#E2E2E2;border-radius:10px;padding:10px 6px;text-align:center;border:1px solid var(--border);}
.stat-val{font-size:16px;font-weight:700;color:var(--text-primary);line-height:1;}
.stat-sub{font-size:9px;color:var(--text-label);margin-top:3px;}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;}
.tag{background:var(--blue-light);border:1px solid #C8DFF5;border-radius:20px;padding:5px 12px;font-size:12px;color:var(--blue-dark);font-weight:500;}
.divider{height:1px;background:var(--border);margin:0 0 14px;}
.section-label-sm{font-size:10px;font-weight:700;color:var(--text-label);letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;}
.includes-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;}
.include-cell{background:#E2E2E2;border:1px solid var(--border);border-radius:12px;padding:10px;display:flex;align-items:flex-start;gap:8px;}
.include-icon{font-size:16px;flex-shrink:0;margin-top:1px;}
.include-text{font-size:12px;color:var(--text-primary);line-height:1.35;}
.price-block{margin:0 14px;padding:14px 0;border-top:1px solid var(--border);}
.price-label{font-size:11px;color:var(--text-label);margin-bottom:3px;}
.price{font-size:28px;font-weight:700;color:var(--text-primary);line-height:1;margin-bottom:12px;}
.btn-row{display:flex;gap:8px;}
.btn-primary{flex:1;background:var(--blue);color:#fff;border:none;border-radius:12px;padding:14px 8px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;}
.btn-secondary{flex:1;background:#F2F2F2;color:var(--text-primary);border:1.5px solid var(--border);border-radius:12px;padding:13px 8px;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap;}
.card-footer{background:var(--black);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;margin-top:16px;}
.footer-text{font-size:10px;color:rgba(255,255,255,.35);letter-spacing:.06em;}
</style></head><body>
<div class="card">
<div class="card-header">
  <div style="font-weight:700;color:#fff;font-size:15px;letter-spacing:.05em;">ARHIT<span style="color:#3D8FE0;">TEK</span></div>
  <span class="header-badge">Проектный отдел</span>
</div>
<div class="tabs">
  <div class="tab active" onclick="showTab('facade',this)">Фасад</div>
  ${CatalogFloors.tabs(card)}
</div>
<div class="panel active" id="facade">
  <div class="swiper-wrap" id="swiperWrap">
    <div class="swiper-track" id="swiperTrack">
      <div class="swiper-slide">${facade1?`<img src="${escapeHtml(facade1)}"/>`:'<div style="width:100%;height:100%;background:#222;"></div>'}<div class="swiper-overlay"></div></div>
      ${facade2?`<div class="swiper-slide"><img src="${escapeHtml(facade2)}" loading="lazy"/><div class="swiper-overlay"></div></div>`:''}
    </div>
    <div class="swiper-caption">${escapeHtml(card.title||'')}</div>
    <div class="swiper-num">№ ${escapeHtml(card.project_number||'')}</div>
    ${facade2?`<button class="swiper-arrow left" onclick="swGo(si-1)">‹</button><button class="swiper-arrow right" onclick="swGo(si+1)">›</button><div class="swiper-dots"><div class="swiper-dot active" id="dot-0"></div><div class="swiper-dot" id="dot-1"></div></div>`:''}
  </div>
</div>
${CatalogFloors.panels(card)}
<div class="info-block">
  <div class="project-title">${escapeHtml(card.title||'')}</div>
  <div class="stats">
    <div class="stat"><div class="stat-val">${escapeHtml(String(card.total_area||'—'))}</div><div class="stat-sub">м² общая</div></div>
    <div class="stat"><div class="stat-val">${escapeHtml(String(card.beds||'—'))}</div><div class="stat-sub">спальни</div></div>
    <div class="stat"><div class="stat-val">${escapeHtml(String(card.floors||'—'))}</div><div class="stat-sub">этажа</div></div>
    <div class="stat"><div class="stat-val" style="font-size:12px">${escapeHtml(card.footprint||'—')}</div><div class="stat-sub">габарит</div></div>
  </div>
  <div class="tags">${tags}</div>
  <div class="divider"></div>
  <div class="section-label-sm">Что входит и гарантии</div>
  <div class="includes-grid">
    <div class="include-cell"><div class="include-icon">📐</div><div class="include-text">Архитектурные решения (АР)</div></div>
    <div class="include-cell"><div class="include-icon">🎨</div><div class="include-text">3D-визуализация всех фасадов</div></div>
    <div class="include-cell"><div class="include-icon">✅</div><div class="include-text">Адаптация под ваш участок</div></div>
    <div class="include-cell"><div class="include-icon">✏️</div><div class="include-text">До 3 правок — включены</div></div>
  </div>
</div>
<div class="price-block">
  <div class="price-label">Стоимость проекта</div>
  <div class="price">${escapeHtml(card.price||'')} ₽</div>
  <div class="btn-row">
    <button class="btn-primary" onclick="window.open('https://wa.me/79226593872','_blank')">Получить проект</button>
    <button class="btn-secondary" onclick="window.open('https://wa.me/79226593872','_blank')">Консультация</button>
  </div>
</div>
<div class="card-footer">
  <div style="font-weight:700;color:#fff;font-size:13px;letter-spacing:.05em;">ARHIT<span style="color:#3D8FE0;">TEK</span></div>
  <span class="footer-text">arhittek.ru · Грозный</span>
</div>
</div>
<script>
function showTab(id,el){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.getElementById(id).classList.add('active');el.classList.add('active');}
let si=0;
let swGo=function(){};
(function(){
  const wrap=document.getElementById('swiperWrap');
  const track=document.getElementById('swiperTrack');
  if(!wrap||!track) return;
  const slides=track.querySelectorAll('.swiper-slide');
  if(!slides.length) return;

  // Подгоняем высоту окна под пропорции текущего изображения (ширина = 100% карточки)
  function sizeToSlide(i){
    const img = slides[i] ? slides[i].querySelector('img') : null;
    if(!img){ wrap.style.height = '200px'; return; }
    const applyH=()=>{
      if(img.naturalWidth && img.naturalHeight){
        const w = wrap.clientWidth || wrap.offsetWidth;
        wrap.style.height = (w * (img.naturalHeight/img.naturalWidth)) + 'px';
      }
    };
    if(img.complete && img.naturalWidth) applyH();
    else img.addEventListener('load', applyH, {once:true});
  }
  sizeToSlide(0);

  if(slides.length<2) return;
  function goTo(i){si=Math.max(0,Math.min(slides.length-1,i));track.style.transform='translateX('+(-si*100)+'%)';[0,1].forEach(j=>{const d=document.getElementById('dot-'+j);if(d)d.className='swiper-dot'+(j===si?' active':'');});sizeToSlide(si);}
  swGo=goTo;
  let sx=0;
  wrap.addEventListener('mousedown',e=>{sx=e.clientX;});
  wrap.addEventListener('mouseup',e=>{if(Math.abs(sx-e.clientX)>40)goTo(sx>e.clientX?si+1:si-1);});
  wrap.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;},{passive:true});
  wrap.addEventListener('touchend',e=>{if(Math.abs(sx-e.changedTouches[0].clientX)>40)goTo(sx>e.changedTouches[0].clientX?si+1:si-1);});
})();
<\/script></body></html>`;
}


loadAll();

