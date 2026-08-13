/**
 * Offline support.
 *
 * The whole app is a handful of static files, so the shell is precached on
 * install and served cache first. Bump CACHE when you change any of them: the
 * activate step deletes every other cache, which is what makes a deploy show up
 * on the next visit instead of being pinned to the old copy forever.
 */

const CACHE = 'voxpad-v1';

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
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;

      return fetch(request)
        .then((response) => {
          // Only same origin, successful, basic responses are worth keeping.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and not cached: navigations fall back to the app shell.
          if (request.mode === 'navigate') return caches.match('index.html');
          return Response.error();
        });
    })
  );
});
