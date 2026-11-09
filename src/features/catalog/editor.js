// ============================================================
// КАРТОЧКИ ПРОЕКТОВ
// ============================================================

// Catalogue administration belongs only to the verified owner.
function canEditCards(){return isOwner();}

// State карточек
let cardsData = [];
let currentCardFloorFilter = 'all';
let currentCardStyleFilter = 'all';
let currentFeatureFilter = 'all';
let ceStyleSelected = '';
let ceFeatureSelected = [];
let ceCurrentId = null;
let cePdfImportMeta = null;
let ceScreenshotPlans = {};
let cardEditorGeneration = 0;
const cardSavesInFlight = new Set();
const cardImageSelections = new Map();
let ceImages = CatalogFloors.slots(); // facade1, facade2, floor1, floor2, floor3, basement
let ceThumbs = CatalogFloors.slots();
let ceFloorsSelected = 2;

// Показ/скрытие adminbar при смене view
function applyCardsRole(){
  const bar = document.getElementById('cards-admin-bar');
  const linksSection = document.getElementById('cards-links-section');
  if(canEditCards()){
    if(bar){ bar.style.display = 'block'; }
    if(linksSection){ linksSection.style.display = 'block'; }
  } else {
    if(bar){ bar.style.display = 'none'; }
    if(linksSection){ linksSection.style.display = 'none'; }
  }
}

// ── Загрузка карточек из Supabase ──
let cardsLoadPromise=null;
function loadCards(){
  if(cardsLoadPromise)return cardsLoadPromise;
  const actor=session?.token;
  cardsLoadPromise=(async()=>{
  try{
    const { data, error } = await fetchAllRows(()=>sb.from('project_cards')
      .select('*',{count:'exact'})
      .is('deleted_at', null)
      .order('created_at', { ascending: false }));
    if(error) throw error;
    if(actor!==session?.token)return;
    cardsData = data || [];
    applyCardsRole();
    renderCardsStats();
    renderCardsList();
    renderShareLinks();
    backfillCardThumbnails(); // фоново, не блокирует отрисовку
  } catch(e){
    console.error('loadCards error', e);
  }
  })().finally(()=>{cardsLoadPromise=null;});
  return cardsLoadPromise;
}

