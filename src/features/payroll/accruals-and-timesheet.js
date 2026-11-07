// ============================================================
// ЗАРАБОТОК ПО ЗАКОНЧЕННЫМ ПРОЕКТАМ — общий расчёт, используется и в
// табеле по сотрудникам, и в финансовой сводке компании (Обзор).
// Считаем только проекты со статусом «Завершён», привязывая их к периоду
// по фактической дате завершения; старые записи сохраняют исторический период.
// Гонорар сотрудника считается как обычно (через getProjectFee), но для
// сотрудников с фиксированной ЗП (is_salaried) реальная выплата — это
// min(фикс. ЗП, заработано), а разница остаётся в прибыли компании.
// ============================================================
function timesheetProjectRefDate(p){
  return ARHITTEKBudget.completionDate(state,p);
}

function financeDeptOf(p){
  if(isConstructionCategory(p.category_id)) return 'Строительство';
  const cat = findCategory(p.category_id);
  const nm = (cat && cat.name || '').toLowerCase();
  if(nm.includes('ландшафт')) return 'Ландшафт';
  if(nm.includes('архитект')) return 'Архитектура';
  return 'Дизайн интерьера';
}

// Возвращает: { employees: {empId: {earned, items:[{projectId,name,amount}]}},
//               revenue, projectCosts, byDeptProfit: {dept: profit} }
function payrollEmployees(){
  if(!state.salaryHistory||state.salaryHistory.version!==1){
    throw new Error('История окладов не загружена. Обновите данные.');
  }
  return state.salaryHistory.employees.map(employee=>{
    const current=state.employees.find(row=>row.id===employee.id);
    return current?{...employee,name:current.name,role:current.role||employee.role}:employee;
  });
}
function payrollEmployee(employeeId){
  return payrollEmployees().find(e=>e.id===employeeId);
}
// Versions use the server's Moscow calendar date. The last change on a day is
// effective for that day; a later card edit cannot rewrite an earlier day.
function salaryDetailsForRange(emp,from,to){
  const employee=payrollEmployee(emp.id);
  if(!employee){
    throw new Error('История оклада сотрудника не загружена');
  }
  if(!from||!to||from>to)return {amount:0,uncertain:false};
  const versions=employee.versions;
  const last=Date.parse(to+'T00:00:00Z');
  let index=-1,total=0,uncertain=false;
  for(let stamp=Date.parse(from+'T00:00:00Z');stamp<=last;stamp+=86400000){
    const date=new Date(stamp),day=date.toISOString().slice(0,10);
    while(index+1<versions.length&&versions[index+1].effective_from<=day){
      index++;
    }
    const version=versions[index];
    if(version?.uncertain)uncertain=true;
    if(!version||!version.active||version.deleted||!version.is_salaried)continue;
    const days=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
    total+=version.fixed_salary/days;
  }
  return {amount:Math.round(total*100)/100,uncertain};
}
function salaryForRange(emp,from,to){
  return salaryDetailsForRange(emp,from,to).amount;
}
function payrollHistoryNotice(from,to){
  return payrollEmployees().some(e=>salaryDetailsForRange(e,from,to).uncertain)?
    '<div class="note" data-salary-history-note>Для части периода оклад восстановлен по начальной записи и доступному журналу. Изменения до начала надёжной истории могли не сохраниться; проверьте старые начисления.</div>':'';
}

