// ============================================================
// EVENT BINDINGS
// ============================================================
document.getElementById('addProjectFab').addEventListener('click', ()=>{
  const activeView = document.querySelector('.view.active');
  // FAB работает только для Проектный и Стройка
  if(activeView && activeView.id === 'view-cards') return;
  openProjectSheet(null);
  // If opened from Стройка — pre-select construction category
  if(activeView && activeView.id === 'view-construction'){
    const constrCat = state.categories.find(c=>{
      const nm = (c.name||'').toLowerCase();
      return nm.includes('строительств') || nm.includes('ремонт') || nm.includes('монтаж');
    });
    if(constrCat) document.getElementById('pf-category').value = constrCat.id;
  }
});

document.getElementById('pf-stage-add').addEventListener('click', ()=>{
  if(editingProjectId) addStage(editingProjectId);
});

document.getElementById('pf-open-as-object').addEventListener('click', ()=>{
  if(editingProjectId){
    closeProjectSheet();
    openObjectView(editingProjectId);
  }
});

// UX rule: рабочие окна не закрываются кликом по затемнённому фону.
// Закрытие только явной кнопкой × / Отмена / Назад, чтобы случайный клик
// не приводил к потере введённых данных.

document.getElementById('projectSheetClose').addEventListener('click', closeProjectSheet);
document.getElementById('pf-cancel').addEventListener('click', closeProjectSheet);
document.getElementById('pf-save').addEventListener('click', ()=>saveProject());
document.getElementById('pf-delete').addEventListener('click', ()=>{
  if(confirm('Переместить этот проект в корзину?')) deleteProject();
});
document.getElementById('pf-tz-create').addEventListener('click', createTzForm);
document.getElementById('tzSheetClose').addEventListener('click', ()=>{
  document.getElementById('tzSheetOverlay').classList.remove('active');
});

document.getElementById('addEmployeeBtn').addEventListener('click', ()=>openEmployeeSheet(null));
document.getElementById('empSheetClose').addEventListener('click', closeEmployeeSheet);
document.getElementById('ef-cancel').addEventListener('click', closeEmployeeSheet);
document.getElementById('ef-save').addEventListener('click', saveEmployee);
document.getElementById('ef-delete').addEventListener('click', deleteEmployee);
document.getElementById('ef-pin').addEventListener('input', (e)=>{
  e.target.value = e.target.value.replace(/\D/g,'').slice(0,6);
});


document.getElementById('addCategoryBtn').addEventListener('click', ()=>openCategorySheet(null));
document.getElementById('catSheetClose').addEventListener('click', closeCategorySheet);
document.getElementById('cf-cancel').addEventListener('click', closeCategorySheet);
document.getElementById('cf-save').addEventListener('click', saveCategory);
document.getElementById('cf-delete').addEventListener('click', deleteCategory);

document.getElementById('addTariffBtn').addEventListener('click', ()=>openTariffSheet(null));
document.getElementById('tariffSheetClose').addEventListener('click', closeTariffSheet);
document.getElementById('tf-cancel').addEventListener('click', closeTariffSheet);
document.getElementById('tf-save').addEventListener('click', saveTariff);
document.getElementById('tf-delete').addEventListener('click', deleteTariff);

document.getElementById('companyExpenseSheetClose').addEventListener('click', closeCompanyExpenseSheet);
document.getElementById('cex-cancel').addEventListener('click', closeCompanyExpenseSheet);
document.getElementById('cex-save').addEventListener('click', saveCompanyExpense);
document.getElementById('cex-delete').addEventListener('click', deleteCompanyExpense);

document.getElementById('companyIncomeSheetClose').addEventListener('click', closeCompanyIncomeSheet);
document.getElementById('cin-cancel').addEventListener('click', closeCompanyIncomeSheet);
document.getElementById('cin-save').addEventListener('click', saveCompanyIncome);
document.getElementById('cin-delete').addEventListener('click', deleteCompanyIncome);

// ledgerAdd listener removed

function setupSearchBox(inputId, setQuery, renderFn){
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(inputId + 'Clear');
  const box = input.closest('.search-box');
  function update(){
    box.classList.toggle('has-value', input.value.length > 0);
  }
  input.addEventListener('input', (e)=>{
    setQuery(e.target.value);
    update();
    renderFn();
  });
  clearBtn.addEventListener('click', ()=>{
    input.value = '';
    setQuery('');
    update();
    renderFn();
    input.focus();
  });
  update();
}

setupSearchBox('projectSearch', v=>projectSearchQuery=v, renderProjects);
// ledgerSearch listener removed
setupSearchBox('employeeSearch', v=>employeeSearchQuery=v, renderEmployees);
setupSearchBox('historySearch', v=>historySearchQuery=v, renderHistory);
setupSearchBox('constrSearch', v=>{ constrSearchQuery=v; renderConstruction(); });

document.getElementById('exportXlsxBtn').addEventListener('click', exportToXlsx);

document.getElementById('openTimesheetBtn').addEventListener('click', ()=>{
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-timesheet').classList.add('active');
  renderTimesheet();
  window.scrollTo(0,0);
});
document.getElementById('timesheetBack').addEventListener('click', ()=>{
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-more').classList.add('active');
  document.querySelector('.nav-btn[data-view="view-more"]').classList.add('active');
  window.scrollTo(0,0);
});
document.getElementById('ts-month').addEventListener('change', renderTimesheet);

document.getElementById('financeBack').addEventListener('click', ()=>{
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-overview').classList.add('active');
  document.querySelector('.nav-btn[data-view="view-overview"]').classList.add('active');
  window.scrollTo(0,0);
});

document.getElementById('openKpBtn').addEventListener('click', openKpView);
document.getElementById('kpBack').addEventListener('click', ()=>{
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-more').classList.add('active');
  document.querySelector('.nav-btn[data-view="view-more"]').classList.add('active');
  window.scrollTo(0,0);
});
document.getElementById('kpAddService').addEventListener('click', addKpService);
document.getElementById('kp-discount-type').addEventListener('change', updateKpTotals);
document.getElementById('kp-discount-value').addEventListener('input', updateKpTotals);
document.getElementById('kpExportPdf').addEventListener('click', exportKpToPdf);
document.getElementById('kpExportXlsx').addEventListener('click', exportKpToXlsx);

document.getElementById('openCompanyBtn').addEventListener('click', openCompanyView);
document.getElementById('companyBack').addEventListener('click', ()=>{
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-more').classList.add('active');
  document.querySelector('.nav-btn[data-view="view-more"]').classList.add('active');
  window.scrollTo(0,0);
});
document.getElementById('companySaveBtn').addEventListener('click', saveCompanyInfo);
  document.getElementById('companyExportBtn').addEventListener('click', exportCompanyInfo);

  document.getElementById('settingsBtn').addEventListener('click', ()=>{
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('view-settings').classList.add('active');
    window.scrollTo(0,0);
    if(typeof renderNotifSettings === 'function') renderNotifSettings();
    renderCatalogPriceSettings();
  });
  document.getElementById('catalogPriceSaveBtn').addEventListener('click', saveCatalogPricePerSqm);
  document.getElementById('settingsBack').addEventListener('click', ()=>{
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('view-more').classList.add('active');
    document.querySelector('.nav-btn[data-view="view-more"]').classList.add('active');
    window.scrollTo(0,0);
  });

  function toggleHistorySection(){
    const body = document.getElementById('historySectionBody');
    const chevron = document.getElementById('historyChevron');
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
  }



