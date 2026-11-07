// ============================================================
// ЭТАПЫ ПРОЕКТА
// ============================================================
function renderStagesList(projectId){
  const container = document.getElementById('pf-stages-list');
  const addRow = document.getElementById('pf-stage-add-row');
  const addBtn = document.getElementById('pf-stage-add');
  if(!container) return;

  const isAdmin = session && session.isAdmin;
  if(addRow) addRow.style.display = isAdmin ? 'flex' : 'none';
  if(addBtn) addBtn.style.display = isAdmin ? 'inline-block' : 'none';

  if(!projectId){
    container.innerHTML = '<div class="empty-state">Сохраните проект, чтобы работать с этапами</div>';
    return;
  }

  const proj = state.projects.find(p=>p.id===projectId);
  const template = defaultStageNamesForProject(proj); // массив имён или null

  const dbStages = state.projectStages
    .filter(s=>s.project_id===projectId)
    .sort((a,b)=>a.sort_order-b.sort_order || new Date(a.created_at)-new Date(b.created_at));

  // Находим DB-строку по имени с учётом старых названий
  function findDbStage(name){
    return dbStages.find(s=> s.name===name || STAGE_LEGACY_MAP[s.name]===name );
  }

  // Собираем отображаемый список: сначала канонические (всегда видны), затем кастомные
  const display = [];
  const usedIds = new Set();
  if(template){
    template.forEach(name=>{
      const db = findDbStage(name);
      if(db){ usedIds.add(db.id); display.push({name, id:db.id, done:!!db.done, done_at:db.done_at, due_date:db.due_date, canonical:true}); }
      else { display.push({name, id:null, done:false, done_at:null, due_date:null, canonical:true}); }
    });
  }
  dbStages.forEach(s=>{
    if(usedIds.has(s.id)) return;
    // старое имя, которое уже показано под новым — пропускаем
    if(template && template.indexOf(STAGE_LEGACY_MAP[s.name]) !== -1 && display.some(d=>d.canonical && d.name===STAGE_LEGACY_MAP[s.name])) return;
    display.push({name:s.name, id:s.id, done:!!s.done, done_at:s.done_at, due_date:s.due_date, canonical:false});
  });

  if(!display.length){
    container.innerHTML = `<div class="empty-state" style="padding:20px;">Этапов пока нет${isAdmin ? ' — добавьте первый выше' : ''}</div>`;
    return;
  }

  const warning=state.stageDataError ? '<div class="note" role="status">Не удалось обновить этапы. Показаны последние загруженные отметки.</div>' : '';
  container.innerHTML = warning+display.map(s=>{
    const overdue = s.due_date && !s.done && daysUntil(s.due_date) < 0;
    const dueTxt = s.due_date ? fmtDate(s.due_date) : '';
    const doneTxt = s.done && s.done_at ? ' · выполнен '+fmtDate(s.done_at) : '';
    const nameEnc = encodeURIComponent(s.name);
    // клик по чекбоксу: для канонических — по имени (создаёт строку при необходимости), для кастомных — по id
    const toggleCall = s.canonical
      ? `toggleStageByName('${projectId}','${nameEnc}',${s.done ? 'false' : 'true'})`
      : (s.done ? `markStageUndone('${s.id}','${projectId}')` : `markStageDone('${s.id}','${projectId}')`);
    const saving = pendingStageChanges.has(stageChangeKey(projectId,s.name,s.id,s.canonical));
    const box = `<button type="button" class="stage-check${s.done ? ' done' : ''}" onclick="${toggleCall}" aria-pressed="${s.done}" aria-label="${escapeHtml((s.done ? 'Снять отметку: ' : 'Выполнить: ')+s.name)}" title="${s.done ? 'Снять отметку' : 'Отметить выполненным'}">${s.done ? '✓' : ''}</button>`;
    const delBtn = (isAdmin && !s.canonical && s.id)
      ? `<button class="icon-btn danger" onclick="deleteStage('${s.id}','${projectId}')" title="Удалить этап">🗑</button>` : '';
    return `<div class="list-item stage-item" style="align-items:center;">
      ${box}
      <div style="flex:1; min-width:0;">
        <div class="li-name" style="${s.done ? 'text-decoration:line-through; opacity:0.55;' : ''}">${escapeHtml(s.name)}</div>
        ${(dueTxt||doneTxt||overdue) ? `<div class="li-meta" style="${overdue ? 'color:var(--red);' : ''}">${dueTxt ? '📅 '+dueTxt : ''}${doneTxt}${overdue ? ' ⚠ просрочен' : ''}</div>` : ''}
        ${saving ? '<div class="li-meta" data-stage-saving="true" role="status">Сохраняется…</div>' : ''}
      </div>
      <div class="li-actions">${delBtn}</div>
    </div>`;
  }).join('');
}

