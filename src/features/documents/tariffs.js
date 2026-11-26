// ============================================================
// ТАРИФЫ УСЛУГ (КП) — управление ставками по направлениям
// ============================================================
let editingTariffId = null;
let tariffOpenedAt = null;
let tariffDraftId = null;
let tariffWritePending = false;

function renderTariffs(){
  const card = document.getElementById('tariffsCard');
  if(!card) return;
  const groups = kpCatalogGrouped();
  const isDb = (state.kpCatalog||[]).length > 0;
  if(!groups.length){ card.innerHTML = '<div class="empty-state">Нет тарифов</div>'; return; }
  let html = '';
  if(!isDb){
    html += `<div class="note" style="margin-bottom:10px;color:var(--gold);">Показаны встроенные тарифы по умолчанию. Отредактируйте или добавьте любой тариф — с этого момента список станет полностью вашим.</div>`;
  }
  groups.forEach(g=>{
    html += `<div style="font-size:11px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:0.06em;margin:12px 0 6px;">${escapeHtml(g.group)}</div>`;
    g.items.forEach(it=>{
      const editable = !!it.id;
      html += `<div class="list-item">
        <div>
          <div class="li-name">${escapeHtml(it.name)}</div>
          <div class="li-meta">${kpNumber(it.rate)} ₽ / ${escapeHtml(it.unit)}</div>
        </div>
        <div class="li-actions">
          ${editable
            ? `<button class="icon-btn" onclick="openTariffSheet('${it.id}')">✎</button>`
            : `<button class="icon-btn" title="Сохраните, чтобы отредактировать" onclick="openTariffSheet(null,${htmlJsArg(g.group)},${htmlJsArg(it.name)},${it.rate},${htmlJsArg(it.unit)},${htmlJsArg(it.desc||'')})">✎</button>`}
        </div>
      </div>`;
    });
  });
  card.innerHTML = html;
}

function openTariffSheet(id, presetGroup, presetName, presetRate, presetUnit, presetDesc){
  if(tariffWritePending)return;
  editingTariffId = id || null;
  tariffOpenedAt = null;
  tariffDraftId = id ? null : crypto.randomUUID();
  const overlay = document.getElementById('tariffSheetOverlay');
  const title = document.getElementById('tariffSheetTitle');
  const deleteBtn = document.getElementById('tf-delete');
  if(id){
    const it = (state.kpCatalog||[]).find(x=>x.id===id);
    if(!it) return;
    tariffOpenedAt = it.updated_at;
    title.textContent = 'Редактировать тариф';
    deleteBtn.style.display = '';
    document.getElementById('tf-group').value = it.group_name || '';
    document.getElementById('tf-name').value = it.name || '';
    document.getElementById('tf-unit').value = it.unit || 'м²';
    document.getElementById('tf-rate').value = it.rate ?? '';
    document.getElementById('tf-desc').value = it.description || '';
  }else{
    title.textContent = presetName ? 'Редактировать тариф' : 'Новый тариф';
    deleteBtn.style.display = 'none';
    document.getElementById('tf-group').value = presetGroup || '';
    document.getElementById('tf-name').value = presetName || '';
    document.getElementById('tf-unit').value = presetUnit || 'м²';
    document.getElementById('tf-rate').value = (presetRate !== undefined && presetRate !== null) ? presetRate : '';
    document.getElementById('tf-desc').value = presetDesc || '';
  }
  overlay.classList.add('active');
}

function closeTariffSheet(written){
  if(tariffWritePending && written!==true)return;
  document.getElementById('tariffSheetOverlay').classList.remove('active');
  editingTariffId = null;
}

function setTariffPending(pending){
  tariffWritePending=pending;
  for(const button of document.querySelectorAll('#tariffSheetOverlay button'))button.disabled=pending;
}

function updateOpenedTariff(payload){
  const query=sb.from('kp_catalog').update(payload).eq('id',editingTariffId).is('deleted_at',null);
  const version=tariffOpenedAt==null ? query.is('updated_at',null) : query.eq('updated_at',tariffOpenedAt);
  return version.select('id').maybeSingle();
}

async function saveTariff(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  if(tariffWritePending)return;
  const group_name = document.getElementById('tf-group').value.trim();
  const name = document.getElementById('tf-name').value.trim();
  const unit = document.getElementById('tf-unit').value;
  const rate = parseFloat(document.getElementById('tf-rate').value) || 0;
  const description = document.getElementById('tf-desc').value.trim();
  if(!group_name || !name){ showToast('Укажите направление и название услуги'); return; }
  if(!Number.isFinite(rate)||rate<0){showToast('Стоимость не может быть отрицательной');return;}
  const fields={group_name,name,unit,rate,description};
  setTariffPending(true);
  try{
    let saved;
    if(editingTariffId){
      saved=await updateOpenedTariff({...fields,updated_at:new Date().toISOString()});
    }else{
      const sort_order=(state.kpCatalog||[]).length;
      saved=await sb.from('kp_catalog').insert({...fields,id:tariffDraftId,sort_order}).select('id').maybeSingle();
      // A reply may have been lost after the server committed this draft.
      if(saved.error?.code==='23505'){
        saved=await sb.from('kp_catalog').select('id,group_name,name,unit,rate,description')
          .eq('id',tariffDraftId).is('deleted_at',null).maybeSingle();
        if(saved.data && Object.entries(fields).some(([key,value])=>String(saved.data[key]??'')!==String(value)))saved={data:null};
      }
    }
    if(saved.error)throw saved.error;
    if(!saved.data){
      showToast('Тариф изменился или удалён. Откройте актуальную запись и сверьте черновик.');
      await loadAll();
      return;
    }
    showToast('Тариф сохранён');
    closeTariffSheet(true);
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Не удалось сохранить тариф. Черновик остался в форме.');
  }finally{setTariffPending(false);}
}

async function deleteTariff(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  if(!editingTariffId||tariffWritePending)return;
  if(!confirm('Переместить тариф в корзину? Его можно будет восстановить.'))return;
  setTariffPending(true);
  try{
    const before=(state.kpCatalog||[]).find(x=>x.id===editingTariffId);
    const now=new Date().toISOString();
    const saved=await updateOpenedTariff({deleted_at:now,updated_at:now});
    if(saved.error)throw saved.error;
    if(!saved.data){
      showToast('Тариф изменился или удалён. Откройте актуальную запись перед удалением.');
      await loadAll();
      return;
    }
    await logAudit('tariff',editingTariffId,before?((before.group_name||'Прайс')+' — '+(before.name||'Тариф')):'Тариф','delete',{});
    showToast('Тариф перемещён в корзину');
    closeTariffSheet(true);
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }finally{setTariffPending(false);}
}
