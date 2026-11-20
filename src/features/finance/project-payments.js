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
  withdrawal: 'Уменьшит деньги в сейфе. Полученную от клиента сумму и долг по договору сохранит. Укажите причину вывода в комментарии.',
};

function syncPaymentTiming(){
  const date=document.getElementById('payment-date');
  const prior=document.getElementById('payment-before-start');
  const receipt=['advance','final_payment','materials_budget'].includes(paymentType);
  if(!receipt)prior.checked=false;
  prior.disabled=!receipt;
  document.getElementById('payment-history-field').hidden=!receipt;
  date.disabled=prior.checked;
  date.closest('.field').hidden=prior.checked;
  const journal=state.financialJournal;
  const start=journal?.workspace?.start_date||(journal?.activated_at?ARHITTEKCash.day(new Date(journal.activated_at)):null);
  const previousReceipt=receipt&&(prior.checked||Boolean(date.value&&start&&date.value<start));
  document.getElementById('payment-history-note').hidden=!previousReceipt;
  document.getElementById('paymentSheetOverlay').toggleAttribute('data-prior-receipt',previousReceipt);
}
document.getElementById('payment-before-start').addEventListener('change',syncPaymentTiming);
document.getElementById('payment-date').addEventListener('input',syncPaymentTiming);

function openPaymentSheet(projectId){
  paymentProjectId = projectId || editingProjectId;
  if(!paymentProjectId) return;
  paymentType = 'advance';
  document.getElementById('payment-before-start').checked=false;
  document.querySelectorAll('#payment-type .yn-btn').forEach(b=>b.classList.toggle('selected', b.dataset.value==='advance'));
  document.getElementById('payment-amount').value = '';
  document.getElementById('payment-note').value = '';
  document.getElementById('payment-date').max = financeToday();
  document.getElementById('payment-date').value = financeToday();
  syncPaymentTiming();
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
    syncPaymentTiming();
    document.getElementById('payment-payee-field').hidden=paymentType!=='fee_payment';
    document.getElementById('payment-hint').textContent = paymentHints[paymentType] || '';
  });
});

