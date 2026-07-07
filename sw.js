// ARHITTEK Service Worker v1.4 (bypass HTTP disk cache — fixes stale iOS PWA content)
const CACHE = 'arhittek-v1.4';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
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
      .catch(()=>caches.match(e.request))
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
