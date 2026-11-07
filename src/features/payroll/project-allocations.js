// ============================================================
// РАСПРЕДЕЛЕНИЕ БЮДЖЕТА ПО М² МЕЖДУ ИСПОЛНИТЕЛЯМИ
// Начисление = площадь проекта × ставка за м² конкретному исполнителю.
// Хранится как ledger_entries(type='role_payout', payee_employee_id=...),
// уменьшает прибыль/остаток компании по проекту (через syncProjectExpensesTotal)
// и попадает в табель исполнителя за месяц даты начисления (см. renderTimesheet).
// ============================================================
function projectRolePayoutEntries(projectId){
  return (state.ledger||[]).filter(l=>l.project_id===projectId && l.type==='role_payout' && !l.deleted_at)
    .sort((a,b)=> new Date(b.entry_date) - new Date(a.entry_date) || new Date(b.created_at) - new Date(a.created_at));
}

function updateCompanyRemainderField(projectId){
  const remEl = document.getElementById('pf-company-remainder');
  if(!remEl) return;
  const price = parseFloat(document.getElementById('pf-price').value) || 0;
  const expenses = parseFloat(document.getElementById('pf-expenses').value) || 0;
  remEl.value = projectId ? (price - expenses) : '';
}

function renderM2CompensationSummary(p){
  const el=document.getElementById('pf-compensation-summary');
  if(!el) return;
  const area=Number(document.getElementById('pf-area')?.value || p?.area || 0);
  const items=projectRolePayoutEntries(p?.id).filter(x=>!x.deleted_at);
  const total=items.reduce((s,x)=>s+Number(x.amount||0),0);
  el.innerHTML=`<div class="fee-row total"><div class="fl">Начислено по м²</div><div class="fv">${fmtMoney(total)}</div></div><div class="payroll-note">Начисления появятся в табеле только после статуса «Завершён» и попадут в месяц фактического завершения проекта.</div>`;
}

function getProjectCompensationMethod(p){
  const raw = p?.fee_base || '';
  if(raw === 'm2') return 'm2';
  return 'percent';
}

function renderCompensationMethodUI(){
  const methodEl = document.getElementById('pf-compensation-method');
  const percentBox = document.getElementById('pf-percent-method-fields');
  const m2Box = document.getElementById('pf-m2-method-fields');
  if(!methodEl || !percentBox || !m2Box) return;
  const method = methodEl.value === 'm2' ? 'm2' : 'percent';
  if(method === 'percent') document.getElementById('pf-feebase').value = methodEl.value === 'percent_profit' ? 'profit' : 'price';
  percentBox.style.display = method === 'percent' ? '' : 'none';
  m2Box.style.display = method === 'm2' ? '' : 'none';
  const empFee = document.getElementById('pf-employee-fee');
  const coFee = document.getElementById('pf-co-employee-fee');
  const main = document.getElementById('pf-employee');
  const co = document.getElementById('pf-co-employee');
  if(empFee && main) empFee.value = main.value || '';
  if(coFee && co) coFee.value = co.value || '';
  const summary = document.getElementById('pf-compensation-summary');
  if(summary && editingProjectId){
    const p = state.projects.find(x=>x.id===editingProjectId);
    if(p){ if(method==='m2') renderM2CompensationSummary(p); else renderFeeSummaryForProject({...p, fee_base:(methodEl.value==='percent_profit'?'profit':'price')}); }
  }
}

function bindCompensationUI(){
  const method = document.getElementById('pf-compensation-method');
  if(method && !method.dataset.bound){
    method.dataset.bound='1';
    method.addEventListener('change', ()=>{
      if(method.value==='m2') document.getElementById('pf-feebase').value='m2';
      else document.getElementById('pf-feebase').value='price';
      renderCompensationMethodUI();
    });
  }
  ['pf-employee-fee','pf-co-employee-fee'].forEach(id=>{
    const el=document.getElementById(id);
    if(el && !el.dataset.bound){
      el.dataset.bound='1';
      el.addEventListener('change', ()=>{
        if(id==='pf-employee-fee') document.getElementById('pf-employee').value=el.value;
        if(id==='pf-co-employee-fee') document.getElementById('pf-co-employee').value=el.value;
      });
    }
  });
}

