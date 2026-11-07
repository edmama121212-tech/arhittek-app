// ============================================================
// УНИВЕРСАЛЬНОЕ СЖАТИЕ ФОТО (для всех загрузок: накладные, карточки, проекты)
// ============================================================
const IMG_MAX_SIDE = 1920;   // px по длинной стороне
const IMG_QUALITY  = 0.85;   // JPEG качество
const THUMB_MAX_SIDE = 240;  // px — маленькое превью для списков (каталог и т.п.)
const THUMB_QUALITY  = 0.7;

// Возвращает Promise<Blob> — сжатый JPEG.
// Если файл уже меньше maxSide с обеих сторон и меньше 300КБ — не перекодирует.
// Загружает файл-изображение с учётом EXIF-ориентации (иначе фото с телефона
// может отрисоваться повёрнутым/перекошенным после сжатия через canvas —
// телефоны хранят кадр как есть + метку поворота, а обычный canvas её игнорирует).
function loadOrientedImage(file){
  if(typeof createImageBitmap === 'function'){
    return createImageBitmap(file, {imageOrientation:'from-image'})
      .then(bmp => ({source: bmp, width: bmp.width, height: bmp.height}))
      .catch(() => loadOrientedImageFallback(file));
  }
  return loadOrientedImageFallback(file);
}

function loadOrientedImageFallback(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e=>{
      const img = new Image();
      img.onerror = reject;
      img.onload = () => resolve({source: img, width: img.naturalWidth||img.width, height: img.naturalHeight||img.height});
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function compressImage(file, maxSide, quality){
  maxSide  = maxSide  || IMG_MAX_SIDE;
  quality  = quality  || IMG_QUALITY;
  const {source, width, height} = await loadOrientedImage(file);
  let w = width, h = height;
  const needsResize = w > maxSide || h > maxSide;
  const needsReencode = file.size > 300 * 1024 || needsResize;
  if(!needsReencode){
    if(source.close) source.close();
    // Уже маленький — возвращаем как есть (в виде Blob)
    return file;
  }
  if(needsResize){
    if(w >= h){ h = Math.round(h * maxSide / w); w = maxSide; }
    else       { w = Math.round(w * maxSide / h); h = maxSide; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  if(source.close) source.close();
  return await new Promise((resolve)=>{
    canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
  });
}

// Хелпер: сжать → загрузить в storage → вернуть publicUrl
async function compressAndUpload(file, bucket, path,canUpload=null){
  const compressed = await compressImage(file);
  if(canUpload&&!canUpload())throw new Error('Сеанс или доступ к объекту изменился');
  const {error} = await sb.storage.from(bucket).upload(path, compressed, {contentType:'image/jpeg', upsert:true});
  if(error) throw error;
  const {data: urlData} = sb.storage.from(bucket).getPublicUrl(path);
  return urlData.publicUrl;
}

function ceLoadImg(input, previewId, idx, nameId){
  const file = input.files[0];
  if(!file) return;
  const generation=cardEditorGeneration,selection=(cardImageSelections.get(idx)||0)+1;
  cardImageSelections.set(idx,selection);

  return loadOrientedImage(file).then(({source, width, height}) => {
    if(generation!==cardEditorGeneration||selection!==cardImageSelections.get(idx)||document.getElementById('cardEditorOverlay').style.display==='none'){
      if(source.close)source.close();
      return;
    }
    // Масштабируем если нужно
    let w = width, h = height;
    if(w > IMG_MAX_SIDE || h > IMG_MAX_SIDE){
      if(w >= h){ h = Math.round(h * IMG_MAX_SIDE / w); w = IMG_MAX_SIDE; }
      else       { w = Math.round(w * IMG_MAX_SIDE / h); h = IMG_MAX_SIDE; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(source, 0, 0, w, h);
    const compressed = canvas.toDataURL('image/jpeg', IMG_QUALITY);

    // Маленькое превью (для списка каталога) — из того же декодированного источника
    let tw = width, th = height;
    if(tw > THUMB_MAX_SIDE || th > THUMB_MAX_SIDE){
      if(tw >= th){ th = Math.round(th * THUMB_MAX_SIDE / tw); tw = THUMB_MAX_SIDE; }
      else        { tw = Math.round(tw * THUMB_MAX_SIDE / th); th = THUMB_MAX_SIDE; }
    }
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = tw; thumbCanvas.height = th;
    thumbCanvas.getContext('2d').drawImage(source, 0, 0, tw, th);
    const thumb = thumbCanvas.toDataURL('image/jpeg', THUMB_QUALITY);

    if(source.close) source.close();

    // Показываем размер после сжатия
    const kb = Math.round(compressed.length * 0.75 / 1024);
    const nm = document.getElementById(nameId);
    if(nm) nm.textContent = `${file.name.slice(0,18)}… · ${kb} КБ`;

    ceImages[idx] = compressed;
    ceThumbs[idx] = thumb;
    const el = document.getElementById(previewId);
    if(el){ el.src = compressed; el.style.display = 'block'; }
    cePreview();
  }).catch(error=>{
    console.error('Catalogue image decode failed',error);
    if(generation===cardEditorGeneration&&selection===cardImageSelections.get(idx))showToast('Не удалось обработать фото. Попробуйте загрузить его ещё раз');
  });
}

function cePrevTab(panelId,tabEl){
  ['prev-facade',...CatalogFloors.definitions.map(f=>'prev-'+f.key)].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  document.getElementById('prev-tabs').querySelectorAll(':scope > div').forEach(t=>{t.style.color='#888';t.style.borderBottomColor='transparent';t.style.fontWeight='500';});
  const panel=document.getElementById(panelId); if(panel) panel.style.display='block';
  tabEl.style.color='#3D8FE0'; tabEl.style.borderBottomColor='#3D8FE0'; tabEl.style.fontWeight='600';
}

// Текущая ставка за м² для каталога готовых проектов (Ещё → Настройки)
function getCatalogPricePerSqm(){
  return Number(state.companyInfo?.price_per_sqm) || 150;
}

// Автоподстановка цены в редакторе карточки при вводе площади — площадь × ставка.
// Поле цены остаётся редактируемым: если поправить его вручную и не менять
// площадь дальше, ручное значение сохранится.
function ceAutoPrice(){
  const areaRaw = document.getElementById('ce-area').value;
  const area = parseFloat((areaRaw||'').replace(',','.'));
  if(area > 0){
    const price = Math.round(area * getCatalogPricePerSqm());
    document.getElementById('ce-price').value = price;
  }
  cePreview();
}