// Каждый этап сохраняется своей очередью: следующий клик виден сразу, даже пока
// предыдущий запрос ещё идёт. Старый ответ чтения не затирает локальную отметку.
const pendingStageChanges=new Map();
const confirmedStageChanges=new Map();
let stageWriteGeneration=0;
let stageReadSequence=0,latestStageReadSequence=0;
function beginStageRead(){return {generation:stageWriteGeneration,sequence:++stageReadSequence};}
function stageChangeKey(projectId,name,id,canonical){
  if(canonical===undefined){
    const template=defaultStageNamesForProject(state.projects.find(p=>p.id===projectId));
    canonical=!!template?.includes(STAGE_LEGACY_MAP[name]||name);
  }
  return projectId+':'+(canonical ? 'name:'+(STAGE_LEGACY_MAP[name]||name) : 'id:'+id);
}
function applyStageChange(rows,entry,row){
  const matches=s=>s.project_id===entry.projectId && (s.id===entry.id ||
    (entry.canonicalName && (s.name===entry.canonicalName || STAGE_LEGACY_MAP[s.name]===entry.canonicalName)));
  const result=rows.filter(s=>!matches(s));
  if(row)result.push({...row});
  return result;
}
function mergeStageRead(rows,read){
  if(read.sequence<latestStageReadSequence)return state.projectStages;
  latestStageReadSequence=read.sequence;
  state.stageDataError=null;
  let result=rows||[];
  for(const entry of confirmedStageChanges.values()){
    if(entry.generation>read.generation)result=applyStageChange(result,entry,entry.row);
  }
  for(const entry of pendingStageChanges.values())result=applyStageChange(result,entry,entry.desired);
  return result;
}
function failStageRead(read,error){
  if(read.sequence<latestStageReadSequence)return;
  latestStageReadSequence=read.sequence;
  state.stageDataError=error.message||'Не удалось обновить этапы';
}
function renderCurrentStages(projectId){
  if(editingProjectId===projectId && document.getElementById('projectSheetOverlay')?.classList.contains('active'))renderStagesList(projectId);
}
function renderStageViews(projectId){
  renderCurrentStages(projectId);
  renderProjects();renderConstruction();renderOverview();
}
function publishStageChange(entry,row){
  confirmedStageChanges.set(entry.key,{projectId:entry.projectId,id:entry.id,canonicalName:entry.canonicalName,
    row:row ? {...row} : null,generation:++stageWriteGeneration});
  state.projectStages=applyStageChange(state.projectStages,entry,row);
}
async function drainStageChanges(entry){
  while(true){
    const version=entry.version;
    const desired=entry.desired ? {...entry.desired} : null;
    try{
      let saved=entry.confirmed;
      if(!desired){
        if(saved){
          const result=await sb.from('project_stages').delete().eq('id',entry.id).eq('project_id',entry.projectId);
          if(result.error)throw result.error;
        }
        saved=null;
      }else if(!saved){
        const result=await sb.from('project_stages').insert(desired).select('*').single();
        if(result.error)throw result.error;
        if(!result.data)throw new Error('Этап не сохранён');
        saved=result.data;
      }else{
        const result=await sb.from('project_stages').update({name:desired.name,done:desired.done,done_at:desired.done_at})
          .eq('id',entry.id).eq('project_id',entry.projectId).select('*').single();
        if(result.error)throw result.error;
        if(!result.data)throw new Error('Этап не найден или недоступен');
        saved=result.data;
      }
      entry.confirmed=saved ? {...saved} : null;
      publishStageChange(entry,entry.version===version ? saved : entry.desired);
    }catch(e){
      console.error(e);showToast('Ошибка сохранения этапа «'+entry.name+'»'+(entry.version===version ? '. Отметка возвращена.' : '. Сохраняем последнюю отметку.'));
      if(entry.version===version)publishStageChange(entry,entry.confirmed);
    }
    if(entry.version===version){pendingStageChanges.delete(entry.key);renderStageViews(entry.projectId);return;}
  }
}
function saveStageChange(projectId,stage,change){
  if(!isProjectMember(projectId)){showToast('Нет доступа к этапам этого проекта');return Promise.resolve();}
  const key=stageChangeKey(projectId,stage.name,stage.id);
  let entry=pendingStageChanges.get(key);
  if(!entry){
    const existing=state.projectStages.find(s=>s.id===stage.id && s.project_id===projectId);
    const canonicalName=key.startsWith(projectId+':name:') ? (STAGE_LEGACY_MAP[stage.name]||stage.name) : null;
    entry={key,projectId,id:stage.id||crypto.randomUUID(),name:canonicalName||stage.name,canonicalName,
      confirmed:existing ? {...existing} : null,desired:existing ? {...existing} : {...stage},version:0};
    pendingStageChanges.set(key,entry);
  }
  entry.desired=change ? {...(entry.desired||entry.confirmed||stage),id:entry.id,project_id:projectId,...change} : null;
  entry.version++;
  state.projectStages=applyStageChange(state.projectStages,entry,entry.desired);
  renderCurrentStages(projectId);
  if(!entry.promise)entry.promise=drainStageChanges(entry);
  return entry.promise;
}
function toggleStageByName(projectId,nameEnc,makeDone){
  const name=decodeURIComponent(nameEnc);
  const existing=state.projectStages.find(s=>s.project_id===projectId && (s.name===name || STAGE_LEGACY_MAP[s.name]===name));
  if(!existing && !makeDone)return Promise.resolve();
  const stage=existing||{project_id:projectId,name,sort_order:state.projectStages.filter(s=>s.project_id===projectId).length};
  return saveStageChange(projectId,stage,{name,done:!!makeDone,done_at:makeDone?new Date().toISOString():null});
}
let stageReloadTimer=null;
async function refreshProjectStages(){
  const read=beginStageRead();
  try{
    const result=await fetchAllRows(()=>sb.from('project_stages').select('*',{count:'exact'}).order('sort_order',{ascending:true}));
    if(result.error)throw result.error;
    state.projectStages=mergeStageRead(result.data,read);
    renderStageViews(editingProjectId);
  }catch(e){failStageRead(read,e);renderCurrentStages(editingProjectId);console.warn('Не удалось обновить этапы',e);}
}
function scheduleStageReload(){
  clearTimeout(stageReloadTimer);
  stageReloadTimer=setTimeout(refreshProjectStages,150);
}

