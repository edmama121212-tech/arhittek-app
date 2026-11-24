// ============================================================
// STATE
// ============================================================
let state = {
  financialDataReady:false,financialDataError:null,financialLoadedAt:null,financialJournal:null,
  projects: [],
  financialProjects: [],
  financialStatusHistory: [],
  salaryHistory: null,
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
  catalogPricing: null,
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
  badge.hidden = active === 0;
  if(active){
    const label = projectSearchQuery.trim() ? 'Сбросить поиск и фильтры' : 'Сбросить фильтры';
    badge.textContent = label + ' (' + active + ')';
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
  search?.focus();
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

