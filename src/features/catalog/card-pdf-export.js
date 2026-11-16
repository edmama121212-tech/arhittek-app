// Export a snapshot of the selected saved card; never writes to the catalogue.
async function createCatalogCardPdf(card){
  const {jsPDF}=window.jspdf||{};
  if(!jsPDF)throw Error('PDF-модуль не загрузился. Обновите страницу');
  const doc=new jsPDF({unit:'mm',format:'a4',compress:true});registerPdfFonts(doc);
  const blue=[61,143,224],ink=[30,47,55],margin=16,width=178,missing=[];
  const text=(s,x,y,size=11,bold=false)=>{doc.setFont('Roboto',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...ink);doc.text(Array.isArray(s)?s:String(s??'не указано'),x,y);};
  function header(label){doc.setFillColor(...ink);doc.rect(0,0,210,27,'F');doc.setTextColor(255);doc.setFont('Roboto','bold');doc.setFontSize(18);doc.text('ARHITTEK',margin,17);doc.setFontSize(9);doc.text(label,194,17,{align:'right'});}
  async function picture(url,x,y,w,h,label){
    if(!url){missing.push(label);text(label+' не добавлен',x+3,y+8,10);return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    let bitmap;
    try{
      const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error('HTTP '+response.status);
      const blob=await response.blob();bitmap=await createImageBitmap(blob);
      const scale=Math.min(w/bitmap.width,h/bitmap.height),pw=bitmap.width*scale,ph=bitmap.height*scale;
      // Decode to PNG to support JPEG, WebP and PNG consistently in jsPDF.
      const canvas=document.createElement('canvas'),factor=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      doc.addImage(canvas.toDataURL('image/png'),'PNG',x+(w-pw)/2,y+(h-ph)/2,pw,ph,undefined,'FAST');
    }catch(e){throw Error('Не удалось загрузить изображение «'+label+'». PDF не сохранён; повторите загрузку');}
    finally{clearTimeout(timer);bitmap?.close();}
  }
  const number=card.project_number||'без номера';header('ПРОЕКТ № '+number);
  const title=doc.splitTextToSize(card.title||CatalogFloors.defaultTitle(card),width);text(title,margin,39,16,true);
  let y=42+title.length*6;
  await picture(card.images?.[0],margin,y,width,94,'Визуализация');y+=102;
  const facts=[['Площадь',String(card.total_area||'не указана')+' м²'],['Этажи',CatalogFloors.label(card)],['Габариты',card.footprint||'не указаны'],['Спальни',card.beds??'не указано'],['Санузлы',card.baths??'не указано']];
  doc.autoTable({startY:y,body:facts,theme:'plain',styles:{font:'Roboto',fontSize:11,cellPadding:3},columnStyles:{0:{textColor:[110,122,133]},1:{fontStyle:'bold',halign:'right'}},margin:{left:margin,right:margin}});
  y=doc.lastAutoTable.finalY+12;text('Стоимость проекта',margin,y,10);text(CatalogFloors.priceText(card).replace('₽','руб.'),margin,y+11,24,true);
  const tags=Array.isArray(card.tags)?card.tags.join(' · '):String(card.tags||'');
  if(tags)text(doc.splitTextToSize(tags,width),margin,y+23,10);
  for(const floor of CatalogFloors.active(card)){
    doc.addPage();header('ПРОЕКТ № '+number+' · '+floor.title);
    text(floor.title,margin,39,17,true);text('Площадь: '+(card[floor.area]||'не указана')+' м²',margin,47,10);
    await picture(card.images?.[floor.image],margin,54,width,151,floor.title+': план');
    const rows=CatalogFloors.normalizeRooms(card[floor.rooms],{expectedArea:card[floor.area]});
    if(rows.length)doc.autoTable({startY:213,head:[['№','Помещение','Площадь, м²']],body:rows.map((r,i)=>[String(i+1),r.name,r.area]),theme:'striped',styles:{font:'Roboto',fontSize:10,cellPadding:2.5},headStyles:{fillColor:blue,fontStyle:'bold'},columnStyles:{0:{cellWidth:12},2:{cellWidth:31,halign:'right'}},margin:{top:35,bottom:23,left:margin,right:margin},didDrawPage:()=>{if(doc.internal.getCurrentPageInfo().pageNumber>2)header('ПРОЕКТ № '+number+' · '+floor.title);}});
    else text('Экспликация не добавлена',margin,218,10);
  }
  const total=doc.internal.getNumberOfPages();
  for(let i=1;i<=total;i++){doc.setPage(i);doc.setDrawColor(220);doc.line(margin,279,194,279);text('arhittek.ru  ·  +7 922 659-38-72',margin,286,9);text(i+' / '+total,183,286,9);}
  return {doc,missing};
}
async function downloadCurrentCardPdf(button){
  if(button?.disabled)return;
  const selected=cardViewerList[cardViewerIndex];if(!selected)return;
  const card=JSON.parse(JSON.stringify(selected)),old=button?.textContent;
  if(button){button.disabled=true;button.textContent='Готовлю…';}
  try{const {doc,missing}=await createCatalogCardPdf(card);doc.save('ARHITTEK-'+String(card.project_number||card.id).replace(/[^\p{L}\p{N}_-]/gu,'_')+'.pdf');if(missing.length)showToast('PDF сохранён. Не добавлено: '+missing.join(', '));}
  catch(e){showToast(e.message||'Не удалось создать PDF');}
  finally{if(button){button.disabled=false;button.textContent=old;}}
}
