/**
 * Offline support.
 *
 * The shell is precached on install and served stale-while-revalidate: cached
 * copies answer immediately, and every hit also refreshes the cache from the
 * network in the background, so a deploy becomes visible on the next visit
 * without touching CACHE. Bumping CACHE is still the hard reset: it discards
 * every previous cache on activate, which is what evicts entries that predate
 * this worker.
 */

const CACHE = 'voxpad-v2';

const SHELL = [
  './',
  'index.html',
  'privacy.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/main.js',
  'js/tts-engine.js',
  'js/text-segmenter.js',
  'js/reader-view.js',
  'js/voices.js',
  'js/storage.js',
  'js/i18n.js',
  'assets/favicon.svg',
  'assets/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 'reload' bypasses the HTTP cache, so a fresh worker can never precache
      // copies that an intermediary cached before the deploy.
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          // Only Voxpad's own caches: the origin may host other apps.
          .filter((key) => key.startsWith('voxpad-') && key !== CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Only plain 200s are cacheable: 206 partial responses make cache.put throw.
  const revalidate = fetch(request).then((response) => {
    if (response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      return caches.open(CACHE)
        .then((cache) => cache.put(request, copy))
        .catch(() => {})
        .then(() => response);
    }
    return response;
  });

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) {
        // Serve stale, refresh in the background.
        event.waitUntil(revalidate.catch(() => {}));
        return hit;
      }
      return revalidate.catch(() => {
        // Offline and not cached: navigations fall back to the app shell.
        if (request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
