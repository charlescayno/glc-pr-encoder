const CACHE_NAME = 'glc-pr-encoder-v29';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './index.css',
  './app.js',
  './logic.js',
  './sales-sheet.js',
  './export.js',
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js',
  './vendor/exceljs.min.js',
  './catalog.js',
  './manifest.json',
  './glc-logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.map(n => n !== CACHE_NAME ? caches.delete(n) : null)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Never cache Firebase / Google API traffic
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('firebase')) return;

  // Network-first for HTML and JS so updates show immediately
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then(c => c || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
      if (res && res.status === 200 && res.type !== 'opaque') {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
      }
      return res;
    }).catch(() => undefined))
  );
});
