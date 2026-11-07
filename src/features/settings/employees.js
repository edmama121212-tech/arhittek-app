// ============================================================
// EMPLOYEES
// ============================================================
function renderEmployees(){
  const card = document.getElementById('employeesCard');
  let list = state.employees.slice();
  if(employeeSearchQuery.trim()){
    const q = employeeSearchQuery.trim().toLowerCase();
    list = list.filter(e=>(e.name||'').toLowerCase().includes(q) || (e.role||'').toLowerCase().includes(q));
  }
  if(!list.length){
    card.innerHTML = '<div class="empty-state">Сотрудники не найдены</div>';
    return;
  }
  card.innerHTML = list.map(e=>{
    const count = state.projects.filter(p=>p.employee_id===e.id || p.co_employee_id===e.id || (state.projectMembers||[]).some(m=>m.project_id===p.id && m.employee_id===e.id)).length;
    return `<div class="list-item">
      <div>
        <div class="li-name">${escapeHtml(e.name)}${e.active===false?' <span style="color:var(--text-dim); font-weight:400;">(архив)</span>':''}</div>
        <div class="li-meta">${escapeHtml(e.role||'')}${count?' · '+count+' проект(ов)':''}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="openEmployeeSheet('${e.id}')">✎</button>
      </div>
    </div>`;
  }).join('');
}

function populateEmployeeFormSelects(){
  // used elsewhere if needed
}

function openEmployeeSheet(id){
  if(!isOwner())return;
  employeeFormGeneration++;
  editingEmployeeId = id;
  const overlay = document.getElementById('empSheetOverlay');
  const title = document.getElementById('empSheetTitle');
  const deleteBtn = document.getElementById('ef-delete');
  const pinField = document.getElementById('ef-pin-field');
  const cardEditField = document.getElementById('ef-card-edit-field');
  const isAdmin = session && session.isAdmin;

  if(id){
    const e = state.employees.find(x=>x.id===id);
    if(!e) return;
    title.textContent = 'Редактировать сотрудника';
    deleteBtn.style.display = '';
    const linkedCount = state.projects.filter(p=>p.employee_id===id || p.co_employee_id===id || (state.projectMembers||[]).some(m=>m.project_id===p.id && m.employee_id===id)).length;
    deleteBtn.textContent = linkedCount ? 'В архив' : 'Удалить';
    deleteBtn.title = linkedCount ? 'Сохранит сотрудника в истории проектов, но уберёт из активной команды' : 'Переместить сотрудника в корзину';
    document.getElementById('ef-name').value = e.name || '';
    const roleSelect=document.getElementById('ef-role');
    roleSelect.querySelectorAll('[data-legacy-role]').forEach(el=>el.remove());
    if(e.role&&![...roleSelect.options].some(o=>o.value===e.role)){
      const option=new Option(e.role,e.role);option.dataset.legacyRole='true';roleSelect.add(option);
    }
    roleSelect.value=e.role||'Сотрудник';
    document.getElementById('ef-active').value = e.active===false ? 'false' : 'true';
    document.getElementById('ef-pin').value = '';
    document.getElementById('ef-can-edit-cards').checked = !!e.can_edit_cards;
    // Если поля can_see_* ещё не заданы явно (null) — подставляем текущее фактическое поведение по роли, как отправную точку
    document.getElementById('ef-see-projects').checked = (e.can_see_projects === null || e.can_see_projects === undefined) ? canSeeProjectsForRole(e.role) : !!e.can_see_projects;
    document.getElementById('ef-see-construction').checked = (e.can_see_construction === null || e.can_see_construction === undefined) ? canSeeConstructionForRole(e.role) : !!e.can_see_construction;
    document.getElementById('ef-is-salaried').checked = !!e.is_salaried;
    document.getElementById('ef-fixed-salary').value = e.fixed_salary ?? '';
    document.getElementById('ef-fixed-salary-row').style.display = e.is_salaried ? '' : 'none';
    pinField.style.display = isAdmin ? '' : 'none';
    if(cardEditField) cardEditField.style.display = isAdmin ? '' : 'none';
    const sectionsField = document.getElementById('ef-sections-field');
    if(sectionsField) sectionsField.style.display = isAdmin ? '' : 'none';
    const salaryField = document.getElementById('ef-salary-field');
    if(salaryField) salaryField.style.display = isAdmin ? '' : 'none';
  }else{
    title.textContent = 'Новый сотрудник';
    deleteBtn.style.display = 'none';
    deleteBtn.textContent = 'Удалить';
    document.getElementById('ef-name').value = '';
    document.getElementById('ef-role').value = 'Сотрудник';
    document.getElementById('ef-active').value = 'true';
    document.getElementById('ef-pin').value = '';
    document.getElementById('ef-can-edit-cards').checked = false;
    document.getElementById('ef-see-projects').checked = true;
    document.getElementById('ef-see-construction').checked = false;
    document.getElementById('ef-is-salaried').checked = false;
    document.getElementById('ef-fixed-salary').value = '';
    document.getElementById('ef-fixed-salary-row').style.display = 'none';
    pinField.style.display = isAdmin ? '' : 'none';
    if(cardEditField) cardEditField.style.display = isAdmin ? '' : 'none';
    const sectionsField2 = document.getElementById('ef-sections-field');
    if(sectionsField2) sectionsField2.style.display = isAdmin ? '' : 'none';
    const salaryField2 = document.getElementById('ef-salary-field');
    if(salaryField2) salaryField2.style.display = isAdmin ? '' : 'none';
  }
  document.getElementById('ef-save').disabled = employeeSavesInFlight.has(id || 'new:'+employeeFormGeneration);
  window.updateEmployeeAccessSummary?.();
  overlay.classList.add('active');
}

