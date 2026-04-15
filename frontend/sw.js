const CACHE_NAME = 'mansion-crm-v7';
const STATIC_ASSETS = [
  '/',
  '/js/app.js?v=20260415',
  '/js/app-mobile.js?v=20260415',
  '/js/pa-dashboard.js?v=20260415',
  '/assets/mansion-logo.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // API calls — network only, no cache
  if (url.pathname.startsWith('/api/')) return;

  // JS files — network first, fallback ke cache (agar selalu dapat versi terbaru)
  if (url.pathname.endsWith('.js')) {
    e.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Push subscription endpoint — network only
  if (url.pathname.startsWith('/api/v1/push')) return;

  // Static assets lain — cache first
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') return caches.match('/');
      });
    })
  );
});

// ── Push Notification Handler ──────────────────────────────
self.addEventListener('push', (e) => {
  let data = { title: 'Mansion CRM', body: 'Ada notifikasi baru', url: '/' };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch (_) {
    if (e.data) data.body = e.data.text();
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-192.png',
      data: { url: data.url || '/' },
      tag: data.tag || 'crm-notif',
      renotify: true,
      requireInteraction: false,
    })
  );
});

// ── Notification Click Handler ─────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const targetUrl = e.notification.data?.url || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Jika sudah ada tab CRM terbuka, fokuskan dan navigate
      const crm = windowClients.find(c => c.url.includes(self.location.origin));
      if (crm) {
        crm.focus();
        return crm.navigate(targetUrl);
      }
      // Tidak ada tab, buka tab baru
      return clients.openWindow(targetUrl);
    })
  );
});
