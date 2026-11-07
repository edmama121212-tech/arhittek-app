// ============================================================
// АКТИВНЫЕ ПРОЕКТЫ ПО ОТДЕЛАМ — Дизайн / Архитектура (Обзор)
// ============================================================
function renderActiveDeptSplit(){
  var el = document.getElementById('plBlock');
  if(!el) return;

  var constrDept = state.departments.find(function(d){ return d.name==='Строительный отдел'; });
  var doneStatus = state.statuses.find(function(s){ return s.name==='Завершён'; });

  var nonConstrActive = state.projects.filter(function(p){
    if(doneStatus && p.status_id === doneStatus.id) return false;
    if(isFrozen(p)) return false;
    var cat = findCategory(p.category_id);
    if(constrDept && cat && cat.department_id === constrDept.id) return false;
    if(cat && (cat.name||'').toLowerCase().indexOf('строительств') !== -1) return false;
    return true;
  });

  function isArch(p){
    var cat = findCategory(p.category_id);
    return !!(cat && (cat.name||'').toLowerCase().indexOf('архитект') !== -1);
  }
  function isLandscape(p){
    var cat = findCategory(p.category_id);
    return !!(cat && (cat.name||'').toLowerCase().indexOf('ландшафт') !== -1);
  }

  var landscapeProjects = nonConstrActive.filter(isLandscape);
  var archProjects = nonConstrActive.filter(function(p){ return isArch(p) && !isLandscape(p); });
  var designProjects = nonConstrActive.filter(function(p){ return !isArch(p) && !isLandscape(p); });

  function sortByDeadline(arr){
    return arr.map(function(p){ return {p:p, d: p.end_date ? daysUntil(p.end_date) : null}; })
      .sort(function(a,b){
        if(a.d===null && b.d===null) return 0;
        if(a.d===null) return 1;
        if(b.d===null) return -1;
        return a.d - b.d;
      });
  }

  function renderColumn(title, icon, items){
    if(!items.length){
      return '<div class="dept-col">' +
        '<div style="font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:var(--blue); font-weight:700; margin-bottom:8px;">' + icon + ' ' + title + '</div>' +
        '<div class="empty-state" style="padding:14px 0; font-size:12px;">Нет активных проектов</div>' +
        '</div>';
    }
    var rows = sortByDeadline(items).map(function(o){
      var p = o.p, d = o.d;
      var price = Number(p.price)||0;
      var balance = Number(p.balance)||0;
      var paid = Math.max(0, price - balance);
      var dateTxt, dateColor;
      if(d===null){ dateTxt = 'без срока'; dateColor = 'var(--text-dim)'; }
      else if(d < 0){ dateTxt = 'просрочен на ' + Math.abs(d) + ' дн.'; dateColor = 'var(--red)'; }
      else if(d <= 7){ dateTxt = d + ' дн. до сдачи'; dateColor = 'var(--gold)'; }
      else { dateTxt = d + ' дн. до сдачи'; dateColor = 'var(--text-dim)'; }
      return '<div class="list-item" onclick="openProjectSheet(\'' + p.id + '\')" style="cursor:pointer;">' +
        '<div style="min-width:0;">' +
          '<div class="li-name">' + escapeHtml(p.name) + '</div>' +
          '<div class="li-meta">оплачено ' + fmtMoney(paid) + ' · осталось ' + fmtMoney(balance) + '</div>' +
        '</div>' +
        '<div style="text-align:right; flex-shrink:0;">' +
          '<div class="proj-sum" style="font-size:12px; color:' + dateColor + ';">' + dateTxt + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="dept-col">' +
      '<div style="font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:var(--blue); font-weight:700; margin-bottom:8px;">' + icon + ' ' + title + '</div>' +
      rows +
      '</div>';
  }

  el.innerHTML = '<div class="card dept-split" style="margin-bottom:10px;">' +
    renderColumn('Дизайн', '🎨', designProjects) +
    renderColumn('Архитектура', '📐', archProjects) +
    renderColumn('Ландшафт', '🌿', landscapeProjects) +
    '</div>';
}

