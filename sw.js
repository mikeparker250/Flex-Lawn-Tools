// ─── VERSION — bump this number every time you deploy a new version ───────
const VERSION = 'flex-mix-v9';
// ─────────────────────────────────────────────────────────────────────────

const ASSETS = [
  '/Flex-Lawn-Tools/flex_mix_calculator.html',
  '/Flex-Lawn-Tools/manifest.json'
];

// Install — cache new version
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(ASSETS))
  );
  // Activate immediately — don't wait for old SW to die
  self.skipWaiting();
});

// Activate — delete ALL old caches, take control of all tabs instantly
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, cache as fallback (always gets latest from GitHub)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)
        .then(cached => cached || caches.match('/Flex-Lawn-Tools/flex_mix_calculator.html'))
      )
  );
});