function closeEmployeeSheet(){
  document.getElementById('empSheetOverlay').classList.remove('active');
  editingEmployeeId = null;
}

async function saveEmployee(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  const employeeId = editingEmployeeId, generation = employeeFormGeneration;
  const saveKey = employeeId || 'new:'+generation;
  if(employeeSavesInFlight.has(saveKey)) return;
  const name = document.getElementById('ef-name').value.trim();
  if(!name){ showToast('Введите имя'); return; }
  const payload = {
    name,
    role: document.getElementById('ef-role').value.trim(),
    active: document.getElementById('ef-active').value === 'true',
  };
  const pinInput = document.getElementById('ef-pin').value.trim();
  if(session && session.isAdmin){
    if(!employeeId){
      // Новый сотрудник — PIN обязателен, иначе он не сможет войти
      if(!pinInput){ showToast('Укажите PIN-код для нового сотрудника'); return; }
      payload.pin_code = pinInput;
    }else if(pinInput){
      // Редактирование — меняем PIN, только если поле не пустое
      payload.pin_code = pinInput;
    }
    payload.can_edit_cards = document.getElementById('ef-can-edit-cards').checked;
    payload.can_see_projects = document.getElementById('ef-see-projects').checked;
    payload.can_see_construction = document.getElementById('ef-see-construction').checked;
    payload.is_salaried = document.getElementById('ef-is-salaried').checked;
    payload.fixed_salary = payload.is_salaried ? (parseFloat(document.getElementById('ef-fixed-salary').value) || 0) : 0;
  }
  if(!Number.isFinite(payload.fixed_salary)||payload.fixed_salary<0){showToast('Оклад должен быть неотрицательной суммой');return;}
  employeeSavesInFlight.add(saveKey);
  document.getElementById('ef-save').disabled = true;
  let persisted = false;
  try{
    let migrationFallback = false;
    if(employeeId){
      const before = state.employees.find(x=>x.id===employeeId);
      let auditPayload = payload;
      let {data: updatedEmployee,error} = await sb.from('employees').update(payload).eq('id', employeeId).select('id').maybeSingle();
      if(isMissingEmployeeSalaryColumn(error)){
        // Миграция 14 (оклад) не выполнена — сохраняем остальное, оклад пропускаем
        const {is_salaried, fixed_salary, ...rest} = payload;
        ({data: updatedEmployee,error} = await sb.from('employees').update(rest).eq('id', employeeId).select('id').maybeSingle());
        migrationFallback = !error;
        if(!error) auditPayload = rest;
      }
      if(error) throw error;
      if(!updatedEmployee?.id)throw new Error('Не получено подтверждение изменения сотрудника');
      persisted = true;
      // PIN никогда не попадает в историю изменений — только факт смены, без значений
      const auditKeys = Object.keys(auditPayload).filter(k => k !== 'pin_code');
      const changes = diffChanges(before, auditPayload, auditKeys);
      if(payload.pin_code) changes.pin_code = { from: '••••••', to: '••••••' };
      if(Object.keys(changes).length) await logAudit('employee', employeeId, name, 'update', changes);
    }else{
      let {data, error} = await sb.from('employees').insert(payload).select('id').single();
      if(isMissingEmployeeSalaryColumn(error)){
        const {is_salaried, fixed_salary, ...rest} = payload;
        ({data, error} = await sb.from('employees').insert(rest).select('id').single());
        migrationFallback = !error;
      }
      if(error) throw error;
      if(!data?.id) throw new Error('Не получено подтверждение создания сотрудника');
      persisted = true;
      if(employeeFormGeneration===generation) editingEmployeeId = data.id;
      await logAudit('employee', data.id, name, 'create', {});
    }
    if(employeeFormGeneration===generation){
      document.getElementById('empSheetOverlay').dataset.dirty='0';
      closeEmployeeSheet();
    }
    const refreshed=await loadAll();
    showToast(migrationFallback ? 'Сотрудник сохранён. Оклад не записан — требуется обновить базу' : refreshed===false ? 'Сотрудник сохранён. Не удалось обновить список — повторите обновление' : 'Сохранено');
  }catch(e){
    console.error(e);
    showToast(persisted ? 'Сотрудник сохранён. Не удалось обновить данные — повторите обновление' : 'Ошибка сохранения: ' + (e.message || e.hint || 'см. консоль'));
  }finally{
    employeeSavesInFlight.delete(saveKey);
    document.getElementById('ef-save').disabled=employeeSavesInFlight.has(editingEmployeeId || 'new:'+employeeFormGeneration);
  }
}

