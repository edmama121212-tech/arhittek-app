// ============================================================
// ЗАДАЧИ ПРОЕКТА
// ============================================================
const TASK_PRIORITY = { high:'🔴', normal:'🔵', low:'⚪' };

function renderTasksList(projectId){
  const container = document.getElementById('pf-tasks-list');
  const addRow = document.getElementById('pf-task-add-row');
  if(!container) return;

  const isAdmin = session && session.isAdmin;
  if(addRow) addRow.style.display = isAdmin ? '' : 'none';

  if(!projectId){
    container.innerHTML = '<div class="empty-state">Сохраните проект, чтобы добавить задачи</div>';
    return;
  }

  // Задачи хранятся в localStorage с ключом по projectId
  // (не требует миграции БД — быстрое решение, потом можно перенести в Supabase)
  const tasks = getProjectTasks(projectId);

  if(!tasks.length){
    container.innerHTML = `<div class="empty-state" style="padding:16px;">
      ${isAdmin ? 'Задач нет — добавьте выше' : 'Задач нет'}
    </div>`;
    return;
  }

  const done = tasks.filter(t=>t.done);
  const todo = tasks.filter(t=>!t.done);

  const renderTask = t => `
    <div class="list-item" style="${t.done?'opacity:0.5;':''}">
      <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
        <span style="font-size:14px; flex-shrink:0;">${TASK_PRIORITY[t.priority]||'🔵'}</span>
        <div style="flex:1; min-width:0;">
          <div class="li-name" style="${t.done?'text-decoration:line-through;':''}">${escapeHtml(t.name)}</div>
          <div class="li-meta">${new Date(t.created_at).toLocaleDateString('ru')}</div>
        </div>
      </div>
      <div class="li-actions">
        ${!t.done
          ? `<button class="icon-btn" onclick="toggleTask('${projectId}','${t.id}',true)" title="Выполнено">✅</button>`
          : `<button class="icon-btn" style="opacity:0.5;" onclick="toggleTask('${projectId}','${t.id}',false)" title="Вернуть">↩</button>`
        }
        ${isAdmin ? `<button class="icon-btn danger" onclick="deleteTask('${projectId}','${t.id}')">🗑</button>` : ''}
      </div>
    </div>`;

  let html = todo.map(renderTask).join('');
  if(done.length){
    html += `<div style="font-size:10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.08em; padding:8px 0 4px;">
      Выполнено (${done.length})
    </div>`;
    html += done.map(renderTask).join('');
  }
  container.innerHTML = html;
}

function getProjectTasks(projectId){
  try{
    const raw = localStorage.getItem('tasks_'+projectId);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}

function saveProjectTasks(projectId, tasks){
  try{ localStorage.setItem('tasks_'+projectId, JSON.stringify(tasks)); }catch(e){}
}

function addTask(projectId){
  const nameEl = document.getElementById('pf-task-name');
  const priorityEl = document.getElementById('pf-task-priority');
  const name = nameEl.value.trim();
  if(!name){ showToast('Введите название задачи'); return; }
  const tasks = getProjectTasks(projectId);
  tasks.unshift({
    id: Date.now().toString(36),
    name,
    priority: priorityEl.value,
    done: false,
    created_at: new Date().toISOString(),
  });
  saveProjectTasks(projectId, tasks);
  nameEl.value = '';
  renderTasksList(projectId);
  showToast('Задача добавлена');
}

function toggleTask(projectId, taskId, done){
  const tasks = getProjectTasks(projectId);
  const t = tasks.find(x=>x.id===taskId);
  if(t){ t.done = done; t.done_at = done ? new Date().toISOString() : null; }
  saveProjectTasks(projectId, tasks);
  renderTasksList(projectId);
}

function deleteTask(projectId, taskId){
  if(!confirm('Удалить задачу?')) return;
  const tasks = getProjectTasks(projectId).filter(t=>t.id!==taskId);
  saveProjectTasks(projectId, tasks);
  renderTasksList(projectId);
}

async function logAudit(entityType, entityId, entityName, action, changes){
  try{
    // Автор изменения встраивается в changes как служебный ключ _actor,
    // чтобы не менять схему таблицы audit_log.
    const payloadChanges = Object.assign({}, changes || {});
    try{
      if(typeof session !== 'undefined' && session && session.name){
        payloadChanges._actor = session.name;
      }
    }catch(e){}
    await sb.from('audit_log').insert({
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      action: action,
      changes: payloadChanges,
    });
  }catch(e){
    console.error('audit log error', e);
  }
}

function diffChanges(oldObj, newObj, fields){
  const changes = {};
  fields.forEach(f=>{
    const oldVal = oldObj ? oldObj[f] : undefined;
    const newVal = newObj[f];
    if(JSON.stringify(oldVal) !== JSON.stringify(newVal)){
      changes[f] = {old: oldVal ?? null, new: newVal ?? null};
    }
  });
  return changes;
}