function completedProjectEarningsForRange(from, to){
  const employees = {};
  const projects=getFinancialProjects();
  function addEarn(empId, amount, projectId, projectName, role){
    if(!empId) return;
    amount = amount || 0;
    if(!employees[empId]) employees[empId] = {earned:0, items:[]};
    employees[empId].earned += amount;
    employees[empId].items.push({projectId, name: projectName, amount, role});
  }

  let revenue = 0, projectCosts = 0;
  const byDeptProfit = {};

  projects.forEach(p=>{
    const st = findStatus(p.status_id);
    if(!st || st.name !== 'Завершён') return;
    const refDate = timesheetProjectRefDate(p);
    if(!refDate || refDate < from || refDate > to) return;

    const isConstr = isConstructionCategory(p.category_id);
    let rev, cost;
    if(isConstr){
      // Customer advances and purchases are agency funds, not company revenue.
      // A documented markup is shown in the object card; it is not a cash allocation.
      rev = 0; cost = 0;
    } else {
      rev = Number(p.price) || 0; cost = getProjectExpenses(p);
    }
    revenue += rev; projectCosts += cost;
    const dept = financeDeptOf(p);
    byDeptProfit[dept] = (byDeptProfit[dept]||0) + (rev - cost);

    const method = p.fee_base === 'm2' ? 'm2' : 'percent';
    if(method === 'percent'){
      const f = getProjectFee(p);
      byDeptProfit[dept] -= (p.employee_id ? f.mainFeeAmount : 0) + (p.co_employee_id ? f.coFeeAmount : 0);
      if(p.co_employee_id){
        if(projectEmployeeRole(p.employee_id)!=='manager') addEarn(p.employee_id, f.mainFeeAmount||0, p.id, p.name, 'архитектор / исполнитель');
        if(projectEmployeeRole(p.co_employee_id)!=='manager') addEarn(p.co_employee_id, f.coFeeAmount||0, p.id, p.name, 'архитектор / соисполнитель');
      } else if(p.employee_id && projectEmployeeRole(p.employee_id)!=='manager'){
        addEarn(p.employee_id, (f.mainFeeAmount||0)+(f.coFeeAmount||0), p.id, p.name, 'исполнитель');
      }
    }
  });

  // Manager commission accrues in the receipt month, independently of project completion.
  (state.ledger||[]).filter(l=>!l.deleted_at && ['advance','final_payment','income'].includes(l.type)
    && l.entry_date>=from && l.entry_date<=to).forEach(l=>{
    const project=projects.find(p=>p.id===l.project_id);
    if(!project||isConstructionProject(project))return;
    projectManagerSlots(project).forEach(([id,rate])=>addEarn(id,
      Math.max(0,Number(l.amount)||0)*Math.max(0,Number(rate)||0)/100,
      project.id,project.name,'Менеджер · '+l.entry_date+' · поступление клиента'));
  });

  // Начисления по м² учитываются в табеле только после завершения проекта и относятся
  // к месяцу сдачи проекта, а не к дате, когда бухгалтер/руководитель создал запись.
  (state.ledger||[]).forEach(l=>{
    if(l.type !== 'role_payout' || l.deleted_at) return;
    const proj = projects.find(p=>p.id===l.project_id);
    if(!proj) return;
    const st = findStatus(proj.status_id);
    if(!st || st.name !== 'Завершён') return;
    if(proj.fee_base !== 'm2') return;
    const refDate = timesheetProjectRefDate(proj);
    if(!refDate || refDate < from || refDate > to) return;
    if(l.payee_employee_id) byDeptProfit[financeDeptOf(proj)] -= Number(l.amount)||0;
    addEarn(l.payee_employee_id, Number(l.amount)||0, l.project_id, (proj.name||'') + ' — ' + (l.description||'начисление по м²'), 'начисление по м²');
  });

  // Премии не привязаны к завершению проекта: они попадают в табель и ФОТ
  // в месяц даты назначения и уменьшают финансовый результат компании этого периода.
  (state.ledger||[]).forEach(l=>{
    if(l.type !== 'bonus' || l.deleted_at) return;
    if(!l.payee_employee_id || !l.entry_date || l.entry_date < from || l.entry_date > to) return;
    addEarn(
      l.payee_employee_id,
      Number(l.amount)||0,
      null,
      'Премия' + (l.description ? ' — ' + l.description : ''),
      'премия'
    );
  });

  // Гарантированный оклад всегда присутствует в табеле текущего месяца,
  // даже если сотрудник не участвовал ни в одном завершённом проекте.
  payrollEmployees().forEach(emp=>{
    const salary=salaryForRange(emp,from,to);
    if(!salary)return;
    if(!employees[emp.id]) employees[emp.id] = {earned:0, items:[]};
    employees[emp.id].salary = salary;
  });

  return {employees, revenue, projectCosts, byDeptProfit};
}

