// ARHITTEK: complete reads, consistent budgets and safe app updates.
const CACHE = 'arhittek-v3.19-construction-audit';
const ASSETS = ['./index.html','./premium.css','./premium.js','./data-access.js','./project-budget.js','./cash-finance.js','./app-refresh.js','./construction-finance.js','./construction-workflow.js','./client.css','./catalog.html','./tz.html','./landscape-brief.js','./manifest.json','./icon-192.png','./icon-512.png'];
const APP_BASE = new URL('./', self.location.href);
// CDN-библиотеки — кэшируем отдельно от основных ASSETS: если jsdelivr на
// момент установки недоступен, это не должно валить весь install (addAll — all-or-nothing).
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(ASSETS).then(()=>Promise.all(
        CDN_ASSETS.map(url=>c.add(url).catch(()=>{}))
      )))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('message', e=>{
  if(e.data === 'SKIP_WAITING'){ self.skipWaiting(); }
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k.startsWith('arhittek-') && k!==CACHE).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  if(e.request.method !== 'GET') return;
  // Сеть первая — для API запросов; кэш для assets
  if(e.request.url.includes('supabase.co')){
    e.respondWith(fetch(e.request).catch(()=>new Response('', {status:503})));
    return;
  }
  // Кэшируем только ресурсы этого приложения и перечисленные публичные библиотеки.
  const requestURL = new URL(e.request.url);
  const isOwnGet = requestURL.origin === APP_BASE.origin &&
    (requestURL.pathname === APP_BASE.pathname || ASSETS.some(path=>new URL(path, APP_BASE).pathname === requestURL.pathname));
  if(!isOwnGet && !CDN_ASSETS.includes(e.request.url)) return;
  // Для GET-запросов своего сайта принудительно обходим HTTP-дисковый кэш браузера
  // (на iOS он может годами отдавать старую версию index.html/catalog.html,
  // даже когда service worker уже обновился) — иначе deploy может "не доходить" до телефона.
  const networkRequest = isOwnGet ? new Request(e.request, {cache:'no-store'}) : e.request;
  e.respondWith(
    fetch(networkRequest)
      .then(res=>{
        if(res.ok){
          const clone = res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, clone));
        }
        return res;
      })
      .catch(async()=>await (await caches.open(CACHE)).match(e.request) || new Response('Нет подключения. Откройте приложение после восстановления связи.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}))
  );
});

// Push-уведомления
self.addEventListener('push', e=>{
  let data = {};
  try{ data = e.data ? e.data.json() : {}; }
  catch(_){ data = {body: e.data?.text() || ''}; }
  if(!data || typeof data !== 'object') data = {};
  const title = data.title || 'ARHITTEK';
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'arhittek',
    data: { url: data.url || './index.html' },
    vibrate: [200, 100, 200],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e=>{
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async cs=>{
      let url;
      try{ url = new URL(e.notification.data?.url || './index.html', APP_BASE); }
      catch(_){ url = new URL('./index.html', APP_BASE); }
      if(url.origin !== APP_BASE.origin || !url.pathname.startsWith(APP_BASE.pathname)) url = new URL('./index.html', APP_BASE);
      const match = cs.find(c=>c.url.startsWith(APP_BASE.href) && 'focus' in c);
      if(match){ if(match.url !== url.href && 'navigate' in match) await match.navigate(url.href); return match.focus(); }
      return self.clients.openWindow(url.href);
    })
  );
});
