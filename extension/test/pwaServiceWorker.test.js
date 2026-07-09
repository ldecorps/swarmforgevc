const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// BL-097 dashboard-04/06: sw.js runs in a service-worker global scope (self/
// caches/clients), which jsdom doesn't provide - this stubs that scope
// minimally (an in-memory Map-backed cache, an addEventListener that
// captures handlers so the test can invoke them directly) and evaluates the
// REAL pwa/sw.js source, rather than restating its caching logic by hand.

const SW_PATH = path.join(__dirname, '..', '..', 'pwa', 'sw.js');

function fakeCacheStorage() {
  const caches = new Map();
  function makeCache() {
    const store = new Map();
    return {
      addAll: (urls) => {
        urls.forEach((u) => store.set(u, { url: u, body: 'shell:' + u }));
        return Promise.resolve();
      },
      put: (request, response) => {
        store.set(typeof request === 'string' ? request : request.url, response);
        return Promise.resolve();
      },
      match: (request) => Promise.resolve(store.get(typeof request === 'string' ? request : request.url)),
    };
  }
  return {
    open: (name) => {
      if (!caches.has(name)) {
        caches.set(name, makeCache());
      }
      return Promise.resolve(caches.get(name));
    },
    match: (request) => {
      const url = typeof request === 'string' ? request : request.url;
      for (const cache of caches.values()) {
        if (cache._store && cache._store.has(url)) {
          return Promise.resolve(cache._store.get(url));
        }
      }
      // Fall back to scanning every open cache via its own match.
      return Promise.all([...caches.values()].map((c) => c.match(url))).then((results) => results.find(Boolean));
    },
    keys: () => Promise.resolve([...caches.keys()]),
    delete: (name) => Promise.resolve(caches.delete(name)),
  };
}

function loadServiceWorker(fetchImpl) {
  const listeners = {};
  const sandbox = {
    self: {
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: fakeCacheStorage(),
    fetch: fetchImpl,
    Request: function Request(url) {
      this.url = url;
    },
    URL: require('node:url').URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SW_PATH, 'utf8'), sandbox);
  return { listeners, sandbox };
}

function fireInstall(listeners) {
  let waited;
  listeners.install({ waitUntil: (p) => { waited = p; } });
  return waited;
}

function fireActivate(listeners) {
  let waited;
  listeners.activate({ waitUntil: (p) => { waited = p; } });
  return waited;
}

// Real browsers always resolve Request.url to an absolute URL before a fetch
// handler ever sees it - sw.js's `new URL(event.request.url)` relies on
// that, so these fixtures use absolute URLs rather than the relative ones
// index.html/app.js reference by, matching real behavior.
const ORIGIN = 'https://example.github.io/dashboard/';
const BACKLOG_URL = ORIGIN + 'backlog.json';
const DOCS_TREE_URL = ORIGIN + 'docs-tree.json';
const APP_JS_URL = ORIGIN + 'app.js';

function fireFetch(listeners, url) {
  let responded;
  listeners.fetch({ request: { url }, respondWith: (p) => { responded = p; } });
  return responded;
}

test('install pre-caches the static shell', async () => {
  const { listeners, sandbox } = loadServiceWorker(() => Promise.reject(new Error('no network in this test')));
  await fireInstall(listeners);
  const cache = await sandbox.caches.open('swarmforge-dashboard-v2');
  const shell = await cache.match('./index.html');
  assert.ok(shell, 'index.html must be pre-cached on install');
});

test('activate deletes stale cache versions from a prior deploy, keeping only the current CACHE_NAME', async () => {
  const { listeners, sandbox } = loadServiceWorker(() => Promise.reject(new Error('no network in this test')));
  // A cache left behind by a prior service-worker version (a bumped
  // CACHE_NAME on redeploy) - activate's own job is to clean these up so
  // storage doesn't leak and a stale shell can never be served.
  await sandbox.caches.open('swarmforge-dashboard-v0');
  await sandbox.caches.open('swarmforge-dashboard-v2');

  await fireActivate(listeners);

  const remaining = await sandbox.caches.keys();
  assert.deepEqual(remaining, ['swarmforge-dashboard-v2']);
});

