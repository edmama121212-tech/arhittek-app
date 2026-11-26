// Fixed employee ranks and navigation guards. Data authorization is enforced by
// owner-access.sql as well; hidden navigation is never a database permission.
(()=>{
'use strict';
const rolesWithDocuments=new Set(['ведущий архитектор','ведущий дизайнер']);
window.updateEmployeeAccessSummary=function(){
  const select=document.getElementById('ef-role'),summary=document.getElementById('ef-role-access');
  if(!select||!summary)return;
  const owner=isOwner()&&editingEmployeeId===session.employeeId;
  const lead=rolesWithDocuments.has(select.value.trim().toLowerCase());
  const projects=document.getElementById('ef-see-projects').checked;
  const construction=document.getElementById('ef-see-construction').checked;
  const sections=[projects?'свои проекты':'',construction?'свои объекты стройки':''].filter(Boolean);
  const access=sections.length?'Доступны '+sections.join(' и ')+'.':'Проектный и строительный разделы выключены.';
  summary.textContent=owner?'Владелец видит все проекты и все разделы.':
    access+(lead?' В «Ещё» доступны КП и Договор.':' Раздел «Ещё» закрыт.')+' Финансы и табель закрыты.';
  const active=document.getElementById('ef-active'),del=document.getElementById('ef-delete');
  if(active)active.disabled=owner;
  if(del&&owner)del.style.display='none';
};
for(const id of ['ef-role','ef-see-projects','ef-see-construction'])document.getElementById(id)?.addEventListener('change',window.updateEmployeeAccessSummary);
const buttonViews={settingsBtn:'view-settings',exportXlsxBtn:'view-finance',openTimesheetBtn:'view-timesheet',
  premiumOpenPayroll:'view-timesheet',openKpBtn:'view-kp',openContractsBtn:'view-contracts',
  openCompanyBtn:'view-company',openPriceListBtn:'view-company',openFamilyTreeBtn:'view-family-tree'};
document.addEventListener('click',event=>{
  const target=event.target.closest('.nav-btn[data-view],'+Object.keys(buttonViews).map(id=>'#'+id).join(','));
  if(!target)return;
  const view=target.dataset.view||buttonViews[target.id];
  if(view&&!canAccessView(view)){event.preventDefault();event.stopImmediatePropagation();}
},true);
// Reject stale restored routes or an unguarded legacy handler before it can
// leave an unavailable screen active. CSS keeps it hidden from the first paint.
const observer=new MutationObserver(()=>applyAccessVisibility());
document.querySelectorAll('.view').forEach(el=>observer.observe(el,{attributes:true,attributeFilter:['class']}));
window.addEventListener('storage',event=>{
  if(event.key!=='arhittek_session')return;
  try{
    const next=JSON.parse(event.newValue||'null');
    // A metadata-only notification for the same verified credentials is not
    // an account switch and must not destroy an uncertain payment UUID.
    if(hasVerifiedAccess()&&next?.employeeId===session.employeeId&&next?.token===session.token)return;
  }catch(e){}
  purgePrivateStorage();revokeVerifiedAccess();applySessionToken(null);location.reload();
});
applyAccessVisibility();
})();
