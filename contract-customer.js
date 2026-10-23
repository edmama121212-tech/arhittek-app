// Customer details belong to the saved contract, not to changing company settings.
const contractLegalFields=['company-name','inn','kpp','ogrn','legal-address','representative','representative-role','authority','bank-name','bank-account','bik','corr-account'];
const contractPersonFields={client_name:'client-name',passport:'passport',birthdate:'birthdate',passport_issuer:'passport-issuer',passport_date:'passport-date',address:'address'};
const contractValue=id=>document.getElementById('ct-'+id)?.value.trim()||'';
function setContractCustomerType(){
  const legal=contractValue('customer-type')==='legal';
  document.getElementById('ct-individual-fields').hidden=legal;
  document.getElementById('ct-legal-fields').hidden=!legal;
  document.querySelectorAll('#ct-individual-fields input').forEach(el=>el.disabled=legal);
  document.querySelectorAll('#ct-legal-fields input').forEach(el=>el.disabled=!legal);
}
function contractCustomerSnapshot(){
  const legal=contractValue('customer-type')==='legal';
  const result={customer_type:legal?'legal':'individual',phone:contractValue('phone'),email:contractValue('email')};
  for(const [key,id]of Object.entries(contractPersonFields))result[key]=legal?'':contractValue(id);
  result.legal_entity=legal?Object.fromEntries(contractLegalFields.map(id=>[id.replaceAll('-','_'),contractValue('legal-'+id)])):null;
  if(legal)result.client_name=result.legal_entity.company_name;
  return result;
}
function applyContractCustomer(s={}){
  const legal=s.customer_type==='legal';
  document.getElementById('ct-customer-type').value=legal?'legal':'individual';
  for(const [key,id]of Object.entries(contractPersonFields))document.getElementById('ct-'+id).value=legal?'':s[key]||'';
  for(const id of contractLegalFields)document.getElementById('ct-legal-'+id).value=legal?s.legal_entity?.[id.replaceAll('-','_')]||'':'';
  for(const id of ['phone','email'])document.getElementById('ct-'+id).value=s[id]||'';
  setContractCustomerType();
}
function resetContractCustomer(){applyContractCustomer();}
function contractCustomerIntro(s){
  if(s.customer_type!=='legal')return 'гражданин(ка) РФ '+(s.client_name||'________________');
  const l=s.legal_entity||{};
  return (l.company_name||s.client_name||'________________')+', в лице '+
    ([l.representative_role,l.representative].filter(Boolean).join(' ')||'________________')+
    ', действующего на основании '+(l.authority||'________________');
}
function contractCustomerLines(s){
  const lines=[],add=(label,value)=>{if(value)lines.push(label+value);};
  if(s.customer_type==='legal'){
    const l=s.legal_entity||{};lines.push(l.company_name||s.client_name||'________________');
    for(const [key,label]of [['inn','ИНН: '],['kpp','КПП: '],['ogrn','ОГРН: '],['legal_address','Юр. адрес: '],['representative_role','Должность: '],['representative','Представитель: '],['authority','Основание полномочий: '],['bank_name','Банк: '],['bank_account','Р/с: '],['bik','БИК: '],['corr_account','К/с: ']])add(label,l[key]);
  }else{
    lines.push(s.client_name||'________________');add('Паспорт: ',s.passport);
    add('Дата рождения: ',s.birthdate?fmtDate(s.birthdate):'');add('Выдан: ',s.passport_issuer);
    add('Дата выдачи: ',s.passport_date?fmtDate(s.passport_date):'');add('Адрес рег.: ',s.address);
  }
  add('Телефон: ',s.phone);add('Email: ',s.email);return lines;
}
document.getElementById('ct-customer-type').addEventListener('change',setContractCustomerType);
setContractCustomerType();

// Keep the original select as the single project ID source for existing workflows.
function syncContractProjectPicker(){
  const select=document.getElementById('ct-project');
  document.getElementById('ct-project-picker').textContent=select.selectedOptions[0]?.textContent||'— не выбран —';
}
function renderContractProjectResults(){
  const q=contractValue('project-search').toLocaleLowerCase('ru').replaceAll('ё','е').split(/\s+/).filter(Boolean);
  const select=document.getElementById('ct-project'),list=document.getElementById('ct-project-results');
  list.replaceChildren();
  const add=(name,id,detail='')=>{
    const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';
    b.textContent=name+(detail?' — '+detail:'');b.dataset.projectId=id;
    if(select.value===id)b.setAttribute('aria-current','true');
    b.addEventListener('click',()=>{
      select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('ct-project-dialog').close();document.getElementById('ct-project-picker').focus();
    });list.append(b);
  };
  add('— не выбран —','');let count=0;
  for(const option of select.options){
    if(!option.value)continue;
    const p=state.projects.find(p=>String(p.id)===option.value);
    if(!p||p.deleted_at)continue;
    const search=[p.name,p.client_name,p.address,p.phone].filter(Boolean).join(' ').toLocaleLowerCase('ru').replaceAll('ё','е');
    if(!q.every(term=>search.includes(term)))continue;
    add(p.name||option.textContent,p.id,[p.client_name,p.address].filter(Boolean).join(' · '));count++;
  }
  document.getElementById('ct-project-count').textContent=count?'Найдено проектов: '+count:'Ничего не найдено. Измените запрос.';
}
document.getElementById('ct-project-picker').addEventListener('click',()=>{
  document.getElementById('ct-project-search').value='';renderContractProjectResults();
  document.getElementById('ct-project-dialog').showModal();document.getElementById('ct-project-search').focus();
});
document.getElementById('ct-project-search').addEventListener('input',renderContractProjectResults);
document.getElementById('ct-project-close').addEventListener('click',()=>document.getElementById('ct-project-dialog').close());
document.getElementById('ct-project-dialog').addEventListener('click',e=>{
  if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();}
});
syncContractProjectPicker();
