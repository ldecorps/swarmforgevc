// BL-097/BL-117: service worker for the backlog dashboard + docs explorer
// PWA.
//
// - Static shell (index.html/app.js/manifest.json/icon.svg): cache-first,
//   so the app shell itself is available offline immediately after first
//   install.
// - backlog.json, docs-tree.json, and recert-batch.json (BL-150): network-
//   first with a cache fallback, so an online open always shows the
//   freshest data while an offline open still renders whatever was last
//   successfully fetched (dashboard-04's "as of <generation time>" honesty
//   requirement, and BL-117's docs-drilldown-04 same requirement for the
//   docs tree - the client, not this worker, surfaces that timestamp from
//   the cached payload itself).
// - periodicsync (dashboard-06, Android/Chrome only): re-fetches all data
//   artifacts into the cache on the browser's own schedule, so a later
//   offline open can render data newer than the last time the app was
//   actually opened. Registration (feature-detected, permission-gated) is
//   app.js's job; this worker just handles the event if it ever fires.

const CACHE_NAME = 'swarmforge-dashboard-v2';
const SHELL_ASSETS = ['./', './index.html', './app.js', './manifest.json', './icon.svg'];
const DATA_URLS = ['./backlog.json', './docs-tree.json', './recert-batch.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirstThenCache(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    throw err;
  }
}

async function cacheFirstThenNetwork(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  return fetch(request);
}

function isDataUrl(pathname) {
  return DATA_URLS.some((dataUrl) => pathname.endsWith(dataUrl.replace('./', '/')));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (isDataUrl(url.pathname)) {
    event.respondWith(networkFirstThenCache(event.request));
    return;
  }
  event.respondWith(cacheFirstThenNetwork(event.request));
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-backlog-json') {
    event.waitUntil(Promise.all(DATA_URLS.map((url) => networkFirstThenCache(new Request(url)))));
  }
});
