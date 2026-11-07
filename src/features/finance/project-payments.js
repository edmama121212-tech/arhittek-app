// ============================================================
// ПРИЁМ ПЛАТЕЖА (для карточки проекта)
// ============================================================
let paymentType = 'advance';
let paymentProjectId = null;

const paymentHints = {
  advance: 'Увеличит «Получено» и уменьшит «Остаток» по проекту.',
  final_payment: 'Увеличит «Получено» и уменьшит «Остаток» по проекту — оплата финального остатка.',
  materials_budget: 'Деньги клиента на закупку материалов — увеличит «Получено» и уменьшит «Остаток» (учитывается в общем приходе по проекту).',
  fee_payment: 'Фактическая выплата выбранному сотруднику. Уменьшит деньги компании и будет учтена в табеле; оплату клиента не меняет.',
  withdrawal: 'Запись о выводе средств из бюджета объекта (например, наличные на материалы). Не влияет на «Получено»/«Остаток» — только запись в истории с указанием причины. Укажите причину в комментарии.',
};

function openPaymentSheet(projectId){
  paymentProjectId = projectId || editingProjectId;
  if(!paymentProjectId) return;
  paymentType = 'advance';
  document.querySelectorAll('#payment-type .yn-btn').forEach(b=>b.classList.toggle('selected', b.dataset.value==='advance'));
  document.getElementById('payment-amount').value = '';
  document.getElementById('payment-note').value = '';
  document.getElementById('payment-date').value = financeToday();
  document.getElementById('payment-hint').textContent = paymentHints.advance;
  const p=state.projects.find(p=>p.id===paymentProjectId);
  const ids=[...new Set([p?.employee_id,p?.co_employee_id,...projectRolePayoutEntries(paymentProjectId).map(r=>r.payee_employee_id)].filter(Boolean))];
  document.getElementById('payment-payee').innerHTML=ids.map(id=>`<option value="${escapeHtml(id)}">${escapeHtml(findEmployee(id)?.name||'Сотрудник')}</option>`).join('');
  document.getElementById('payment-payee-field').hidden=true;
  document.getElementById('paymentSheetOverlay').classList.add('active');
  window.ARHITTEKCash?.attachCountField('payment-note');
}

document.querySelectorAll('#payment-type .yn-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#payment-type .yn-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    paymentType = btn.dataset.value;
    document.getElementById('payment-payee-field').hidden=paymentType!=='fee_payment';
    document.getElementById('payment-hint').textContent = paymentHints[paymentType] || '';
  });
});

