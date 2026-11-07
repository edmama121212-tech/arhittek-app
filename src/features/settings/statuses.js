// ============================================================
// STATUSES (view only + reorder not needed, simple list)
// ============================================================
function renderStatuses(){
  const card = document.getElementById('statusesCard');
  if(!state.statuses.length){
    card.innerHTML = '<div class="empty-state">Нет статусов</div>';
    return;
  }
  card.innerHTML = state.statuses.map(s=>{
    const count = state.projects.filter(p=>p.status_id===s.id).length;
    return `<div class="list-item">
      <div>
        <span class="status-chip" data-status="${escapeHtml(s.name)}" style="margin-top:0;">${escapeHtml(s.name)}</span>
      </div>
      <div class="li-meta">${count} проект(ов)</div>
    </div>`;
  }).join('');
}