// Разбивает заработок сотрудников на «фактически выплачено» и «осталось
// в прибыли компании» — для сотрудников с фиксированной ЗП (is_salaried).
function splitPayrollByEmployee(employeesEarned){
  const result = {}; // empId -> {earned, payout, retained, isSalaried, salary}
  let payrollPaidOut = 0, companyRetained = 0;
  // Гарантированный оклад выплачивается независимо от количества завершённых проектов.
  // Проектные начисления добавляются сверху, если они есть.
  payrollEmployees().filter(e=>e.active!==false&&!e.deleted_at || employeesEarned[e.id]?.earned || employeesEarned[e.id]?.salary).forEach(emp=>{
    const earned = employeesEarned[emp.id]?.earned || 0;
    const salary = employeesEarned[emp.id]?.salary || 0;
    const payout = salary + earned;
    result[emp.id] = {earned, payout, retained:0, isSalaried:salary>0, salary};
    payrollPaidOut += payout;
  });
  return {result, payrollPaidOut, companyRetained};
}

function timesheetMonthRange(monthStr){
  const [y, m] = monthStr.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2,'0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  return {from, to};
}

function isTimesheetPaid(employeeId, monthStr){
  return (state.timesheetPayments||[]).some(t=>t.employee_id===employeeId && t.month===monthStr && t.paid);
}

async function toggleTimesheetPaid(employeeId, monthStr, checked){
  if(!session?.isAdmin){showToast('Отмечать выплаты может только администратор');return;}
  try{
    const existing = (state.timesheetPayments||[]).find(t=>t.employee_id===employeeId && t.month===monthStr);
    if(existing){
      const {error} = await sb.from('timesheet_payments').update({paid: checked, paid_at: checked ? new Date().toISOString() : null}).eq('id', existing.id);
      if(error) throw error;
      existing.paid = checked;
      existing.paid_at = checked ? new Date().toISOString() : null;
    }else{
      const {data, error} = await sb.from('timesheet_payments').insert({employee_id: employeeId, month: monthStr, paid: checked, paid_at: checked ? new Date().toISOString() : null}).select().single();
      if(error) throw error;
      state.timesheetPayments = state.timesheetPayments || [];
      state.timesheetPayments.push(data);
    }
    renderTimesheet();
    showToast(checked ? 'Отмечено как оплачено' : 'Отметка снята');
  }catch(e){
    console.error(e);
    showToast('Ошибка сохранения — проверьте, что миграция timesheet_payments выполнена в Supabase');
    renderTimesheet();
  }
}

let timesheetExpanded = {}; // employeeId -> bool

function toggleTimesheetRow(employeeId){
  timesheetExpanded[employeeId] = !timesheetExpanded[employeeId];
  renderTimesheet();
}

