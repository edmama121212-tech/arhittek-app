// ============================================================
// CANCEL PAYMENT
// ============================================================
const paymentCancellationsInFlight=new Set();
async function cancelPayment(entryId){
  if(paymentCancellationsInFlight.has(entryId))return;
  if(!confirm('Отменить этот платёж? Сумма будет возвращена в расчёты проекта.')) return;
  paymentCancellationsInFlight.add(entryId);
  let cancelledEntry=null,projectSynced=false;
  try{
    const e = state.ledger.find(x => x.id === entryId);
    if(!e){ showToast('Запись не найдена'); return; }
    const p = state.projects.find(x => x.id === e.project_id);

    // Soft-delete the ledger entry
    const {data:cancelled,error} = await sb.from('ledger_entries').update({deleted_at: new Date().toISOString()}).eq('id', entryId).is('deleted_at',null).select().maybeSingle();
    if(error) throw error;
    if(!cancelled){await loadAll();return;}
    cancelledEntry=e;

    // Reverse the project financial fields
    const updates = {};
    if(p && isConstructionProject(p)){
      const ledgerAfterCancel = (state.ledger||[]).map(x=>x.id===entryId ? {...x, deleted_at:new Date().toISOString()} : x);
      const finAfterCancel = getConstructionFinancials(p, ledgerAfterCancel);
      updates.balance = finAfterCancel.balance;
      if(CONSTRUCTION_INCOME_TYPES.includes(e.type))updates.advance=finAfterCancel.received;
      if(e.type==='fee_payment'){
        const field=projectFeePaidField(p,e);if(field)updates[field]=Math.max(0,(Number(p[field])||0)-(Number(e.amount)||0));
      }
    }else if(e.type === 'fee_payment'){
      const field=projectFeePaidField(p,e);if(field)updates[field]=Math.max(0,(Number(p?.[field])||0)-(Number(e.amount)||0));
    } else if(e.type !== 'withdrawal'){
      const newAdvance = Math.max(0, (Number(p?.advance)||0) - (Number(e.amount)||0));
      updates.advance = newAdvance;
      updates.balance = Math.max(0, (Number(p?.price)||0) - newAdvance);
    }

    if(p && Object.keys(updates).length){
      let query=sb.from('projects').update(updates).eq('id',p.id);
      for(const field of Object.keys(updates))query=p[field]==null?query.is(field,null):query.eq(field,p[field]);
      const {data:updated,error:projErr}=await query.select().maybeSingle();
      if(projErr) throw projErr;
      if(!updated)throw new Error('Проект изменился на другом устройстве');
    }
    projectSynced=true;

    if(p) await logAudit('project', p.id, p.name, 'update', {
      payment_cancelled: {old: null, new: 'отмена: ' + (e.description||entryId)}
    });

    showToast('Платёж отменён');
    await loadAll();

    if(editingProjectId === e.project_id){
      const updated = state.projects.find(x => x.id === e.project_id);
      if(updated){
        document.getElementById('pf-advance').value = updated.advance||0;
        document.getElementById('pf-balance').value = updated.balance||0;
      }
      renderPaymentHistory(e.project_id);
      if(updated) renderFeeSummaryForProject(updated);
    }
    if(currentObjectId === e.project_id){
      const updatedObj = state.projects.find(x => x.id === e.project_id);
      if(updatedObj) renderObjectSummary(updatedObj);
    }
  }catch(err){
    console.error(err);
    if(cancelledEntry&&!projectSynced){
      const rollback=await sb.from('ledger_entries').update({deleted_at:null}).eq('id',entryId);
      showToast(rollback.error?'Отмена не завершена. Проверьте историю перед повтором':'Платёж сохранён: отмена не завершена');
    }else showToast(projectSynced?'Платёж отменён. Обновите страницу':'Ошибка отмены платежа');
    await loadAll();
  }finally{
    paymentCancellationsInFlight.delete(entryId);
  }
}

