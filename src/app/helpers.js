// ============================================================
// HELPERS
// ============================================================
function fmt(n){
  n = Number(n) || 0;
  return Math.round(n).toLocaleString('ru-RU');
}
function fmtMoney(n){ return fmt(n) + ' ₽'; }

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2000);
}

function setSyncStatus(status, label){
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  if(status === 'loading'){
    dot.className = 'sync-dot loading';
  } else if(status === 'off'){
    dot.className = 'sync-dot off';
  } else if(status === 'live'){
    dot.className = 'sync-dot live';
  } else {
    dot.className = 'sync-dot';
  }
  lbl.textContent = label;
}

function findCategory(id){ return state.categories.find(c=>c.id===id); }
// Является ли категория строительной (для показа накладных/материалов/фото объекта)
function isConstructionCategory(catId){
  const cat = findCategory(catId);
  if(!cat) return false;
  const constrDept = state.departments.find(d=>d.name==='Строительный отдел');
  if(constrDept && cat.department_id === constrDept.id) return true;
  const nm = (cat.name||'').toLowerCase();
  return nm.includes('строительств') || nm.includes('ремонт') || nm.includes('монтаж') || cat.name==='Строительство';
}
function findStatus(id){ return state.statuses.find(s=>s.id===id); }

// Расходы объекта: для строительных объектов — всегда свежая сумма из накладных
// (ручное поле p.expenses для них не источник истины, см. renderConstrSummary).
// Для остальных проектов — ручное поле p.expenses как и раньше.
// Единый источник прямых расходов проекта. Начисления сотрудникам (role_payout)
// не смешиваются с себестоимостью проекта: это отдельная статья ФОТ.
function getFinancialProjects(){
  const live=state.projects||[], ids=new Set(live.map(p=>p.id));
  const archived=(state.financialProjects||[]).filter(p=>p.deleted_at&&!ids.has(p.id));
  return [...live,...archived];
}
function getProjectExpenses(p){
  if(!p) return 0;
  if(isConstructionProject(p))return getConstructionExpenses(p).expenses;
  const manual = (state.ledger||[])
    .filter(e => e.project_id===p.id && !e.deleted_at && (['expense','project_expense'].includes(e.type)||(e.type==='payment'&&!e.payee_employee_id)))
    .filter(e => !isInvoiceLinkedExpense(e))
    .reduce((sum,e)=>sum + Number(e.amount||0),0);

  // Старые проекты могли хранить расходы только в projects.expenses.
  return manual > 0 ? manual : Math.max(0, Number(p.expenses)||0);
}
function isInvoiceLinkedExpense(entry){
  const id=typeof ARHITTEKCash!=='undefined'?ARHITTEKCash.invoicePaymentId(entry):null;
  return !!id&&(state.invoices||[]).some(i=>i.id===id&&i.project_id===entry.project_id&&!i.deleted_at);
}

// Накладные, отмеченные «оплачено заказчиком напрямую» (заказчик оплатил
// поставщику сам, минуя компанию). Сумма всё равно входит в затраты объекта
// (getProjectExpenses), но не должна считаться перерасходом компании —
// компания эти деньги не тратила и не получала.
function getProjectDirectClientPaid(p){
  if(isConstructionProject(p))return getConstructionExpenses(p).directPaid;
  return (state.invoices||[])
    .filter(inv => inv.project_id === p.id && !inv.deleted_at && inv.paid_by_client)
    .reduce((s,i)=>s+Number(i.amount||0), 0);
}

// Единая точка расчёта гонорара — строительные объекты считаются по calcConstrFee
// (% от расходов), остальные — по calcFee (% от цены/прибыли). Раньше эти формулы
// путались местами (калькулятор гонорара, карточка проекта, экспорт), из-за чего
// один и тот же объект показывал разные суммы гонорара на разных экранах.
function getProjectFee(p){
  const withFreshExpenses = {...p, expenses: getProjectExpenses(p)};
  if(p && p.fee_base === 'm2'){
    const rows=projectRolePayoutEntries(p.id), feeAmount=rows.reduce((sum,e)=>sum+(Number(e.amount)||0),0);
    const forEmp=id=>id?rows.filter(e=>e.payee_employee_id===id).reduce((sum,e)=>sum+(Number(e.amount)||0),0):0;
    return {feePercent:0,feeBase:'m2',profit:(Number(p.price)||0)-getProjectExpenses(p),feeAmount,paid:0,remaining:feeAmount,
      mainFeeAmount:forEmp(p.employee_id),coFeeAmount:forEmp(p.co_employee_id),mainPaid:0,coPaid:0,grossMainFee:feeAmount,companyExpenseShare:0};
  }
  return isConstructionProject(p) ? calcConstrFee(withFreshExpenses) : calcFee(withFreshExpenses);
}

// Канонические этапы по типу проекта (встроенный чек-лист).
const CAT_ID_ARCH   = "f1138228-54da-46a3-86a4-95ba8e1116c2";
const CAT_ID_DESIGN = "c16f08eb-72e8-4261-bef6-77a8c29284ef";
const CAT_ID_FURN   = "916ec7c2-98a1-4d93-bdec-c35c99bea22c";
const STAGE_TEMPLATE_ARCH   = ["Составление ТЗ","Разработка планировки","Экстерьер","Чертежи","Печать и отправка Альбома"];
const STAGE_TEMPLATE_DESIGN = ["Составление ТЗ","Разработка планировки","Визуализация","Чертежи","Печать и отправка Альбома"];
// Старые названия → новые (чтобы старые отметки «выполнено» подхватывались шаблоном)
const STAGE_LEGACY_MAP = {
  "Составить ТЗ": "Составление ТЗ",
  "Планировка": "Разработка планировки",
  "Распечатка и Отправка": "Печать и отправка Альбома",
  "Распечатка и отправка": "Печать и отправка Альбома",
};
function defaultStageNamesForProject(proj){
  if(!proj) return null;
  if(proj.category_id === CAT_ID_ARCH) return STAGE_TEMPLATE_ARCH;
  if(proj.category_id === CAT_ID_DESIGN || proj.category_id === CAT_ID_FURN) return STAGE_TEMPLATE_DESIGN;
  if(isConstructionCategory(proj.category_id)) return null; // объект — без шаблона
  const cat = findCategory(proj.category_id);
  const nm = (cat && cat.name || '').toLowerCase();
  if(nm.includes('архитект')) return STAGE_TEMPLATE_ARCH;
  if(nm.includes('дизайн') || nm.includes('интерьер') || nm.includes('мебел')) return STAGE_TEMPLATE_DESIGN;
  return null;
}
// Заморожен ли проект — такие проекты не считаются просроченными и исключаются из активных
function isFrozen(p){
  if(!p) return false;
  const st = findStatus(p.status_id);
  return !!(st && st.name === 'Заморожен');
}
function findEmployee(id){ return state.employees.find(e=>e.id===id) || state.salaryHistory?.employees.find(e=>e.id===id); }
function findDepartment(id){ return state.departments.find(d=>d.id===id); }
function financeToday(){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

function daysUntil(dateStr){
  if(!dateStr) return null;
  const today = new Date();
  today.setHours(0,0,0,0);
  const d = new Date(dateStr);
  return Math.round((d - today) / (1000*60*60*24));
}
function fmtDate(d){
  if(!d) return '';
  const [y,m,day] = d.split('-');
  return `${day}.${m}.${y}`;
}
function fmtDateTime(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
}

