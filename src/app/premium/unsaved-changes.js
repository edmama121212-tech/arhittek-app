// ===== UX safety: protect unsaved form edits =====
(()=>{
  const overlayIds=[
    'projectSheetOverlay','paymentSheetOverlay','empSheetOverlay','catSheetOverlay',
    'tariffSheetOverlay','companyExpenseSheetOverlay','companyIncomeSheetOverlay',
    'tzSheetOverlay','invoiceSheetOverlay','shareLinkOverlay','financeControlSheetOverlay'
  ];

  function visibleOverlay(el){
    if(!el) return false;
    return el.classList.contains('active') || (el.style.display && el.style.display!=='none');
  }
  function resetDirty(el){ if(el) el.dataset.dirty='0'; }
  function markDirtyFromEvent(e){
    const el=overlayIds.map(id=>document.getElementById(id)).find(o=>o&&o.contains(e.target)&&visibleOverlay(o));
    if(el && !e.target.matches('button')) el.dataset.dirty='1';
    const view=e.target.closest?.('#view-kp,#view-contracts');
    if(view && view.classList.contains('active') && !e.target.matches('button')) view.dataset.dirty='1';
  }
  document.addEventListener('input',markDirtyFromEvent,true);
  document.addEventListener('change',markDirtyFromEvent,true);

  // Reset when a sheet is freshly opened.
  const observer=new MutationObserver(records=>{
    records.forEach(r=>{
      const el=r.target;
      if(overlayIds.includes(el.id) && visibleOverlay(el)) resetDirty(el);
    });
  });
  overlayIds.forEach(id=>{
    const el=document.getElementById(id);
    if(el) observer.observe(el,{attributes:true,attributeFilter:['class','style']});
  });

  document.addEventListener('click',e=>{
    const close=e.target.closest?.('.sheet-close,#pf-cancel,#ef-cancel,#cf-cancel,#tf-cancel,#cex-cancel,#cin-cancel');
    if(close){
      const overlay=overlayIds.map(id=>document.getElementById(id)).find(o=>o&&o.contains(close)&&visibleOverlay(o));
      if(overlay?.dataset.dirty==='1' && !confirm('Есть несохранённые изменения. Закрыть окно и потерять их?')){
        e.preventDefault();e.stopImmediatePropagation();
        return;
      }
    }

    const leavesProject=e.target.closest?.('#pf-create-kp,#pf-create-contract,#pf-open-as-object');
    const projectOverlay=document.getElementById('projectSheetOverlay');
    if(leavesProject && projectOverlay?.classList.contains('active') && projectOverlay.dataset.dirty==='1'){
      if(!confirm('В карточке проекта есть несохранённые изменения. Продолжить и потерять их?')){
        e.preventDefault();e.stopImmediatePropagation();
        return;
      }
      projectOverlay.dataset.dirty='0';
    }

    const back=e.target.closest?.('#kpBack,#contractsBack');
    if(back){
      const view=back.closest('.view');
      if(view?.dataset.dirty==='1' && !confirm('Есть несохранённые изменения. Выйти без сохранения?')){
        e.preventDefault();e.stopImmediatePropagation();
      }
    }
  },true);

  // Навигация по нижнему/боковому меню из КП или договора.
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      const active=document.querySelector('#view-kp.active,#view-contracts.active');
      if(active?.dataset.dirty==='1' && !confirm('Есть несохранённые изменения. Перейти в другой раздел без сохранения?')){
        e.preventDefault();e.stopImmediatePropagation();
      }
    },true);
  });

  window.addEventListener('beforeunload',e=>{
    const dirtyOverlay=overlayIds.some(id=>{const el=document.getElementById(id);return visibleOverlay(el)&&el.dataset.dirty==='1';});
    const dirtyView=document.querySelector('#view-kp.active[data-dirty="1"],#view-contracts.active[data-dirty="1"]');
    if(dirtyOverlay||dirtyView){e.preventDefault();e.returnValue='';}
  });

  // Each save flow clears its marker only after a confirmed database write.

})();


