// ============================================================
// TRASH (soft-deleted items)
// ============================================================
function renderTrash(){
  const card = document.getElementById('trashCard');
  const total = state.trash.projects.length + state.trash.employees.length + state.trash.categories.length + state.trash.ledger.length + (state.trash.companyExpenses||[]).length + (state.trash.companyIncome||[]).length + (state.trash.tariffs||[]).length;
  if(!total){
    card.innerHTML = '<div class="empty-state">Корзина пуста</div>';
    return;
  }

  // Корзина хранит записи до явного восстановления/ручного обслуживания базы.
  let html = '';

  state.trash.projects.forEach(p=>{
    html += `<div class="trash-item">
      <div>
        <div class="li-name">${escapeHtml(p.name)}</div>
        <div class="li-meta">Проект · удалён ${fmtDateTime(p.deleted_at)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="restoreItem('projects','${p.id}',${htmlJsArg(p.name)})">↺ Восстановить</button>
      </div>
    </div>`;
  });
  state.trash.employees.forEach(e=>{
    html += `<div class="trash-item">
      <div>
        <div class="li-name">${escapeHtml(e.name)}</div>
        <div class="li-meta">Сотрудник · удалён ${fmtDateTime(e.deleted_at)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="restoreItem('employees','${e.id}',${htmlJsArg(e.name)})">↺ Восстановить</button>
      </div>
    </div>`;
  });
  state.trash.categories.forEach(c=>{
    html += `<div class="trash-item">
      <div>
        <div class="li-name">${escapeHtml(c.name)}</div>
        <div class="li-meta">Категория · удалена ${fmtDateTime(c.deleted_at)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="restoreItem('categories','${c.id}',${htmlJsArg(c.name)})">↺ Восстановить</button>
      </div>
    </div>`;
  });
  state.trash.ledger.forEach(e=>{
    const t = ledgerTypeLabels[e.type] || ledgerTypeLabels.expense;
    html += `<div class="trash-item">
      <div>
        <div class="li-name">${escapeHtml(e.description||t.label)}</div>
        <div class="li-meta">Запись финансов · удалена ${fmtDateTime(e.deleted_at)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="restoreItem('ledger_entries','${e.id}',${htmlJsArg(e.description||t.label)})">↺ Восстановить</button>
      </div>
    </div>`;
  });
  (state.trash.companyExpenses||[]).forEach(e=>{
    const name=(e.category||'Расход')+(e.description?' — '+e.description:'');
    html += `<div class="trash-item">
      <div>
        <div class="li-name">${escapeHtml(name)} · −${fmtMoney(e.amount)}</div>
        <div class="li-meta">Расход компании · удалён ${fmtDateTime(e.deleted_at)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="restoreItem('company_expenses','${e.id}',${htmlJsArg(name)})">↺ Восстановить</button>
      </div>
    </div>`;
  });
  (state.trash.companyIncome||[]).forEach(e=>{
    const name=(e.category||'Доход')+(e.description?' — '+e.description:'');
    html += `<div class="trash-item">
      <div>
        <div class="li-name">${escapeHtml(name)} · +${fmtMoney(e.amount)}</div>
        <div class="li-meta">Доход компании · удалён ${fmtDateTime(e.deleted_at)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="restoreItem('company_income','${e.id}',${htmlJsArg(name)})">↺ Восстановить</button>
      </div>
    </div>`;
  });
  (state.trash.tariffs||[]).forEach(t=>{
    const name=(t.group_name||'Прайс')+' — '+(t.name||'Тариф');
    html += `<div class="trash-item">
      <div>
        <div class="li-name">${escapeHtml(name)}</div>
        <div class="li-meta">Тариф · ${fmtMoney(t.rate||0)} / ${escapeHtml(t.unit||'м²')} · удалён ${fmtDateTime(t.deleted_at)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="restoreItem('kp_catalog','${t.id}',${htmlJsArg(name)})">↺ Восстановить</button>
      </div>
    </div>`;
  });
  card.innerHTML = html;
}

const entityTypeMap = {
  projects: 'project',
  employees: 'employee',
  categories: 'category',
  ledger_entries: 'ledger_entry',
  company_expenses: 'company_expense',
  company_income: 'company_income',
  kp_catalog: 'tariff',
};

