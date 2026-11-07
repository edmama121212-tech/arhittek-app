// ============================================================
// STATE
// ============================================================
let state = {
  financialDataReady:false,financialDataError:null,financialLoadedAt:null,financialJournal:null,
  projects: [],
  financialProjects: [],
  financialStatusHistory: [],
  employees: [],
  categories: [],
  statuses: [],
  departments: [],
  ledger: [],
  photos: [],
  history: [],
  cashCounts: [],
  invoices: [],
  tzForms: [],
  tzReferences: [],
  companyInfo: null,
  kpForms: [],
  kpCatalog: [],
  timesheetPayments: [],
  companyExpenses: [],
  companyIncome: [],
  projectStages: [],
  stageDataError: null,
  projectMembers: [],
  projectMembersDataError: null,
  trash: {projects:[], employees:[], categories:[], ledger:[], companyExpenses:[], companyIncome:[], tariffs:[]},
};
window.state = state; // экспорт для enhancement-блока (бэкфилл этапов и пр.)

let activeCategoryFilter = 'all';
let activeStatusFilter = 'all';
let activePaymentFilter = 'all';
let activeEmployeeFilter = 'all';

function updateFilterBadge(){
  const badge = document.getElementById('filter-active-badge');
  if(!badge) return;
  const active = [activeCategoryFilter, activeStatusFilter, activeEmployeeFilter, activePaymentFilter].filter(v=>v!=='all').length;
  if(active > 0){
    const textEl = document.getElementById('filter-badge-text');
    if(textEl) textEl.textContent = active + (active===1?' активен':' активно');
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}
function resetAllFilters(){
  activeCategoryFilter = 'all';
  activeStatusFilter = 'all';
  activeEmployeeFilter = 'all';
  activePaymentFilter = 'all';
  projectSearchQuery = '';
  const search = document.getElementById('projectSearch');
  if(search) search.value = '';
  const searchBox = search?.closest('.search-box');
  if(searchBox) searchBox.classList.remove('has-value');
  renderCategoryFilters();
  renderStatusFilters();
  renderPaymentFilters();
  renderEmployeeFilters();
  renderProjects();
  updateFilterBadge();
}
let loadAllInFlight = false;
let loadAllPromise = null;
let loadAllQueued = false;
let projectSearchQuery = '';
let ledgerSearchQuery = '';
let employeeSearchQuery = '';
let historySearchQuery = '';
let editingProjectId = null;
let editingProjectLoadedAt = null;
let editingEmployeeId = null;
let employeeFormGeneration = 0;
const employeeSavesInFlight = new Set();
let editingCategoryId = null;
let openConstructionId = null;

