// Prosp'Up Service Worker v30 — liquid glass shell + v30 UX refresh
const CACHE = 'prospup-v30.0-beta-shell-2';
const API_CACHE = 'prospup-api-v23.4';
const API_TTL = 5 * 60 * 1000; // 5 minutes

const SHELL = [
  // Legacy v29 shell (toujours servi pour les users restés sur v29)
  '/static/css/style.css',
  '/static/css/mobile.css',
  '/static/css/mobile-2026.css',
  '/static/css/mobile-2026-screens.css',
  '/static/css/mode-prosp.css',
  '/static/js/app.js',
  '/static/js/sidebar.js',
  '/static/js/v8-features.js',
  '/static/js/mobile-2026.js',
  '/static/js/notifications.js',
  '/static/js/metiers-data.js',
  '/static/js/page-dashboard-v2.js',
  '/static/js/page-focus.js',
  '/static/js/page-calendar.js',
  '/static/js/page-prospects.js',
  '/static/js/page-push.js',
  '/static/js/page-sourcing.js',
  '/static/js/page-stats.js',
  '/static/js/page-companies.js',
  '/static/js/page-quickadd.js',
  '/static/js/page-import.js',
  '/static/js/mode-prosp-tab.js',
  // v30 CSS
  '/static/css/v30/tokens.css',
  '/static/css/v30/chrome.css',
  '/static/css/v30/components.css',
  '/static/css/v30/dashboard.css',
  '/static/css/v30/prospects.css',
  '/static/css/v30/prospect_detail.css',
  '/static/css/v30/candidate_detail.css',
  '/static/css/v30/push.css',
  '/static/css/v30/calendar.css',
  '/static/css/v30/sourcing.css',
  '/static/css/v30/palette.css',
  '/static/css/v30/shortcuts.css',
  '/static/css/v30/rapport.css',
  '/static/css/v30/users.css',
  '/static/css/v30/parametres.css',
  '/static/css/v30/activity.css',
  '/static/css/v30/snapshots.css',
  '/static/css/v30/help.css',
  '/static/css/v30/metiers.css',
  // v30 JS
  '/static/js/v30/opt-in.js',
  '/static/js/v30/palette.js',
  '/static/js/v30/shortcuts.js',
  '/static/js/v30/dashboard.js',
  '/static/js/v30/focus.js',
  '/static/js/v30/calendar.js',
  '/static/js/v30/prospects.js',
  '/static/js/v30/prospect_detail.js',
  '/static/js/v30/prospect_detail_render.js',
  '/static/js/v30/prospect_detail_ui.js',
  '/static/js/v30/entreprises.js',
  '/static/js/v30/candidate_detail.js',
  '/static/js/v30/push.js',
  '/static/js/v30/sourcing.js',
  '/static/js/v30/stats.js',
  '/static/js/v30/rapport.js',
  '/static/js/v30/users.js',
  '/static/js/v30/activity.js',
  '/static/js/v30/snapshots.js',
  '/static/js/v30/metiers.js',
  // Assets partagés
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