const itemRestoresInFlight=new Set();
async function restoreItem(table, id, name){
  const restoreKey=table+':'+id;if(itemRestoresInFlight.has(restoreKey))return;itemRestoresInFlight.add(restoreKey);
  let restoredLedger=null,previousDeletedAt=null,dependentSynced=false;
  try{
    // Use the server's deleted row, not a stale trash snapshot from this device.
    // Other entities only need public row metadata; never fetch employee secrets.
    const columns=table==='ledger_entries'?'*':'id,deleted_at';
    const before=await sb.from(table).select(columns).eq('id',id).not('deleted_at','is',null).maybeSingle();
    if(before.error)throw before.error;
    if(!before.data){await loadAll();showToast('Запись уже восстановлена или удалена. Данные обновлены.');return;}
    previousDeletedAt=before.data.deleted_at;
    const result=await sb.from(table).update({deleted_at:null}).eq('id',id).eq('deleted_at',previousDeletedAt).select(columns).maybeSingle();
    if(result.error)throw result.error;
    if(!result.data){await loadAll();showToast('Запись изменилась на другом устройстве. Данные обновлены.');return;}
    restoredLedger=table==='ledger_entries'?result.data:null;

    if(restoredLedger?.project_id){
      await loadAll();
      if(!state.financialDataReady)throw new Error('Не удалось проверить восстановленный платёж. Повторите обновление.');
      const p=getFinancialProjects().find(x=>x.id===restoredLedger.project_id);
      if(!p)throw new Error('Проект восстановленного платежа не найден');
      const amount=Number(restoredLedger.amount)||0,updates={};
      if(restoredLedger.type==='project_expense'){
        const total=isConstructionProject(p)?getProjectExpenses({...p,expenses:0}):(state.ledger||[]).filter(e=>e.project_id===p.id&&e.type==='project_expense'&&!e.deleted_at).reduce((sum,e)=>sum+(Number(e.amount)||0),0);
        updates.expenses=total;
      }else if(restoredLedger.type==='fee_payment'){
        const field=projectFeePaidField(p,restoredLedger);if(field)updates[field]=(Number(p[field])||0)+amount;
      }else if(['advance','final_payment','materials_budget','construction_budget','income'].includes(restoredLedger.type)){
        if(isConstructionProject(p)){const fin=getConstructionFinancials(p);updates.balance=fin.balance;updates.advance=fin.received;}
        else{
          updates.advance=(Number(p.advance)||0)+amount;
          updates.balance=Math.max(0,(Number(p.price)||0)-updates.advance);
        }
      }
      if(isConstructionProject(p))updates.balance=getConstructionFinancials(p).balance;
      if(Object.keys(updates).length){
        let query=sb.from('projects').update(updates).eq('id',p.id);
        for(const field of Object.keys(updates))query=p[field]==null?query.is(field,null):query.eq(field,p[field]);
        const update=await query.select('id').maybeSingle();
        if(update.error)throw update.error;
        if(!update.data)throw new Error('Суммы проекта изменились на другом устройстве. Повторите восстановление после обновления.');
      }
    }
    dependentSynced=true;
    await logAudit(entityTypeMap[table],id,name,'restore',{});
    await loadAll();
    showToast('Восстановлено');
  }catch(e){
    console.error(e);
    // This is a compensating request, not a database transaction. Preserve a
    // clear warning if the row cannot be returned to its original deleted state.
    let rollbackFailed=false;
    if(restoredLedger&&!dependentSynced){
      try{
        const rollback=await sb.from('ledger_entries').update({deleted_at:previousDeletedAt}).eq('id',id).is('deleted_at',null).select('id').maybeSingle();
        rollbackFailed=!!rollback.error;
      }catch(rollbackError){console.error(rollbackError);rollbackFailed=true;}
      await loadAll();
    }
    showToast(rollbackFailed?'Восстановление не завершено. Проверьте журнал перед повтором':'Ошибка восстановления. Обновите данные перед повтором');
  }finally{itemRestoresInFlight.delete(restoreKey);}
}

