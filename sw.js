const CACHE_NAME = 'flex-mix-v4';

const ASSETS = [
  '/Flex-Lawn-Tools/flex_mix_calculator.html',
  '/Flex-Lawn-Tools/manifest.json'
];

// Install — cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate — delete ALL old caches immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — NETWORK FIRST, fall back to cache
// This means the phone always tries to get the latest from GitHub first.
// Only uses cache if offline.
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Got a fresh response — update the cache with it
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — serve from cache
        return caches.match(event.request)
          .then(cached => cached || caches.match('/Flex-Lawn-Tools/flex_mix_calculator.html'));
      })
  );
});