let paymentSaveInFlight=false;
function projectFeePaidField(project,entry){
  if(!project||project.fee_base==='m2')return null;
  const payee=entry?.payee_employee_id;
  // Older payments without a recipient used the primary executor's counter.
  if(!payee||payee===project.employee_id)return 'fee_paid';
  if(payee===project.co_employee_id)return 'co_fee_paid';
  return null;
}
async function savePayment(){
  if(paymentSaveInFlight) return;
  if(!session?.isAdmin){showToast('Финансовые операции сохраняет администратор');return;}
  const projectId = paymentProjectId || editingProjectId;
  if(!projectId) return;
  const amount = parseFloat(document.getElementById('payment-amount').value);
  const historical=document.getElementById('payment-before-start').checked;
  const entry_date=historical?financeToday():document.getElementById('payment-date').value;
  const note = document.getElementById('payment-note').value.trim();

  if(!Number.isFinite(amount) || amount <= 0){ showToast('Укажите сумму платежа'); return; }
  if(document.getElementById('payment-amount').validity.stepMismatch){showToast('Введите сумму с точностью до копейки');return;}
  if(!entry_date){showToast('Укажите фактическую дату платежа');return;}
  if(entry_date>financeToday()){showToast('Фактический платёж не может быть в будущем');return;}
  if(paymentType === 'withdrawal' && !note){ showToast('Укажите причину вывода средств'); return; }

  const p = state.projects.find(x=>x.id===projectId);
  if(!p) return;
  const payeeEmployeeId=paymentType==='fee_payment'?document.getElementById('payment-payee').value:null;
  if(paymentType==='fee_payment'&&!payeeEmployeeId){showToast('Укажите сотрудника в команде проекта');return;}

  if(historical&&!['advance','final_payment','income','materials_budget','construction_budget'].includes(paymentType)){showToast('Прежняя оплата доступна только для поступлений клиента');return;}
  const updates = {};
  if(paymentType === 'fee_payment'){
    const field=projectFeePaidField(p,{payee_employee_id:payeeEmployeeId});
    if(field)updates[field]=(Number(p[field])||0)+amount;
  }else if(paymentType === 'withdrawal'){
    // No effect on project financial fields — purely a journal record with a reason
  }else{
    const newAdvance = (Math.round((Number(p.advance)||0)*100)+Math.round(amount*100))/100;
    updates.advance = newAdvance;
    updates.balance = outstandingProjectBalance(Number(p.price)||0,newAdvance);
    if(!isConstructionProject(p))updates.payment_status=newAdvance>=Number(p.price)&&Number(p.price)>0?'Оплачен':'Частично оплачен';
  }

  paymentSaveInFlight=true;
  document.getElementById('payment-save').disabled=true;
  showToast('Сохранение…');
  let projectSynced=false;
  try{
    const t = ledgerTypeLabels[paymentType];
    const description = window.ARHITTEKCash?.operationDescription ? ARHITTEKCash.operationDescription('payment-note',note || t?.label || 'Платёж') : note || t?.label || 'Платёж';
    const entry={type:paymentType,project_id:projectId,description,amount,entry_date,
      payee_employee_id:payeeEmployeeId,received_before_start:historical};
    if(isConstructionProject(p)){
      const finAfterPayment=getConstructionFinancials(p,[...(state.ledger||[]),entry]);
      updates.balance=finAfterPayment.balance;
      if(CONSTRUCTION_INCOME_TYPES.includes(paymentType))updates.advance=finAfterPayment.received;
    }
    const expected={};
    for(const field of ['price','category_id','employee_id','co_employee_id','fee_base',...Object.keys(updates)])expected[field]=p[field]??null;
    // Reuse the request ID if confirmation was lost, including after a reload.
    const key='arhittek.project-payment.'+session.employeeId+'.'+projectId;
    const signature=JSON.stringify([entry,window.ARHITTEKFinanceWorkspace?.selectedWallet()||null]);
    let pending;
    try{pending=JSON.parse(sessionStorage.getItem(key));}catch{}
    if(pending&&pending.signature!==signature){
      const previous=await sb.from('ledger_entries').select('id').eq('id',pending.id).maybeSingle();
      if(!previous.error&&previous.data){
        sessionStorage.removeItem(key);
        showToast('Предыдущий платёж уже сохранён. Сверьте историю перед новой оплатой.');
      }else showToast('Результат предыдущей отправки неизвестен. Проверьте историю и повторите прежние данные.');
      return;
    }
    entry.id=pending?.id||crypto.randomUUID();
    sessionStorage.setItem(key,JSON.stringify({signature,id:entry.id}));
    const {data,error}=await sb.rpc('record_project_card_payment',{p_entry:entry,p_expected:expected,p_updates:updates});
    if(error){
      // A definite SQL rejection rolled back the transaction. A transport error may have lost only the response.
      if(/^(22|23|40|42)/.test(error.code||'')||error.code==='PGRST202')sessionStorage.removeItem(key);
      throw error;
    }
    if(data!==entry.id)throw new Error('Не получено подтверждение платежа');
    sessionStorage.removeItem(key);
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
        document.getElementById('pf-co-feepaid').value = updated.co_fee_paid ?? '';
        if(updates.payment_status)document.getElementById('pf-payment').value=updated.payment_status;
        window.refreshProjectWorkspace?.();
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
    const notice=e?.code==='40001'?'Данные проекта изменились. Обновите карточку перед повтором.':window.ARHITTEKCash?.insufficientFundsNotice(e);
    showToast(projectSynced?'Платёж сохранён. Обновите страницу для проверки':(notice||'Проверьте историю платежей перед повтором'));
    await loadAll();
  }finally{
    paymentSaveInFlight=false;
    document.getElementById('payment-save').disabled=false;
  }
}

document.getElementById('pf-add-payment').addEventListener('click', ()=>openPaymentSheet());
document.getElementById('pf-expense-add-btn').addEventListener('click', addProjectExpense);
document.getElementById('pf-expense-cancel-edit')?.addEventListener('click', ()=>{
  const edited=document.querySelector('#pf-expenses-list [data-edit-expense="'+CSS.escape(editingProjectExpenseId)+'"]');
  resetProjectExpenseEditor();
  edited?.focus();
});
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
    await logAudit('ledger_entry', id, (proj?proj.name+' — ':'')+(e?.description||''), 'delete', {_project_id:e?.project_id});
    showToast('Запись перемещена в корзину');
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }
}

