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
  const standardTags = ['Классический','Современный','Цокольный этаж','Мансарда','Плоская кровля'];
  const standardTagByName = new Map(standardTags.map(tag=>[tag.toLowerCase(),tag]));
  function tags(card){
    const values=Array.isArray(card.tags)?card.tags:String(card.tags||'').split(',');
    const result=new Set();
    for(const value of values){
      if(typeof value!=='string')continue;
      const text=value.trim();
      if(text)result.add(standardTagByName.get(text.toLowerCase().replace(/\s+/g,' '))||text);
    }
    return [...result];
  }
  const enabled = (floor,card)=>floor.key==='basement'?tags(card).includes('Цокольный этаж'):Number(card.floors||1)>=floor.number;
  const active = card=>definitions.filter(floor=>enabled(floor,card));
  const slots = values=>Array.from({length:Math.max(6,Array.isArray(values)?values.length:0)},(_,i)=>values?.[i]||null);
  function count(card){
    const value=Number(card.floors);
    return Number.isSafeInteger(value)&&value>0?value:null;
  }
  function matchesCount(card,filter){
    const value=count(card);
    return String(filter)==='3'?value>=3:value===Number(filter);
  }
  const plurals=new Intl.PluralRules('ru');
  function label(card){
    const value=count(card);
    const unit={one:'этаж',few:'этажа',many:'этажей'};
    const text=value===null?'Этажность не указана':value+' '+unit[plurals.select(value)];
    return text+(tags(card).includes('Цокольный этаж')?' + цоколь':'');
  }
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
    const levels=count(card);
    const complete=levels!==null&&levels<=3&&!missing.length&&sum>0;
    if(complete)patch.total_area=areaText(sum/100);
    return {patch,complete,missing};
  }
  // Whole-house tariff, not progressive bands. Exactly 100 and 400 are middle tier.
  // Shared, validated rates: owner edits them in settings; public catalog reads the same public rates.
  const defaultRates=Object.freeze({rate_under_100:150,rate_100_to_400:100,rate_over_400:80});
  let pricingRates={...defaultRates};
  function setRates(values){
    const keys=['rate_under_100','rate_100_to_400','rate_over_400'];
    if(!values||keys.some(key=>!Number.isInteger(Number(values[key]))||Number(values[key])<1||Number(values[key])>100000))return false;
    pricingRates=Object.fromEntries(keys.map(key=>[key,Number(values[key])]));
    return true;
  }
  function getRates(){return {...pricingRates};}
  function rate(value){
    const area=areaNumber(value);
    return area===null?null:area<100?pricingRates.rate_under_100:area>400?pricingRates.rate_over_400:pricingRates.rate_100_to_400;
  }
  function autoPrice(value){const area=areaNumber(value),unit=rate(value);return area===null?null:Math.round(Math.round(area*100)*unit/100);}
  function price(card){
    const saved=areaNumber(String(card.price??'').replace(/руб\.?|₽/giu,''));
    return saved!==null?saved:autoPrice(card.total_area);
  }
  function formatCatalogPrice(amount){
    const step = amount >= 1000 ? 1000 : 1;
    const rounded = Math.max(1, Math.round(amount / step) * step);
    return rounded.toLocaleString('ru-RU') + ' ₽';
  }
  function priceText(card, {rounded = false} = {}){
    const value = price(card);
    if (value === null) return 'Цена по запросу';
    return rounded ? formatCatalogPrice(value) : value.toLocaleString('ru-RU') + ' ₽';
  }
  function individualPriceText(value, tariff){
    const area = areaNumber(value);
    const unit = areaNumber(tariff);
    if (area === null || unit === null) return '';
    // Area in hundredths of a square metre, rate in kopecks per square metre.
    const product = Math.round(area * 100) * Math.round(unit * 100);
    if (!Number.isSafeInteger(product)) return '';
    return formatCatalogPrice(product / 10000);
  }
  function pricesHTML(card, tariff){
    const comparison = individualPriceText(card.total_area, tariff);
    const labelStyle = 'color:#56677a;font-size:11px;line-height:1.25;margin-bottom:4px';
    const amountStyle = 'display:block;font-weight:700;line-height:1.1;letter-spacing:-.035em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere';
    return `<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 12px;margin-bottom:12px">
      <div style="flex:1 1 110px;min-width:0">
        <div style="${labelStyle}">Готовый проект</div>
        <div class="price" style="${amountStyle};font-size:24px;color:#177245">${priceText(card, {rounded:true})}</div>
      </div>
      ${comparison ? `<div style="flex:1 1 110px;min-width:0;text-align:right">
        <div style="${labelStyle}">Индивидуальный проект той же площади</div>
        <s style="${amountStyle};font-size:27px;color:#b4232e">${comparison}</s>
      </div>` : ''}
    </div>`;
  }
  function defaultTitle(card){
    const floors=count(card);
    const names=['','Одноэтажный дом','Двухэтажный дом','Трёхэтажный дом'];
    return floors===null?'Жилой дом':names[floors]||'Дом в '+label({floors});
  }
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
  root.CatalogFloors = Object.freeze({definitions,tags,enabled,active,slots,count,matchesCount,label,rate,setRates,getRates,autoPrice,price,priceText,individualPriceText,pricesHTML,rows,normalizeRooms,calculateAreas,defaultTitle,areaNumber,tabs,panels,editor,previewTabs,previewPanels});
})(typeof window!=='undefined'?window:globalThis);
