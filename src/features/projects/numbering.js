// Project identity is allocated by PostgreSQL, never from a filtered client list.
let nextProjectNumbers=null,projectNumbersActor=null,projectNumbersRequest=null,projectNumbersGeneration=0;
let projectNumberDraftVersion=0,projectCreateDraftId=null,displayedProjectNumber=null;

function resetProjectNumberDraft(){
  projectNumberDraftVersion++;
  projectCreateDraftId=null;
  displayedProjectNumber=null;
}
function projectNumberSeries(categoryId){
  const name=String(findCategory(categoryId)?.name||'').toLowerCase();
  return name.includes('ландшафт')?'landscape':name.includes('интерьер')?'interior':name.includes('архитект')?'architecture':null;
}
function projectNumberPrefix(p){
  if(!p?.number_series||!Number.isInteger(p.number_sequence)||!Number.isInteger(p.number_year))return '';
  return 'Проект '+(p.number_series==='interior'?'ДИ ':p.number_series==='landscape'?'ЛД ':'')+'№'+p.number_sequence+String(p.number_year).slice(-2);
}
function projectOrdinal(p){
  if(p.number_series&&Number.isInteger(p.number_sequence)&&Number.isInteger(p.number_year))return {year:p.number_year,sequence:p.number_sequence};
  const n=String(p.name||'').match(/^\s*(?:проект\s*(?:(?:АР|АПР|ДИ|ЛД|ПР)\s*)*№?\s*|№\s*)([0-9]{3,8})(?:[^0-9]|$)/i)?.[1];
  return n?{year:2000+Number(n.slice(-2)),sequence:Number(n.slice(0,-2))}:null;
}
function compareProjectNumbers(a,b){
  const x=projectOrdinal(a),y=projectOrdinal(b);
  if(x&&y)return y.sequence-x.sequence||y.year-x.year||String(b.created_at||'').localeCompare(String(a.created_at||''))||String(a.id).localeCompare(String(b.id));
  if(x||y)return x?-1:1;
  return String(b.created_at||'').localeCompare(String(a.created_at||''))||String(a.name||'').localeCompare(String(b.name||''),'ru')||String(a.id).localeCompare(String(b.id));
}
function canCreateProjectCard(){
 if(!hasVerifiedAccess())return false;
 if(isOwner())return true;
 const employee=findEmployee(session.employeeId);
 return !!(employee&&employee.active!==false&&!employee.deleted_at&&canSeeProjects()&&['ведущий дизайнер','ведущий архитектор'].includes(String(employee.role||'').trim().toLowerCase()));
}
function clearProjectNumbers(){
  displayedProjectNumber=null;
  nextProjectNumbers=null;projectNumbersActor=null;projectNumbersRequest=null;projectNumbersGeneration++;
  const bar=document.getElementById('nextProjectNumbers');if(bar){bar.hidden=true;bar.replaceChildren();}
  const prefix=document.getElementById('pf-number-prefix');if(prefix)prefix.textContent='';
}
function renderNextProjectNumbers(){
  const bar=document.getElementById('nextProjectNumbers');if(!bar)return;
  bar.hidden=!canCreateProjectCard();if(bar.hidden){bar.replaceChildren();return;}
  const heading='<div class="project-number-heading">Следующие номера проектов</div>';
  if(!nextProjectNumbers){
    bar.innerHTML=heading+(projectNumbersRequest?'<p>Загружаем номера…</p>':'<p>Не удалось загрузить номера. <button type="button" class="project-number-retry" onclick="refreshProjectNumbers()">Обновить</button></p>');
    return;
  }
  const labels={architecture:'Архитектура',interior:'Дизайн интерьера',landscape:'Ландшафт'};
  const items=Object.entries(labels).map(([series,label])=>{
    const row=nextProjectNumbers.find(number=>number.series===series);
    if(!row)return '';
    const prefix=escapeHtml(row.prefix);
    return `<div><span>${label}</span><button type="button" class="project-number-copy" aria-label="Скопировать ${prefix}">${prefix}</button></div>`;
  });
  bar.innerHTML=heading+'<div class="project-number-grid">'+items.join('')+'</div><p>Нажмите на номер, чтобы скопировать. Номер закрепляется при сохранении проекта.</p>';
}
document.getElementById('nextProjectNumbers').addEventListener('click',async event=>{
  const button=event.target.closest('.project-number-copy');
  if(!button)return;
  try{
    await navigator.clipboard.writeText(button.textContent);
    showToast('Скопировано: '+button.textContent);
  }catch{
    const range=document.createRange(),selection=window.getSelection();
    range.selectNodeContents(button);
    selection.removeAllRanges();
    selection.addRange(range);
    showToast('Номер выделен. Выберите «Скопировать».');
  }
});
async function refreshProjectNumbers(){
  if(!canCreateProjectCard()){clearProjectNumbers();return false;}
  const actor=session.token;
  if(projectNumbersRequest&&projectNumbersActor===actor)return projectNumbersRequest;
  if(projectNumbersActor!==actor)nextProjectNumbers=null;
  projectNumbersActor=actor;
  const generation=++projectNumbersGeneration;
  const request=(async()=>{
    try{
      const result=await Promise.resolve().then(()=>sb.rpc('get_next_project_numbers'));
      if(generation!==projectNumbersGeneration||session?.token!==actor||!canCreateProjectCard())return false;
      const rows=result.data;
      if(result.error||!Array.isArray(rows)||rows.some(n=>!n||!['architecture','interior','landscape'].includes(n.series)||!Number.isInteger(n.sequence)||n.sequence<1||!Number.isInteger(n.year)||n.year<2000||n.year>2099||typeof n.category_id!=='string'||n.prefix!==projectNumberPrefix({number_series:n.series,number_sequence:n.sequence,number_year:n.year})))throw new Error('Номера не подтверждены сервером');
      nextProjectNumbers=rows;return true;
    }catch(e){if(generation===projectNumbersGeneration)nextProjectNumbers=null;console.warn('Не удалось обновить номера проектов');return false;}
    finally{if(generation===projectNumbersGeneration){projectNumbersRequest=null;renderNextProjectNumbers();renderProjectNumberField();}}
  })();
  projectNumbersRequest=request;
  renderProjectNumberField();
  return request;
}
function renderProjectNumberField(){
  const input=document.getElementById('pf-name'),label=document.getElementById('pf-name-label'),prefix=document.getElementById('pf-number-prefix'),hint=document.getElementById('pf-number-hint'),category=document.getElementById('pf-category');
  if(!input||!prefix)return;
  const saved=state.projects.find(p=>p.id===editingProjectId),series=projectNumberSeries(category.value);
  if(saved||!series||displayedProjectNumber?.category_id!==category.value){
    displayedProjectNumber=saved||!series?null:nextProjectNumbers?.find(n=>n.category_id===category.value)||null;
  }
  const fixed=saved?projectNumberPrefix(saved):displayedProjectNumber?.prefix;
  prefix.hidden=!!saved&&!saved.number_series||(!saved&&!series);
  prefix.textContent=prefix.hidden?'':fixed||(projectNumbersRequest?'Загружаем номер…':'');
  hint.hidden=!!saved||!series;
  hint.textContent=fixed?'Номер закрепится при сохранении.':projectNumbersRequest?'':'Не удалось получить номер. Повторите сохранение после восстановления связи.';
  input.disabled=!saved&&!category.value;
  label.textContent=(saved?!saved.number_series:!series)?'Название проекта':'Название без номера';
  category.disabled=!!saved?.number_series;
}
function projectNameForSave(){
  const title=document.getElementById('pf-name').value.trim(),saved=state.projects.find(p=>p.id===editingProjectId);
  return saved?.number_series?projectNumberPrefix(saved)+' '+title:title;
}
async function prepareProjectNumberSave(){
  if(editingProjectId)return true;
  const draftVersion=projectNumberDraftVersion,actor=session?.token;
  const category=document.getElementById('pf-category').value;
  if(!category){showToast('Сначала выберите направление проекта');return false;}
  if(!projectNumberSeries(category))return true;
  if(!nextProjectNumbers||projectNumbersActor!==session?.token){await refreshProjectNumbers();}
  if(draftVersion!==projectNumberDraftVersion||actor!==session?.token||editingProjectId||category!==document.getElementById('pf-category').value)return false;
  if(!nextProjectNumbers?.some(n=>n.category_id===category)){showToast('Не удалось получить номер проекта. Проверьте соединение и обновите номера.');return false;}
  return true;
}
async function createProjectDraft(payload){
  const token=session?.token;
  const draftVersion=projectNumberDraftVersion;
  const wasAttempted=!!projectCreateDraftId;
  const id=projectCreateDraftId||crypto.randomUUID();
  projectCreateDraftId=id;

  const checkDraft=()=>{
    if(token!==session?.token||draftVersion!==projectNumberDraftVersion){
      throw new Error('Форма проекта уже закрыта');
    }
  };
  const readExisting=async()=>{
    const result=await sb.from('projects').select('*').eq('id',id).maybeSingle();
    checkDraft();
    if(result.error)throw result.error;
    if(result.data?.deleted_at)throw new Error('Сохранённый проект находится в корзине');
    return result.data;
  };

  if(wasAttempted){
    const existing=await readExisting();
    if(existing)return existing;
  }
  const quote=displayedProjectNumber;
  const insert={...payload,id};
  if(quote&&quote.category_id===payload.category_id){
    insert.project_title=payload.name;
    insert.number_year=quote.year;
    insert.number_sequence=quote.sequence;
  }
  let result;
  try{
    result=await sb.from('projects').insert(insert).select().single();
  }catch(error){
    result={error};
  }
  checkDraft();
  if(!result.error&&result.data?.id===id)return result.data;
  if(result.error?.code==='PT409'&&result.error.message==='project_number_changed'){
    // The transaction did not create a card. Keep the name and show the current number.
    displayedProjectNumber=null;
    nextProjectNumbers=null;
    projectNumbersRequest=null;
    await refreshProjectNumbers();
    checkDraft();
    const prefix=displayedProjectNumber?.prefix;
    const error=new Error(prefix?'Номер изменился. Теперь '+prefix+'. Проверьте номер папки и сохраните ещё раз.':'Номер изменился. Обновите номера и повторите сохранение.');
    error.code='PROJECT_NUMBER_CHANGED';
    throw error;
  }

  const existing=await readExisting();
  if(existing)return existing;
  throw result.error||new Error('Не получено подтверждение создания проекта');
}
