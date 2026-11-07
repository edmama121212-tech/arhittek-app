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
  const rows = values=>(Array.isArray(values)?values:[]).map((r,i)=>`<div class="expl-row"><div class="expl-num">${i+1}</div><div class="expl-name">${esc(r.name)}</div><div class="expl-area">${esc(r.area)} <sup>м²</sup></div></div>`).join('');
  function tabs(card,suffix='',handler='showTab'){
    return active(card).map(f=>`<div class="tab" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" onclick="${handler}('${f.key}${suffix}',this)">${f.label}</div>`).join('');
  }
  function panels(card,suffix=''){
    return active(card).map(f=>`<div class="panel" id="${f.key}${suffix}"><div class="plan-wrap"><div class="plan-label">${f.title} <span>${esc(card[f.area]||'—')} м²</span></div><div class="plan-img-container">${card.images?.[f.image]?`<img class="plan-img" src="${esc(card.images[f.image])}" alt="${f.title}: план" loading="lazy"/>`:'<div class="catalog-plan-empty">План не добавлен</div>'}</div></div><div class="explication"><div class="expl-header"><span class="expl-header-title">Экспликация</span><span class="expl-header-total">${esc(card[f.area]||'—')} м²</span></div>${rows(card[f.rooms])}</div><div style="height:12px"></div></div>`).join('');
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
  root.CatalogFloors = Object.freeze({definitions,enabled,active,slots,label,rows,tabs,panels,editor,previewTabs,previewPanels});
})(typeof window!=='undefined'?window:globalThis);