function renderProjectRolePayouts(projectId){
  const sel = document.getElementById('pf-rp-employee');
  if(sel){
    const selected=sel.value;
    sel.innerHTML = '<option value="">— выберите —</option>' + state.employees.filter(e=>e.active!==false)
      .map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
    sel.value=selected;
  }
  const el = document.getElementById('pf-m2-payouts-list');
  if(!el) return;
  if(!projectId){ el.innerHTML = ''; return; }
  const project = state.projects.find(x=>x.id===projectId);
  const status = project ? findStatus(project.status_id) : null;
  const items = projectRolePayoutEntries(projectId);
  if(!items.length){
    el.innerHTML = '<div class="empty-state" style="padding:10px;">Начислений пока нет</div>';
  } else {
    const total = items.reduce((s,e)=>s+Number(e.amount||0),0);
    el.innerHTML = `<div class="card" style="margin-bottom:0;">` + items.map(e=>{
      const emp = findEmployee(e.payee_employee_id);
      return `<div class="list-item">
        <div style="min-width:0;">
          <div class="li-name">${escapeHtml(e.description||'Начисление')}</div>
          <div class="li-meta">${emp?escapeHtml(emp.name)+' · ':''}${fmtDate(e.entry_date)} · <span style="color:var(--gold);">−${fmtMoney(e.amount)}</span></div>
        </div>
        <div class="li-actions">
          <button class="icon-btn danger" title="Удалить начисление" onclick="deleteProjectRolePayout('${e.id}','${projectId}')">🗑</button>
        </div>
      </div>`;
    }).join('') +
      `<div class="list-item" style="border-top:1px solid var(--line-strong);">
        <div class="li-name" style="font-weight:700;">Итого начислено исполнителям</div>
        <div class="li-name" style="font-weight:700;color:var(--gold);">−${fmtMoney(total)}</div>
      </div></div>`;
  }
  if(status && status.name !== 'Завершён'){ el.insertAdjacentHTML('afterbegin','<div class="payroll-note" style="padding:8px 0;color:var(--gold);">Начисления сохранены, но в табеле появятся только после завершения проекта — в месяц фактического завершения.</div>'); }
  updateCompanyRemainderField(projectId);
}

async function addProjectRolePayout(){
  const projectId = editingProjectId;
  if(!projectId){ showToast('Сначала сохраните проект'); return; }
  const p = state.projects.find(x=>x.id===projectId);
  if(!p){ showToast('Проект не найден'); return; }
  if(p.fee_base!=='m2'){showToast('Сохраните проект с методом «Ставка за м²», затем добавьте начисление');return;}
  const role = document.getElementById('pf-rp-role').value;
  const employeeId = document.getElementById('pf-rp-employee').value;
  const rate = parseFloat(document.getElementById('pf-rp-rate').value);
  const area = parseFloat(document.getElementById('pf-area').value);
  if(!employeeId){ showToast('Выберите исполнителя'); return; }
  if(!rate || rate <= 0){ showToast('Укажите ставку за м²'); return; }
  if(!area || area <= 0){ showToast('Укажите площадь проекта, м²'); return; }
  const amount = Math.round(area * rate);
  const emp = findEmployee(employeeId);
  try{
    const {error} = await sb.from('ledger_entries').insert({
      type:'role_payout', project_id:projectId, payee_employee_id: employeeId,
      description:`${role} — ${emp?emp.name:''} (${area} м² × ${fmtMoney(rate)}/м²)`,
      amount, entry_date: financeToday(),
      received_by: session ? session.employeeId : null,
    });
    if(error) throw error;
    const total = await syncProjectExpensesTotal(projectId);
    await logAudit('project', projectId, p?p.name:'', 'update', {role_payout_added:{old:null, new:`${role} — ${emp?emp.name:''} — ${fmtMoney(amount)}`}});
    document.getElementById('pf-rp-rate').value = '';
    await loadAll();
    renderProjectRolePayouts(projectId);
    const expEl = document.getElementById('pf-expenses'); if(expEl) expEl.value = total;
    updateCompanyRemainderField(projectId);
    const up = state.projects.find(x=>x.id===projectId); if(up) renderM2CompensationSummary(up);
    showToast('Начисление добавлено. В табель попадёт после завершения проекта — в месяц сдачи.');
  }catch(e){ console.error(e); showToast('Ошибка добавления начисления — проверьте, что миграция выполнена в Supabase'); }
}

async function deleteProjectRolePayout(entryId, projectId){
  if(!confirm('Удалить это начисление?')) return;
  try{
    const {error:payoutDeleteError}=await sb.from('ledger_entries').update({deleted_at:new Date().toISOString()}).eq('id', entryId);
    if(payoutDeleteError) throw payoutDeleteError;
    await loadAll();
    const total = await syncProjectExpensesTotal(projectId);
    renderProjectRolePayouts(projectId);
    const expEl = document.getElementById('pf-expenses'); if(expEl) expEl.value = total;
    updateCompanyRemainderField(projectId);
    const up = state.projects.find(x=>x.id===projectId); if(up) renderFeeSummaryForProject(up);
    showToast('Начисление удалено');
  }catch(e){ console.error(e); showToast('Ошибка удаления'); }
}

