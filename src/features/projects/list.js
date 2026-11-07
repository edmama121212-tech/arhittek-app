// ============================================================
// PROJECTS VIEW
// ============================================================
function renderCategoryFilters(){
  const el = document.getElementById('categoryFilters');
  const constrDept = state.departments.find(d=>d.name==='Строительный отдел');
  // Only show non-construction categories in the projects filter
  const cats = state.categories.filter(c=>{
    if(constrDept && c.department_id === constrDept.id) return false;
    const nm = (c.name||'').toLowerCase();
    if(nm.includes('строительств') || nm.includes('ремонт') || nm.includes('монтаж')) return false;
    return true;
  });
  let html = `<div class="filter-chip ${activeCategoryFilter==='all'?'active':''}" data-cat="all">Все категории</div>`;
  cats.forEach(c=>{
    html += `<div class="filter-chip ${activeCategoryFilter===c.id?'active':''}" data-cat="${c.id}">${escapeHtml(c.name)}</div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('.filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      activeCategoryFilter = chip.dataset.cat;
      renderCategoryFilters();
      renderProjects();
    });
  });
}

function renderStatusFilters(){
  const el = document.getElementById('statusFilters');
  let html = `<div class="filter-chip ${activeStatusFilter==='all'?'active':''}" data-st="all">Любой статус</div>`;
  state.statuses.forEach(s=>{
    html += `<div class="filter-chip ${activeStatusFilter===s.id?'active':''}" data-st="${s.id}">${escapeHtml(s.name)}</div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('.filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      activeStatusFilter = chip.dataset.st;
      renderStatusFilters();
      renderProjects();
    });
  });
}

function renderPaymentFilters(){
  const el = document.getElementById('paymentFilters');
  el.querySelectorAll('.filter-chip').forEach(chip=>{
    chip.classList.toggle('active', chip.dataset.pay === activePaymentFilter);
  });
}

