// ARHITTEK Service Worker v1.5 (bypass HTTP disk cache — fixes stale iOS PWA content)
const CACHE = 'arhittek-v2.2';
const ASSETS = ['./index.html','./premium.css','./premium.js','./client.css','./catalog.html','./tz.html','./manifest.json','./icon-192.png'];
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
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
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
  // Для GET-запросов своего сайта принудительно обходим HTTP-дисковый кэш браузера
  // (на iOS он может годами отдавать старую версию index.html/catalog.html,
  // даже когда service worker уже обновился) — иначе deploy может "не доходить" до телефона.
  const isOwnGet = e.request.method === 'GET' && e.request.url.startsWith(self.location.origin);
  const networkRequest = isOwnGet ? new Request(e.request.url, {cache:'no-store'}) : e.request;
  e.respondWith(
    fetch(networkRequest)
      .then(res=>{
        if(res.ok){
          const clone = res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, clone));
        }
        return res;
      })
      .catch(async()=>await caches.match(e.request) || new Response('Нет подключения. Откройте приложение после восстановления связи.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}))
  );
});

// Push-уведомления
self.addEventListener('push', e=>{
  const data = e.data ? e.data.json() : {};
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
    clients.matchAll({type:'window'}).then(cs=>{
      const url = e.notification.data?.url || './index.html';
      const match = cs.find(c=>c.url.includes('arhittek') && 'focus' in c);
      if(match) return match.focus();
      return clients.openWindow(url);
    })
  );
});
