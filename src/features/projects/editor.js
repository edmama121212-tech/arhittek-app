// ============================================================
// PROJECT SHEET (create / edit)
// ============================================================
function populateProjectFormSelects(){
  const catSel = document.getElementById('pf-category');
  const prevCat = catSel.value;
  catSel.innerHTML = state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if(prevCat && state.categories.some(c=>c.id===prevCat)) catSel.value = prevCat;

  const stSel = document.getElementById('pf-status');
  const prevSt = stSel.value;
  const allowedStatuses = ['Запись', 'В процессе', 'Завершён', 'Заморожен'];
  // Порядок отображения фиксированный, чтобы «Заморожен» шёл последним
  stSel.innerHTML = allowedStatuses
    .map(nm => state.statuses.find(s=>s.name===nm))
    .filter(Boolean)
    .map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if(prevSt && state.statuses.some(s=>s.id===prevSt)) stSel.value = prevSt;

  const empSel = document.getElementById('pf-employee');
  const prevEmp = empSel.value;
  const empOptions = '<option value="">—</option>' + state.employees.filter(e=>e.active!==false).map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  empSel.innerHTML = empOptions;
  if(prevEmp && state.employees.some(e=>e.id===prevEmp)) empSel.value = prevEmp;

  const coEmpSel = document.getElementById('pf-co-employee');
  const prevCoEmp = coEmpSel.value;
  coEmpSel.innerHTML = empOptions;
  if(prevCoEmp && state.employees.some(e=>e.id===prevCoEmp)) coEmpSel.value = prevCoEmp;

  const feeEmpSel = document.getElementById('pf-employee-fee');
  if(feeEmpSel){ feeEmpSel.innerHTML = empOptions; feeEmpSel.value = empSel.value || ''; }
  const feeCoEmpSel = document.getElementById('pf-co-employee-fee');
  if(feeCoEmpSel){ feeCoEmpSel.innerHTML = empOptions; feeCoEmpSel.value = coEmpSel.value || ''; }

  // Заполняем список для добавления доп. участников
  const membersAdd = document.getElementById('pf-members-add');
  if(membersAdd){
    membersAdd.innerHTML = '<option value="">+ Добавить участника</option>' +
      state.employees.filter(e=>e.active!==false).map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  }
}

// When category changes, auto-select its department (categories belong to one department)
document.addEventListener('change', (e)=>{
  if(e.target && e.target.id === 'pf-category'){
    const cat = findCategory(e.target.value);
    if(cat && cat.department_id){
      document.getElementById('pf-department').value = cat.department_id;
    }
  }
});

// Recalculate "Остаток" and fee summary live when relevant fields change
document.getElementById('pf-category').addEventListener('change', ()=>{
  if(editingProjectId) return;
  const cat=findCategory(document.getElementById('pf-category').value),name=(cat?.name||'').toLowerCase();
  const arch=name.includes('архитект')||name.includes('ландшафт');
  document.getElementById('pf-compensation-method').value=name.includes('интерьер')?'m2':arch?'percent_profit':(cat?.fee_base==='profit'?'percent_profit':'percent_price');
  document.getElementById('pf-feepercent').value=isConstructionCategory(cat?.id)?15:(cat?.fee_percent??(arch?40:''));
  document.getElementById('pf-department').value=cat?.department_id||'';
  renderCompensationMethodUI();
});

function recalcLiveFeeSummary(){
  if(!editingProjectId) return;
  const p = state.projects.find(x=>x.id===editingProjectId);
  if(!p) return;
  const live = {
    ...p,
    price: parseFloat(document.getElementById('pf-price').value) || 0,
    expenses: parseFloat(document.getElementById('pf-expenses').value) || 0,
    fee_percent: document.getElementById('pf-feepercent').value === '' ? null : parseFloat(document.getElementById('pf-feepercent').value),
    fee_base: (document.getElementById('pf-compensation-method')?.value === 'm2' ? 'm2' : (document.getElementById('pf-feebase').value || 'price')),
    fee_paid: parseFloat(document.getElementById('pf-feepaid').value) || 0,
    co_employee_id: document.getElementById('pf-co-employee').value || null,
    co_fee_percent: document.getElementById('pf-co-feepercent').value === '' ? null : parseFloat(document.getElementById('pf-co-feepercent').value),
    co_fee_paid: parseFloat(document.getElementById('pf-co-feepaid').value) || 0,
  };
  if(document.getElementById('pf-compensation-method')?.value === 'm2'){ renderM2CompensationSummary(p); } else { renderFeeSummaryForProject(live); }
}