document.getElementById('pf-rp-add-btn').addEventListener('click', addProjectRolePayout);

let projectExpenseSaveInFlight=false;
async function addProjectExpense(){
  if(projectExpenseSaveInFlight) return;
  const projectId = editingProjectId;
  if(!projectId){ showToast('Сначала сохраните проект'); return; }
  const desc = document.getElementById('pf-expense-desc').value.trim();
  const amount = parseFloat(document.getElementById('pf-expense-amount').value);
  const entry_date = document.getElementById('pf-expense-date').value || financeToday();
  if(!Number.isFinite(amount) || amount <= 0){ showToast('Укажите сумму расхода'); return; }
  if(!desc){ showToast('Укажите, на что расход'); return; }
  const p = state.projects.find(x=>x.id===projectId);
  const wasEditing = !!editingProjectExpenseId;
  projectExpenseSaveInFlight=true;
  document.getElementById('pf-expense-add-btn').disabled=true;
  try{
    if(editingProjectExpenseId){
      const before=(state.ledger||[]).find(x=>x.id===editingProjectExpenseId);
      const {error}=await sb.from('ledger_entries').update({description:desc,amount,entry_date}).eq('id',editingProjectExpenseId);
      if(error) throw error;
      await logAudit('project', projectId, p?p.name:'', 'update', {
        project_expense_edited:{old:before ? ((before.description||'Расход')+' — '+fmtMoney(before.amount)) : null, new:desc+' — '+fmtMoney(amount)}
      });
    }else{
      const existing = state.ledger.filter(l=>l.project_id===projectId && l.type==='project_expense' && !l.deleted_at);
      if(!existing.length && p && !isConstructionProject(p) && Number(p.expenses) > 0){
        const {error:importError}=await sb.from('ledger_entries').insert({
          type:'project_expense', project_id:projectId,
          description:'[cash:historical-expense] Ранее внесённые расходы', amount:Number(p.expenses),
          entry_date:(p.created_at||new Date().toISOString()).slice(0,10),
          received_by:session ? session.employeeId : null,
        });
        if(importError) throw importError;
      }
      const {error}=await sb.from('ledger_entries').insert({
        type:'project_expense', project_id:projectId,
        description:desc, amount, entry_date,
        received_by:session ? session.employeeId : null,
      });
      if(error) throw error;
      await logAudit('project', projectId, p?p.name:'', 'update', {project_expense_added:{old:null,new:desc+' — '+fmtMoney(amount)}});
    }
    resetProjectExpenseEditor();
    await loadAll();
    const total=await syncProjectExpensesTotal(projectId);
    renderProjectExpenses(projectId);
    const expEl=document.getElementById('pf-expenses'); if(expEl) expEl.value=total;
    updateCompanyRemainderField(projectId);
    const up=state.projects.find(x=>x.id===projectId); if(up) renderFeeSummaryForProject(up);
    showToast(wasEditing ? 'Расход изменён' : 'Расход добавлен');
  }catch(e){ console.error(e); showToast(wasEditing ? 'Ошибка изменения расхода' : 'Ошибка добавления расхода');
  }finally{ projectExpenseSaveInFlight=false; document.getElementById('pf-expense-add-btn').disabled=false; }
}

async function deleteProjectExpense(entryId, projectId){
  if(!confirm('Удалить этот расход?')) return;
  try{
    const {error:payoutDeleteError}=await sb.from('ledger_entries').update({deleted_at:new Date().toISOString()}).eq('id', entryId);
    if(payoutDeleteError) throw payoutDeleteError;
    await loadAll();
    const total = await syncProjectExpensesTotal(projectId);
    renderProjectExpenses(projectId);
    const expEl = document.getElementById('pf-expenses'); if(expEl) expEl.value = total;
    updateCompanyRemainderField(projectId);
    const up = state.projects.find(x=>x.id===projectId); if(up) renderFeeSummaryForProject(up);
    showToast('Расход удалён');
  }catch(e){ console.error(e); showToast('Ошибка удаления'); }
}