function renderEmployeeFilters(){
  const el = document.getElementById('employeeFilters');
  if(session && !session.isAdmin){
    // Executors only see their own projects — no employee filter needed
    el.innerHTML = '';
    return;
  }
  let html = `<div class="filter-chip ${activeEmployeeFilter==='all'?'active':''}" data-emp="all">Все исполнители</div>`;
  html += `<div class="filter-chip ${activeEmployeeFilter==='none'?'active':''}" data-emp="none">Без исполнителя</div>`;
  state.employees.filter(e=>e.active!==false).forEach(e=>{
    html += `<div class="filter-chip ${activeEmployeeFilter===e.id?'active':''}" data-emp="${e.id}">${escapeHtml(e.name)}</div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('.filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      activeEmployeeFilter = chip.dataset.emp;
      renderEmployeeFilters();
      renderProjects();
    });
  });
}

function paymentBadgeColor(status){
  if(status === 'Оплачен') return {bg:'rgba(111,174,140,0.18)', fg:'var(--green)'};
  if(status === 'Частично оплачен') return {bg:'rgba(232,163,61,0.18)', fg:'var(--gold)'};
  return {bg:'rgba(217,104,79,0.18)', fg:'var(--red)'};
}

function renderProjects(){
  const constrDept = state.departments.find(d=>d.name==='Строительный отдел');

  // A project is a CONSTRUCTION OBJECT if its category belongs to Строительный отдел
  // OR its category name contains "Строительство" / "Ремонт"
  const isConstrObject = (p)=>{
    const cat = findCategory(p.category_id);
    if(!cat) return false;
    if(constrDept && cat.department_id === constrDept.id) return true;
    const nm = (cat.name||'').toLowerCase();
    return nm.includes('строительств') || nm.includes('ремонт') || nm.includes('монтаж');
  };

  // "Проектный" shows everything that is NOT a construction object
  const isProjectItem = (p) => !isConstrObject(p);

  let list;
  if(session && !session.isAdmin){
    list = state.projects.filter(p=> isProjectItem(p) && isProjectMember(p.id));
  }else{
    list = state.projects.filter(isProjectItem);
  }

  if(activeCategoryFilter !== 'all') list = list.filter(p=>p.category_id === activeCategoryFilter);
  if(activeStatusFilter !== 'all') list = list.filter(p=>p.status_id === activeStatusFilter);
  if(activePaymentFilter !== 'all') list = list.filter(p=>(p.payment_status||'Ждём оплату') === activePaymentFilter);
  const hasAnyAssignedEmployee = p => !!(p.employee_id || p.co_employee_id || (state.projectMembers||[]).some(m=>m.project_id===p.id));
  const employeeParticipates = (p, employeeId) => p.employee_id === employeeId || p.co_employee_id === employeeId || (state.projectMembers||[]).some(m=>m.project_id===p.id && m.employee_id===employeeId);
  if(activeEmployeeFilter === 'none') list = list.filter(p=>!hasAnyAssignedEmployee(p));
  else if(activeEmployeeFilter !== 'all') list = list.filter(p=>employeeParticipates(p, activeEmployeeFilter));

  if(projectSearchQuery.trim()){
    const q = projectSearchQuery.trim().toLowerCase();
    list = list.filter(p=>{
      return (p.name||'').toLowerCase().includes(q) ||
             (p.address||'').toLowerCase().includes(q) ||
             (p.phone||'').toLowerCase().includes(q) ||
             (p.client_name||'').toLowerCase().includes(q) ||
             (p.notes||'').toLowerCase().includes(q);
    });
  }

  // Сортировка: активные проекты — первыми (по ближайшей дате окончания),
  // затем завершённые — по дате завершения (сначала недавно завершённые).
  const doneStatusForSort = state.statuses.find(s=>s.name==='Завершён');
  list = list.slice().sort((a,b)=>{
    const aDone = doneStatusForSort && a.status_id === doneStatusForSort.id;
    const bDone = doneStatusForSort && b.status_id === doneStatusForSort.id;
    if(aDone !== bDone) return aDone ? 1 : -1; // активные выше завершённых
    if(!aDone){
      // среди активных — у кого раньше срок, тот выше; без срока — в конец
      if(!a.end_date && !b.end_date) return 0;
      if(!a.end_date) return 1;
      if(!b.end_date) return -1;
      return a.end_date.localeCompare(b.end_date);
    }else{
      // среди завершённых — недавно завершённые выше
      return (b.end_date||'').localeCompare(a.end_date||'');
    }
  });

  const card = document.getElementById('projectsCard');
  if(!list.length){
    const isFiltered = activeCategoryFilter !== 'all' || activeStatusFilter !== 'all' || activePaymentFilter !== 'all' || activeEmployeeFilter !== 'all' || projectSearchQuery.trim();
    card.innerHTML = `<div class="empty-state">
      ${isFiltered
        ? 'Нет проектов по этому фильтру'
        : '<div style="font-size:32px;margin-bottom:10px;">📋</div><div>Проектов пока нет</div><button class="btn btn-primary" style="margin-top:14px;width:auto;padding:10px 24px;" onclick="openProjectSheet(null)">+ Создать первый проект</button>'}
    </div>`;
    return;
  }

  // Group projects without an assigned executor into a separate section
  // (only when not already filtering by a specific employee)
  if(activeEmployeeFilter === 'all'){
    const withEmp = list.filter(p=>hasAnyAssignedEmployee(p));
    const withoutEmp = list.filter(p=>!hasAnyAssignedEmployee(p));
    let html = withEmp.map(renderProjectRow).join('');
    if(withoutEmp.length){
      html += `<div class="section-label" style="margin:14px 0 10px;"><span class="lbl-text">Без исполнителя</span><span class="section-label-line"></span></div>`;
      html += withoutEmp.map(renderProjectRow).join('');
    }
    card.innerHTML = html || '<div class="empty-state">Нет проектов по этому фильтру</div>';
  }else{
    card.innerHTML = list.map(renderProjectRow).join('');
  }
}

function renderProjectRow(p){
    const cat = findCategory(p.category_id);
    const st = findStatus(p.status_id);
    const emp = findEmployee(p.employee_id);
    const d = p.end_date ? daysUntil(p.end_date) : null;
    const payStatus = p.payment_status || 'Ждём оплату';
    const payColor = paymentBadgeColor(payStatus);
    const isDone = st && st.name === 'Завершён';
    const frozen = isFrozen(p);

    let metaParts = [];
    if(cat) metaParts.push(escapeHtml(cat.name));
    if(p.client_name) metaParts.push('👤 '+escapeHtml(p.client_name));
    if(emp) metaParts.push(escapeHtml(emp.name));
    const coEmp = findEmployee(p.co_employee_id);
    if(coEmp) metaParts.push('+ '+escapeHtml(coEmp.name));
    if(p.address) metaParts.push(escapeHtml(p.address));

    let statusChips = '';
    if(st){
      statusChips += `<span class="status-chip" data-status="${escapeHtml(st.name)}">${escapeHtml(st.name)}</span>`;
    }
    statusChips += `<span class="status-chip" style="background:${payColor.bg}; color:${payColor.fg};">${escapeHtml(payStatus)}</span>`;
    if(!frozen && d !== null && d < 0 && !isDone){
      statusChips += `<span class="status-chip overdue">просрочен ${Math.abs(d)} дн.</span>`;
    } else if(!frozen && d !== null && d >= 0 && d <= 7 && !isDone){
      statusChips += `<span class="status-chip" data-status="Ждём оплату">${d} дн. до сдачи</span>`;
    }
    const overdueStages = frozen ? [] : state.projectStages.filter(s=>s.project_id===p.id && !s.done && s.due_date && daysUntil(s.due_date)<0);
    if(overdueStages.length && !isDone){
      statusChips += `<span class="status-chip overdue">⚠ этап просрочен (${overdueStages.length})</span>`;
    }

    const balance = Number(p.balance) || 0;
    const showFinance = !session || session.isAdmin;

    // Завершённые и замороженные — приглушённый вид
    const rowStyle = (isDone || frozen) ? 'opacity:0.55;' : '';
    const donePrefix = isDone ? '✓ ' : (frozen ? '❄ ' : '');

    return `<div class="proj-row" onclick="openProjectSheet('${p.id}')" style="${rowStyle}">
      <div>
        <div class="proj-name" title="${escapeHtml(p.name)}">${donePrefix}${escapeHtml(p.name)}</div>
        <div class="proj-meta">${metaParts.join(' · ')}</div>
        ${statusChips}
      </div>
      ${showFinance ? `<div class="proj-right">
        <div class="proj-sum">${fmtMoney(p.price)}</div>
        <div class="proj-rest ${balance>0&&!isDone?'has-balance':''}">${balance>0&&!isDone ? 'остаток '+fmtMoney(balance) : '✓ закрыт'}</div>
      </div>` : ''}
    </div>`;
}