document.getElementById('pf-price').addEventListener('input', ()=>{
  const price = parseFloat(document.getElementById('pf-price').value) || 0;
  const advance = parseFloat(document.getElementById('pf-advance').value) || 0;
  document.getElementById('pf-balance').value = Math.max(0, price - advance);
  recalcLiveFeeSummary();
});
['pf-expenses','pf-feepercent','pf-feebase','pf-feepaid','pf-co-employee','pf-co-feepercent','pf-co-feepaid'].forEach(id=>{
  document.getElementById(id).addEventListener('input', recalcLiveFeeSummary);
  document.getElementById(id).addEventListener('change', recalcLiveFeeSummary);
});

// Хранилище участников текущего редактируемого проекта
let currentProjectMembers = []; // [{employee_id}]
let projectMembersDraftUnverified = false;

function renderProjectMemberChips(){
  const list = document.getElementById('pf-members-list');
  if(!list) return;
  const unknown=!!state.projectMembersDataError||projectMembersDraftUnverified;
  const add=document.getElementById('pf-members-add');if(add)add.disabled=unknown;
  const warning=unknown?'<div class="hint" role="alert" style="margin-bottom:8px;color:var(--gold);">Не удалось обновить состав команды. Показаны прежние данные. Обновите приложение перед изменением команды.</div>':'';
  list.innerHTML = warning+currentProjectMembers.map(m=>{
    const emp = findEmployee(m.employee_id);
    return `<div style="display:inline-flex;align-items:center;gap:4px;background:rgba(0,113,235,0.15);border:1px solid rgba(0,113,235,0.3);border-radius:20px;padding:3px 10px 3px 8px;font-size:12px;">
      ${escapeHtml(emp?emp.name:m.employee_id)}
      <span onclick="removeProjectMember('${m.employee_id}')" style="cursor:pointer;opacity:0.6;font-size:14px;line-height:1;">×</span>
    </div>`;
  }).join('');
}

function removeProjectMember(empId){
  if(state.projectMembersDataError||projectMembersDraftUnverified){showToast('Состав команды не загружен. Обновите приложение перед изменением команды.');return;}
  currentProjectMembers = currentProjectMembers.filter(m=>m.employee_id!==empId);
  renderProjectMemberChips();
}

document.addEventListener('change', (e)=>{
  if(e.target && e.target.id==='pf-members-add' && e.target.value){
    if(state.projectMembersDataError||projectMembersDraftUnverified){e.target.value='';showToast('Состав команды не загружен. Обновите приложение перед изменением команды.');return;}
    const empId = e.target.value;
    if(!currentProjectMembers.some(m=>m.employee_id===empId)){
      currentProjectMembers.push({employee_id: empId});
      renderProjectMemberChips();
    }
    e.target.value = '';
  }
});

