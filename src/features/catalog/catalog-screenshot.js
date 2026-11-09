(function(root){
 'use strict';
 const fields={project_number:['ce-num','Номер проекта'],title:['ce-title','Название'],total_area:['ce-area','Общая площадь, м²'],footprint:['ce-footprint','Габариты'],beds:['ce-beds','Спальни'],baths:['ce-baths','Санузлы'],price:['ce-price','Цена, ₽']};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function properties(text){
  const out={},t=String(text||'').replace(/\u00a0/g,' '),take=(key,re,format=m=>m[1].trim())=>{const m=t.match(re);if(m)out[key]=format(m);};
  take('project_number',/(?:проект\s*(?:АР\s*)?№|номер\s+проекта\s*[:№—-]?)\s*([\p{L}\d][\p{L}\d._\/-]{0,39})/iu);
  take('title',/(?:название\s*(?:проекта)?|наименование\s+проекта)\s*[:—]\s*([^\n]{3,120})/iu);
  take('total_area',/(?:общая\s+площадь(?:\s+(?:дома|здания))?|площадь\s+дома)\s*[:=—-]?\s*(\d+(?:[.,]\d{1,2})?)/iu,m=>CatalogPdfCore.area(CatalogPdfCore.number(m[1])));
  take('footprint',/(?:габариты|размеры\s+(?:дома|здания))\s*[:=—-]?\s*(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+(?:[.,]\d+)?)/iu,m=>m[1]+' × '+m[2]);
  take('beds',/(?:спальни|спален|количество\s+спален)\s*[:=—-]?\s*(\d{1,2})\b/iu);
  take('baths',/(?:санузлы|санузлов|количество\s+санузлов)\s*[:=—-]?\s*(\d{1,2})\b/iu);
  take('price',/(?:цена|стоимость(?:\s+проекта)?)\s*[:=—-]?\s*(\d[\d ]*(?:[.,]\d{1,2})?)\s*(?:₽|руб)/iu,m=>m[1].replace(/ /g,''));
  return out;
 }
 // Multiset merge: re-scanning the same table adds nothing; two identical
 // rooms in a single table remain two rooms, rather than collapsing by name.
 function mergeRows(existing,incoming){
  const key=r=>r.name.trim().toLowerCase()+'|'+CatalogPdfCore.number(r.area),counts=new Map();
  for(const r of existing)counts.set(key(r),(counts.get(key(r))||0)+1);
  const result=existing.slice();for(const r of incoming){const k=key(r),n=counts.get(k)||0;if(n)counts.set(k,n-1);else result.push(r);}return result;
 }
 let token=0,source=null,selection=null,anchor=null,worker=null,pending=null;
 const el=id=>document.getElementById('ce-shot-'+id),visible=()=>document.getElementById('cardEditorOverlay')?.style.display!=='none';
 function message(text){if(el('status'))el('status').textContent=text;}
 function invalidate(){token++;pending=null;if(el('scan'))el('scan').disabled=!source;if(el('result'))el('result').replaceChildren();if(worker){worker.terminate().catch(()=>{});worker=null;}}
 function reset(){invalidate();if(source)source.width=source.height=0;source=null;selection=null;if(el('panel')){el('panel').hidden=true;if(el('preview'))el('preview').hidden=true;if(el('scan'))el('scan').disabled=true;message('');}}
 function open(){if(!canEditCards())return;if(!el('panel').hidden){reset();return;}el('panel').hidden=false;el('drop').focus();}
 function level(){return CatalogFloors.definitions.find(f=>f.key===el('level').value)||CatalogFloors.definitions[1];}
 function modeChanged(){invalidate();el('level-wrap').hidden=el('mode').value==='properties';message('');}
 function draw(){if(!source)return;const c=el('canvas'),ctx=c.getContext('2d');c.width=source.width;c.height=source.height;ctx.drawImage(source,0,0);if(selection){ctx.strokeStyle='#2284ed';ctx.lineWidth=Math.max(2,c.width/350);ctx.setLineDash([ctx.lineWidth*3,ctx.lineWidth*2]);ctx.strokeRect(selection.x,selection.y,selection.w,selection.h);}}
 function point(e){const c=el('canvas'),b=c.getBoundingClientRect();return {x:Math.max(0,Math.min(c.width,(e.clientX-b.left)*c.width/b.width)),y:Math.max(0,Math.min(c.height,(e.clientY-b.top)*c.height/b.height))};}
 function crop(){const r=selection||{x:0,y:0,w:source.width,h:source.height},c=document.createElement('canvas');c.width=Math.max(1,Math.round(r.w));c.height=Math.max(1,Math.round(r.h));c.getContext('2d').drawImage(source,r.x,r.y,r.w,r.h,0,0,c.width,c.height);return c;}
 async function file(file){
  if(!file)return;if(!canEditCards())return;if(!/^image\//.test(file.type)){message('Выберите скриншот или фото (PNG, JPEG, WebP).');return;}if(file.size>30*1024*1024){message('Изображение больше 30 МБ. Выберите фрагмент или уменьшите файл.');return;}
  invalidate();const own=token,generation=cardEditorGeneration;message('Открываю изображение…');let loaded;
  try{loaded=await loadOrientedImage(file);if(own!==token||generation!==cardEditorGeneration||!visible())return;
   if(loaded.width*loaded.height>60000000)throw Error('Изображение слишком большое. Выберите фрагмент.');
   if(source)source.width=source.height=0;const scale=Math.min(1,4096/Math.max(loaded.width,loaded.height));source=document.createElement('canvas');source.width=Math.round(loaded.width*scale);source.height=Math.round(loaded.height*scale);source.getContext('2d').drawImage(loaded.source,0,0,source.width,source.height);
   selection=null;el('preview').hidden=false;el('scan').disabled=false;draw();message('Выделите нужную область пальцем или мышью. Для таблицы захватите названия и площади.');
  }catch(e){if(own===token)message(e.message||'Не удалось открыть изображение.');}finally{loaded?.source.close?.();}
 }
 function receive(e){const data=e.clipboardData||e.dataTransfer,files=[...(data?.files||[]),...[...(data?.items||[])].map(i=>i.getAsFile?.()).filter(Boolean)];const f=files.find(f=>/^image\//.test(f.type));if(f){e.preventDefault();e.stopPropagation();file(f);}}
 function renderProperties(values,snapshot){
  el('result').innerHTML='<p>Выберите поля для вставки. Заполненные поля по умолчанию защищены.</p>'+Object.entries(values).map(([key,value])=>{const [id,label]=fields[key],current=snapshot[id];return `<label class="ce-shot-field"><input type="checkbox" data-field="${key}" ${current?'':'checked'}><span>${label}${current?'<small>Сейчас: '+esc(current)+'</small>':''}</span><input class="ce-inp" data-value="${key}" value="${esc(value)}"></label>`;}).join('')+'<button type="button" class="btn btn-primary" data-shot-apply>Вставить выбранные данные</button>';
 }
 async function scan(){
  if(!source||!canEditCards())return;if(CatalogPdfImport.busyReading()){message('Дождитесь окончания импорта PDF.');return;}
  invalidate();const own=token,generation=cardEditorGeneration,mode=el('mode').value,floor=level(),snapshot=Object.fromEntries(Object.values(fields).map(([id])=>[id,document.getElementById(id).value]));let prepared=null,localWorker=null;
  const check=()=>{if(own!==token||generation!==cardEditorGeneration||!visible()||!canEditCards())throw new DOMException('Отменено','AbortError');};
  el('scan').disabled=true;
  try{
   if(mode==='plan'){
    prepared=crop();const image=prepared.toDataURL('image/png');pending={mode,floor,image,own,generation,previous:ceImages[floor.image]};
    el('result').innerHTML=`<p>План: ${esc(floor.title)}. Будет вставлена только выделенная область.</p><p>Это ручная вставка изображения. Перерисовка по шаблону выполняется при распознавании векторного PDF.</p><img class="ce-shot-result-image" alt="Выбранный план" src="${image}"><button type="button" class="btn btn-primary" data-shot-apply>Вставить план: ${esc(floor.title)}</button>`;message('Проверьте границы и этаж перед вставкой.');return;
   }
   message('Подготавливаю распознавание…');await loadTesseractScript();check();const cropped=crop(),blob=await new Promise(resolve=>cropped.toBlob(resolve,'image/png'));cropped.width=cropped.height=0;if(!blob)throw Error('Не удалось подготовить изображение.');prepared=await preprocessForOcr(blob);check();
   localWorker=await Tesseract.createWorker('rus+eng',Tesseract.OEM.LSTM_ONLY,{logger:m=>{if(own===token&&m.status==='recognizing text')message('Распознаю… '+Math.round((m.progress||0)*100)+'%');}});check();worker=localWorker;
   let result;if(mode==='table')result=await CatalogOcr.recognize(localWorker,prepared,{check});else {await localWorker.setParameters({tessedit_pageseg_mode:3});const r=await localWorker.recognize(prepared,{}, {blocks:true,text:true});result=CatalogOcr.result(r.data,prepared.width,prepared.height);}check();
   if(mode==='table'){
    const rows=result.rows||[];if(!rows.length){message('Не найдены комнаты с площадями. Выделите таблицу крупнее, включая правый столбец.');el('result').textContent=result.text||'Текст не найден';return;}
    pending={mode,floor,own,generation,before:document.getElementById('ce-expl'+floor.suffix).value};
    el('result').innerHTML=`<p>${esc(floor.title)} · найдено помещений: ${rows.length}. Проверьте числа перед вставкой.${result.table&&!result.table.verified?' Сумма не совпала с итогом таблицы.':''}</p><textarea class="ce-inp" id="ce-shot-rows" rows="7" aria-label="Распознанная экспликация">${esc(rows.map(r=>r.name+': '+r.area).join('\n'))}</textarea><label><input type="checkbox" id="ce-shot-replace"> Заменить существующую экспликацию</label><label><input type="checkbox" id="ce-shot-totals" checked> Пересчитать площадь, спальни и санузлы по всем заполненным этажам</label><button type="button" class="btn btn-primary" data-shot-apply>Вставить: ${esc(floor.title)}</button>`;
   }else {const values=properties(result.text);if(!Object.keys(values).length){message('Характеристики не найдены. Выделите строки с названиями показателей и значениями.');el('result').textContent=result.text||'Текст не найден';return;}pending={mode,own,generation,snapshot};renderProperties(values,snapshot);}
   message('Результат готов к проверке и вставке.');
  }catch(e){if(e.name!=='AbortError'&&own===token)message(e.message||'Не удалось распознать изображение.');}
  finally{if(worker===localWorker)worker=null;if(localWorker)await localWorker.terminate().catch(()=>{});if(prepared)prepared.width=prepared.height=0;if(own===token)el('scan').disabled=!source;}
 }
 function enableFloor(f){if(f.key==='basement'){if(!ceFeatureSelected.includes('basement'))toggleFeature('basement');}else if(ceFloorsSelected<f.number)selectFloors(f.number);}
 function apply(){
  const p=pending;if(!p||p.own!==token||p.generation!==cardEditorGeneration||!visible()||!canEditCards())return;if(CatalogPdfImport.busyReading()){message('Дождитесь окончания импорта PDF.');return;}
  if(p.mode==='properties'){
   const selected=[...el('result').querySelectorAll('[data-field]:checked')];if(!selected.length){message('Выберите хотя бы одно поле.');return;}
   for(const input of selected){const id=fields[input.dataset.field][0];if(document.getElementById(id).value!==p.snapshot[id]){message('Поле изменено после сканирования. Повторите сканирование, чтобы сохранить ваши правки.');return;}}
   for(const input of selected)setVal(fields[input.dataset.field][0],el('result').querySelector('[data-value="'+input.dataset.field+'"]').value.trim());
  }else if(p.mode==='table'){
   const id='ce-expl'+p.floor.suffix,current=document.getElementById(id).value;if(current!==p.before){message('Экспликация изменена после сканирования. Повторите сканирование.');return;}
   const text=el('rows').value,rows=CatalogOcr.parse(text),existing=parseExpl(current),valid=rs=>rs.every(r=>r.name.trim()&&Number.isFinite(CatalogPdfCore.number(r.area))&&CatalogPdfCore.number(r.area)>0);if(!rows.length||rows.length!==text.split('\n').filter(l=>l.trim()).length){message('Проверьте каждую строку: «Название: площадь», число должно быть больше нуля.');return;}
   if(!el('replace').checked&&!valid(existing)){message('В существующей экспликации есть неполные строки. Исправьте их или выберите замену таблицы.');return;}
   const combined=el('replace').checked?rows:mergeRows(existing,rows);setVal(id,combined.map(r=>r.name+': '+r.area).join('\n'));setVal('ce-area'+p.floor.suffix,CatalogPdfCore.area(combined.reduce((n,r)=>n+CatalogPdfCore.number(r.area),0)));enableFloor(p.floor);
   if(el('totals').checked){const active=CatalogFloors.definitions.filter(f=>f.key==='basement'?ceFeatureSelected.includes('basement'):f.number<=ceFloorsSelected),groups=active.map(f=>parseExpl(document.getElementById('ce-expl'+f.suffix).value));if(groups.every(g=>g.length&&valid(g))){const all=groups.flat();setVal('ce-area',CatalogPdfCore.area(all.reduce((n,r)=>n+CatalogPdfCore.number(r.area),0)));setVal('ce-beds',all.filter(r=>/спальн|^сп(?:\s|[-–—.]|\d|$)|детск/iu.test(r.name)).length);setVal('ce-baths',all.filter(r=>/^(?:с\s*[\/.]?\s*у)(?:\s|[-–.]|\d|$)|сануз|ванн|душев|туалет/iu.test(r.name)).length);}}
  }else {
   if(ceImages[p.floor.image]!==p.previous){message('План изменён после сканирования. Выберите его снова.');return;}ceImages[p.floor.image]=p.image;ceThumbs[p.floor.image]=null;ceScreenshotPlans[p.floor.key]={style:'manual-screenshot',manual:true,source:'screenshot'};const preview=document.getElementById('ce-plan'+p.floor.suffix+'-preview');preview.src=p.image;preview.style.display='block';enableFloor(p.floor);
  }
  markCardEditorDirty();cePreview();invalidate();message('Вставлено в карточку. Сохраните проект, когда закончите.');
 }
 function init(){
  const host=document.getElementById('ce-shot-panel');if(!host||host.dataset.ready)return;host.dataset.ready='1';
  host.innerHTML=`<label>Что вставить<select id="ce-shot-mode" class="ce-inp"><option value="table">Экспликация — комнаты и площади</option><option value="properties">Характеристики проекта</option><option value="plan">План — ручная вставка фрагмента</option></select></label><label id="ce-shot-level-wrap">Этаж<select id="ce-shot-level" class="ce-inp">${CatalogFloors.definitions.map(f=>`<option value="${f.key}" ${f.key==='floor1'?'selected':''}>${f.title}</option>`).join('')}</select></label><div id="ce-shot-drop" class="ce-shot-drop" tabindex="0">Вставьте скриншот Ctrl+V или перетащите сюда изображение</div><div class="ce-floor-scan"><label class="ce-scan-btn" for="ce-shot-file">🖼 Скриншот / фото</label><label class="ce-scan-btn" for="ce-shot-camera">📷 Камера</label></div><input id="ce-shot-file" type="file" accept="image/*" hidden><input id="ce-shot-camera" type="file" accept="image/*" capture="environment" hidden><div id="ce-shot-preview" hidden><p>Выделите нужный фрагмент. Если выделение не задано, используется всё изображение.</p><canvas id="ce-shot-canvas" aria-label="Выделение области скриншота"></canvas><button type="button" id="ce-shot-clear">Использовать всё изображение</button></div><button type="button" class="btn btn-primary" id="ce-shot-scan" disabled>Сканировать</button><p id="ce-shot-status" role="status" aria-live="polite"></p><div id="ce-shot-result"></div><button type="button" id="ce-shot-cancel">Закрыть сканирование</button>`;
  el('mode').addEventListener('change',modeChanged);el('level').addEventListener('change',()=>{invalidate();message('Этаж изменён. Нажмите «Сканировать».');});
  for(const id of ['file','camera'])el(id).addEventListener('change',e=>{file(e.target.files[0]);e.target.value='';});
  host.addEventListener('paste',receive);el('drop').addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';});el('drop').addEventListener('drop',receive);el('scan').addEventListener('click',scan);el('cancel').addEventListener('click',reset);el('clear').addEventListener('click',()=>{invalidate();selection=null;draw();el('scan').disabled=!source;});host.addEventListener('click',e=>{if(e.target.closest('[data-shot-apply]'))apply();});
  const c=el('canvas');c.addEventListener('pointerdown',e=>{if(!source)return;invalidate();anchor=point(e);c.setPointerCapture(e.pointerId);});c.addEventListener('pointermove',e=>{if(!anchor)return;const p=point(e);selection={x:Math.min(anchor.x,p.x),y:Math.min(anchor.y,p.y),w:Math.abs(anchor.x-p.x),h:Math.abs(anchor.y-p.y)};draw();});const end=()=>{anchor=null;if(selection&&(selection.w<10||selection.h<10))selection=null;draw();el('scan').disabled=!source;};c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);
 }
 root.CatalogScreenshot=Object.freeze({init,open,reset,file,scan,apply,properties,mergeRows});
 if(typeof module!=='undefined')module.exports=root.CatalogScreenshot;
})(typeof window!=='undefined'?window:globalThis);