function initStageDragSort(container, projectId){
  let dragEl = null;
  let dragOverEl = null;

  container.querySelectorAll('.stage-item').forEach(item=>{
    item.addEventListener('dragstart', e=>{
      dragEl = item;
      item.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', ()=>{
      item.style.opacity = '';
      container.querySelectorAll('.stage-item').forEach(i=>i.style.borderTop='');
      dragEl = null;
    });
    item.addEventListener('dragover', e=>{
      e.preventDefault();
      if(item === dragEl) return;
      container.querySelectorAll('.stage-item').forEach(i=>i.style.borderTop='');
      item.style.borderTop = '2px solid var(--blue)';
      dragOverEl = item;
    });
    item.addEventListener('drop', async e=>{
      e.preventDefault();
      if(!dragEl || dragEl === item) return;
      container.querySelectorAll('.stage-item').forEach(i=>i.style.borderTop='');

      // Собираем новый порядок
      const items = [...container.querySelectorAll('.stage-item')];
      const fromIdx = items.indexOf(dragEl);
      const toIdx = items.indexOf(item);
      items.splice(fromIdx, 1);
      items.splice(toIdx, 0, dragEl);

      // Сохраняем sort_order в БД
      const updates = items.map((el,idx)=>({
        id: el.dataset.stageId,
        sort_order: idx,
      }));

      try{
        await Promise.all(updates.map(u=>
          sb.from('project_stages').update({sort_order: u.sort_order}).eq('id', u.id)
        ));
        await loadAll();
        renderCurrentStages(projectId);
      }catch(err){
        console.error(err);
        showToast('Ошибка сохранения порядка');
      }
    });
  });
}

const stageAddsInFlight=new Map();
function addStage(projectId){
  if(!session?.isAdmin || !isProjectMember(projectId)){showToast('Нет доступа к добавлению этапов');return Promise.resolve();}
  if(stageAddsInFlight.has(projectId))return stageAddsInFlight.get(projectId);
  const name = document.getElementById('pf-stage-name').value.trim();
  if(!name){ showToast('Введите название этапа'); return; }
  const due_date = document.getElementById('pf-stage-date').value || null;
  const sort_order = state.projectStages.filter(s=>s.project_id===projectId).length;
  const id=crypto.randomUUID();
  const saving=(async()=>{
    try{
      const {data,error}=await sb.from('project_stages').insert({id,project_id:projectId,name,due_date,sort_order}).select('*').single();
      if(error)throw error;
      if(!data)throw new Error('Этап не сохранён');
      publishStageChange({key:stageChangeKey(projectId,name,id),projectId,id,canonicalName:null},data);
      if(editingProjectId===projectId){
        const nameField=document.getElementById('pf-stage-name'),dateField=document.getElementById('pf-stage-date');
        if(nameField.value.trim()===name && (dateField.value||null)===due_date){nameField.value='';dateField.value='';}
      }
      renderStageViews(projectId);
    }catch(e){console.error(e);showToast('Ошибка добавления этапа');}
    finally{stageAddsInFlight.delete(projectId);}
  })();
  stageAddsInFlight.set(projectId,saving);
  return saving;
}

async function markStageDone(stageId,projectId){
  const stage=state.projectStages.find(s=>s.id===stageId && s.project_id===projectId);
  if(stage)return saveStageChange(projectId,stage,{done:true,done_at:new Date().toISOString()});
}
async function markStageUndone(stageId,projectId){
  const stage=state.projectStages.find(s=>s.id===stageId && s.project_id===projectId);
  if(stage)return saveStageChange(projectId,stage,{done:false,done_at:null});
}
async function deleteStage(stageId,projectId){
  if(!session?.isAdmin)return;
  if(!confirm('Удалить этот этап?'))return;
  const stage=state.projectStages.find(s=>s.id===stageId && s.project_id===projectId);
  if(stage)return saveStageChange(projectId,stage,null);
}