function openProjectSheet(id){
  if(id&&!isProjectMember(id)){showToast("Нет доступа к этому проекту");return;}
  editingProjectId = id;
  projectMembersDraftUnverified=!!state.projectMembersDataError;
  const overlay = document.getElementById('projectSheetOverlay');
  const title = document.getElementById('projectSheetTitle');
  const deleteBtn = document.getElementById('pf-delete');

  if(id){
    const p = state.projects.find(x=>x.id===id);
    if(!p) return;
    editingProjectLoadedAt = p.updated_at || null;
    title.textContent = 'Редактировать проект';
    deleteBtn.style.display = '';
    document.getElementById('pf-name').value = p.name || '';
    document.getElementById('pf-category').value = p.category_id || '';
    document.getElementById('pf-status').value = p.status_id || '';
    document.getElementById('pf-payment').value = p.payment_status || 'Ждём оплату';
    const cat = findCategory(p.category_id);
    document.getElementById('pf-department').value = cat ? (cat.department_id || '') : '';
    document.getElementById('pf-employee').value = p.employee_id || '';
    document.getElementById('pf-co-employee').value = p.co_employee_id || '';
    // Загружаем доп. участников
    currentProjectMembers = (state.projectMembers||[]).filter(m=>m.project_id===id).map(m=>({employee_id:m.employee_id}));
    renderProjectMemberChips();
    document.getElementById('pf-phone').value = p.phone || '';
    document.getElementById('pf-address').value = p.address || '';
    document.getElementById('pf-price').value = p.price ?? '';
    document.getElementById('pf-advance').value = p.advance ?? '';
    document.getElementById('pf-balance').value = p.balance ?? '';
    document.getElementById('pf-area').value = p.area ?? '';
    document.getElementById('pf-expenses').value = p.expenses ?? '';
    document.getElementById('pf-feepaid').value = p.fee_paid ?? '';
    document.getElementById('pf-feepercent').value = p.fee_percent ?? '';
    document.getElementById('pf-feebase').value = p.fee_base || '';
    const compMethod = document.getElementById('pf-compensation-method'); if(compMethod) compMethod.value = p.fee_base === 'm2' ? 'm2' : (p.fee_base === 'profit' ? 'percent_profit' : 'percent_price');
    const feeEmp = document.getElementById('pf-employee-fee'); if(feeEmp) feeEmp.value = p.employee_id || '';
    const feeCoEmp = document.getElementById('pf-co-employee-fee'); if(feeCoEmp) feeCoEmp.value = p.co_employee_id || '';
    document.getElementById('pf-co-feepercent').value = p.co_fee_percent ?? '';
    document.getElementById('pf-co-feepaid').value = p.co_fee_paid ?? '';
    document.getElementById('pf-start').value = p.start_date || '';
    document.getElementById('pf-end').value = p.end_date || '';
    document.getElementById('pf-notes').value = p.notes || '';
    document.getElementById('pf-client-name').value = p.client_name || '';
    renderTzList(id);
    document.getElementById('pf-tz-create').style.display = '';
    renderKpListForProject(id);
    document.getElementById('pf-create-kp').style.display = '';
    renderPaymentHistory(id);
    renderProjectExpenses(id);
    renderProjectRolePayouts(id);
    const expAddRow = document.getElementById('pf-expense-add-row'); if(expAddRow) expAddRow.style.display = 'flex';
    renderFeeSummaryForProject(p);
    renderStagesList(id);
    renderTasksList(id);

    // Кнопка добавления задачи
    const addTaskBtn = document.getElementById('pf-task-add-btn');
    if(addTaskBtn){
      addTaskBtn.onclick = () => addTask(id);
    }
    // Кнопка «Накладные, материалы, фото» — только для строительных объектов.
    // Для Архитектуры и Дизайна интерьера она не нужна.
    const isConstr = isConstructionProject(p);
    document.getElementById('pf-open-as-object').style.display = isConstr ? '' : 'none';
    if(isConstr){
      const financials=getConstructionFinancials(p);
      document.getElementById('pf-advance').value=financials.received;
      document.getElementById('pf-balance').value=financials.balance;
    }
    // Для строительных объектов расходы считаются из накладных (вкладка «Стройка»),
    // а не из этого списка — прячем блок, чтобы не путал устаревшим/нерелевантным числом.
    const expBlock = document.getElementById('pf-expenses-block');
    if(expBlock){
      expBlock.style.display = isConstr ? 'none' : '';
      const expField = document.getElementById('pf-expenses');
      if(expField){
        expField.value = isConstr ? getProjectExpenses(p) : (p.expenses ?? '');
        expField.title = isConstr ? 'Считается из накладных объекта (вкладка «Стройка»)' : 'Складывается из списка расходов ниже';
      }
    }

    // История изменений по проекту
    renderProjectHistory(id);
    const histToggle = document.getElementById('pf-history-toggle');
    const histList = document.getElementById('pf-history-list');
    if(histToggle && histList){
      histList.style.display = 'none';
      histToggle.textContent = '📋 Показать историю изменений';
      histToggle.onclick = function(){
        const shown = histList.style.display !== 'none';
        histList.style.display = shown ? 'none' : '';
        histToggle.textContent = shown ? '📋 Показать историю изменений' : '📋 Скрыть историю изменений';
        if(!shown) renderProjectHistory(id);
      };
    }
  }else{
    editingProjectLoadedAt = null;
    title.textContent = 'Новый проект';
    deleteBtn.style.display = 'none';
    document.getElementById('pf-name').value = '';
    document.getElementById('pf-category').selectedIndex = 0;
    document.getElementById('pf-status').selectedIndex = 0;
    document.getElementById('pf-payment').value = 'Ждём оплату';
    const firstCat = state.categories[0];
    document.getElementById('pf-department').value = firstCat ? (firstCat.department_id || '') : '';
    document.getElementById('pf-co-employee').value = '';
    currentProjectMembers = [];
    renderProjectMemberChips();
    document.getElementById('pf-employee').value = (session && !session.isAdmin) ? session.employeeId : '';
    document.getElementById('pf-phone').value = '';
    document.getElementById('pf-address').value = '';
    document.getElementById('pf-price').value = '';
    document.getElementById('pf-advance').value = '';
    document.getElementById('pf-balance').value = '';
    document.getElementById('pf-area').value = '';
    document.getElementById('pf-expenses').value = '';
    document.getElementById('pf-m2-payouts-list').innerHTML = '<div class="empty-state" style="padding:10px;">Сохраните проект, чтобы начислять исполнителям</div>';
    updateCompanyRemainderField(null);
    document.getElementById('pf-feepaid').value = '';
    document.getElementById('pf-feepercent').value = isConstructionCategory(firstCat?.id)?15:(firstCat?.fee_percent ?? '');
    document.getElementById('pf-feebase').value = '';
    const compMethod0 = document.getElementById('pf-compensation-method'); if(compMethod0) compMethod0.value = firstCat?.fee_base === 'm2' ? 'm2' : (firstCat?.fee_base === 'profit' ? 'percent_profit' : 'percent_price');
    document.getElementById('pf-co-feepercent').value = '';
    document.getElementById('pf-co-feepaid').value = '';
    document.getElementById('pf-start').value = '';
    document.getElementById('pf-end').value = '';
    document.getElementById('pf-notes').value = '';
    document.getElementById('pf-client-name').value = '';
    document.getElementById('pf-tz-list').innerHTML = '<div class="empty-state">Сохраните проект, чтобы создать ТЗ</div>';
    document.getElementById('pf-tz-create').style.display = 'none';
    document.getElementById('pf-kp-list').innerHTML = '<div class="empty-state">Сохраните проект, чтобы создать КП</div>';
    document.getElementById('pf-create-kp').style.display = 'none';
    document.getElementById('pf-payment-history').innerHTML = '';
    document.getElementById('pf-expenses-list').innerHTML = '';
    { const r = document.getElementById('pf-expense-add-row'); if(r) r.style.display = 'none'; }
    document.getElementById('pf-fee-summary').innerHTML = '';
    renderStagesList(null);
    renderTasksList(null);
    document.getElementById('pf-open-as-object').style.display = 'none';
    const histList0 = document.getElementById('pf-history-list');
    if(histList0){ histList0.style.display = 'none'; histList0.innerHTML = '<div class="empty-state">Сохраните проект, чтобы вести историю</div>'; }
  }

  overlay.classList.add('active');
  applyRole();
  bindCompensationUI();
  renderCompensationMethodUI();
}


