// ============================================================
// ТАРИФЫ УСЛУГ (КП) — управление ставками по направлениям
// ============================================================
let editingTariffId = null;

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
          <div class="li-meta">${fmt(it.rate)} ₽ / ${escapeHtml(it.unit)}</div>
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
  editingTariffId = id || null;
  const overlay = document.getElementById('tariffSheetOverlay');
  const title = document.getElementById('tariffSheetTitle');
  const deleteBtn = document.getElementById('tf-delete');
  if(id){
    const it = (state.kpCatalog||[]).find(x=>x.id===id);
    if(!it) return;
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

function closeTariffSheet(){
  document.getElementById('tariffSheetOverlay').classList.remove('active');
  editingTariffId = null;
}

async function saveTariff(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  const group_name = document.getElementById('tf-group').value.trim();
  const name = document.getElementById('tf-name').value.trim();
  const unit = document.getElementById('tf-unit').value;
  const rate = parseFloat(document.getElementById('tf-rate').value) || 0;
  const description = document.getElementById('tf-desc').value.trim();
  if(!group_name || !name){ showToast('Укажите направление и название услуги'); return; }
  if(!Number.isFinite(rate)||rate<0){showToast('Стоимость не может быть отрицательной');return;}
  try{
    if(editingTariffId){
      const {error} = await sb.from('kp_catalog').update({group_name, name, unit, rate, description, updated_at: new Date().toISOString()}).eq('id', editingTariffId);
      if(error) throw error;
    }else{
      const sort_order = (state.kpCatalog||[]).length;
      const {error} = await sb.from('kp_catalog').insert({group_name, name, unit, rate, description, sort_order});
      if(error) throw error;
    }
    showToast('Тариф сохранён');
    closeTariffSheet();
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка сохранения тарифа — проверьте, что миграция kp_catalog выполнена в Supabase');
  }
}

async function deleteTariff(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  if(!editingTariffId) return;
  if(!confirm('Переместить тариф в корзину? Его можно будет восстановить.')) return;
  try{
    const before=(state.kpCatalog||[]).find(x=>x.id===editingTariffId);
    const {error} = await sb.from('kp_catalog').update({deleted_at: new Date().toISOString()}).eq('id', editingTariffId);
    if(error) throw error;
    await logAudit('tariff',editingTariffId,before?((before.group_name||'Прайс')+' — '+(before.name||'Тариф')):'Тариф','delete',{});
    showToast('Тариф перемещён в корзину');
    closeTariffSheet();
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }
}