// Декодирует картинку (data: или https:) в маленький JPEG-превью через canvas.
function makeThumbFromUrl(url){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    if(!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = ()=>{
      let w = img.naturalWidth, h = img.naturalHeight;
      if(w > THUMB_MAX_SIDE || h > THUMB_MAX_SIDE){
        if(w >= h){ h = Math.round(h*THUMB_MAX_SIDE/w); w = THUMB_MAX_SIDE; }
        else      { w = Math.round(w*THUMB_MAX_SIDE/h); h = THUMB_MAX_SIDE; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      try{ resolve(canvas.toDataURL('image/jpeg', THUMB_QUALITY)); }
      catch(e){ reject(e); }
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Разовая фоновая починка старых карточек каталога:
//  1) картинки, всё ещё хранящиеся как base64 прямо в строке БД (раздувают project_cards),
//     выгружаются в Storage и заменяются на URL;
//  2) для всех фото генерируется маленькое превью (thumbnails) — чтобы список каталога
//     не грузил полноразмерные фото ради иконки 56×56.
// Идемпотентно — карточки, у которых всё уже в порядке, пропускаются.
async function backfillCardThumbnails(){
  if(!canEditCards()) return;
  const needsWork = cardsData.filter(c =>
    Array.isArray(c.images) && c.images.some(Boolean) &&
    (!Array.isArray(c.thumbnails) || c.thumbnails.length < c.images.filter(Boolean).length || c.images.some(im=>im && im.startsWith('data:')))
  );
  if(!needsWork.length) return;
  for(const card of needsWork){
    try{
      const newImages = [];
      const newThumbs = [];
      for(let i=0;i<card.images.length;i++){
        const src = card.images[i];
        if(!src){ newImages.push(null); newThumbs.push(null); continue; }
        let fullUrl = src;
        if(src.startsWith('data:')){
          const blob = dataURLtoBlob(src);
          const fileName = `cards/backfill_${card.id}_${Date.now()}_${i}_${Math.random().toString(36).slice(2,7)}.jpg`;
          const {error: upErr} = await sb.storage.from('expense-photos').upload(fileName, blob, {contentType:'image/jpeg', upsert:true});
          if(upErr) throw upErr;
          fullUrl = sb.storage.from('expense-photos').getPublicUrl(fileName).data.publicUrl;
        }
        newImages.push(fullUrl);
        const thumbDataUrl = await makeThumbFromUrl(fullUrl);
        const thumbBlob = dataURLtoBlob(thumbDataUrl);
        const thumbName = `cards/thumb_${card.id}_${Date.now()}_${i}_${Math.random().toString(36).slice(2,7)}.jpg`;
        const {error: thErr} = await sb.storage.from('expense-photos').upload(thumbName, thumbBlob, {contentType:'image/jpeg', upsert:true});
        if(thErr) throw thErr;
        newThumbs.push(sb.storage.from('expense-photos').getPublicUrl(thumbName).data.publicUrl);
      }
      const {error: updErr} = await sb.from('project_cards').update({images:newImages, thumbnails:newThumbs}).eq('id', card.id);
      if(updErr) throw updErr;
      card.images = newImages;
      card.thumbnails = newThumbs;
    }catch(e){ console.warn('Не удалось обновить превью карточки каталога', card.id, e); }
  }
  renderCardsList();
}

// ── Рендер списка карточек ──
function filterCards(val, el){
  currentCardFloorFilter = val;
  document.querySelectorAll('#cards-filters .filter-chip').forEach(c=>c.classList.remove('active'));
  if(el) el.classList.add('active');
  renderCardsList();
}

function filterStyle(val, el){
  currentCardStyleFilter = val;
  document.querySelectorAll('#style-filters .filter-chip').forEach(c=>c.classList.remove('active'));
  if(el) el.classList.add('active');
  renderCardsList();
}

function filterFeature(val, el){
  currentFeatureFilter = val;
  document.querySelectorAll('#feature-filters .filter-chip').forEach(c=>c.classList.remove('active'));
  if(el) el.classList.add('active');
  renderCardsList();
}

// Счётчик каталога: общее число проектов + разбивка по этажам и стилю.
// Всегда по ПОЛНОМУ каталогу (не зависит от текущего фильтра) — это обзор
// состава каталога, а не счётчик отфильтрованных результатов.
function renderCardsStats(){
  const el = document.getElementById('cards-stats');
  if(!el) return;
  if(!cardsData.length){ el.innerHTML = ''; return; }

  const total = cardsData.length;
  const byFloors = {1:0, 2:0, '3plus':0};
  let classic = 0, modern = 0;
  cardsData.forEach(c=>{
    const f = Number(c.floors) || 1;
    if(f >= 3) byFloors['3plus']++;
    else byFloors[f] = (byFloors[f]||0) + 1;
    const tags = Array.isArray(c.tags) ? c.tags : (c.tags||'').split(',').map(t=>t.trim());
    if(tags.includes('Классический')) classic++;
    if(tags.includes('Современный')) modern++;
  });

  const maxFloorCount = Math.max(byFloors[1], byFloors[2], byFloors['3plus'], 1);
  const barPct = n => Math.max(n>0?6:0, Math.round((n/maxFloorCount)*100));

  el.innerHTML = `
    <div class="cat-statbar">
      <div class="cat-stat-total"><div class="v">${total}</div><div class="l">всего</div></div>
      <div class="cat-stat-breakdown">
        <div class="cat-sb-row"><span class="cat-sb-label">1 этаж</span><div class="cat-sb-bars"><div class="cat-sb-seg" style="width:${barPct(byFloors[1])}%; opacity:${byFloors[1]?1:0.25};"></div></div><span class="cat-sb-val">${byFloors[1]}</span></div>
        <div class="cat-sb-row"><span class="cat-sb-label">2 этажа</span><div class="cat-sb-bars"><div class="cat-sb-seg" style="width:${barPct(byFloors[2])}%; opacity:${byFloors[2]?1:0.25};"></div></div><span class="cat-sb-val">${byFloors[2]}</span></div>
        <div class="cat-sb-row"><span class="cat-sb-label">3+ этажей</span><div class="cat-sb-bars"><div class="cat-sb-seg" style="width:${barPct(byFloors['3plus'])}%; opacity:${byFloors['3plus']?1:0.25};"></div></div><span class="cat-sb-val">${byFloors['3plus']}</span></div>
      </div>
    </div>
    <div class="cat-stat-grid">
      <div class="cat-stat-tile"><div class="v">${classic}</div><div class="l">Классический стиль</div></div>
      <div class="cat-stat-tile"><div class="v">${modern}</div><div class="l">Современный стиль</div></div>
    </div>
  `;
}

function renderCardsList(){
  const container = document.getElementById('cards-list');
  if(!container) return;

  let filtered = cardsData;
  if(currentCardFloorFilter !== 'all'){
    filtered = filtered.filter(c => String(c.floors) === String(currentCardFloorFilter));
  }
  if(currentFeatureFilter !== 'all'){
    const featureTagMap = {basement:'Цокольный этаж',mansard:'Мансарда',flat:'Плоская кровля'};
    const featureTag = featureTagMap[currentFeatureFilter];
    if(featureTag){
      filtered = filtered.filter(c => {
        const tags = Array.isArray(c.tags) ? c.tags : (c.tags||'').split(',').map(t=>t.trim());
        return tags.includes(featureTag);
      });
    }
  }
  if(currentCardStyleFilter !== 'all'){
    const styleKey = currentCardStyleFilter === 'classic' ? 'Классический' : 'Современный';
    filtered = filtered.filter(c => {
      const tags = Array.isArray(c.tags) ? c.tags : (c.tags||'').split(',').map(t=>t.trim());
      return tags.includes(styleKey);
    });
  }

  if(!filtered.length){
    container.innerHTML = `<div class="note" style="text-align:center;padding:40px 0;opacity:0.5;">
      ${cardsData.length ? 'Нет проектов для этого фильтра' : 'Проектов ещё нет'}
    </div>`;
    return;
  }

  // Сохраняем текущий отфильтрованный список для листания в просмотрщике
  cardViewerList = filtered;

  container.innerHTML = filtered.map(card => `
    <div class="card" style="margin-bottom:10px;cursor:pointer;position:relative;"
         onclick="viewCard('${card.id}')">
      ${canEditCards() ? `<button class="icon-btn" title="Получить ссылку на этот проект" onclick="event.stopPropagation(); createShareLinkForProject('${card.id}',${htmlJsArg(card.title||'Проект')})" style="position:absolute;top:8px;right:8px;font-size:15px;background:var(--card-solid);border:1px solid var(--line-strong);border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;z-index:2;">🔗</button>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;line-height:1.35;margin-bottom:3px;">${escapeHtml(card.title||'Без названия')}</div>
          <div style="font-size:11px;color:var(--text-dim);">
            ${card.floors} эт. · ${card.total_area||'—'} м² · ${card.footprint||''}
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
            <span style="font-size:10px;background:rgba(0,113,235,0.15);color:var(--blue);padding:2px 8px;border-radius:20px;font-weight:600;">${CatalogFloors.label(card)}</span>
            ${card.beds ? `<span style="font-size:10px;background:rgba(22,35,58,0.08);color:var(--text-dim);padding:2px 8px;border-radius:20px;">${card.beds} спал.</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          ${(card.thumbnails?.[0] || card.images?.[0])
            ? `<img src="${escapeHtml(card.thumbnails?.[0] || card.images[0])}" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid rgba(22,35,58,0.1);" onerror="this.parentNode.innerHTML='<div style=\'width:56px;height:56px;border-radius:8px;background:rgba(61,143,224,0.1);display:flex;align-items:center;justify-content:center;font-size:22px;border:1px dashed rgba(61,143,224,0.3);\'>🏠</div>'"/>`
            : `<div style="width:56px;height:56px;border-radius:8px;background:rgba(61,143,224,0.08);display:flex;align-items:center;justify-content:center;font-size:22px;border:1px dashed rgba(61,143,224,0.25);" title="Фото не загружено">🏠</div>`}
          <div style="font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:700;color:var(--blue);margin-top:4px;">${card.price ? card.price+' ₽' : ''}</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Открыть редактор карточки ──
function openCardEditor(id){
  if(!canEditCards()){ showToast('Нет доступа'); return; }
  CatalogPdfImport.cancel();
  CatalogScreenshot.reset();
  cardEditorGeneration++;
  ceCurrentId = id || null;
  cePdfImportMeta = null;
  ceScreenshotPlans = {};
  const qualityStatus=document.getElementById('ce-quality-status');if(qualityStatus){qualityStatus.hidden=true;qualityStatus.textContent='';}
  CatalogPdfImport.reset();
  initCardFloorEditor();
  CatalogScreenshot.init();
  ceImages = CatalogFloors.slots();
  ceThumbs = CatalogFloors.slots();
  ceScanPending = {};
  CatalogFloors.definitions.map(f=>'ce-expl'+f.suffix+'-scan-status').forEach(id2=>{ const el=document.getElementById(id2); if(el) el.innerHTML=''; });

  // Reset form
  ['ce-num','ce-title','ce-area','ce-footprint','ce-beds','ce-baths','ce-price','ce-tags',...CatalogFloors.definitions.flatMap(f=>['ce-area'+f.suffix,'ce-expl'+f.suffix])].forEach(f=>{
    const el = document.getElementById(f);
    if(el) el.value = '';
  });
  ['ce-facade-preview','ce-facade2-preview',...CatalogFloors.definitions.map(f=>'ce-plan'+f.suffix+'-preview')].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.src=''; el.style.display='none'; }
  });

  ceStyleSelected = '';
  ceFeatureSelected = [];
  selectStyle('');
  ['basement','mansard','flat'].forEach(id=>{const b=document.getElementById('feature-btn-'+id);b.style.borderColor='#374151';b.style.background='transparent';b.style.color='#6b7280';b.setAttribute('aria-pressed','false');});
  selectFloors(2);

  if(id){
    // Edit mode
    document.getElementById('cardEditorTitle').textContent = 'Редактировать проект';
    document.getElementById('ce-delete-row').style.display = 'block';
    const card = cardsData.find(c=>c.id===id);
    if(card){
      setVal('ce-num', card.project_number||'');
      // Убрать префикс "Проект №XXXX — " из title при загрузке в редактор
      let titleForEdit = card.title || '';
      const titlePrefix = 'Проект №' + (card.project_number||'') + ' — ';
      if(titleForEdit.startsWith(titlePrefix)){
        titleForEdit = titleForEdit.slice(titlePrefix.length);
      } else if(titleForEdit.startsWith('Проект №')){
        titleForEdit = titleForEdit.replace(/^Проект №[\d\w]+ — /, '');
      }
      setVal('ce-title', titleForEdit);
      setVal('ce-area', card.total_area||'');
      setVal('ce-footprint', card.footprint||'');
      setVal('ce-beds', card.beds||'');
      setVal('ce-baths', card.baths||'');
      setVal('ce-price', card.price||'');
      setVal('ce-tags', (card.tags||[]).join(', '));
      CatalogFloors.definitions.forEach(f=>{
        setVal('ce-area'+f.suffix,card[f.area]||'');
        setVal('ce-expl'+f.suffix,(card[f.rooms]||[]).map(r=>`${r.name}: ${r.area}`).join('\n'));
      });
      selectFloors(card.floors||2);
      // Load style and features from tags
      const cardTags = Array.isArray(card.tags) ? card.tags : (card.tags||'').split(',').map(t=>t.trim());
      if(cardTags.includes('Классический')) selectStyle('classic');
      else if(cardTags.includes('Современный')) selectStyle('modern');
      else { ceStyleSelected=''; ['classic','modern'].forEach(id=>{const btn=document.getElementById('style-btn-'+id);if(btn){btn.style.borderColor='#374151';btn.style.background='transparent';btn.style.color='#6b7280';}}); }
      ceFeatureSelected=[];
      ['basement','mansard','flat'].forEach(id=>{const btn=document.getElementById('feature-btn-'+id);if(btn){btn.style.borderColor='#374151';btn.style.background='transparent';btn.style.color='#6b7280';}});
      if(cardTags.includes('Цокольный этаж')){ceFeatureSelected.push('basement');const b=document.getElementById('feature-btn-basement');if(b){b.style.borderColor='#3b82f6';b.style.background='rgba(59,130,246,0.15)';b.style.color='#3b82f6';}}
      if(cardTags.includes('Мансарда')){ceFeatureSelected.push('mansard');const b=document.getElementById('feature-btn-mansard');if(b){b.style.borderColor='#3b82f6';b.style.background='rgba(59,130,246,0.15)';b.style.color='#3b82f6';}}
      if(cardTags.includes('Плоская кровля')){ceFeatureSelected.push('flat');const b=document.getElementById('feature-btn-flat');if(b){b.style.borderColor='#3b82f6';b.style.background='rgba(59,130,246,0.15)';b.style.color='#3b82f6';}}
      // Show stored images as previews
      if(card.images){
        const previews = ['ce-facade-preview','ce-facade2-preview','ce-plan1-preview','ce-plan2-preview','ce-plan3-preview','ce-planb-preview'];
        card.images.forEach((src,i)=>{
          if(src && previews[i]){
            const el = document.getElementById(previews[i]);
            if(el){ el.src=src; el.style.display='block'; }
          }
        });
        ceImages = CatalogFloors.slots(card.images);
        ceThumbs = CatalogFloors.slots(card.thumbnails);
      }
    }
  } else {
    document.getElementById('cardEditorTitle').textContent = 'Новый проект';
    document.getElementById('ce-delete-row').style.display = 'none';
  }

  const overlay=document.getElementById('cardEditorOverlay');
  if(!overlay.dataset.draftGuardInstalled){
    overlay.dataset.draftGuardInstalled='1';
    const markDirty=()=>{if(overlay.style.display!=='none')overlay.dataset.dirty='1';};
    overlay.addEventListener('input',markDirty,true);
    overlay.addEventListener('change',markDirty,true);
    overlay.addEventListener('click',event=>{
      if(event.target.closest('button[onclick="closeCardEditor()"]')&&overlay.dataset.dirty==='1'&&!confirm('Есть несохранённые изменения. Закрыть окно и потерять их?')){
        event.preventDefault();event.stopImmediatePropagation();
      }
    },true);
    window.addEventListener('beforeunload',event=>{if(overlay.style.display!=='none'&&overlay.dataset.dirty==='1'){event.preventDefault();event.returnValue='';}});
  }
  overlay.dataset.dirty='0';
  const saving=cardSavesInFlight.has(ceCurrentId || 'new:'+cardEditorGeneration);
  document.getElementById('ce-save-btn').disabled=saving;
  document.getElementById('ce-save-btn').textContent=saving?'Сохранение…':'Сохранить проект';
  cePrevTab('prev-facade',document.querySelector('#prev-tabs > div'));
  cePreview();
  overlay.style.display = 'flex';
}

function closeCardEditor(){
  CatalogPdfImport.cancel();
  CatalogScreenshot.reset();
  document.getElementById('cardEditorOverlay').style.display = 'none';
}

function setVal(id, val){ const el=document.getElementById(id); if(el) el.value=val; }

function selectFloors(n){
  n = Math.max(1,Math.min(3,parseInt(n)||1));
  ceFloorsSelected = n;
  markCardEditorDirty();
  [1,2,3].forEach(i=>{
    const btn = document.getElementById('floors-btn-'+i);
    if(!btn) return;
    if(i===n){
      btn.style.borderColor='#3b82f6';btn.style.background='rgba(59,130,246,0.15)';btn.style.color='#3b82f6';
    } else {
      btn.style.borderColor='#374151';btn.style.background='transparent';btn.style.color='#6b7280';
    }
  });
  const fs = document.getElementById('prev-floors-stat'); if(fs) fs.textContent=n;
  cePreview();
}

function selectStyle(s){
  ceStyleSelected = s || '';
  ['classic','modern'].forEach(id=>{
    const btn=document.getElementById('style-btn-'+id);
    if(!btn) return;
    if(s===id){
      btn.style.borderColor='#3b82f6';btn.style.background='rgba(59,130,246,0.15)';btn.style.color='#3b82f6';
    } else {
      btn.style.borderColor='#374151';btn.style.background='transparent';btn.style.color='#6b7280';
    }
  });
}

function toggleFeature(f, el){
  const idx = ceFeatureSelected.indexOf(f);
  if(idx === -1){ ceFeatureSelected.push(f); }
  else { ceFeatureSelected.splice(idx,1); }
  ['basement','mansard','flat'].forEach(id=>{
    const btn=document.getElementById('feature-btn-'+id);
    if(!btn) return;
    if(ceFeatureSelected.includes(id)){
      btn.style.borderColor='#3b82f6';btn.style.background='rgba(59,130,246,0.15)';btn.style.color='#3b82f6';
    } else {
      btn.style.borderColor='#374151';btn.style.background='transparent';btn.style.color='#6b7280';
    }
  });
  markCardEditorDirty();
  cePreview();
}

