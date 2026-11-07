// ============================================================
// HISTORY (audit log)
// ============================================================
const auditActionLabels = {
  create: 'Создано',
  update: 'Изменено',
  delete: 'Удалено',
  restore: 'Восстановлено',
};
const auditEntityLabels = {
  project: 'Проект',
  employee: 'Сотрудник',
  category: 'Категория',
  ledger_entry: 'Запись финансов',
};
const fieldLabels = {
  name: 'Название', category_id: 'Категория', status_id: 'Статус', payment_status: 'Оплата',
  employee_id: 'Исполнитель', phone: 'Телефон', address: 'Адрес', price: 'Цена', advance: 'Аванс',
  balance: 'Остаток', expenses: 'Расходы', fee_paid: 'Выплачено гонорара', fee_percent: '% гонорара',
  fee_base: 'База гонорара', start_date: 'Дата начала', end_date: 'Дата сдачи', notes: 'Заметки',
  role: 'Роль', active: 'Активен', floors_total: 'Этажей всего', floors_done: 'Готово этажей',
  stage_notes: 'Этап', fee_base_label: 'База', department_id: 'Отдел', photo: 'Фото',
  client_name: 'Клиент', co_employee_id: 'Соисполнитель', invoice_added: 'Добавлена накладная',
};

function fmtAuditValue(field, val){
  if(val === null || val === undefined) return '—';
  if(field === 'category_id'){ const c = findCategory(val); return c?c.name:'—'; }
  if(field === 'status_id'){ const s = findStatus(val); return s?s.name:'—'; }
  if(field === 'employee_id'){ const e = findEmployee(val); return e?e.name:'—'; }
  if(field === 'department_id'){ const d = findDepartment(val); return d?d.name:'—'; }
  if(['price','advance','balance','expenses','fee_paid'].includes(field)) return fmtMoney(val);
  if(typeof val === 'boolean') return val ? 'да' : 'нет';
  return String(val);
}

// История изменений по конкретному проекту (внутри карточки)
function renderProjectHistory(projectId){
  const el = document.getElementById('pf-history-list');
  if(!el) return;
  if(!projectId){ el.innerHTML = '<div class="empty-state">Сохраните проект, чтобы вести историю</div>'; return; }
  // Берём записи, относящиеся к этому проекту (по entity_id),
  // а также ledger/накладные, где в имени фигурирует проект.
  const proj = state.projects.find(p=>p.id===projectId);
  const projName = proj ? proj.name : '';
  let list = (state.history||[]).filter(h=>{
    if(h.entity_type === 'project' && h.entity_id === projectId) return true;
    // финансовые записи логируются под своей сущностью, но имя начинается с названия проекта
    if((h.entity_type === 'ledger_entry') && projName && (h.entity_name||'').indexOf(projName) === 0) return true;
    return false;
  });
  if(!list.length){ el.innerHTML = '<div class="empty-state">Изменений пока нет</div>'; return; }
  el.innerHTML = list.slice(0,80).map(h=>{
    const action = auditActionLabels[h.action] || h.action;
    let actor = '';
    let changesHtml = '';
    if(h.changes && Object.keys(h.changes).length){
      changesHtml = Object.entries(h.changes).filter(([field])=>field!=='_actor').map(([field, vals])=>{
        const lbl = fieldLabels[field] || field;
        if(vals && typeof vals === 'object' && ('old' in vals || 'new' in vals)){
          return `${lbl}: ${escapeHtml(fmtAuditValue(field, vals.old))} → ${escapeHtml(fmtAuditValue(field, vals.new))}`;
        }
        return `${lbl}: ${escapeHtml(String(vals))}`;
      }).join('<br>');
      if(h.changes._actor) actor = h.changes._actor;
    }
    return `<div class="history-item">
      <div class="h-top">
        <span class="h-action ${h.action}">${action}</span>
        <span class="h-time">${fmtDateTime(h.created_at)}</span>
      </div>
      ${changesHtml ? `<div class="h-changes">${changesHtml}</div>` : ''}
      <div class="h-actor" style="font-size:11px;color:var(--text-dim);margin-top:4px;">✎ ${escapeHtml(actor || '—')}</div>
    </div>`;
  }).join('');
}

function renderHistory(){
  const card = document.getElementById('historyCard');
  let list = state.history.slice();
  if(historySearchQuery.trim()){
    const q = historySearchQuery.trim().toLowerCase();
    list = list.filter(h=>(h.entity_name||'').toLowerCase().includes(q));
  }
  if(!list.length){
    card.innerHTML = '<div class="empty-state">История пуста</div>';
    return;
  }
  card.innerHTML = list.slice(0,50).map(h=>{
    const action = auditActionLabels[h.action] || h.action;
    const entity = auditEntityLabels[h.entity_type] || h.entity_type;
    let actor = '';
    let changesHtml = '';
    if(h.changes && Object.keys(h.changes).length){
      changesHtml = Object.entries(h.changes).filter(([field])=>field!=='_actor').map(([field, vals])=>{
        const lbl = fieldLabels[field] || field;
        return `${lbl}: ${escapeHtml(fmtAuditValue(field, vals.old))} → ${escapeHtml(fmtAuditValue(field, vals.new))}`;
      }).join('<br>');
      if(h.changes._actor) actor = h.changes._actor;
    }
    return `<div class="history-item">
      <div class="h-top">
        <span class="h-action ${h.action}">${action}</span>
        <span class="h-time">${fmtDateTime(h.created_at)}</span>
      </div>
      <div class="h-entity">${entity}: ${escapeHtml(h.entity_name||'')}</div>
      ${changesHtml ? `<div class="h-changes">${changesHtml}</div>` : ''}
      ${actor ? `<div class="h-actor" style="font-size:11px;color:var(--text-dim);margin-top:4px;">✎ ${escapeHtml(actor)}</div>` : ''}
    </div>`;
  }).join('');
}

