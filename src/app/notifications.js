// ============================================================
// PWA — Service Worker + Уведомления о просрочках
// ============================================================
async function registerSW(){
  if(!('serviceWorker' in navigator)) return;
  try{
    const reg = await navigator.serviceWorker.register('./sw.js');
    console.log('[SW] зарегистрирован:', reg.scope);
    window._swReg = reg;

    // Принудительно проверяем обновления при каждом открытии приложения —
    // на iOS PWA без этого может надолго зависнуть на старой закэшированной версии
    reg.update().catch(()=>{});

    // Если найдена новая версия — просим её активироваться немедленно
    reg.addEventListener('updatefound', ()=>{
      const newWorker = reg.installing;
      if(!newWorker) return;
      newWorker.addEventListener('statechange', ()=>{
        if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
          newWorker.postMessage('SKIP_WAITING');
        }
      });
    });

    // Как только новый SW взял на себя контроль — перезагружаем страницу один раз,
    // чтобы подтянуть свежий index.html и все данные карточек
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', ()=>{
      if(reloaded) return;
      reloaded = true;
      if(document.querySelector('[data-dirty="1"]')){
        showToast('Новая версия готова. Сохраните изменения и обновите страницу.');
        return;
      }
      window.location.reload();
    });
  }catch(e){
    console.warn('[SW] ошибка регистрации:', e);
  }
}

// ФИКС (аудит, находка «фейковые push»): настоящий VAPID public key.
// Приватный ключ живёт ТОЛЬКО в секретах Supabase Edge Function — сюда его класть нельзя.
const VAPID_PUBLIC_KEY = 'BFiwEd8fQhKwAknET-k0xi6wGRjJ8mVcRTy-S_iVTcD5SrdKpG5mOQGbwbPQd-gx8X5erf8i110cL0yf6Y5rH3k';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for(let i = 0; i < rawData.length; i++){ outputArray[i] = rawData.charCodeAt(i); }
  return outputArray;
}

