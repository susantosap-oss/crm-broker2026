const CACHE_NAME = 'mansion-crm-v1';
const STATIC_ASSETS = [
  '/',
  '/js/app-mobile.js',
  '/js/pa-dashboard.js',
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

  // Static assets — cache first
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
        // Offline fallback — return cached index.html for navigation
        if (request.mode === 'navigate') return caches.match('/');
      });
    })
  );
});
