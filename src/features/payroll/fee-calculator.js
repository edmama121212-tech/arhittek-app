// ============================================================
// FEE CALCULATOR
// ============================================================
// Порог для правила «кто несёт расходы» (только проектный отдел — не Стройка):
// гонорар исполнителя от полной цены > 30 000₽ — расходы вычитаются из его гонорара;
// иначе расходы ложатся на доход компании, а исполнитель получает гонорар целиком.
const EXECUTOR_FEE_EXPENSE_THRESHOLD = 30000;

function projectEmployeeRole(id){
  const role=String(findEmployee(id)?.role||'').trim().toLowerCase().replace(/ё/g,'е');
  if(/(^|\s)менеджер(?=\s|$)/.test(role)) return 'manager';
  if(/(^|\s)архитектор(?=\s|$)/.test(role)) return 'architect';
  return 'other';
}
function projectFeePercent(p){
  // Explicit historical terms stay intact. Salary alone does not imply a category fee.
  if(p.fee_percent !== null && p.fee_percent !== undefined) return Number(p.fee_percent) || 0;
  if(findEmployee(p.employee_id)?.is_salaried) return 0;
  return Number(findCategory(p.category_id)?.fee_percent) || 0;
}
function projectManagerSlots(p){
  if(isConstructionProject(p))return [];
  if(isConstructionProject(p)||p.fee_base==='m2')return [];
  return [[p.employee_id,projectFeePercent(p)],
    [p.co_employee_id,p.co_fee_percent||0]].filter(([id])=>id&&projectEmployeeRole(id)==='manager');
}

function calcFee(p){
  const cat = findCategory(p.category_id);
  const feePercent = projectFeePercent(p);
  const feeBase = p.fee_base || (cat ? cat.fee_base : 'profit');
  const coFeePercent = Number(p.co_fee_percent) || 0;

  const price = Number(p.price) || 0;
  const expenses = Number(p.expenses) || 0;
  const profit = price - expenses;

  const slots = [{id:p.employee_id,rate:Math.max(0,feePercent)},
    {id:p.co_employee_id,rate:Math.max(0,coFeePercent)}];
  const manager = slot => projectEmployeeRole(slot.id) === 'manager';
  const managerCommission = slots.filter(slot=>slot.id && manager(slot))
    .reduce((sum,slot)=>sum+Math.max(0,price)*slot.rate/100,0);
  const architectBase = Math.max(0,price-managerCommission-expenses);
  const legacyBase = feeBase === 'profit' ? Math.max(0,profit) : Math.max(0,price);
  const slotAmount = slot => !slot.id ? 0 : (manager(slot) ? Math.max(0,price)
    : projectEmployeeRole(slot.id)==='architect' ? architectBase : legacyBase)*slot.rate/100;
  const mainFeeAmount = slotAmount(slots[0]);
  const coFeeAmount = slotAmount(slots[1]);
  const grossMainFee = mainFeeAmount;
  const companyExpenseShare = expenses;

  const feeAmount = mainFeeAmount + coFeeAmount;
  const mainPaid = Number(p.fee_paid) || 0;
  const coPaid = Number(p.co_fee_paid) || 0;
  const paid = mainPaid + coPaid;
  const remaining = feeAmount - paid;

  return {feePercent, feeBase, coFeePercent, profit, feeAmount, paid, remaining, mainFeeAmount, coFeeAmount, mainPaid, coPaid, grossMainFee, companyExpenseShare, managerCommission, architectBase, companyRemainder:profit-feeAmount};
}

function renderEmployeeFeeSummary(){
  const container = document.getElementById('employeeFeeSummary');
  if(!container) return;

  const employees = state.employees.filter(e=>!e.deleted_at);
  const rows = employees.map(emp=>{
    const projectIds = new Set(
      state.projects.filter(p=>p.employee_id===emp.id || p.co_employee_id===emp.id).map(p=>p.id)
    );
    (state.projectMembers||[]).filter(m=>m.employee_id===emp.id).forEach(m=>projectIds.add(m.project_id));
    const projects = state.projects.filter(p=>projectIds.has(p.id));
    let earned = 0, paid = 0;
    projects.forEach(p=>{
      const f = getProjectFee(p);
      // У каждого своя доля гонорара — исполнителю mainFeeAmount, соисполнителю coFeeAmount,
      // иначе при совпадении обоих полей на одном проекте сумма считалась бы дважды.
      if(p.employee_id === emp.id){ earned += projectEmployeeRole(emp.id)==='manager'&&!isConstructionProject(p)&&p.fee_base!=='m2' ? Math.max(0,Number(p.advance)||0)*Math.max(0,f.feePercent)/100 : f.mainFeeAmount; paid += f.mainPaid; }
      if(p.co_employee_id === emp.id){ earned += projectEmployeeRole(emp.id)==='manager'&&!isConstructionProject(p)&&p.fee_base!=='m2' ? Math.max(0,Number(p.advance)||0)*Math.max(0,f.coFeePercent)/100 : f.coFeeAmount; paid += f.coPaid; }
    });
    return {emp, count: projects.length, earned, paid, remaining: Math.max(0, earned - paid)};
  });

  if(!rows.length){
    container.innerHTML = '<div class="empty-state">Нет данных по сотрудникам</div>';
    return;
  }

  rows.sort((a,b)=>b.earned - a.earned);

  container.innerHTML = rows.map(r=>`
    <div class="fee-card">
      <div style="font-weight:700; font-size:13.5px; margin-bottom:8px;">${escapeHtml(r.emp.name)}</div>
      <div class="fee-row"><div class="fl">Проектов</div><div class="fv">${r.count}</div></div>
      <div class="fee-row"><div class="fl">Начислено гонорара</div><div class="fv">${fmtMoney(r.earned)}</div></div>
      <div class="fee-row"><div class="fl">Получено на руки</div><div class="fv">${fmtMoney(r.paid)}</div></div>
      <div class="fee-row remaining"><div class="fl">Осталось выплатить</div><div class="fv">${fmtMoney(r.remaining)}</div></div>
    </div>
  `).join('');
}