function renderLedgerProjectSelect(){
  const sel = document.getElementById('ledgerProject');
  sel.innerHTML = '<option value="">Без проекта</option>' + state.projects.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

function renderLedger(){
  const el = document.getElementById('ledgerEntries');
  let list = state.ledger.slice();

  // Текстовый поиск
  if(ledgerSearchQuery.trim()){
    const q = ledgerSearchQuery.trim().toLowerCase();
    list = list.filter(e=>{
      const proj = state.projects.find(p=>p.id===e.project_id);
      return (e.description||'').toLowerCase().includes(q) ||
             (proj && proj.name.toLowerCase().includes(q)) ||
             (ledgerTypeLabels[e.type]?.label||'').toLowerCase().includes(q);
    });
  }

  // Фильтр по дате
  const dateFromEl = document.getElementById('ledgerDateFrom');
  const dateToEl = document.getElementById('ledgerDateTo');
  if(dateFromEl && dateFromEl.value){
    const from = new Date(dateFromEl.value);
    list = list.filter(e=>e.entry_date && new Date(e.entry_date) >= from);
  }
  if(dateToEl && dateToEl.value){
    const to = new Date(dateToEl.value);
    to.setHours(23,59,59);
    list = list.filter(e=>e.entry_date && new Date(e.entry_date) <= to);
  }

  // Подвязываем события фильтров дат один раз
  if(dateFromEl && !dateFromEl.dataset.bound){
    dateFromEl.dataset.bound = '1';
    dateFromEl.addEventListener('change', renderLedger);
  }
  if(dateToEl && !dateToEl.dataset.bound){
    dateToEl.dataset.bound = '1';
    dateToEl.addEventListener('change', renderLedger);
  }

  if(!list.length){
    el.innerHTML = '<div class="empty-state">Записей не найдено</div>';
    return;
  }

  // Итог отфильтрованного периода
  const totalIn = list.filter(e=>['advance','final_payment','income','materials_budget','construction_budget'].includes(e.type)).reduce((s,e)=>s+Number(e.amount||0),0);
  const totalOut = list.filter(e=>['expense','project_expense','payment','withdrawal','fee_payment','salary_payment'].includes(e.type)).reduce((s,e)=>s+Number(e.amount||0),0);
  const summaryHtml = `<div style="display:flex;gap:10px;margin-bottom:8px;font-size:11px;">
    <span style="color:var(--green);">↑ Приход: ${fmtMoney(totalIn)}</span>
    <span style="color:var(--red);">↓ Расход: ${fmtMoney(totalOut)}</span>
    <span style="color:var(--text-dim);">Записей: ${list.length}</span>
  </div>`;

  el.innerHTML = summaryHtml + list.map(e=>{
    const t = ledgerTypeLabels[e.type] || ledgerTypeLabels.expense;
    const proj = state.projects.find(p=>p.id===e.project_id);
    return `<div class="list-item">
      <div>
        <div class="li-name">${proj ? escapeHtml(proj.name) : 'Без объекта'}${e.description ? ' — '+escapeHtml(e.description) : ''}</div>
        <div class="li-meta">${t.label}${e.entry_date ? ' · '+fmtDate(e.entry_date) : ''}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="proj-sum" style="color:${t.cls};">${t.sign}${fmtMoney(e.amount)}</div>
        <button class="icon-btn danger" onclick="deleteLedgerEntry('${e.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

async function addLedgerEntry(){
  const type = document.getElementById('ledgerType').value;
  const project_id = document.getElementById('ledgerProject').value || null;
  const description = document.getElementById('ledgerDesc').value.trim();
  const amount = parseFloat(document.getElementById('ledgerAmount').value);
  const entry_date = document.getElementById('ledgerDate').value || financeToday();

  if(!amount || amount <= 0){
    showToast('Укажите сумму');
    return;
  }

  // Защита от дублей: проверяем похожую запись за ту же дату
  const dupCheck = state.ledger.filter(e =>
    e.type === type &&
    e.project_id === project_id &&
    Number(e.amount) === amount &&
    e.entry_date === entry_date &&
    !e.deleted_at
  );
  if(dupCheck.length > 0){
    if(!confirm('Похожая запись за эту дату уже существует. Добавить ещё раз?')) return;
  }

  try{
    const {data, error} = await sb.from('ledger_entries').insert({type, project_id, description, amount, entry_date, received_by: session ? session.employeeId : null}).select().single();
    if(error) throw error;
    const proj = state.projects.find(p=>p.id===project_id);
    await logAudit('ledger_entry', data.id, (proj?proj.name+' — ':'')+(description||ledgerTypeLabels[type]?.label||''), 'create', {});
    document.getElementById('ledgerDesc').value = '';
    document.getElementById('ledgerAmount').value = '';
    document.getElementById('ledgerDate').value = '';
    showToast('Запись добавлена');
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка сохранения');
  }
}

