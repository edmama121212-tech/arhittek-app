// Selected saved card -> adaptive A3 concept album, approved dark option 2.
// No database writes, fabricated rooms, or altered source geometry.
function canExportCatalogPdf(){return typeof isOwner==='function'&&isOwner()===true;}
function requireCatalogPdfOwner(){if(!canExportCatalogPdf())throw Error('Скачивание PDF доступно только владельцу');}
async function createCatalogCardPdf(card){
 requireCatalogPdfOwner();
 const {jsPDF}=window.jspdf||{};if(!jsPDF)throw Error('PDF-модуль не загрузился. Обновите страницу');
 const doc=new jsPDF({unit:'mm',format:'a3',orientation:'landscape',compress:true});registerPdfFonts(doc);
 const ink=[24,35,53],dark=[23,33,50],panel=[32,47,70],blue=[54,116,212],white=[255,255,255],gray=[164,177,196],missing=[],levels=CatalogFloors.active(card),overflow=[];
 const text=(s,x,y,size=10,bold=false,color=ink,opts={})=>{doc.setFont('Roboto',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(Array.isArray(s)?s:String(s??'не указано'),x,y,opts);};
 const rect=(x,y,w,h,color)=>{doc.setFillColor(...color);doc.rect(x,y,w,h,'F');};
 const rule=(x,y,w,color=[53,67,90])=>{doc.setDrawColor(...color);doc.setLineWidth(.15);doc.line(x,y,x+w,y);};
 const number=String(card.project_number||'без номера'),numberText='ПРОЕКТ №'+number;
 function wrap(value,width,size=10,bold=false){doc.setFont('Roboto',bold?'bold':'normal');doc.setFontSize(size);return doc.splitTextToSize(String(value??'не указано'),width);}
 function header(label){rect(0,0,420,297,dark);text('ARHITTEK',16,22,23,true,white);text(label,404,21,9,true,gray,{align:'right'});rule(16,33,388);}
 async function picture(url,x,y,w,h,label,{trim=false,cover=false}={}){
  if(!url){missing.push(label);text(label+' не добавлен',x+5,y+12,11,false,gray);return;}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let bitmap;
  try{
   const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error('HTTP '+response.status);bitmap=await createImageBitmap(await response.blob());
   let sx=0,sy=0,sw=bitmap.width,sh=bitmap.height;
   if(trim){
    // Only crop external whitespace for page placement; keep every source mark.
    const scan=document.createElement('canvas'),scale=Math.min(1,800/Math.max(sw,sh));scan.width=Math.max(1,Math.round(sw*scale));scan.height=Math.max(1,Math.round(sh*scale));const sc=scan.getContext('2d');sc.drawImage(bitmap,0,0,scan.width,scan.height);const pixels=sc.getImageData(0,0,scan.width,scan.height).data;let x0=scan.width,y0=scan.height,x1=-1,y1=-1;
    for(let yy=0;yy<scan.height;yy++)for(let xx=0;xx<scan.width;xx++){const i=(yy*scan.width+xx)*4;if(pixels[i+3]>100&&Math.min(pixels[i],pixels[i+1],pixels[i+2])<210){x0=Math.min(x0,xx);y0=Math.min(y0,yy);x1=Math.max(x1,xx);y1=Math.max(y1,yy);}}
    if(x1>=x0&&y1>=y0){const pad=18;sx=Math.max(0,(x0-pad)/scale);sy=Math.max(0,(y0-pad)/scale);sw=Math.min(bitmap.width-sx,(x1-x0+1+2*pad)/scale);sh=Math.min(bitmap.height-sy,(y1-y0+1+2*pad)/scale);}
   }
   // Never crop facade composition: preserve the entire image and its aspect.
   const scale=Math.min(w/sw,h/sh),pw=sw*scale,ph=sh*scale,canvas=document.createElement('canvas'),factor=Math.min(1,3200/Math.max(sw,sh));canvas.width=Math.max(1,Math.round(sw*factor));canvas.height=Math.max(1,Math.round(sh*factor));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
   doc.addImage(canvas.toDataURL(cover?'image/jpeg':'image/png',.94),cover?'JPEG':'PNG',x+(w-pw)/2,y+(h-ph)/2,pw,ph,undefined,'FAST');
  }catch(e){throw Error('Не удалось загрузить изображение «'+label+'». PDF не сохранён; повторите загрузку');}finally{clearTimeout(timer);bitmap?.close();}
 }
 header('КОНЦЕПТУАЛЬНЫЙ ПРОЕКТ');rect(16,46,126,224,panel);rect(16,46,126,3,blue);text(numberText,26,63,10,true,blue);
 const title=String(card.title||CatalogFloors.defaultTitle(card)).replace(/^Проект\s*№[^—–]*[—–]\s*/iu,'');let titleSize=21,titleLines=wrap(title,105,titleSize,true);while(titleLines.length>2&&titleSize>11){titleSize--;titleLines=wrap(title,105,titleSize,true);}if(titleLines.length>2)throw Error('Слишком длинное название проекта для обложки PDF. Сократите название');text(titleLines,26,77,titleSize,true,white);
 const tags=(Array.isArray(card.tags)?card.tags:String(card.tags||'').split(',')).filter(Boolean),tagLines=wrap(tags.join(' · '),105,9);text(tagLines.slice(0,2),26,94,9,false,gray);
 const area=String(card.total_area||'не указана');text(area,26,114,36,true,white);if(CatalogFloors.areaNumber(card.total_area)!==null)text('м²',26+Math.min(92,doc.getTextWidth(area))+4,113,16,false,blue);text('ОБЩАЯ ПЛОЩАДЬ',26,123,7.5,true,gray);
 const facts=[['Габариты',card.footprint||'не указаны'],['Этажи',CatalogFloors.label(card)],['Спальни / санузлы',(card.beds??'не указано')+' / '+(card.baths??'не указано')],...levels.map(f=>[f.title,(card[f.area]||'не указана')+' м²'])];
 facts.forEach(([label,value],i)=>{const yy=139+i*11;text(label,26,yy,8.5,false,gray);let size=9.5;while(doc.getTextWidth(String(value))>60&&size>7){size--;doc.setFontSize(size);}text(value,131,yy,size,true,white,{align:'right'});rule(26,yy+4,105);});
 text('СТОИМОСТЬ ПРОЕКТА',26,237,7.5,true,gray);const price=CatalogFloors.priceText(card).replace('₽','руб.');text(price,26,253,price.length>18?19:27,true,white);
 await picture(card.images?.[0],154,46,250,158,'Визуализация',{cover:true});
 if(card.images?.[1]){await picture(card.images[1],154,214,104,56,'Вторая визуализация',{cover:true});text('Форма.',270,229,27,true,white);text('Свет.',270,242,27,true,white);text('Пространство.',270,255,21,true,white);rect(270,265,134,2,blue);}
 else{text('Архитектура для жизни.',154,234,26,true,white);text(numberText,154,252,12,true,gray);rect(154,265,250,2,blue);}
 const roomLabel=name=>String(name||'').replace(/^СП\s*[-–]?\s*(\d*)$/iu,(_,n)=>'Спальня'+(n?' '+n:'')).replace(/^С[\/.]?У\s*[-–]?\s*(\d*)$/iu,(_,n)=>'Санузел'+(n?' '+n:''));
 function scheduleRows(f){return CatalogFloors.normalizeRooms(card[f.rooms],{expectedArea:card[f.area]});}
 async function floorPanel(f,x,w){
  rect(x,53,w,218,white);rect(x,53,w,14,[41,60,90]);text(f.title,x+6,63,13,true,white);text((card[f.area]||'не указана')+' м²',x+w-6,63,11,true,white,{align:'right'});
  const tableW=w>200?94:57,tableX=x+w-tableW-6,planW=w-tableW-15;await picture(card.images?.[f.image],x+3,75,planW,183,f.title+': план',{trim:true});text('ПОМЕЩЕНИЯ / М²',tableX,81,8,true,[119,132,153]);
  const rows=scheduleRows(f);let y=94,index=0;
  for(;index<rows.length;index++){const r=rows[index],lines=wrap(roomLabel(r.name),tableW,9),height=Math.max(13,lines.length*3.7+7);if(y+height>249)break;text(lines,tableX,y,9);text(r.area,tableX+tableW,y+lines.length*3.7+1,9,true,ink,{align:'right'});rule(tableX,y+height-3,tableW,[231,235,241]);y+=height;}
  if(index<rows.length){overflow.push({floor:f,rows:rows.slice(index),start:index});text('Экспликация: продолжение далее',tableX,250,7,false,[119,132,153]);}
  if(!rows.length)text('Экспликация не добавлена',tableX,96,9,false,[119,132,153]);text('ИТОГО',tableX,260,8,false,[119,132,153]);text((card[f.area]||'не указана')+' м²',tableX+tableW,267,11,true,ink,{align:'right'});
 }
 // One level gets a full-width plan; two levels share a spread; more levels
 // retain the same readable scale on additional A3 sheets.
 for(let i=0;i<levels.length;i+=2){doc.addPage();header(numberText);text('Планировочные решения',16,44,27,true,white);const pair=levels.slice(i,i+2);for(let j=0;j<pair.length;j++)await floorPanel(pair[j],16+j*199,pair.length===1?388:189);}
 for(const extra of overflow){doc.addPage();header(numberText);text(extra.floor.title+' / Экспликация',16,45,23,true,white);doc.autoTable({startY:55,head:[['№','Помещение','Площадь, м²']],body:extra.rows.map((r,i)=>[String(extra.start+i+1),roomLabel(r.name),r.area]),theme:'striped',styles:{font:'Roboto',fontSize:11,cellPadding:3},headStyles:{fillColor:blue,fontStyle:'bold'},columnStyles:{0:{cellWidth:17},2:{cellWidth:40,halign:'right'}},margin:{top:55,bottom:23,left:16,right:16},willDrawPage:()=>{header(numberText);text(extra.floor.title+' / Экспликация',16,45,23,true,white);}});}
 const roof=CatalogFloors.roofPlan(card);
 if(roof){doc.addPage();header(numberText);text('Эксплуатируемая кровля',16,44,27,true,white);await picture(roof.image,16,50,388,220,'План кровли');}
 const total=doc.internal.getNumberOfPages();for(let i=1;i<=total;i++){doc.setPage(i);rule(16,281,388);text('ARHITTEK / КОНЦЕПТУАЛЬНЫЙ ПРОЕКТ',16,288,7,true,gray);text('+7 922 659-38-72 · arhittek.ru',258,288,8,false,gray);text(i+' / '+total,404,288,8,true,gray,{align:'right'});}
 return {doc,missing};
}
var catalogPreparedPdf=null;
async function deliverCatalogPdf(file){
  requireCatalogPdfOwner();
  // Share the attachment itself. Sharing a browser PDF preview on iOS also
  // shares its temporary blob: address as the WhatsApp message caption.
  if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})){
    await navigator.share({files:[file]});return 'shared';
  }
  const url=URL.createObjectURL(file),a=document.createElement('a');
  a.href=url;a.download=file.name;document.body.appendChild(a);
  try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  return 'downloaded';
}
async function downloadCurrentCardPdf(button){
  if(!canExportCatalogPdf()){catalogPreparedPdf=null;showToast('Скачивание PDF доступно только владельцу');return;}
  if(button?.disabled)return;
  const selected=cardViewerList[cardViewerIndex];if(!selected)return;
  const card=JSON.parse(JSON.stringify(selected)),key=JSON.stringify(card),old=button?.textContent;
  let retry=false;
  if(button){button.disabled=true;button.textContent='Готовлю…';}
  try{
    if(catalogPreparedPdf?.key!==key){
      const {doc,missing}=await createCatalogCardPdf(card),name='ARHITTEK-'+String(card.project_number||card.id).replace(/[^\p{L}\p{N}_-]/gu,'_')+'.pdf';
      catalogPreparedPdf={key,file:new File([doc.output('blob')],name,{type:'application/pdf'}),missing};
    }
    requireCatalogPdfOwner();
    const result=await deliverCatalogPdf(catalogPreparedPdf.file);
    if(catalogPreparedPdf.missing.length)showToast((result==='shared'?'PDF передан.':'PDF сохранён.')+' Не добавлено: '+catalogPreparedPdf.missing.join(', '));
    catalogPreparedPdf=null;
  }catch(e){
    if(e.name==='AbortError'){retry=true;return;}
    if(e.name==='NotAllowedError'&&catalogPreparedPdf?.key===key){retry=true;showToast('PDF готов. Нажмите ещё раз, чтобы отправить файл.');return;}
    catalogPreparedPdf=null;
    showToast(e.message||'Не удалось создать PDF');
  }
  finally{if(button){button.disabled=false;button.textContent=retry?'Отправить PDF':old==='Отправить PDF'?'↓ Скачать PDF':old;}}
}
