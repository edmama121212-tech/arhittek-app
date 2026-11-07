// ===== Client-facing price list export =====
(()=>{
'use strict';
if(window.__arhittekPriceListInstalled) return;
window.__arhittekPriceListInstalled=true;

const $=id=>document.getElementById(id);
const esc=v=>{try{return escapeHtml(String(v??''));}catch(e){return String(v??'');}};
let priceProjectId=null;
let priceMode='all';
let selectedPriceGroups=new Set();
let selectedPriceItems=new Set();

function allPriceGroups(){
  try{return (kpCatalogGrouped()||[]).filter(g=>g?.items?.length);}
  catch(e){return [];}
}
function itemKey(groupName,item,index){
  return String(groupName)+'::'+String(item.id||item.name||index);
}
function priceGroupForProject(projectId){
  const p=(state.projects||[]).find(x=>x.id===projectId);
  if(!p) return null;
  const cat=(typeof findCategory==='function'?findCategory(p.category_id):null);
  const name=String(cat?.name||'').toLowerCase();
  const groups=allPriceGroups();
  const tests=[];
  if(name.includes('интерьер')) tests.push('интерьер');
  if(name.includes('архитект')) tests.push('архитект');
  if(name.includes('ландшафт')) tests.push('ландшафт');
  if(name.includes('мебел')) tests.push('мебел');
  if(name.includes('строит')||name.includes('ремонт')||name.includes('монтаж')) tests.push('строит','ремонт');
  tests.push(...name.split(/\s+/).filter(x=>x.length>4));
  return groups.find(g=>tests.some(t=>String(g.group||'').toLowerCase().includes(t))) || null;
}
function filteredPriceGroups(){
  const groups=allPriceGroups();
  if(priceMode==='all') return groups;
  if(priceMode==='group'){
    return groups.filter(g=>selectedPriceGroups.has(g.group));
  }
  return groups.map(g=>({
    group:g.group,
    items:g.items.filter((it,i)=>selectedPriceItems.has(itemKey(g.group,it,i)))
  })).filter(g=>g.items.length);
}
function ensurePriceSheet(){
  let o=$('priceListSheetOverlay');
  if(o) return o;
  o=document.createElement('div');
  o.className='sheet-overlay';
  o.id='priceListSheetOverlay';
  o.innerHTML=`
    <div class="sheet" style="max-width:640px">
      <div class="sheet-handle"></div>
      <div class="sheet-title">
        <span>Скачать прайс для клиента</span>
        <button class="sheet-close" id="priceListClose" type="button">✕</button>
      </div>
      <div class="field">
        <label>Что скачать</label>
        <div class="yn-group" id="priceListMode" style="flex-wrap:wrap">
          <div class="yn-btn selected" data-value="all" style="flex-basis:31%">Весь прайс</div>
          <div class="yn-btn" data-value="group" style="flex-basis:31%">Направление</div>
          <div class="yn-btn" data-value="custom" style="flex-basis:31%">Выбрать услуги</div>
        </div>
      </div>
      <div id="priceProjectHint" class="note" style="display:none;margin-bottom:10px"></div>
      <div id="priceGroupBox" class="card" style="display:none;margin-bottom:10px"></div>
      <div id="priceCustomBox" class="card" style="display:none;margin-bottom:10px;max-height:340px;overflow:auto"></div>
      <div class="field">
        <label>Заголовок для клиента</label>
        <input id="priceListTitle" type="text" value="Прайс-лист услуг ARHITTEK">
      </div>
      <label style="display:flex;align-items:flex-start;gap:9px;margin:4px 0 14px;font-size:12px;color:var(--text-dim)">
        <input id="priceIncludeDesc" type="checkbox" checked style="width:auto;margin-top:2px">
        <span>Показывать краткое описание того, что входит в услугу</span>
      </label>
      <div class="btn-row">
        <button class="btn btn-primary" id="priceDownloadPdf" type="button">Скачать PDF</button>
        <button class="btn btn-secondary" id="priceDownloadXlsx" type="button">Скачать Excel</button>
      </div>
    </div>`;
  document.body.appendChild(o);
  $('priceListClose').onclick=()=>o.classList.remove('active');
  $('priceListMode').addEventListener('click',e=>{
    const b=e.target.closest('[data-value]');if(!b)return;
    priceMode=b.dataset.value;
    $('priceListMode').querySelectorAll('.yn-btn').forEach(x=>x.classList.toggle('selected',x===b));
    renderPricePicker();
  });
  $('priceDownloadPdf').onclick=exportPricePdf;
  $('priceDownloadXlsx').onclick=exportPriceXlsx;
  return o;
}
function renderPricePicker(){
  const groups=allPriceGroups();
  const gb=$('priceGroupBox'), cb=$('priceCustomBox');
  if(!gb||!cb) return;

  gb.style.display=priceMode==='group'?'':'none';
  cb.style.display=priceMode==='custom'?'':'none';

  if(priceMode==='group'){
    gb.innerHTML=groups.map(g=>`
      <label class="list-item" style="cursor:pointer">
        <div><div class="li-name">${esc(g.group)}</div><div class="li-meta">${g.items.length} услуг</div></div>
        <input type="radio" name="priceGroupChoice" value="${esc(g.group)}" ${selectedPriceGroups.has(g.group)?'checked':''} style="width:auto">
      </label>`).join('');
    gb.querySelectorAll('input[name="priceGroupChoice"]').forEach(r=>r.addEventListener('change',()=>{
      selectedPriceGroups=new Set([r.value]);
    }));
  }

  if(priceMode==='custom'){
    cb.innerHTML=groups.map(g=>`
      <div class="project-eyebrow" style="margin:10px 0 5px">${esc(g.group)}</div>
      ${g.items.map((it,i)=>{
        const key=itemKey(g.group,it,i);
        return `<label class="list-item" style="cursor:pointer">
          <div style="min-width:0"><div class="li-name">${esc(it.name)}</div><div class="li-meta">${Number(it.rate||0).toLocaleString('ru-RU')} ₽ / ${esc(it.unit||'м²')}</div></div>
          <input type="checkbox" data-price-key="${esc(key)}" ${selectedPriceItems.has(key)?'checked':''} style="width:auto">
        </label>`;
      }).join('')}`).join('');
    cb.querySelectorAll('[data-price-key]').forEach(ch=>ch.addEventListener('change',()=>{
      if(ch.checked) selectedPriceItems.add(ch.dataset.priceKey);
      else selectedPriceItems.delete(ch.dataset.priceKey);
    }));
  }
}
function openPriceListSheet(projectId=null){
  priceProjectId=projectId||null;
  const groups=allPriceGroups();
  selectedPriceGroups=new Set();
  selectedPriceItems=new Set();
  priceMode='all';

  const matched=projectId?priceGroupForProject(projectId):null;
  if(matched){
    priceMode='group';
    selectedPriceGroups.add(matched.group);
  }else if(groups.length){
    selectedPriceGroups.add(groups[0].group);
  }

  const o=ensurePriceSheet();
  $('priceListMode').querySelectorAll('.yn-btn').forEach(x=>x.classList.toggle('selected',x.dataset.value===priceMode));
  const hint=$('priceProjectHint');
  if(projectId){
    const p=(state.projects||[]).find(x=>x.id===projectId);
    if(matched){
      hint.style.display='';
      hint.textContent='Для проекта «'+(p?.name||'')+'» автоматически выбрано направление: '+matched.group+'. При необходимости можно выбрать другой режим.';
    }else{
      hint.style.display='';
      hint.textContent='Для этого проекта не удалось однозначно определить направление. Выберите нужный раздел прайса вручную.';
    }
  }else hint.style.display='none';

  renderPricePicker();
  o.classList.add('active');
}
function priceSelectionOrWarn(){
  const groups=filteredPriceGroups();
  if(!groups.length){
    showToast(priceMode==='custom'?'Выберите хотя бы одну услугу':'Выберите направление прайса');
    return null;
  }
  return groups;
}
function priceSafeName(groups,ext){
  let tag='ves-prays';
  if(priceMode==='group'&&groups.length===1) tag=groups[0].group;
  else if(priceMode==='custom') tag='vybrannye-uslugi';
  tag=String(tag).replace(/[^a-zA-Zа-яА-Я0-9_-]+/g,'_').replace(/^_+|_+$/g,'');
  return 'ARHITTEK-Price-'+tag+'-'+financeToday()+'.'+ext;
}
function exportPricePdf(){
  const groups=priceSelectionOrWarn(); if(!groups)return;
  const {jsPDF}=window.jspdf||{};
  if(!jsPDF){showToast('PDF-модуль не загружен');return;}
  const doc=new jsPDF({unit:'mm',format:'a4'});
  registerPdfFonts(doc);
  const pageW=doc.internal.pageSize.getWidth(), margin=15, blue=[69,134,236];
  const title=($('priceListTitle')?.value||'Прайс-лист услуг ARHITTEK').trim();
  const includeDesc=!!$('priceIncludeDesc')?.checked;

  const logoSize=14;
  try{doc.addImage(ARHITTEK_LOGO_B64,'PNG',margin,10,logoSize,logoSize*(87/100));}catch(e){}
  const tx=margin+logoSize+4;
  doc.setFont('Roboto','bold');doc.setFontSize(18);doc.setTextColor(0);doc.text('ARHIT',tx,19);
  const w=doc.getTextWidth('ARHIT');doc.setTextColor(...blue);doc.text('TEK',tx+w,19);
  doc.setTextColor(0);doc.setFont('Roboto','normal');doc.setFontSize(11);doc.text(title,tx,26);
  doc.setFontSize(8.5);doc.setTextColor(120);doc.text('Актуально на '+fmtDate(financeToday()),pageW-margin,19,{align:'right'});
  doc.setTextColor(0);
  let y=37;

  groups.forEach((g,gi)=>{
    if(y>250){doc.addPage();y=18;}
    doc.setFillColor(...blue);doc.roundedRect(margin,y-5,pageW-margin*2,9,1.5,1.5,'F');
    doc.setFont('Roboto','bold');doc.setFontSize(10);doc.setTextColor(255);doc.text(String(g.group).toUpperCase(),margin+3,y+0.5);
    doc.setTextColor(0);y+=8;

    const rows=g.items.map(it=>[
      it.name||'Услуга',
      Number(it.rate||0).toLocaleString('ru-RU')+' ₽',
      it.unit||'м²'
    ]);
    doc.autoTable({
      startY:y,
      head:[['Услуга','Стоимость','Ед.']],
      body:rows,
      theme:'grid',
      headStyles:{fillColor:[240,244,250],textColor:[35,44,60],font:'Roboto',fontStyle:'bold'},
      styles:{font:'Roboto',fontSize:9,cellPadding:3,textColor:[35,44,60]},
      columnStyles:{1:{cellWidth:32,halign:'right'},2:{cellWidth:18,halign:'center'}},
      margin:{left:margin,right:margin}
    });
    y=doc.lastAutoTable.finalY+4;

    if(includeDesc){
      doc.setFont('Roboto','normal');doc.setFontSize(8);doc.setTextColor(90);
      for(const it of g.items){
        if(!it.desc)continue;
        if(y>270){doc.addPage();y=18;}
        doc.setFont('Roboto','bold');doc.setTextColor(45);doc.text(it.name,margin,y);y+=4;
        doc.setFont('Roboto','normal');doc.setTextColor(100);
        const lines=doc.splitTextToSize(it.desc,pageW-margin*2);
        lines.forEach(line=>{if(y>276){doc.addPage();y=18;}doc.text(line,margin,y);y+=3.8;});
        y+=2;
      }
      doc.setTextColor(0);
    }
    if(gi<groups.length-1)y+=4;
  });

  if(y>265){doc.addPage();y=20;}
  doc.setDrawColor(210);doc.line(margin,y,pageW-margin,y);y+=6;
  doc.setFont('Roboto','normal');doc.setFontSize(8);doc.setTextColor(105);
  doc.text('Стоимость указана по действующему прайсу и может уточняться после изучения объекта и технического задания.',margin,y);y+=4.5;
  doc.text('ARHITTEK — архитектура · дизайн интерьера · строительство под ключ',margin,y);y+=4.5;
  const ci=state.companyInfo||{};
  const contacts=[ci.phone,ci.email,ci.website].filter(Boolean).join(' · ');
  if(contacts)doc.text(contacts,margin,y);

  doc.save(priceSafeName(groups,'pdf'));
  showToast('Прайс PDF скачивается...');
}
function exportPriceXlsx(){
  const groups=priceSelectionOrWarn(); if(!groups)return;
  if(typeof XLSX==='undefined'){showToast('Excel-модуль не загружен');return;}
  const rows=[['ARHITTEK — прайс-лист услуг'],['Актуально на',fmtDate(financeToday())],[]];
  groups.forEach(g=>{
    rows.push([g.group]);
    rows.push(['Услуга','Стоимость, ₽','Единица','Что входит']);
    g.items.forEach(it=>rows.push([it.name,Number(it.rate)||0,it.unit||'м²',$('priceIncludeDesc')?.checked?(it.desc||''):'']));
    rows.push([]);
  });
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:42},{wch:16},{wch:12},{wch:80}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Прайс');
  XLSX.writeFile(wb,priceSafeName(groups,'xlsx'));
  showToast('Прайс Excel скачивается...');
}

window.openPriceListSheet=openPriceListSheet;

// Main entry point: Studio Tools.

const studioGrid=document.querySelector('#view-more .premium-tool-grid') || document.querySelector('#view-more > div[style*="display:grid"]');
if(studioGrid && !$('openPriceListBtn')){
  const b=document.createElement('button');
  b.id='openPriceListBtn';b.type='button';b.className='btn btn-primary';b.textContent='Прайс для клиента';
  studioGrid.appendChild(b);
  b.dataset.priceListToolFallback='1';
}
$('openPriceListBtn')?.addEventListener('click',()=>openPriceListSheet()); // price-list-tool-fallback


// KP workspace: quick access while talking to a potential client.
const kpNew=$('kpNewBtn');
if(kpNew && !$('kpPriceListBtn')){
  const btn=document.createElement('button');
  btn.className='btn btn-secondary';
  btn.id='kpPriceListBtn';
  btn.type='button';
  btn.style.marginBottom='10px';
  btn.textContent='Скачать прайс';
  kpNew.after(btn);
  btn.addEventListener('click',()=>openPriceListSheet(typeof editingKpProjectId!=='undefined'?editingKpProjectId:null));
}

// Project card / object: one-click relevant price list.
const projectContractBtn=$('pf-create-contract');
if(projectContractBtn && !$('pf-download-price')){
  const btn=document.createElement('button');
  btn.className='btn btn-secondary';
  btn.id='pf-download-price';
  btn.type='button';
  btn.style.marginTop='8px';
  btn.textContent='Скачать прайс по направлению';
  projectContractBtn.after(btn);
  btn.addEventListener('click',()=>{if(typeof editingProjectId!=='undefined'&&editingProjectId)openPriceListSheet(editingProjectId);});
}

const objectDocs=$('objDocumentsContent');
if(objectDocs){
  objectDocs.addEventListener('click',e=>{
    const b=e.target.closest?.('#objDownloadPriceBtn');
    if(b&&typeof currentObjectId!=='undefined'&&currentObjectId)openPriceListSheet(currentObjectId);
  });
}
const oldRenderObjectDocs=window.renderObjectDocuments;
if(typeof oldRenderObjectDocs==='function'){
  window.renderObjectDocuments=async function(projectId){
    const r=await oldRenderObjectDocs.apply(this,arguments);
    const box=$('objDocumentsContent');
    if(box&&!$('objDownloadPriceBtn')){
      const actions=box.querySelector('.btn-row');
      if(actions){
        const b=document.createElement('button');
        b.className='btn btn-secondary';b.type='button';b.id='objDownloadPriceBtn';b.textContent='Прайс по направлению';
        actions.append(b);
      }
    }
    return r;
  };
}
})();


