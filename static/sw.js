// Prosp'Up Service Worker v26 — enhanced caching + offline fallback + HTML stale-while-revalidate
const CACHE = 'prospup-v26';
const API_CACHE = 'prospup-api-v23.4';
const API_TTL = 5 * 60 * 1000; // 5 minutes

const SHELL = [
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/sidebar.js',
  '/static/js/v8-features.js',
  '/static/js/notifications.js',
  '/static/js/metiers-data.js',
  '/static/js/page-dashboard.js',
  '/static/js/page-focus.js',
  '/static/js/page-calendar.js',
  '/static/js/page-prospects.js',
  '/static/js/page-push.js',
  '/static/js/page-sourcing.js',
  '/static/js/page-stats.js',
  '/static/js/page-companies.js',
  '/static/js/page-quickadd.js',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/favicon.ico',
  '/static/logo-up-technologies.png',
  '/static/manifest.json',
  '/offline.html'
];

// ── Install: pre-cache shell assets ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ──
self.addEventListener('activate', e => {
  const keep = new Set([CACHE, API_CACHE]);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategy ──
self.addEventListener('fetch', e => {
  // IMPORTANT: skip non-GET requests (uploads/updates) — fixes mobile Safari issues
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // ── API requests: network-first with runtime cache ──
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const copy = response.clone();
          caches.open(API_CACHE).then(cache => cache.put(e.request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.open(API_CACHE).then(cache =>
            cache.match(e.request).then(cached => {
              if (cached) return cached;
              return new Response('{"error":"offline"}', {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              });
            })
          )
        )
    );
    return;
  }

  // ── HTML / navigation: stale-while-revalidate (instant from cache if present, revalidate in background) ──
  var accept = e.request.headers.get('accept') || '';
  if (e.request.mode === 'navigate' || accept.includes('text/html')) {
    var navUrl = e.request.url;
    e.respondWith(
      caches.open(CACHE).then(function (cache) {
        // Match by URL only (prefetch uses different Request than navigation, so match by url)
        return cache.keys().then(function (keys) {
          var sameUrl = keys.find(function (req) { return req.url === navUrl; });
          return sameUrl ? cache.match(sameUrl) : Promise.resolve(null);
        }).then(function (cached) {
          if (cached) {
            fetch(e.request).then(function (response) {
              if (response && response.ok) {
                var copy = response.clone();
                cache.put(e.request, copy).catch(function () {});
              }
            }).catch(function () {});
            return cached;
          }
          return fetch(e.request).then(function (response) {
            var copy = response.clone();
            cache.put(e.request, copy).catch(function () {});
            return response;
          }).catch(function () {
            return caches.match('/offline.html');
          });
        });
      })
    );
    return;
  }

  // ── Static assets: cache-first (ignoreSearch for ?v= busters) ──
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, copy)).catch(() => {});
        return response;
      });
    })
  );
});

// ── Message: allow app to trigger skipWaiting ──
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
