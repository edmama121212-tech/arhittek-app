// ============================================================
// QUICK BALANCE EDIT (from debt list on overview)
// ============================================================
async function updateProjectBalance(id, newBalance){
  try{
    const p = state.projects.find(x=>x.id===id);
    if(p && isConstructionProject(p)){
      showToast('Для строительного объекта остаток рассчитывается автоматически по приходам и расходам.');
      return;
    }
    const advance = p ? (Number(p.advance)||0) : 0;
    let payment_status;
    if(newBalance <= 0) payment_status = 'Оплачен';
    else if(advance > 0) payment_status = 'Частично оплачен';
    else payment_status = 'Ждём оплату';

    const {error} = await sb.from('projects').update({balance: newBalance, payment_status, updated_at: new Date().toISOString()}).eq('id', id);
    if(error) throw error;
    await logAudit('project', id, p ? p.name : '', 'update', {balance: {old: p?p.balance:null, new: newBalance}, payment_status: {old: p?p.payment_status:null, new: payment_status}});
    showToast(newBalance === 0 ? 'Отмечено как оплачено' : 'Остаток обновлён');
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка сохранения');
  }
}

function editBalance(id, el){
  const current = el.dataset.balance;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = current;
  input.style.cssText = 'width:90px; background:var(--card); border:1px solid var(--line-strong); border-radius:6px; color:var(--gold); font-family:Space Grotesk,sans-serif; font-weight:700; font-size:14px; padding:4px 6px; text-align:right;';
  input.onclick = (e)=>e.stopPropagation();

  const finish = async ()=>{
    const val = parseFloat(input.value);
    if(isNaN(val) || val < 0){
      showToast('Введите корректную сумму');
      renderOverview();
      return;
    }
    await updateProjectBalance(id, val);
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') input.blur(); });

  el.replaceWith(input);
  input.focus();
  input.select();
}

async function markPaid(id){
  await updateProjectBalance(id, 0);
}