let paymentSaveInFlight=false;
function projectFeePaidField(project,entry){
  if(!project||project.fee_base==='m2')return null;
  return entry.payee_employee_id&&entry.payee_employee_id===project.co_employee_id?'co_fee_paid':'fee_paid';
}
async function savePayment(){
  if(paymentSaveInFlight) return;
  if(!session?.isAdmin){showToast('Финансовые операции сохраняет администратор');return;}
  const projectId = paymentProjectId || editingProjectId;
  if(!projectId) return;
  const amount = parseFloat(document.getElementById('payment-amount').value);
  const entry_date = document.getElementById('payment-date').value || financeToday();
  const note = document.getElementById('payment-note').value.trim();

  if(!Number.isFinite(amount) || amount <= 0){ showToast('Укажите сумму платежа'); return; }
  if(paymentType === 'withdrawal' && !note){ showToast('Укажите причину вывода средств'); return; }

  const p = state.projects.find(x=>x.id===projectId);
  if(!p) return;
  const payeeEmployeeId=paymentType==='fee_payment'?document.getElementById('payment-payee').value:null;
  if(paymentType==='fee_payment'&&!payeeEmployeeId){showToast('Укажите сотрудника в команде проекта');return;}

  const updates = {};
  if(paymentType === 'fee_payment'){
    const field=projectFeePaidField(p,{payee_employee_id:payeeEmployeeId});
    if(field)updates[field]=(Number(p[field])||0)+amount;
  }else if(paymentType === 'withdrawal'){
    // No effect on project financial fields — purely a journal record with a reason
  }else{
    const newAdvance = (Number(p.advance)||0) + amount;
    updates.advance = newAdvance;
    updates.balance = Math.max(0, (Number(p.price)||0) - newAdvance);
  }

  paymentSaveInFlight=true;
  document.getElementById('payment-save').disabled=true;
  showToast('Сохранение…');
  let insertedPayment=null,projectSynced=false;
  try{
    const t = ledgerTypeLabels[paymentType];
    const description = window.ARHITTEKCash?.operationDescription ? ARHITTEKCash.operationDescription('payment-note',note || t?.label || 'Платёж') : note || t?.label || 'Платёж';
    const {data, error} = await sb.from('ledger_entries').insert({
      type: paymentType, project_id: projectId, description, amount, entry_date,
      ...(paymentType==='fee_payment'?{payee_employee_id:payeeEmployeeId}:{}),
      received_by: session ? session.employeeId : null,
    }).select().single();
    if(error) throw error;
    insertedPayment=data;

    if(isConstructionProject(p)){
      const finAfterPayment = getConstructionFinancials(p, [...(state.ledger||[]), data]);
      updates.balance=finAfterPayment.balance;
      if(CONSTRUCTION_INCOME_TYPES.includes(paymentType))updates.advance=finAfterPayment.received;
    }
    if(Object.keys(updates).length){
      let query=sb.from('projects').update(updates).eq('id',projectId);
      for(const field of Object.keys(updates)) query=p[field]==null?query.is(field,null):query.eq(field,p[field]);
      const {data:updated,error:projErr}=await query.select().maybeSingle();
      if(projErr) throw projErr;
      if(!updated) throw new Error('Проект изменился на другом устройстве. Обновите данные перед повтором.');
    }
    projectSynced=true;

    await logAudit('project', projectId, p.name, 'update', {
      payment: {old:null, new: `${t?.label||paymentType} — ${fmtMoney(amount)}${note?' ('+note+')':''}`}
    });

    document.getElementById('paymentSheetOverlay').classList.remove('active');
    showToast('Платёж сохранён');
    await loadAll();

    // Refresh project sheet fields with updated values
    if(editingProjectId === projectId){
      const updated = state.projects.find(x=>x.id===projectId);
      if(updated){
        document.getElementById('pf-advance').value = updated.advance ?? '';
        document.getElementById('pf-balance').value = updated.balance ?? '';
        document.getElementById('pf-feepaid').value = updated.fee_paid ?? '';
      }
      renderPaymentHistory(projectId);
      renderFeeSummaryForProject(updated);
    }

    // Refresh construction object detail view if it's open behind the sheet
    if(currentObjectId === projectId){
      const updatedObj = state.projects.find(x=>x.id===projectId);
      if(updatedObj) renderObjectSummary(updatedObj);
    }
  }catch(e){
    console.error(e);
    if(insertedPayment&&!projectSynced){
      const rollback=await sb.from('ledger_entries').update({deleted_at:new Date().toISOString()}).eq('id',insertedPayment.id);
      showToast(rollback.error?'Не удалось завершить платёж. Проверьте журнал перед повтором':'Платёж не сохранён: данные проекта изменились или недоступны');
    }else showToast(projectSynced?'Платёж сохранён. Обновите страницу для проверки':'Платёж не сохранён. Проверьте журнал перед повтором');
    await loadAll();
  }finally{
    paymentSaveInFlight=false;
    document.getElementById('payment-save').disabled=false;
  }
}

document.getElementById('pf-add-payment').addEventListener('click', ()=>openPaymentSheet());
document.getElementById('pf-expense-add-btn').addEventListener('click', addProjectExpense);
document.getElementById('pf-expense-cancel-edit')?.addEventListener('click', resetProjectExpenseEditor);
document.getElementById('paymentSheetClose').addEventListener('click', ()=>{
  document.getElementById('paymentSheetOverlay').classList.remove('active');
});
document.getElementById('payment-save').addEventListener('click', savePayment);

async function deleteLedgerEntry(id){
  try{
    const e = state.ledger.find(x=>x.id===id);
    if(e?.project_id&&e.type==='project_expense'){await deleteProjectExpense(id,e.project_id);return;}
    if(e?.project_id&&e.type==='role_payout'){await deleteProjectRolePayout(id,e.project_id);return;}
    if(e?.project_id&&['advance','final_payment','materials_budget','construction_budget','fee_payment'].includes(e.type)){await cancelPayment(id);return;}
    const {error} = await sb.from('ledger_entries').update({deleted_at: new Date().toISOString()}).eq('id', id);
    if(error) throw error;
    const proj = e ? state.projects.find(p=>p.id===e.project_id) : null;
    await logAudit('ledger_entry', id, (proj?proj.name+' — ':'')+(e?.description||''), 'delete', {});
    showToast('Запись перемещена в корзину');
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }
}

