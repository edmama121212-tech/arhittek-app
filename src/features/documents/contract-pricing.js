// Contract prices are saved with the document, independently of future catalogue edits.
let contractTariff = null;
const ctField = id => document.getElementById('ct-' + id);
const ctRound = n => Math.round((n + Number.EPSILON) * 100) / 100;
const ctNumber = n => Number(n).toLocaleString('ru-RU', {maximumFractionDigits:2});

function renderContractTariffs(){
  const select=ctField('tariff');
  const mode=select.value;
  select.innerHTML='<option value="manual">Договорная сумма — за весь объём работ</option><option value="custom">Свой тариф за м²</option>';
  if(contractTariff){
    select.add(new Option(contractTariff.name,'selected'));
  }
  kpFlatCatalog().forEach((item,index)=>{
    if(!['м²','м2','m2','m²'].includes(String(item.unit).trim())) return;
    select.add(new Option(item.name+' · '+ctNumber(item.rate)+' ₽/м²','catalog:'+index));
  });
  select.value=contractTariff?'selected':mode==='custom'?'custom':'manual';
}

function contractPricingSnapshot(){
  const mode=ctField('tariff').value;
  return {
    mode:mode==='manual'?'manual':'rate',
    area:ctField('area').value===''?null:Number(ctField('area').value),
    tariff:mode==='manual'?null:{id:contractTariff?.id||null,name:contractTariff?.name||'Индивидуальный тариф'},
    base_rate:mode==='manual'?null:Number(ctField('rate').value),
    discount_mode:ctField('discount-mode').value,
    discount_pct:ctField('discount-mode').value==='discount'?Number(ctField('discount-pct').value):0
  };
}

function contractPricingResult(p){
  if(!p||p.mode!=='rate') return null;
  const discount=p.discount_mode==='discount'?p.discount_pct:0;
  if(!Number.isFinite(p.area)||p.area<=0||!Number.isFinite(p.base_rate)||p.base_rate<0||
     !Number.isFinite(discount)||discount<0||discount>100) return null;
  if([p.area,p.base_rate,discount].some(n=>ctRound(n)!==n)) return null;
  // Round the agreed unit price first so the printed rate × area equals the total.
  const rate=ctRound(p.base_rate*(1-discount/100));
  const total=ctRound(rate*p.area);
  return Number.isSafeInteger(Math.round(total*100))?{rate,total,discount}:null;
}

function updateContractPricing(){
  const p=contractPricingSnapshot(),rated=p.mode==='rate';
  ctField('rate-field').hidden=!rated;
  ctField('discount-fields').hidden=!rated;
  ctField('discount-value-field').hidden=p.discount_mode!=='discount';
  ctField('price').readOnly=rated;
  ctField('price-label').textContent=rated?'Стоимость работ, ₽':'Договорная сумма, ₽';
  ctField('fixed-price-hint').hidden=rated;
  ctField('area').required=rated;
  ctField('rate').required=rated;
  ctField('discount-pct').required=rated&&p.discount_mode==='discount';
  if(!rated) return;
  const result=contractPricingResult(p);
  const complete=ctField('rate').value!==''&&(p.discount_mode!=='discount'||ctField('discount-pct').value!=='');
  ctField('price').value=result&&complete?result.total:'';
  ctField('price-preview').textContent=result&&complete?
    ctNumber(p.area)+' м² × '+ctNumber(result.rate)+' ₽/м² = '+ctNumber(result.total)+' ₽':
    'Укажите площадь, тариф и размер скидки, если она выбрана.';
}

function validateContractPricing(){
  updateContractPricing();
  const p=contractPricingSnapshot();
  if(p.mode==='rate'&&(!contractPricingResult(p)||ctField('price').value==='')){
    showToast('Укажите площадь больше нуля, тариф и скидку от 0 до 100% — до двух знаков после запятой');return false;
  }
  if(p.area!==null&&(!Number.isFinite(p.area)||p.area<=0)){
    showToast('Площадь должна быть больше нуля');return false;
  }
  const total=Number(ctField('price').value);
  if(p.mode==='manual'&&ctField('price').value!==''&&(!Number.isFinite(total)||total<0||ctRound(total)!==total||!Number.isSafeInteger(Math.round(total*100)))){
    showToast('Укажите неотрицательную договорную сумму с точностью до копеек');return false;
  }
  return true;
}

function resetContractPricing(area){
  contractTariff=null;
  ctField('tariff').value='manual';
  ctField('area').value=Number(area)>0?area:'';
  ctField('rate').value='';
  ctField('discount-mode').value='none';
  ctField('discount-pct').value='';
  renderContractTariffs();updateContractPricing();
}

function applyContractPricing(p){
  resetContractPricing();
  if(!p) return; // Legacy documents retain their original total and have no invented rate.
  ctField('area').value=p.area??'';
  if(p.mode==='rate'){
    contractTariff=p.tariff?{...p.tariff}:null;
    ctField('tariff').value='custom';renderContractTariffs();
    ctField('rate').value=p.base_rate??'';
    ctField('discount-mode').value=p.discount_mode==='discount'?'discount':'none';
    ctField('discount-pct').value=p.discount_pct??'';
  }
  updateContractPricing();
}

function contractPricingLines(p){
  if(!p) return [];
  const lines=[];
  if(Number(p.area)>0) lines.push('Площадь объекта: '+ctNumber(p.area)+' м².');
  if(p.mode==='manual'){
    lines.push('Стоимость работ установлена по соглашению сторон за весь объём работ, без расчёта по тарифу за квадратный метр.');
    return lines;
  }
  const r=contractPricingResult(p);
  if(!r) return lines;
  lines.push('Тариф «'+(p.tariff?.name||'Индивидуальный тариф')+'»: '+ctNumber(p.base_rate)+' ₽/м² без скидки.');
  if(p.discount_mode==='discount') lines.push('Скидка: '+ctNumber(r.discount)+'%. Тариф со скидкой: '+ctNumber(r.rate)+' ₽/м².');
  else lines.push('Скидка не применяется.');
  lines.push('Расчёт стоимости: '+ctNumber(p.area)+' м² × '+ctNumber(r.rate)+' ₽/м² = '+ctNumber(r.total)+' ₽.');
  return lines;
}

ctField('tariff').addEventListener('change',()=>{
  const value=ctField('tariff').value;
  if(value.startsWith('catalog:')){
    const item=kpFlatCatalog()[Number(value.slice(8))];
    if(!item) return;
    contractTariff={id:item.id||null,name:item.name};
    ctField('rate').value=item.rate;
    renderContractTariffs();
  }else if(value!=='selected'){
    contractTariff=null;
    renderContractTariffs();
  }
  updateContractPricing();
});
ctField('rate').addEventListener('input',()=>{
  // An edited catalogue rate becomes an explicitly agreed individual rate.
  if(contractTariff){contractTariff=null;ctField('tariff').value='custom';renderContractTariffs();}
});
['area','rate','discount-pct'].forEach(id=>ctField(id).addEventListener('input',updateContractPricing));
ctField('discount-mode').addEventListener('change',updateContractPricing);
resetContractPricing();
