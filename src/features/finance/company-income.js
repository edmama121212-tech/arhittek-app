// ============================================================
// ДОХОДЫ КОМПАНИИ (аренда 2 помещений и пр. — не связаны с проектами)
// ============================================================
let editingCompanyIncomeId = null;

function renderCompanyIncomeList(){
  const el = document.getElementById('companyIncomeList');
  if(!el) return;
  const list = (state.companyIncome||[]).filter(isOperationalCompanyIncome).slice().sort((a,b)=>(b.income_date||'').localeCompare(a.income_date||''));
  if(!list.length){
    el.innerHTML = '<div class="empty-state">Доходов пока нет</div>';
    return;
  }
  el.innerHTML = list.map(inc=>`
    <div class="list-item">
      <div>
        <div class="li-name">${escapeHtml(inc.category)}${inc.description?' — '+escapeHtml(inc.description):''}</div>
        <div class="li-meta">${fmtDate(inc.income_date)}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="proj-sum" style="color:var(--green);">${fmtMoney(inc.amount)}</div>
        <button class="icon-btn" onclick="openCompanyIncomeSheet('${inc.id}')">✎</button>
      </div>
    </div>`).join('');
}

function openCompanyIncomeSheet(id){
  editingCompanyIncomeId = id;
  const overlay = document.getElementById('companyIncomeSheetOverlay');
  const title = document.getElementById('companyIncomeSheetTitle');
  const deleteBtn = document.getElementById('cin-delete');
  const catSel = document.getElementById('cin-category');
  catSel.innerHTML = COMPANY_INCOME_CATEGORIES.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if(id){
    const inc = (state.companyIncome||[]).find(x=>x.id===id);
    if(!inc) return;
    if(inc.category && !COMPANY_INCOME_CATEGORIES.includes(inc.category)) catSel.add(new Option(inc.category,inc.category));
    title.textContent = 'Редактировать доход';
    deleteBtn.style.display = '';
    catSel.value = inc.category || COMPANY_INCOME_CATEGORIES[0];
    document.getElementById('cin-amount').value = inc.amount ?? '';
    document.getElementById('cin-date').value = inc.income_date || '';
    document.getElementById('cin-desc').value = inc.description || '';
  }else{
    title.textContent = 'Новый доход';
    deleteBtn.style.display = 'none';
    catSel.selectedIndex = 0;
    document.getElementById('cin-amount').value = '';
    document.getElementById('cin-date').value = financeToday();
    document.getElementById('cin-desc').value = '';
  }
  beginCompanyMoneyForm('income',id,(state.companyIncome||[]).find(x=>x.id===id));
  overlay.classList.add('active');
  window.ARHITTEKCash?.attachCountField('cin-desc');
}

function closeCompanyIncomeSheet(){
  document.getElementById('companyIncomeSheetOverlay').classList.remove('active');
  editingCompanyIncomeId = null;
}

let companyIncomeSaveInFlight=false;
async function saveCompanyIncome(){
  if(companyIncomeSaveInFlight) return;
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  const form=companyMoneyForms.income;
  if(!form||!document.getElementById('companyIncomeSheetOverlay').classList.contains('active'))return;
  const payload=companyMoneyPayload('income'),{category,amount,income_date}=payload;
  if(!Number.isFinite(amount) || amount <= 0){ showToast('Укажите сумму'); return; }
  if(!category){ showToast('Выберите категорию'); return; }
  if(!income_date){ showToast('Укажите дату'); return; }
  companyIncomeSaveInFlight=true;
  document.getElementById('cin-save').disabled=true;
  try{
    await commitCompanyMoneyForm(form,payload);
  }catch(e){
    console.error(e);
    const current=companyMoneyForms.income===form&&document.getElementById('companyIncomeSheetOverlay').classList.contains('active');
    if(current)companyMoneyNotice('income',e.message||'Ошибка сохранения. Проверьте связь перед повтором.');
    showToast((current?'':'Предыдущая форма: ')+(e.message||'Ошибка сохранения дохода'));
  }finally{
    companyIncomeSaveInFlight=false;
    document.getElementById('cin-save').disabled=false;
  }
}

async function deleteCompanyIncome(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  if(!editingCompanyIncomeId) return;
  if(!confirm('Удалить эту запись о доходе? Её можно будет восстановить из корзины.')) return;
  try{
    const before=(state.companyIncome||[]).find(x=>x.id===editingCompanyIncomeId);
    const {error} = await sb.from('company_income').update({deleted_at: new Date().toISOString()}).eq('id', editingCompanyIncomeId);
    if(error) throw error;
    await logAudit('company_income',editingCompanyIncomeId,before?((before.category||'Доход')+(before.description?' — '+before.description:'')):'Доход компании','delete',{});
    showToast('Доход перемещён в корзину');
    closeCompanyIncomeSheet();
    await loadAll();
    financeExpanded = true;
    renderAnalytics();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }
}

