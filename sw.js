// ARHITTEK Service Worker v1.2 (redeploy)
const CACHE = 'arhittek-v1';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
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
  e.respondWith(
    fetch(e.request)
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