// Подписывает текущее устройство на настоящий серверный push и сохраняет
// подписку в push_subscriptions, привязанную к текущему сотруднику.
async function subscribeToPush(){
  try{
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if(!session) return;
    const reg = window._swReg || await navigator.serviceWorker.ready;
    if(!reg) return;

    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    await sb.from('push_subscriptions').upsert({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      employee_id: session.employeeId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
  }catch(e){
    console.warn('[Push] не удалось подписаться:', e);
  }
}

async function requestNotificationPermission(){
  if(!('Notification' in window)) return false;
  if(Notification.permission === 'granted'){ subscribeToPush(); return true; }
  if(Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  if(result === 'granted') subscribeToPush();
  renderNotifSettings();
  return result === 'granted';
}

function renderNotifSettings(){
  const card = document.getElementById('notifSettingsCard');
  if(!card) return;

  if(!('Notification' in window)){
    card.innerHTML = `<div class="hint">Уведомления не поддерживаются этим браузером.</div>`;
    return;
  }

  const perm = Notification.permission;

  if(perm === 'granted'){
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div>
          <div style="font-size:13px; font-weight:600; color:#3ecf6b;">Уведомления включены ✓</div>
          <div class="hint" style="margin-top:2px;">Просрочки и важные события</div>
        </div>
        <button class="btn btn-secondary" id="notifTestBtn" style="width:auto; padding:8px 14px; font-size:12px;">Тест</button>
      </div>
    `;
    const testBtn = document.getElementById('notifTestBtn');
    if(testBtn) testBtn.addEventListener('click', ()=>{
      sendLocalNotification('ARHITTEK', 'Тестовое уведомление ✓', 'test');
      showToast('Уведомление отправлено');
    });
    return;
  }

  if(perm === 'denied'){
    card.innerHTML = `
      <div style="font-size:13px; font-weight:600; color:var(--red, #e05555); margin-bottom:6px;">Уведомления заблокированы</div>
      <div class="hint">Браузер/устройство запретили уведомления для этого сайта. Включить обратно можно только вручную:</div>
      <div class="hint" style="margin-top:8px; line-height:1.6;">
        <b>iPhone (Safari/PWA):</b> Настройки → Safari (или само приложение) → Уведомления → включить<br>
        <b>Android/Chrome:</b> три точки → Настройки сайта → Уведомления → включить<br>
        <b>Компьютер (Chrome):</b> значок замка рядом с адресом → Уведомления → Разрешить
      </div>
    `;
    return;
  }

  // default — ещё не спрашивали
  card.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <div>
        <div style="font-size:13px; font-weight:600;">Уведомления выключены</div>
        <div class="hint" style="margin-top:2px;">Просрочки и важные события</div>
      </div>
      <button class="btn btn-primary" id="notifEnableBtn" style="width:auto; padding:8px 14px; font-size:12px;">Включить</button>
    </div>
  `;
  const enableBtn = document.getElementById('notifEnableBtn');
  if(enableBtn) enableBtn.addEventListener('click', async ()=>{
    const ok = await requestNotificationPermission();
    if(ok) showToast('Уведомления включены ✓');
    renderNotifSettings();
  });
}

function sendLocalNotification(title, body, tag='arhittek'){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, {
    body,
    icon: './icon-192.png',
    tag,
  });
}

// Проверка просрочек — вызывается после loadAll
function checkOverdueNotifications(){
  if(!session) return;
  if(!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();
  const today = now.toISOString().slice(0,10);

  // Просроченные этапы (замороженные проекты игнорируем)
  const overdueStages = state.projectStages.filter(s=>{
    if(s.done || !s.due_date) return false;
    const pr = state.projects.find(x=>x.id===s.project_id);
    if(isFrozen(pr)) return false;
    return s.due_date < today;
  });

  // Просроченные проекты
  const doneStatus = state.statuses.find(s=>s.name==='Завершён');
  const overdueProjects = state.projects.filter(p=>{
    if(doneStatus && p.status_id === doneStatus.id) return false;
    if(isFrozen(p)) return false;
    if(!p.end_date) return false;
    return p.end_date < today;
  });

  // Проверяем — уже уведомляли сегодня?
  const lastNotifKey = 'arhittek_last_notif';
  const lastNotif = localStorage.getItem(lastNotifKey);
  if(lastNotif === today) return; // уже отправляли сегодня

  if(overdueStages.length || overdueProjects.length){
    let body = '';
    if(overdueProjects.length) body += `Просрочено проектов: ${overdueProjects.length}. `;
    if(overdueStages.length) body += `Просроченных этапов: ${overdueStages.length}.`;
    sendLocalNotification('⚠ ARHITTEK — просрочки', body.trim(), 'overdue');
    localStorage.setItem(lastNotifKey, today);
  }

  // Напоминание про аренду 2 помещений — в последний день месяца, если за этот
  // месяц ещё нет ни одной записи дохода с категорией «Аренда помещений».
  const rentNotifKey = 'arhittek_last_rent_notif';
  const lastRentDay = now.getDate();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  if(lastRentDay === lastDayOfMonth && localStorage.getItem(rentNotifKey) !== today){
    const monthPrefix = today.slice(0,7); // YYYY-MM
    const hasRentThisMonth = (state.companyIncome||[]).some(i =>
      i.category === 'Аренда помещений' && !i.deleted_at && (i.income_date||'').slice(0,7) === monthPrefix
    );
    if(!hasRentThisMonth){
      sendLocalNotification('💹 ARHITTEK — аренда помещений', 'Сегодня последний день месяца — не забудьте внести доход по аренде 2 помещений в Финансы.', 'rent-reminder');
    }
    localStorage.setItem(rentNotifKey, today);
  }
}

// Кнопка запроса разрешения в приложении
function showNotifPrompt(){
  if(!('Notification' in window)) return;
  if(Notification.permission === 'granted') return;
  // Показываем тост с предложением
  setTimeout(()=>{
    if(Notification.permission === 'default'){
      const toast = document.createElement('div');
      toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:448px;background:#1a2d45;border:1px solid rgba(61,143,224,0.3);border-radius:14px;padding:14px 16px;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);`;
      toast.innerHTML = `
        <div style="font-size:24px;">🔔</div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;margin-bottom:2px;">Включить уведомления?</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.5);">Просрочки и важные события</div>
        </div>
        <button onclick="requestNotificationPermission().then(ok=>{ if(ok) showToast('Уведомления включены ✓'); this.closest('[data-notif-toast]').remove(); })" style="background:var(--blue);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Включить</button>
        <button onclick="this.closest('[data-notif-toast]').remove()" style="background:transparent;color:rgba(255,255,255,0.4);border:none;font-size:18px;cursor:pointer;padding:4px;">×</button>
      `;
      toast.setAttribute('data-notif-toast','1');
      document.body.appendChild(toast);
      setTimeout(()=>toast.remove(), 12000);
    }
  }, 3000);
}

// Запуск
registerSW();
showNotifPrompt();