async function deleteEmployee(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  if(!editingEmployeeId) return;

  const linkedProjects = state.projects.filter(p=>
    p.employee_id===editingEmployeeId ||
    p.co_employee_id===editingEmployeeId ||
    (state.projectMembers||[]).some(m=>m.project_id===p.id && m.employee_id===editingEmployeeId)
  );
  if(linkedProjects.length){
    const names = linkedProjects.slice(0,3).map(p=>p.name).join(', ');
    const emp=state.employees.find(x=>x.id===editingEmployeeId);
    const msg='Сотрудник участвует в '+linkedProjects.length+' проект(ах)'+(names?' — '+names:'')+'.\n\nУдалять его нельзя, иначе история проектов потеряет исполнителя. Перевести сотрудника в архив вместо удаления?';
    if(confirm(msg)){
      try{
        const {error}=await sb.from('employees').update({active:false}).eq('id',editingEmployeeId);
        if(error) throw error;
        await logAudit('employee',editingEmployeeId,emp?emp.name:'','update',{active:{old:emp?.active!==false,new:false}});
        showToast('Сотрудник переведён в архив. История проектов сохранена.');
        closeEmployeeSheet();
        await loadAll();
      }catch(e){console.error(e);showToast('Не удалось перевести сотрудника в архив');}
    }
    return;
  }

  if(!confirm('Переместить сотрудника в корзину? Его можно будет восстановить.')) return;
  try{
    const emp = state.employees.find(x=>x.id===editingEmployeeId);
    const {error} = await sb.from('employees').update({deleted_at: new Date().toISOString()}).eq('id', editingEmployeeId);
    if(error) throw error;
    await logAudit('employee', editingEmployeeId, emp?emp.name:'', 'delete', {});
    showToast('Сотрудник перемещён в корзину');
    closeEmployeeSheet();
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }
}

