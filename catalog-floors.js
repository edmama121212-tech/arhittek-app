(function(root){
  'use strict';
  // Existing image slots 0–3 retain their meaning. New plans use 4 and 5.
  const definitions = Object.freeze([
    {key:'basement', suffix:'b', label:'Цоколь', title:'Цокольный этаж', area:'basement_area', rooms:'expl_basement', image:5},
    {key:'floor1', suffix:'1', label:'1-й этаж', title:'1-й этаж', area:'floor1_area', rooms:'expl1', image:2, number:1},
    {key:'floor2', suffix:'2', label:'2-й этаж', title:'2-й этаж', area:'floor2_area', rooms:'expl2', image:3, number:2},
    {key:'floor3', suffix:'3', label:'3-й этаж', title:'3-й этаж', area:'floor3_area', rooms:'expl3', image:4, number:3}
  ].map(Object.freeze));
  const esc = value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const tags = card=>Array.isArray(card.tags)?card.tags:String(card.tags||'').split(',').map(t=>t.trim());
  const enabled = (floor,card)=>floor.key==='basement'?tags(card).includes('Цокольный этаж'):Number(card.floors||1)>=floor.number;
  const active = card=>definitions.filter(floor=>enabled(floor,card));
  const slots = values=>Array.from({length:Math.max(6,Array.isArray(values)?values.length:0)},(_,i)=>values?.[i]||null);
  const label = card=>`${Number(card.floors)||1} ${Number(card.floors)===1?'этаж':'этажа'}${tags(card).includes('Цокольный этаж')?' + цоколь':''}`;
  const rows = values=>normalizeRooms(values).map((r,i)=>`<div class="expl-row"><div class="expl-num">${i+1}</div><div class="expl-name">${esc(r.name)}</div><div class="expl-area">${esc(r.area)} <sup>м²</sup></div></div>`).join('');
  const areaNumber=value=>{const text=String(value??'').trim().replace(/\s/g,'').replace(/м[²2]$/iu,'').replace(',','.');return /^\d+(?:\.\d{1,2})?$/.test(text)&&Number(text)>0?Number(text):null;};
  const areaText=value=>(Math.round(value*100)/100).toFixed(2).replace('.',',');
  function normalizeRooms(values,{expectedArea}={}){
    const rows=typeof values==='string'?values.split(/\r?\n/).filter(v=>v.trim()):Array.isArray(values)?values:[];
    const normalized=rows.map(row=>{
      let name=typeof row==='string'?'':String(row?.name||'').trim(),area=(typeof row==='string'?row:String(row?.area??'')).trim().replace(/(\d[.,]\d{1,2})[.,;]+$/,'$1');
      if(areaNumber(area)===null){
        const m=/\d[-ю]\d{2}\s*(?:м[²2])?$/iu.test(area)?null:area.replace(/^:\s*/,'').match(/^(.*\S)\s*(?::|[–—-]|\s)\s*(\d+(?:[.,]\d{1,2})?)\s*(?:м[²2])?\s*$/iu);
        if(m&&(!name||name===m[1].trim())){name=m[1].trim().replace(/[:–—-]\s*$/,'').trim();area=m[2];}
      }
      return {name,area:areaNumber(area)!==null?String(area).replace(/\s|м[²2]/giu,'').replace('.',','):area};
    });
    const expected=areaNumber(expectedArea);
    if(expected!==null&&normalized.some(r=>!r.name||areaNumber(r.area)===null)){
      const repaired=rows.map(row=>{const name=typeof row==='string'?'':String(row?.name||''),raw=typeof row==='string'?row:String(row?.area??'');return {name,area:raw.replace(/(\d+)[ю-](\d{2})(\s*(?:м[²2])?)$/iu,'$1,$2$3')};});
      const trial=normalizeRooms(repaired);
      if(trial.every(r=>r.name&&areaNumber(r.area)!==null)&&Math.abs(trial.reduce((sum,r)=>sum+areaNumber(r.area),0)-expected)<.021)return trial;
    }
    return normalized;
  }
  function calculateAreas(card){
    const patch={},missing=[];let sum=0;
    for(const f of active(card)){
      const rooms=normalizeRooms(card[f.rooms],{expectedArea:card[f.area]});patch[f.rooms]=rooms;
      const complete=rooms.length&&rooms.every(r=>r.name&&areaNumber(r.area)!==null);
      const value=complete?rooms.reduce((s,r)=>s+Math.round(areaNumber(r.area)*100),0)/100:areaNumber(card[f.area]);
      if(value===null){missing.push(f.key);continue;}patch[f.area]=areaText(value);sum+=Math.round(value*100);
    }
    if(!missing.length&&sum>0)patch.total_area=areaText(sum/100);
    return {patch,complete:!missing.length&&sum>0,missing};
  }
  // Whole-house tariff, not progressive bands. Exactly 100 and 400 are middle tier.
  function rate(value){const area=areaNumber(value);return area===null?null:area<100?150:area>400?80:100;}
  function autoPrice(value){const area=areaNumber(value),unit=rate(value);return area===null?null:Math.round(Math.round(area*100)*unit/100);}
  function price(card){
    const saved=areaNumber(String(card.price??'').replace(/руб\.?|₽/giu,''));
    return saved!==null?saved:autoPrice(card.total_area);
  }
  const priceText=card=>{const value=price(card);return value===null?'Цена по запросу':value.toLocaleString('ru-RU')+' ₽';};
  const defaultTitle=card=>(Number(card.floors)===1?'Одноэтажный':Number(card.floors)===3?'Трёхэтажный':'Двухэтажный')+' дом';
  function roofPlan(card){
    const plan=card?.catalog_roof_plan;
    if(!plan || plan.revision!=='generated-render-v2-gray' || plan.album_hash!==card.pdf_import_meta?.sha256) return null;
    const validHash=hash=>typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash);
    if(![plan.album_hash,plan.file_sha256,plan.thumbnail_file_sha256].every(validHash) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(card.id)) return null;
    const prefix=SUPABASE_URL+'/storage/v1/object/public/expense-photos/cards/'+card.id+'/';
    return {image:prefix+plan.file_sha256+'.webp',thumbnail:prefix+plan.thumbnail_file_sha256+'.webp'};
  }
  function tabs(card,suffix='',handler='showTab'){
    const items=active(card);
    if(roofPlan(card)) items.push({key:'roof',label:'Кровля'});
    return items.map(f=>`<div class="tab" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" onclick="${handler}('${f.key}${suffix}',this)">${f.label}</div>`).join('');
  }
  function panels(card,suffix=''){
    const roof=roofPlan(card);
    const extra=roof ? `<div class="panel" id="roof${suffix}"><div class="plan-wrap"><div class="plan-label">Эксплуатируемая кровля</div><div class="plan-img-container"><a href="${esc(roof.image)}" target="_blank" rel="noopener"><img class="plan-img" src="${esc(roof.image)}" alt="Полный план эксплуатируемой кровли" loading="lazy"/></a></div></div></div>` : '';
    return active(card).map(f=>`<div class="panel" id="${f.key}${suffix}"><div class="plan-wrap"><div class="plan-label">${f.title} <span>${esc(card[f.area]||'—')} м²</span></div><div class="plan-img-container">${card.images?.[f.image]?`<img class="plan-img" src="${esc(card.images[f.image])}" alt="${f.title}: план" loading="lazy"/>`:'<div class="catalog-plan-empty">План не добавлен</div>'}</div></div><div class="explication"><div class="expl-header"><span class="expl-header-title">Экспликация</span><span class="expl-header-total">${esc(card[f.area]||'—')} м²</span></div>${rows(card[f.rooms])}</div><div style="height:12px"></div></div>`).join('')+extra;
  }
  function editor(){
    return definitions.map(f=>`<section class="ce-floor-section" id="ce-section-${f.key}">
      <h3>${f.title}</h3>
      <label class="ce-floor-label" for="ce-area${f.suffix}">Площадь, м²</label>
      <input class="ce-inp" id="ce-area${f.suffix}" inputmode="decimal" oninput="cePreview()"/>
      <label class="ce-floor-upload">📐 <span id="ce-p${f.suffix}-name">Загрузить план</span><input type="file" accept="image/*" onchange="ceLoadImg(this,'ce-plan${f.suffix}-preview',${f.image},'ce-p${f.suffix}-name')"/></label>
      <img id="ce-plan${f.suffix}-preview" class="ce-floor-image" alt="${f.title}: план" style="display:none"/>
      <label class="ce-floor-label" for="ce-expl${f.suffix}">Экспликация</label>
      <div class="ce-floor-hint">Каждая строка: Название: площадь</div>
      <textarea class="ce-inp" id="ce-expl${f.suffix}" rows="5" placeholder="Помещение: 20,40" oninput="cePreview()"></textarea>
      <div class="ce-floor-scan"><label class="ce-scan-btn" for="ce-expl${f.suffix}-scan-photo">🖼 Фото таблицы</label><label class="ce-scan-btn" for="ce-expl${f.suffix}-scan-camera">📷 Сканировать</label></div>
      <input type="file" id="ce-expl${f.suffix}-scan-photo" accept="image/*" style="display:none" onchange="scanExplication(this,'ce-expl${f.suffix}')"/>
      <input type="file" id="ce-expl${f.suffix}-scan-camera" accept="image/*" capture="environment" style="display:none" onchange="scanExplication(this,'ce-expl${f.suffix}')"/>
      <div id="ce-expl${f.suffix}-scan-status"></div>
    </section>`).join('');
  }
  function previewTabs(){
    return definitions.map(f=>`<div id="prev-tab-${f.key}" role="button" tabindex="0" onclick="cePrevTab('prev-${f.key}',this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">${f.label}</div>`).join('');
  }
  function previewPanels(){
    return definitions.map(f=>`<div id="prev-${f.key}" class="catalog-floor-preview" style="display:none"><div class="plan-wrap"><div class="plan-label">${f.title}<span id="prev-a${f.suffix}-badge">— м²</span></div><div class="plan-img-container"><img id="prev-plan${f.suffix}-img" class="plan-img" alt="${f.title}: план" style="display:none"/><span id="prev-plan${f.suffix}-ph" class="catalog-plan-empty">Загрузите план</span></div></div><div class="explication"><div class="expl-header"><span class="expl-header-title">Экспликация</span><span id="prev-total${f.suffix}" class="expl-header-total">— м²</span></div><div id="prev-expl${f.suffix}-rows"></div></div><div style="height:12px"></div></div>`).join('');
  }
  root.CatalogFloors = Object.freeze({definitions,roofPlan,tags,enabled,active,slots,label,rate,autoPrice,price,priceText,rows,normalizeRooms,calculateAreas,defaultTitle,areaNumber,tabs,panels,editor,previewTabs,previewPanels});
})(typeof window!=='undefined'?window:globalThis);
