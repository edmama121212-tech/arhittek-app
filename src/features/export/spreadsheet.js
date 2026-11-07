// ============================================================
// XLSX EXPORT
// ============================================================
function buildExportRows(){
  const sheets = {};

  sheets['Проекты'] = state.projects.map(p=>{
    const cat = findCategory(p.category_id);
    const st = findStatus(p.status_id);
    const emp = findEmployee(p.employee_id);
    const dept = cat ? findDepartment(cat.department_id) : null;
    const f = getProjectFee(p);
    return {
      'Название': p.name,
      'ФИО клиента': p.client_name||'',
      'Отдел': dept?dept.name:'',
      'Категория': cat?cat.name:'',
      'Статус': st?st.name:'',
      'Оплата': p.payment_status||'',
      'Исполнитель': emp?emp.name:'',
      'Соисполнитель': findEmployee(p.co_employee_id)?.name||'',
      'Команда': (state.projectMembers||[]).filter(m=>m.project_id===p.id).map(m=>findEmployee(m.employee_id)?.name).filter(Boolean).join(', '),
      'Адрес': p.address||'',
      'Телефон': p.phone||'',
      'Цена': p.price||0,
      'Аванс': isConstructionProject(p)?getConstructionFinancials(p).received:p.advance||0,
      'Остаток': isConstructionProject(p)?getConstructionFinancials(p).balance:p.balance||0,
      'Расходы': getProjectExpenses(p),
      'Прибыль': f.profit,
      '% гонорара': f.feePercent,
      'Гонорар начислен': f.feeAmount,
      'Гонорар выплачен': f.paid,
      'Гонорар остаток': f.remaining,
      'Дата начала': p.start_date||'',
      'Дата сдачи': p.end_date||'',
      'Заметки': p.notes||'',
    };
  });

  sheets['Сотрудники'] = state.employees.map(e=>({
    'Имя': e.name,
    'Роль': e.role||'',
    'Активен': e.active===false?'нет':'да',
    'Проектов': state.projects.filter(p=>p.employee_id===e.id || p.co_employee_id===e.id || (state.projectMembers||[]).some(m=>m.project_id===p.id && m.employee_id===e.id)).length,
  }));

  sheets['Категории'] = state.categories.map(c=>{
    const dept = findDepartment(c.department_id);
    return {
      'Название': c.name,
      'Отдел': dept?dept.name:'',
      '% гонорара': c.fee_percent,
      'База гонорара': c.fee_base==='price'?'% от цены':'% от прибыли',
    };
  });

  sheets['Финансы'] = state.ledger.map(e=>{
    const proj = state.projects.find(p=>p.id===e.project_id);
    const t = ledgerTypeLabels[e.type]||{label:e.type};
    return {
      'Дата': e.entry_date||'',
      'Тип': t.label,
      'Проект': proj?proj.name:'',
      'Описание': e.description||'',
      'Сумма': e.amount,
    };
  });

  // Строительные накладные отдельным листом
  sheets['Накладные (Стройка)'] = state.invoices.map(inv=>{
    const proj = state.projects.find(p=>p.id===inv.project_id);
    return {
      'Дата': inv.invoice_date||'',
      'Объект': proj?proj.name:'',
      'Номер накладной': inv.number||'',
      'Тип': inv.item_type||'',
      'Категория': inv.category||'',
      'Описание': inv.description||'',
      'Сумма': inv.amount||0,
    };
  });

  return sheets;
}

function exportToXlsx(){
  if(!isOwner())return;
  const sheets = buildExportRows();
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows])=>{
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31));
  });
  const dateStr = financeToday();
  XLSX.writeFile(wb, `ARHITTEK-export-${dateStr}.xlsx`);
  showToast('Файл скачивается...');
}