test('backlog.json fetch is network-first: a successful network response is served and cached', async () => {
  const networkResponse = { clone: () => ({ served: 'network-clone' }), body: 'network' };
  const { listeners } = loadServiceWorker((req) => {
    assert.equal(req.url, BACKLOG_URL);
    return Promise.resolve(networkResponse);
  });
  const result = await fireFetch(listeners, BACKLOG_URL);
  assert.equal(result, networkResponse);
});

test('backlog.json fetch falls back to the cache when the network fails (dashboard-04)', async () => {
  const { listeners, sandbox } = loadServiceWorker(() => Promise.reject(new Error('offline')));
  const cache = await sandbox.caches.open('swarmforge-dashboard-v2');
  const cachedResponse = { body: 'cached backlog' };
  await cache.put(BACKLOG_URL, cachedResponse);

  const result = await fireFetch(listeners, BACKLOG_URL);
  assert.equal(result, cachedResponse);
});

test('docs-tree.json fetch is network-first, same as backlog.json (BL-117 docs-drilldown-04)', async () => {
  const networkResponse = { clone: () => ({ served: 'docs-tree-network' }), body: 'network' };
  const { listeners } = loadServiceWorker((req) => {
    assert.equal(req.url, DOCS_TREE_URL);
    return Promise.resolve(networkResponse);
  });
  const result = await fireFetch(listeners, DOCS_TREE_URL);
  assert.equal(result, networkResponse);
});

test('docs-tree.json fetch falls back to the cache when the network fails (BL-117 docs-drilldown-04)', async () => {
  const { listeners, sandbox } = loadServiceWorker(() => Promise.reject(new Error('offline')));
  const cache = await sandbox.caches.open('swarmforge-dashboard-v2');
  const cachedResponse = { body: 'cached docs tree' };
  await cache.put(DOCS_TREE_URL, cachedResponse);

  const result = await fireFetch(listeners, DOCS_TREE_URL);
  assert.equal(result, cachedResponse);
});

test('a static shell asset is served cache-first, without touching the network at all', async () => {
  let networkCalled = false;
  const { listeners, sandbox } = loadServiceWorker(() => {
    networkCalled = true;
    return Promise.resolve({ clone: () => ({}) });
  });
  const cache = await sandbox.caches.open('swarmforge-dashboard-v2');
  const cachedShell = { body: 'cached app.js' };
  await cache.put(APP_JS_URL, cachedShell);

  const result = await fireFetch(listeners, APP_JS_URL);
  assert.equal(result, cachedShell);
  assert.equal(networkCalled, false);
});

test('periodicsync with the expected tag re-fetches and caches both backlog.json and docs-tree.json (dashboard-06)', async () => {
  let fetchCount = 0;
  const { listeners, sandbox } = loadServiceWorker((req) => {
    fetchCount += 1;
    return Promise.resolve({ clone: () => ({ served: 'refreshed:' + req.url }) });
  });

  let waited;
  listeners.periodicsync({ tag: 'refresh-backlog-json', waitUntil: (p) => { waited = p; } });
  await waited;

  assert.equal(fetchCount, 2, 'both data artifacts must be re-fetched on periodic sync');
  const cache = await sandbox.caches.open('swarmforge-dashboard-v2');
  const cachedBacklog = await cache.match('./backlog.json');
  const cachedDocsTree = await cache.match('./docs-tree.json');
  assert.deepEqual(cachedBacklog, { served: 'refreshed:./backlog.json' });
  assert.deepEqual(cachedDocsTree, { served: 'refreshed:./docs-tree.json' });
});

test('periodicsync with an unrecognized tag does nothing', async () => {
  let fetchCount = 0;
  const { listeners } = loadServiceWorker(() => {
    fetchCount += 1;
    return Promise.resolve({ clone: () => ({}) });
  });
  let waited = null;
  listeners.periodicsync({ tag: 'some-other-tag', waitUntil: (p) => { waited = p; } });
  assert.equal(waited, null, 'waitUntil must not be called for an unrecognized tag');
  assert.equal(fetchCount, 0);
});
