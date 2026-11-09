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
  if(!strict)return {version:VERSION,passed:true,issues:[],scope:'manual-card'};
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
  const beds=rooms.filter(r=>/спальн|^сп(?:\s|[-–—.]|\d|$)|детск/iu.test(r.name)).length,baths=rooms.filter(r=>/^(?:с\s*[\/.]?\s*у)(?:\s|[-–.]|\d|$)|сануз|ванн|душев|туалет/iu.test(r.name)).length;
  if(Number(card.beds||0)!==beds)issues.push('Количество спален не совпадает с экспликациями');if(Number(card.baths||0)!==baths)issues.push('Количество санузлов не совпадает с экспликациями');
  return {version:VERSION,passed:!issues.length,issues:[...new Set(issues)],scope:'pdf-card'};
 }

 function show(review){const box=document.getElementById('ce-quality-status');if(!box)return;box.hidden=false;box.textContent=review.passed?(review.scope==='manual-card'?'Заполненные данные проверены. Автоматическая проверка геометрии доступна для планов из PDF.':'Проверка пройдена: планы, экспликации и данные согласованы. Можно сохранить проект.'):'Сохранение заблокировано. Исправьте:\n• '+review.issues.join('\n• ');box.style.whiteSpace='pre-line';}
 function checkEditor(){
  const value=id=>document.getElementById(id)?.value||'',card={project_number:value('ce-num'),title:value('ce-title'),floors:ceFloorsSelected,total_area:value('ce-area'),price:value('ce-price'),beds:value('ce-beds'),baths:value('ce-baths'),tags:ceFeatureSelected.includes('basement')?['Цокольный этаж']:[],images:ceImages};
  for(const f of CatalogFloors.definitions){card[f.area]=value('ce-area'+f.suffix);card[f.rooms]=parseExpl(value('ce-expl'+f.suffix));}
  let meta=cePdfImportMeta||cardsData.find(c=>c.id===ceCurrentId)?.pdf_import_meta;if(Object.keys(ceScreenshotPlans).length)meta={...meta,sources:{...meta?.sources,plans:{...meta?.sources?.plans,...ceScreenshotPlans}}};
  const review=reviewCard(card,meta);show(review);return review;
 }
 root.CatalogQuality=Object.freeze({version:VERSION,fingerprint,scheduleFingerprint,reviewPlan,reviewCard,show,checkEditor});
 if(typeof module!=='undefined')module.exports=root.CatalogQuality;
})(typeof window!=='undefined'?window:globalThis);
