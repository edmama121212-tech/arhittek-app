// ============================================================
// REALTIME — мгновенная синхронизация между пользователями
// ============================================================
let realtimeChannel = null;
let realtimeToastShown = false;
let pendingReload = false;
let reloadDebounceTimer = null;

function scheduleReload(source){
  // Дебаунс: если несколько таблиц изменились одновременно — один loadAll
  if(reloadDebounceTimer) clearTimeout(reloadDebounceTimer);
  reloadDebounceTimer = setTimeout(async ()=>{
    reloadDebounceTimer = null;
    await loadAll();
    if(state.financialDataReady&&!state.financialDataError&&!state.stageDataError&&!state.projectMembersDataError){
      setSyncStatus('live','синхронизировано · live');
      if(!realtimeToastShown){
        realtimeToastShown=true;showToast('🔄 Данные обновлены');
        setTimeout(()=>{realtimeToastShown=false;},4000);
      }
    }
  }, 600);
}

function setupRealtime(){
  if(!session?.token)return;
  if(realtimeChannel){sb.removeChannel(realtimeChannel);realtimeChannel=null;}
  let channel=sb.channel('arhittek-live');
  for(const table of ['projects','invoices','ledger_entries','project_members','employees',
    'company_expenses','company_income','timesheet_payments','company_info','kp_catalog','kp_forms',
    'categories','statuses','departments','tz_forms','tz_references']){
    channel=channel.on('postgres_changes',{event:'*',schema:'public',table},()=>scheduleReload(table));
  }
  channel=channel.on('postgres_changes',{event:'*',schema:'public',table:'project_stages'},scheduleStageReload);
  channel=channel.on('postgres_changes',{event:'*',schema:'public',table:'audit_log',filter:'entity_type=eq.reserve'},()=>scheduleReload('cash_count'));
  realtimeChannel=channel.subscribe(status=>{
    if(status==='SUBSCRIBED'){
      if(state.financialDataReady&&!state.financialDataError)setSyncStatus('live','синхронизировано · live');
    }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
      setSyncStatus('off','нет live-связи');startPollingFallback();
    }
  });
  // A joined WebSocket does not prove that custom-header employee RLS can
  // deliver its events. Keep an authenticated HTTP refresh as a fallback.
  startPollingFallback();
}

// Authenticated background refresh also covers silent Realtime/RLS filtering.
let pollingTimer = null;
function startPollingFallback(){
  if(pollingTimer) return; // уже запущен
  pollingTimer = setInterval(()=>{
    if(!session?.token || document.visibilityState!=='visible' || navigator.onLine===false ||
       loadAllInFlight || pendingStageChanges.size ||
       document.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])') ||
       document.querySelector('.view.active[data-dirty="1"]'))return;
    const editing=[...document.querySelectorAll('.sheet-overlay,.modal,.modal-overlay,.overlay,[id$="Overlay"],[role="dialog"],[aria-modal="true"],dialog[open]')]
      .some(el=>el.getClientRects().length&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden');
    if(!editing)void loadAll();
  }, 20000);
}

// Запускаем realtime после первой загрузки данных
// (используем небольшую задержку чтобы сессия уже была установлена)
setTimeout(setupRealtime, 1500);

// Переподключение при возврате на вкладку браузера
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible'){
    // Страница стала видимой — обновляем данные
    loadAll();
    // Если канал потерян — переподключаем
    if(!realtimeChannel || realtimeChannel.state !== 'joined'){
      setTimeout(setupRealtime, 500);
    }
  }
});

