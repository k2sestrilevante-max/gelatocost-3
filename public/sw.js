// K2 Suite — Service Worker v1
const CACHE = 'k2-suite-v1';
const ASSETS = [
  '/',
  '/index.html',
];

// Installa: pre-cacha solo index.html
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Attiva: rimuovi vecchie cache
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first per JS/assets, cache-first per index
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Solo richieste stessa origine
  if (url.origin !== location.origin) return;

  if (url.pathname === '/' || url.pathname === '/index.html') {
    // Cache-first per la shell
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
      )
    );
  } else {
    // Network-first per assets JS/CSS (sempre aggiornati al deploy)
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
