// ===== Preserve current screen across page refresh =====
(()=>{
'use strict';
if(window.__arhittekRoutePersistenceInstalled) return;
window.__arhittekRoutePersistenceInstalled=true;

const ROUTE_KEY='arhittek_ui_route_v1';
let restoring=true;
let restored=false;
let saveTimer=null;

function readRoute(){
  try{return JSON.parse(sessionStorage.getItem(ROUTE_KEY)||'null');}catch(e){return null;}
}
const bootRoute=readRoute();

function activeViewId(){
  return document.querySelector('.view.active')?.id || 'view-overview';
}
function projectTab(){
  return document.querySelector('#projectSheetOverlay.active .project-tabs button[aria-selected="true"]')?.dataset.tab || null;
}
function routeSnapshot(){
  const view=activeViewId();
  return {
    employeeId:(typeof session!=='undefined'&&session?.employeeId)||window.session?.employeeId||null,
    view,
    objectId:view==='view-object' && typeof currentObjectId!=='undefined' ? currentObjectId : null,
    objectTab:view==='view-object' && typeof activeObjTab!=='undefined' ? activeObjTab : null,
    projectId:document.getElementById('projectSheetOverlay')?.classList.contains('active') && typeof editingProjectId!=='undefined' ? editingProjectId : null,
    projectTab:projectTab(),
    scrollY:Math.max(0,Math.round(window.scrollY||0)),
    at:Date.now()
  };
}
function saveRouteNow(){
  if(restoring) return;
  try{sessionStorage.setItem(ROUTE_KEY,JSON.stringify(routeSnapshot()));}catch(e){}
}
function scheduleRouteSave(){
  if(restoring)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveRouteNow,100);
}
function canUseSavedRoute(r){
  if(!r||!r.view||!canAccessView(r.view))return false;
  const sid=(typeof session!=='undefined'&&session?.employeeId)||window.session?.employeeId||null;
  if(!sid||!r.employeeId||sid!==r.employeeId)return false;
  if(r.view==='view-settings' && !(typeof session!=='undefined'&&session?.isAdmin))return false;
  return !!document.getElementById(r.view);
}
function showViewDirect(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  const nav=document.querySelector('.nav-btn[data-view="'+id+'"]');
  if(nav && nav.style.display!=='none') nav.classList.add('active');
}
function navAllowed(id){
  const nav=document.querySelector('.nav-btn[data-view="'+id+'"]');
  return !nav || nav.style.display!=='none';
}
function restoreRoute(r){
  if(!canUseSavedRoute(r)) return false;

  // Screens that need their own initialization.
  if(r.view==='view-object'){
    if(!r.objectId || !(state.projects||[]).some(p=>p.id===r.objectId))return false;
    openObjectView(r.objectId);
    if(r.objectTab && typeof activeObjTab!=='undefined'){
      activeObjTab=r.objectTab;
      try{renderObjTabs();renderObjTabContent();}catch(e){}
    }
  }else if(r.view==='view-kp'){
    if(typeof openKpView==='function')openKpView(); else showViewDirect(r.view);
  }else if(r.view==='view-contracts'){
    if(typeof openContractsView==='function')openContractsView(); else showViewDirect(r.view);
  }else if(r.view==='view-settings'){
    document.getElementById('settingsBtn')?.click();
  }else if(r.view==='view-company'){
    document.getElementById('openCompanyBtn')?.click();
  }else if(r.view==='view-timesheet'){
    document.getElementById('openTimesheetBtn')?.click();
  }else if(r.view==='view-cards'){
    const nav=document.querySelector('.nav-btn[data-view="view-cards"]');
    if(nav&&nav.style.display!=='none')nav.click();else showViewDirect(r.view);
  }else{
    if(!navAllowed(r.view))return false;
    const nav=document.querySelector('.nav-btn[data-view="'+r.view+'"]');
    if(nav&&nav.style.display!=='none')nav.click();else showViewDirect(r.view);
  }

  // Reopen a saved project card after the underlying screen is restored.
  if(r.projectId && (state.projects||[]).some(p=>p.id===r.projectId) && typeof openProjectSheet==='function'){
    openProjectSheet(r.projectId);
    if(r.projectTab){
      setTimeout(()=>{
        document.querySelector('#projectSheetOverlay .project-tabs button[data-tab="'+r.projectTab+'"]')?.click();
      },80);
    }
  }

  setTimeout(()=>window.scrollTo(0,Number(r.scrollY)||0),80);
  return true;
}

function attemptRestore(){
  if(restored)return;
  const login=document.getElementById('loginOverlay');
  const sid=(typeof session!=='undefined'&&session?.employeeId)||window.session?.employeeId||null;
  if(!sid || (login&&login.style.display!=='none'))return;

  // For object/project restoration wait until project data has arrived.
  const needsProject=bootRoute?.objectId||bootRoute?.projectId;
  if(needsProject && !(state.projects||[]).length)return;

  restored=true;
  const ok=restoreRoute(bootRoute);
  restoring=false;
  if(!ok) saveRouteNow();
}

// Observe every view switch and sheet open/close.
const viewObserver=new MutationObserver(()=>scheduleRouteSave());
document.querySelectorAll('.view').forEach(v=>viewObserver.observe(v,{attributes:true,attributeFilter:['class']}));
const projectOverlay=document.getElementById('projectSheetOverlay');
if(projectOverlay)viewObserver.observe(projectOverlay,{attributes:true,attributeFilter:['class']});

document.addEventListener('click',e=>{
  if(e.target.closest('.nav-btn,#objTabs,.project-tabs,#kpBack,#contractsBack,#settingsBack,#objBack'))setTimeout(scheduleRouteSave,0);
},true);
window.addEventListener('scroll',scheduleRouteSave,{passive:true});
window.addEventListener('beforeunload',()=>{if(!restoring)saveRouteNow();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!restoring)saveRouteNow();});

// loadAll can run after refresh, login, realtime and visibility changes.
// Restoring after it keeps the current screen instead of returning to Overview.
if(typeof loadAll==='function' && !loadAll.__routePersistence){
  const originalLoadAll=loadAll;
  loadAll=async function(){
    const r=await originalLoadAll.apply(this,arguments);
    setTimeout(attemptRestore,0);
    return r;
  };
  loadAll.__routePersistence=true;
}

// The first load may have started before premium.js was evaluated.
let tries=0;
const timer=setInterval(()=>{
  tries++;
  attemptRestore();
  if(restored||tries>50){
    clearInterval(timer);
    if(!restored){restoring=false;saveRouteNow();}
  }
},160);

window.__arhittekClearSavedRoute=()=>{try{sessionStorage.removeItem(ROUTE_KEY);}catch(e){}};
})();