function closeProjectSheet(){
  document.getElementById('projectSheetOverlay').classList.remove('active');
  projectMembersDraftUnverified=false;
  editingProjectId = null;
  editingProjectLoadedAt = null;
}

let projectSaveInFlight=false;
async function saveProject(){
  if(projectSaveInFlight) return;
  if(state.projectMembersDataError||projectMembersDraftUnverified){showToast('Состав команды не загружен. Обновите приложение перед сохранением проекта.');return;}
  const wantedMemberIds=[...new Set(currentProjectMembers.map(m=>m.employee_id).filter(Boolean))];
  const price = parseFloat(document.getElementById('pf-price').value) || 0;
  const advance = parseFloat(document.getElementById('pf-advance').value) || 0;

  if(price < 0 || advance < 0){
    showToast('Сумма не может быть отрицательной');
    return;
  }

  const addressInput = document.getElementById('pf-address').value.trim();
  if(addressInput){
    const normalize = s => (s||'').trim().toLowerCase().replace(/\s+/g,' ');
    const dupe = state.projects.find(p =>
      p.id !== editingProjectId &&
      !p.deleted_at &&
      normalize(p.address) === normalize(addressInput)
    );
    if(dupe){
      const proceed = confirm(`Объект с адресом «${addressInput}» уже есть в системе («${dupe.name}»). Всё равно создать ещё один?`);
      if(!proceed) return;
    }
  }

  const categoryId = document.getElementById('pf-category').value || null;
  const existingProject = editingProjectId ? state.projects.find(p=>p.id===editingProjectId) : null;
  const draftProject = existingProject ? {...existingProject, category_id: categoryId, price} : {category_id: categoryId, price};
  const isConstr = existingProject ? isConstructionProject(draftProject) : isConstructionCategory(categoryId);
  const directExpensesInput = parseFloat(document.getElementById('pf-expenses').value) || 0;

  const payload = {
    name: document.getElementById('pf-name').value.trim(),
    category_id: categoryId,
    status_id: document.getElementById('pf-status').value || null,
    payment_status: document.getElementById('pf-payment').value || 'Ждём оплату',
    employee_id: (document.getElementById('pf-employee-fee')?.value || document.getElementById('pf-employee').value || null),
    co_employee_id: (document.getElementById('pf-co-employee-fee')?.value || document.getElementById('pf-co-employee').value || null),
    phone: document.getElementById('pf-phone').value.trim(),
    address: document.getElementById('pf-address').value.trim(),
    price: price,
    advance: advance,
    area: document.getElementById('pf-area').value === '' ? null : parseFloat(document.getElementById('pf-area').value),
    fee_paid: parseFloat(document.getElementById('pf-feepaid').value) || 0,
    fee_percent: document.getElementById('pf-feepercent').value === '' ? null : parseFloat(document.getElementById('pf-feepercent').value),
    fee_base: (document.getElementById('pf-compensation-method')?.value === 'm2' ? 'm2' : (document.getElementById('pf-compensation-method')?.value === 'percent_profit' ? 'profit' : 'price')),
    co_fee_percent: document.getElementById('pf-co-feepercent').value === '' ? null : parseFloat(document.getElementById('pf-co-feepercent').value),
    co_fee_paid: parseFloat(document.getElementById('pf-co-feepaid').value) || 0,
    start_date: document.getElementById('pf-start').value || null,
    end_date: document.getElementById('pf-end').value || null,
    notes: document.getElementById('pf-notes').value.trim(),
    client_name: document.getElementById('pf-client-name').value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  // Остаток проекта — производное значение. Для стройки он считается из
  // фактических приходов/прямых оплат/расходов после сохранения и никогда
  // не перезаписывается общей формулой price - advance.
  if(!isConstr){
    payload.balance = Math.max(0, price - advance);
    payload.expenses = Math.max(0, directExpensesInput);
  }

  if((payload.expenses||0) < 0 || payload.fee_paid < 0 || payload.co_fee_paid < 0){
    showToast('Сумма не может быть отрицательной');
    return;
  }

  // Actual completion is stamped by the server. end_date is the planned deadline.

  if([payload.fee_percent,payload.co_fee_percent].some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>100))||(Number(payload.fee_percent)||0)+(Number(payload.co_fee_percent)||0)>100){showToast('Сумма долей должна быть от 0 до 100%');return;}
  if(payload.area!==null&&(!Number.isFinite(payload.area)||payload.area<0)){showToast('Площадь не может быть отрицательной');return;}
  if(!payload.name){
    showToast('Введите название проекта');
    return;
  }

  projectSaveInFlight=true;
  let mainRecordSaved=false;
  try{
    let savedProjectId = editingProjectId;
    if(editingProjectId){
      const before = state.projects.find(p=>p.id===editingProjectId);

      let updateQuery = sb.from('projects').update(payload).eq('id', editingProjectId);
      if(editingProjectLoadedAt){
        // Оптимистичная блокировка: сохраняем, только если запись не менялась
        // с момента открытия карточки этим пользователем
        updateQuery = updateQuery.eq('updated_at', editingProjectLoadedAt);
      }
      const { data: updatedRows, error } = await updateQuery.select('id');
      if(error) throw error;

      if(editingProjectLoadedAt && (!updatedRows || updatedRows.length === 0)){
        showToast('Данные обновились, перезагрузите карточку и попробуйте снова');
        return;
      }
      editingProjectLoadedAt=payload.updated_at;mainRecordSaved=true;
      const changes = diffChanges(before, payload, Object.keys(payload).filter(k=>k!=='updated_at'));
      if(Object.keys(changes).length){
        await logAudit('project', editingProjectId, payload.name, 'update', changes);
      }
      showToast('Проект обновлён');
    }else{
      const {data, error} = await sb.from('projects').insert(payload).select().single();
      if(error) throw error;
      savedProjectId = data.id;
      editingProjectId=data.id;editingProjectLoadedAt=payload.updated_at;mainRecordSaved=true;
      await logAudit('project', data.id, payload.name, 'create', {});
      showToast('Проект добавлен');
    }
    // Для строительного объекта баланс и расходы — производные значения.
    // Пересчитываем их только после успешного сохранения основной записи.
    if(savedProjectId && isConstr){
      await loadAll();
      const saved = state.projects.find(x=>x.id===savedProjectId);
      if(saved){
        const fin = getConstructionFinancials(saved);
        const financialUpdatedAt=new Date().toISOString();
        const {error: finErr} = await sb.from('projects').update({
          expenses: fin.directCosts,
          advance: fin.received,
          balance: fin.balance,
          updated_at: financialUpdatedAt
        }).eq('id', savedProjectId);
        if(finErr) throw finErr;
        editingProjectLoadedAt=financialUpdatedAt;
      }
    }

    // Добавляем новых участников до удаления прежних: сбой вставки не стирает команду.
    if(savedProjectId){
      if(state.projectMembersDataError||projectMembersDraftUnverified)throw new Error('Состав команды не загружен. Обновите приложение перед изменением команды.');
      const previous=(state.projectMembers||[]).filter(m=>m.project_id===savedProjectId);
      const previousIds=new Set(previous.map(m=>m.employee_id));
      const addIds=wantedMemberIds.filter(id=>!previousIds.has(id));
      const removeIds=previous.filter(m=>!wantedMemberIds.includes(m.employee_id)).map(m=>m.employee_id);
      let added=[];
      if(addIds.length){
        const result=await sb.from('project_members').insert(addIds.map(employee_id=>({project_id:savedProjectId,employee_id}))).select('id');
        if(result.error) throw result.error;
        added=result.data||[];
      }
      if(removeIds.length){
        const result=await sb.from('project_members').delete().eq('project_id',savedProjectId).in('employee_id',removeIds);
        if(result.error){
          if(added.length){
            const rollback=await sb.from('project_members').delete().in('id',added.map(m=>m.id));
            if(rollback.error) console.error('Не удалось отменить добавление участников',rollback.error);
          }
          throw result.error;
        }
      }
      state.projectMembers=[...(state.projectMembers||[]).filter(m=>m.project_id!==savedProjectId),
        ...previous.filter(m=>wantedMemberIds.includes(m.employee_id)),
        ...added.map((m,i)=>({...m,project_id:savedProjectId,employee_id:addIds[i]}))];
    }
    closeProjectSheet();
    await loadAll();
  }catch(e){
    console.error(e);
    showToast(mainRecordSaved?'Основные данные сохранены. Проверьте команду и повторите сохранение.':'Ошибка сохранения');
  }finally{projectSaveInFlight=false;}
}

async function deleteProject(){
  if(!editingProjectId) return;
  try{
    const p = state.projects.find(x=>x.id===editingProjectId);
    const {error} = await sb.from('projects').update({deleted_at: new Date().toISOString()}).eq('id', editingProjectId);
    if(error) throw error;
    await logAudit('project', editingProjectId, p ? p.name : '', 'delete', {});
    showToast('Проект перемещён в корзину');
    closeProjectSheet();
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }
}

