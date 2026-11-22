(function(root){
 'use strict';
 const VERSION='catalog-quality-1';
 function fingerprint(value){let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
 function scheduleFingerprint(rows){return fingerprint(JSON.stringify((rows||[]).map(r=>[String(r.name||'').toLowerCase().replace(/\s+/g,' ').trim(),Number(String(r.area).replace(',','.')).toFixed(2)])));}
 function reviewPlan({roomSchedule,image,wallSamples,wallLost,labelsComplete,details,wallCount,dimensions}){
  const checks={sourceWalls:wallCount>0,wallIntegrity:wallSamples>20&&wallLost/wallSamples<=.004,roomLabels:!!labelsComplete,stairScope:(details?.stairs||0)<3000,approvedPrimitives:!!details&&Object.keys(details).every(k=>['stairs','doors','windows'].includes(k))};
  const reasons={sourceWalls:'Не подтверждены стены исходного плана',wallIntegrity:'Подписи или графика перекрывают контур стен',roomLabels:'Не все помещения подписаны достоверно',stairScope:'Слишком много графики распознано как лестница',approvedPrimitives:'В плане обнаружены неподтверждённые элементы'};
  const issues=Object.keys(checks).filter(k=>!checks[k]).map(k=>reasons[k]);
  return {version:VERSION,passed:!issues.length,checks,issues,wallLoss:wallSamples?wallLost/wallSamples:1,dimensionsConfirmed:dimensions?.widthMm>0&&dimensions?.heightMm>0,imageFingerprint:fingerprint(image),scheduleFingerprint:roomSchedule?scheduleFingerprint(roomSchedule):null};
 }
 const floors=[['basement','basement_area','expl_basement',5,'Цоколь'],['floor1','floor1_area','expl1',2,'1-й этаж'],['floor2','floor2_area','expl2',3,'2-й этаж'],['floor3','floor3_area','expl3',4,'3-й этаж']];
 const num=s=>Number(String(s??'').replace(/\s/g,'').replace(',','.'));
 function reviewCard(card,meta,{strict=!!meta}={}){
  const issues=[],plans=meta?.sources?.plans||{};
  if(!strict){
   const title=String(card.title||'').replace(/^Проект\s*№.*?—\s*/u,'').trim();
   const fields=[card.project_number,title,card.total_area,card.footprint,card.beds,card.baths,card.price,...(card.tags||[])];
   const hasContent=fields.some(value=>String(value??'').trim())||card.images?.some(Boolean)||
    floors.some(([,area,rooms])=>String(card[area]??'').trim()||card[rooms]?.length);
   if(!hasContent)issues.push('Карточка пуста. Заполните данные проекта перед сохранением.');
   return {version:VERSION,passed:!issues.length,issues,scope:'manual-card'};
  }
  if(!String(card.project_number||'').trim())issues.push('Укажите номер проекта');
  else if(!/^[\p{L}\d][\p{L}\d._\/-]{0,39}$/u.test(String(card.project_number).trim()))issues.push('В номере проекта есть лишний текст или недопустимые символы');
  if(!String(card.title||'').replace(/^Проект\s*№.*?—\s*/u,'').trim())issues.push('Укажите название проекта');
  if(!Number.isInteger(+card.floors)||+card.floors<1||+card.floors>3)issues.push('Укажите от 1 до 3 надземных этажей');
  if(!(num(card.total_area)>0))issues.push('Не подтверждена общая площадь');
  if(card.price&&!Number.isFinite(num(card.price))||card.price&&num(card.price)<0)issues.push('Цена должна быть корректным неотрицательным числом');
  if(!card.images?.[0])issues.push('Не добавлена визуализация фасада');
  const active=floors.filter(([key])=>key==='basement'?(card.tags||[]).includes('Цокольный этаж'):+key.slice(5)<=+card.floors),rooms=[];let total=0;
  for(const [key,areaId,rowsId,slot,label]of active){
   const rows=card[rowsId]||[],area=num(card[areaId]);rooms.push(...rows);
   if(!rows.length||rows.some(r=>!r.name?.trim()||!(num(r.area)>0)))issues.push(label+': нужна полная экспликация с площадями');
   const sum=rows.reduce((n,r)=>n+num(r.area),0);if(!(area>0)||!Number.isFinite(sum)||Math.abs(sum-area)>.03)issues.push(label+': площадь не совпадает с суммой помещений');total+=area;
   if(!card.images?.[slot])issues.push(label+': не добавлен проверенный план');
   else {const report=plans[key],q=report?.quality;
    if(!q?.passed||q.version!==VERSION)issues.push(label+': план не прошёл автоматическую проверку качества; загрузите исходный PDF');
    else {if(report.rooms!==rows.length||report.roomNames?.length!==rows.length)issues.push(label+': подписи плана не соответствуют экспликации');if(q.scheduleFingerprint&&q.scheduleFingerprint!==scheduleFingerprint(rows))issues.push(label+': экспликация изменена после проверки плана');if(!['sourceWalls','wallIntegrity','roomLabels','stairScope','approvedPrimitives'].every(k=>q.checks?.[k]===true)||!q.dimensionsConfirmed)issues.push(label+': не подтверждены контуры, подписи или общие размеры');if(String(card.images[slot]).startsWith('data:')&&fingerprint(card.images[slot])!==q.imageFingerprint)issues.push(label+': изображение изменено после проверки');}
   }
  }
  if(!Number.isFinite(total)||Math.abs(total-num(card.total_area))>.05)issues.push('Общая площадь не совпадает с суммой площадей этажей');
  const beds=rooms.filter(r=>/спальн|^м?\s*сп(?:\s|[-–—.]|\d|$)|детск/iu.test(r.name)).length,baths=rooms.filter(r=>/^(?:м?с\s*[\/.]?\s*у)(?:\s|[-–.]|\d|$)|сануз|ванн|душев|туалет/iu.test(r.name)).length;
  if(Number(card.beds||0)!==beds)issues.push('Количество спален не совпадает с экспликациями');if(Number(card.baths||0)!==baths)issues.push('Количество санузлов не совпадает с экспликациями');
  return {version:VERSION,passed:!issues.length,issues:[...new Set(issues)],scope:'pdf-card'};
 }

 // Editing only descriptive fields of an already saved card does not change
 // its approved (or legacy) plan geometry. Still validate its identity/price.
 function reviewMetadata(card){
  const issues=[],number=String(card.project_number||'').trim();
  if(!number)issues.push('Укажите номер проекта');
  else if(!/^[\\p{L}\\d][\\p{L}\\d._\\/-]{0,39}$/u.test(number))issues.push('В номере проекта есть недопустимые символы');
  if(!String(card.title||'').replace(/^Проект\\s*№.*?—\\s*/u,'').trim())issues.push('Укажите название проекта');
  if(card.price!==''&&card.price!==null&&card.price!==undefined&&(!Number.isFinite(num(card.price))||num(card.price)<0))issues.push('Цена должна быть корректным неотрицательным числом');
  return {version:VERSION,passed:!issues.length,issues,scope:'metadata-card'};
 }

 function show(review){const box=document.getElementById('ce-quality-status');if(!box)return;box.hidden=false;box.textContent=review.passed?(review.scope==='metadata-card'?'Данные карточки проверены. Планы не менялись — повторная проверка PDF не нужна. Можно сохранить проект.':review.scope==='manual-card'?'Заполненные данные проверены. Автоматическая проверка геометрии доступна для планов из PDF.':'Проверка пройдена: планы, экспликации и данные согласованы. Можно сохранить проект.'):'Сохранение заблокировано. Исправьте:\n• '+review.issues.join('\n• ');box.style.whiteSpace='pre-line';}
 function checkEditor(){
  const value=id=>document.getElementById(id)?.value||'',card={project_number:value('ce-num'),title:value('ce-title'),floors:ceFloorsSelected,total_area:value('ce-area'),footprint:value('ce-footprint'),price:value('ce-price'),beds:value('ce-beds'),baths:value('ce-baths'),tags:[...value('ce-tags').split(',').map(tag=>tag.trim()).filter(Boolean),...ceFeatureSelected,...(typeof ceStyleSelected==='string'&&ceStyleSelected?[ceStyleSelected]:[]),...(ceFeatureSelected.includes('basement')?['Цокольный этаж']:[])],images:ceImages};
  for(const f of CatalogFloors.definitions){card[f.area]=value('ce-area'+f.suffix);card[f.rooms]=parseExpl(value('ce-expl'+f.suffix));}
  let meta=cePdfImportMeta||cardsData.find(c=>c.id===ceCurrentId)?.pdf_import_meta;const screenshots=typeof ceScreenshotPlans==='undefined'?{}:ceScreenshotPlans;if(Object.keys(screenshots).length)meta={...meta,sources:{...meta?.sources,plans:{...meta?.sources?.plans,...screenshots}}};
  const unchanged=!!ceCurrentId&&cardsData.some(c=>c.id===ceCurrentId)&&!cePdfImportMeta&&!Object.keys(screenshots).length&&typeof cardPlanUnchanged==='function'&&cardPlanUnchanged();
  const review=unchanged?reviewMetadata(card):reviewCard(card,meta);show(review);return review;
 }
 // An already open pre-quality shell still owns its older inline saveCard.
 // Attach the current publication gate when an import is applied, after that
 // shell has finished declaring its functions. No page reload or draft loss.
 function protectSave(){
  const original=root.saveCard;if(typeof original!=='function'||original.catalogQualityGuard)return;
  const legacyImporter=root.CatalogPdfImport&&root.CatalogPdfImport.draftOnly!==true;let userSave=false;
  if(legacyImporter&&typeof document!=='undefined')document.addEventListener('click',event=>{if(event.isTrusted&&event.target?.closest?.('#ce-save-btn'))userSave=true;},true);
  async function guardedSave(...args){
   if(legacyImporter&&!userSave)return {ok:false,awaitingManualSave:true};userSave=false;
   if(typeof canEditCards==='function'&&!canEditCards())return original.apply(this,args);
   const review=checkEditor();if(!review.passed){if(typeof showToast==='function')showToast('Сохранение заблокировано: нужна проверка карточки');return {ok:false,qualityBlocked:true,error:review.issues.join('. ')};}
   return original.apply(this,args);
  }
  guardedSave.catalogQualityGuard=true;root.saveCard=guardedSave;
 }
 root.CatalogQuality=Object.freeze({version:VERSION,fingerprint,scheduleFingerprint,reviewPlan,reviewCard,reviewMetadata,show,checkEditor,protectSave});
 if(typeof module!=='undefined')module.exports=root.CatalogQuality;
})(typeof window!=='undefined'?window:globalThis);