function renderTimesheet(){
  if(!isOwner())return;
  const monthInput = document.getElementById('ts-month');
  if(!monthInput) return;
  if(!monthInput.value){
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  const monthStr = monthInput.value;
  if(!state.salaryHistory){
    const card=document.getElementById('timesheetCard');
    if(card)card.innerHTML='<div class="empty-state">История окладов недоступна. Обновите данные.</div>';
    return;
  }
  const {from, to} = timesheetMonthRange(monthStr);
  const {employees: earnedMap} = completedProjectEarningsForRange(from, to);
  const {result: payrollByEmp} = splitPayrollByEmployee(earnedMap);

  const card = document.getElementById('timesheetCard');
  if(!card) return;

  const rows = payrollEmployees().filter(e=>e.active!==false&&!e.deleted_at || earnedMap[e.id]?.earned || earnedMap[e.id]?.salary).filter(e=>session?.isAdmin || e.id===session?.employeeId).map(emp=>{
    const e = earnedMap[emp.id];
    const p = payrollByEmp[emp.id] || {earned:0, payout:0, retained:0, isSalaried:false, salary:0};
    return {
      id: emp.id,
      name: emp.name,
      earned: p.earned,
      payout: p.payout,
      retained: p.retained,
      isSalaried: p.isSalaried,
      salary: p.salary || 0,
      items: e ? e.items : [],
      paid: isTimesheetPaid(emp.id, monthStr),
    };
  }).sort((a,b)=>b.payout-a.payout);

  const totalPayout = rows.reduce((s,r)=>s+r.payout, 0);
  const totalRetained = rows.reduce((s,r)=>s+r.retained, 0);
  const totalPaid=rows.filter(r=>r.paid).reduce((s,r)=>s+r.payout,0);
  const totalOutstanding=totalPayout-totalPaid;

  card.innerHTML = payrollHistoryNotice(from,to)+rows.map(r=>{
    const expanded = !!timesheetExpanded[r.id];
    const projectItems = r.items.filter(it=>it.role!=='премия');
    const bonusItems = r.items.filter(it=>it.role==='премия');
    const itemsHtml = r.items.length ? r.items.map(it=>`
      <div class="list-item" style="padding-left:34px;${it.projectId?'cursor:pointer;':''}" ${it.projectId?`onclick="openProjectSheet('${it.projectId}')"`:''}>
        <div class="li-name" style="font-size:12.5px;">${escapeHtml(it.name)}${it.role==='соисполнитель'?' <span style="color:var(--text-dim); font-weight:400;">(соисполнитель)</span>':it.role==='премия'?' <span style="color:var(--gold); font-weight:600;">(премия)</span>':''}</div>
        <div class="proj-sum" style="font-size:12.5px; ${it.role==='премия'?'color:var(--gold);':it.amount===0?'color:var(--text-dim);':''}">${fmtMoney(it.amount)}${it.amount===0 && it.role==='соисполнитель' ? ' · нет %' : ''}</div>
      </div>`).join('') : '<div class="empty-state" style="padding:8px 0 8px 34px;">Нет начислений за месяц</div>';
    return `
    <div class="list-item" style="cursor:pointer;" onclick="toggleTimesheetRow('${r.id}')">
      <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
        <input type="checkbox" ${r.paid?'checked':''} ${session?.isAdmin?'':'disabled'} aria-label="Выплата ${escapeHtml(r.name)}" style="width:20px;height:20px;flex-shrink:0;cursor:pointer;"
          onclick="event.stopPropagation();" onchange="toggleTimesheetPaid('${r.id}','${monthStr}', this.checked)">
        <div style="min-width:0;">
          <div class="li-name">${expanded?'▾':'▸'} ${escapeHtml(r.name)}${r.isSalaried?' <span style="color:var(--text-dim); font-weight:400;">(фикс. ЗП)</span>':''}</div>
          <div class="li-meta">${r.isSalaried ? 'Гарантированный оклад '+fmtMoney(r.salary) : ''}${projectItems.length ? (r.isSalaried ? ' · ' : '') + projectItems.length + ' проект(ов)' : ''}${bonusItems.length ? ((r.isSalaried||projectItems.length) ? ' · ' : '') + bonusItems.length + ' прем.' : ((!r.isSalaried && !projectItems.length) ? 'Нет начислений' : '')}${r.paid?' · оплачено':''}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <div class="proj-sum" style="${r.paid?'color:var(--green);':''}">${fmtMoney(r.payout)}</div>
        <button class="icon-btn" title="Скачать табель этого сотрудника за месяц (PDF)" onclick="event.stopPropagation(); exportTimesheetToPdf('${r.id}','${monthStr}')" style="font-size:15px;">📄</button>
      </div>
    </div>
    ${expanded ? itemsHtml : ''}`;
  }).join('') +
    `<div class="list-item" style="border-top:1px solid var(--line-strong);">
      <div class="li-name" style="font-weight:700;">Всего начислено за месяц</div>
      <div class="proj-sum" style="font-weight:700;">${fmtMoney(totalPayout)}</div>
    </div>` +
    `<div class="list-item"><div class="li-name">Отмечено выплаченным</div><div class="proj-sum" style="color:var(--green)">${fmtMoney(totalPaid)}</div></div><div class="list-item"><div class="li-name">Осталось выплатить</div><div class="proj-sum" style="color:var(--gold)">${fmtMoney(totalOutstanding)}</div></div>` +
    (totalRetained > 0 ? `<div class="list-item">
      <div class="li-name" style="color:var(--text-dim);">Осталось в прибыли компании (сверх фикс. ЗП)</div>
      <div class="proj-sum" style="color:var(--gold);">${fmtMoney(totalRetained)}</div>
    </div>` : '');
}

