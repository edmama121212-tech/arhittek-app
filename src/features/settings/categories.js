// ============================================================
// CATEGORIES
// ============================================================
function renderCategories(){
  const card = document.getElementById('categoriesCard');
  if(!state.categories.length){
    card.innerHTML = '<div class="empty-state">Нет категорий</div>';
    return;
  }
  card.innerHTML = state.categories.map(c=>{
    const count = state.projects.filter(p=>p.category_id===c.id).length;
    const baseLabel = c.fee_base === 'price' ? '% от цены' : '% от прибыли';
    return `<div class="list-item">
      <div>
        <div class="li-name">${escapeHtml(c.name)}</div>
        <div class="li-meta">${c.fee_percent}% (${baseLabel}) · ${count} проект(ов)</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="openCategorySheet('${c.id}')">✎</button>
      </div>
    </div>`;
  }).join('');
}

function openCategorySheet(id){
  editingCategoryId = id;
  const overlay = document.getElementById('catSheetOverlay');
  const title = document.getElementById('catSheetTitle');
  const deleteBtn = document.getElementById('cf-delete');

  const deptSel = document.getElementById('cf-department');
  deptSel.innerHTML = state.departments.map(d=>`<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');

  if(id){
    const c = state.categories.find(x=>x.id===id);
    if(!c) return;
    title.textContent = 'Редактировать категорию';
    deleteBtn.style.display = '';
    document.getElementById('cf-name').value = c.name || '';
    document.getElementById('cf-feepercent').value = c.fee_percent ?? 0;
    document.getElementById('cf-feebase').value = c.fee_base || 'profit';
    deptSel.value = c.department_id || '';
  }else{
    title.textContent = 'Новая категория';
    deleteBtn.style.display = 'none';
    document.getElementById('cf-name').value = '';
    document.getElementById('cf-feepercent').value = '';
    document.getElementById('cf-feebase').value = 'profit';
    deptSel.selectedIndex = 0;
  }
  overlay.classList.add('active');
}

function closeCategorySheet(){
  document.getElementById('catSheetOverlay').classList.remove('active');
  editingCategoryId = null;
}

async function saveCategory(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  const name = document.getElementById('cf-name').value.trim();
  if(!name){ showToast('Введите название'); return; }
  const payload = {
    name,
    fee_percent: parseFloat(document.getElementById('cf-feepercent').value) || 0,
    fee_base: document.getElementById('cf-feebase').value || 'profit',
    department_id: document.getElementById('cf-department').value || null,
  };
  try{
    if(editingCategoryId){
      const before = state.categories.find(x=>x.id===editingCategoryId);
      const {error} = await sb.from('categories').update(payload).eq('id', editingCategoryId);
      if(error) throw error;
      const changes = diffChanges(before, payload, Object.keys(payload));
      if(Object.keys(changes).length) await logAudit('category', editingCategoryId, name, 'update', changes);
    }else{
      payload.sort_order = state.categories.length + 1;
      const {data, error} = await sb.from('categories').insert(payload).select().single();
      if(error) throw error;
      await logAudit('category', data.id, name, 'create', {});
    }
    showToast('Сохранено');
    closeCategorySheet();
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка сохранения');
  }
}

async function deleteCategory(){
  if(!session?.isAdmin){showToast("Требуются права администратора");return;}
  if(!editingCategoryId) return;
  try{
    const cat = state.categories.find(x=>x.id===editingCategoryId);
    const inUse = state.projects.some(p=>p.category_id===editingCategoryId);
    if(inUse){
      showToast('Нельзя удалить — есть проекты с этой категорией');
      return;
    }
    if(!confirm('Переместить категорию в корзину? Её можно будет восстановить.')) return;
    const {error} = await sb.from('categories').update({deleted_at: new Date().toISOString()}).eq('id', editingCategoryId);
    if(error) throw error;
    await logAudit('category', editingCategoryId, cat?cat.name:'', 'delete', {});
    showToast('Категория перемещена в корзину');
    closeCategorySheet();
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления');
  }
}

