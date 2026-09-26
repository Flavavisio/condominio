const CACHE = 'condomia-v15-live-demo';
const CORE = ['./','./index.html','./app.html','./demo.html','./manifest.webmanifest','./assets/icons/cf-icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    const fallback=url.pathname.endsWith('/app.html')?'./app.html':url.pathname.endsWith('/demo.html')?'./demo.html':'./index.html';
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(fallback, copy)).catch(() => null);
      return response;
    }).catch(() => caches.match(fallback)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => null);
    return response;
  })));
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title: 'Condomia', body: event.data?.text() || 'Tem um novo alerta.' }; }
  const title = data.title || 'Condomia';
  const options = {
    body: data.body || 'Tem um novo alerta.',
    icon: './assets/icons/cf-icon.svg',
    badge: './assets/icons/cf-icon.svg',
    tag: data.id || undefined,
    renotify: Boolean(data.severity === 'urgent'),
    requireInteraction: Boolean(data.severity === 'urgent'),
    data: { url: data.url || './', notificationId: data.id || null },
    vibrate: data.severity === 'urgent' ? [180,80,180,80,240] : [120,60,120]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = event.notification?.data?.url || './';
  if (target.startsWith('/?')) target = `./app.html${target.slice(1)}`;
  const targetUrl = new URL(target, self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(clients => {
    for (const client of clients) {
      if ('focus' in client) {
        client.navigate(targetUrl).catch(() => null);
        return client.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(targetUrl) : null;
  }));
});
