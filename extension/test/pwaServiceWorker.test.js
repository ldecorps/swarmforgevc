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
const APP_JS_PATH = path.join(__dirname, '..', '..', 'pwa', 'app.js');

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

// BL-249: CACHE_NAME in the source tree is a placeholder (stamped with a
// real content-derived name only in the SERVED sw.js under _site/, see
// extension/src/tools/stamp-pwa-cache-name.ts) - substituted here with
// whatever name a test asks for, defaulting to the same literal every
// existing test in this file already assumed, so none of their own
// cache-name assertions needed to change.
const CACHE_NAME_PLACEHOLDER = '__PWA_CACHE_NAME_PLACEHOLDER__';
const DEFAULT_TEST_CACHE_NAME = 'swarmforge-dashboard-v2';

function loadServiceWorker(fetchImpl, cacheName = DEFAULT_TEST_CACHE_NAME) {
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
  const source = fs.readFileSync(SW_PATH, 'utf8').replace(CACHE_NAME_PLACEHOLDER, cacheName);
  vm.runInContext(source, sandbox);
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
const RECERT_BATCH_URL = ORIGIN + 'recert-batch.json';
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
  await sandbox.caches.open(DEFAULT_TEST_CACHE_NAME);

  await fireActivate(listeners);

  const remaining = await sandbox.caches.keys();
  assert.deepEqual(remaining, [DEFAULT_TEST_CACHE_NAME]);
});

// BL-249: sw.js's own CACHE_NAME is a placeholder in the source tree - only
// the stamp tool (extension/src/tools/stamp-pwa-cache-name.ts) fills it in,
// against the SERVED sw.js under _site/. Guards against ever reintroducing
// a hardcoded literal here, which is exactly the BL-117/118/150 bug BL-249
// fixed (returning users never got shell updates because CACHE_NAME never
// changed).
test('BL-249: sw.js keeps a stamped-at-deploy placeholder, never a hardcoded CACHE_NAME literal', () => {
  const source = fs.readFileSync(SW_PATH, 'utf8');
  assert.match(source, new RegExp(`const CACHE_NAME = '${CACHE_NAME_PLACEHOLDER}';`));
});

// BL-249 shell-change-reaches-users-01: the full chain a returning user
// actually experiences once a deploy changes the shell and the served
// sw.js is stamped with a DIFFERENT CACHE_NAME than before - a stale cache
// under the OLD name is present, the new SW installs under the NEW name,
// activate purges the OLD name, and the returning user's next shell
// request resolves from the NEW cache.
test('a returning user with a stale cache gets the updated shell once the served sw.js has a new CACHE_NAME', async () => {
  const OLD_NAME = 'swarmforge-dashboard-oldhash1234';
  const NEW_NAME = 'swarmforge-dashboard-newhash5678';

  const { listeners, sandbox } = loadServiceWorker(
    () => Promise.reject(new Error('no network in this test')),
    NEW_NAME
  );
  const staleCache = await sandbox.caches.open(OLD_NAME);
  await staleCache.put('./index.html', { body: 'STALE shell content' });

  await fireInstall(listeners);
  await fireActivate(listeners);

  const remaining = await sandbox.caches.keys();
  assert.deepEqual(remaining, [NEW_NAME], 'the stale cache under the old CACHE_NAME must be purged, only the new one remains');

  // Same querying convention the very first test in this file already uses
  // for install-cached content (a direct caches.match by SHELL_ASSETS' own
  // relative key, not a full fetch-event round trip - this fake never
  // resolves relative install keys against an absolute fetch URL the way a
  // real browser's Cache Storage does).
  const served = await sandbox.caches.match('./index.html');
  assert.notDeepEqual(served, { body: 'STALE shell content' }, 'must never serve the purged stale shell');
  assert.ok(served, 'the returning user must receive the freshly re-installed shell, not nothing');
});

// BL-249 hardener bounce: app.js persists locale (BL-118) and font-size
// (BL-220) preferences in a SEPARATE cache under the permanently-static
// name below (see pwa/app.js's own PREFERENCES_CACHE_NAME) - the activate
// purge above deletes ANY key that isn't CACHE_NAME, so without an explicit
// exemption, the very next shell-changing deploy would silently wipe every
// returning user's preferences. This must survive activate while an
// unrelated stale shell cache from a prior deploy is still purged.
const PREFERENCES_CACHE_NAME = 'swarmforge-dashboard-preferences';

test('BL-249 bounce: activate purges a stale shell cache but keeps app.js\'s preferences cache', async () => {
  const { listeners, sandbox } = loadServiceWorker(
    () => Promise.reject(new Error('no network in this test')),
    'swarmforge-dashboard-newhash0001'
  );
  await sandbox.caches.open('swarmforge-dashboard-oldhash0000'); // stale shell cache from a prior deploy
  const prefsCache = await sandbox.caches.open(PREFERENCES_CACHE_NAME);
  await prefsCache.put('./__locale-preference__', { body: 'fr' });

  await fireInstall(listeners); // creates the current CACHE_NAME's own cache
  await fireActivate(listeners);

  const remaining = await sandbox.caches.keys();
  assert.deepEqual(
    remaining.sort(),
    [PREFERENCES_CACHE_NAME, 'swarmforge-dashboard-newhash0001'].sort(),
    'the stale shell cache is purged, but the preferences cache must survive'
  );
  const stillThere = await prefsCache.match('./__locale-preference__');
  assert.deepEqual(stillThere, { body: 'fr' }, 'a returning user\'s persisted preference must not be wiped by a shell-changing deploy');
});

// BL-249 hardener bounce, hardening gap: sw.js's exemption and app.js's own
// cache both hardcode PREFERENCES_CACHE_NAME as a literal - the two files
// share no module system, so nothing but eyeballing keeps them in sync. The
// test above only proves sw.js keeps whatever name IT declares; it can't
// catch the two literals drifting apart, which is the exact collision class
// this ticket exists to prevent (sw.js's CACHE_NAME and app.js's old
// LOCALE_CACHE_NAME happened to match by accident until BL-249 made one of
// them change). Parse both real source files - same precedent as
// render-dashboard-font-size.js parsing this same constant out of app.js -
// so a future rename on only one side fails this test instead of silently
// reopening the wipe.
test('BL-249 bounce: sw.js and app.js declare the identical PREFERENCES_CACHE_NAME literal', () => {
  const swJsSource = fs.readFileSync(SW_PATH, 'utf8');
  const appJsSource = fs.readFileSync(APP_JS_PATH, 'utf8');
  const swMatch = swJsSource.match(/const PREFERENCES_CACHE_NAME\s*=\s*'([^']+)'/);
  const appMatch = appJsSource.match(/var PREFERENCES_CACHE_NAME\s*=\s*'([^']+)'/);
  assert.ok(swMatch, 'sw.js must declare a PREFERENCES_CACHE_NAME string literal');
  assert.ok(appMatch, 'app.js must declare a PREFERENCES_CACHE_NAME string literal');
  assert.equal(
    swMatch[1],
    appMatch[1],
    'sw.js\'s purge exemption and app.js\'s actual preferences cache name must be hand-synced identically, or the next shell-changing deploy silently wipes preferences again'
  );
});

// BL-249 unchanged-shell-no-churn-02: two installs stamped with the SAME
// CACHE_NAME (a byte-identical redeploy, since the stamp is content-
// derived) never purge anything and never force a re-download.
test('installing twice under the same (content-derived) CACHE_NAME never purges anything', async () => {
  const { listeners, sandbox } = loadServiceWorker(
    () => Promise.reject(new Error('no network in this test')),
    'swarmforge-dashboard-samehash0000'
  );

  await fireInstall(listeners);
  await fireActivate(listeners);
  await fireInstall(listeners);
  await fireActivate(listeners);

  const remaining = await sandbox.caches.keys();
  assert.deepEqual(remaining, ['swarmforge-dashboard-samehash0000']);
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

test('recert-batch.json fetch is network-first, same as backlog.json (BL-150)', async () => {
  const networkResponse = { clone: () => ({ served: 'recert-batch-network' }), body: 'network' };
  const { listeners } = loadServiceWorker((req) => {
    assert.equal(req.url, RECERT_BATCH_URL);
    return Promise.resolve(networkResponse);
  });
  const result = await fireFetch(listeners, RECERT_BATCH_URL);
  assert.equal(result, networkResponse);
});

test('recert-batch.json fetch falls back to the cache when the network fails (BL-150)', async () => {
  const { listeners, sandbox } = loadServiceWorker(() => Promise.reject(new Error('offline')));
  const cache = await sandbox.caches.open('swarmforge-dashboard-v2');
  const cachedResponse = { body: 'cached recert batch' };
  await cache.put(RECERT_BATCH_URL, cachedResponse);

  const result = await fireFetch(listeners, RECERT_BATCH_URL);
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

test('periodicsync with the expected tag re-fetches and caches every data artifact (dashboard-06, BL-150 recert-batch.json included)', async () => {
  let fetchCount = 0;
  const { listeners, sandbox } = loadServiceWorker((req) => {
    fetchCount += 1;
    return Promise.resolve({ clone: () => ({ served: 'refreshed:' + req.url }) });
  });

  let waited;
  listeners.periodicsync({ tag: 'refresh-backlog-json', waitUntil: (p) => { waited = p; } });
  await waited;

  assert.equal(fetchCount, 3, 'every data artifact must be re-fetched on periodic sync');
  const cache = await sandbox.caches.open('swarmforge-dashboard-v2');
  const cachedBacklog = await cache.match('./backlog.json');
  const cachedDocsTree = await cache.match('./docs-tree.json');
  const cachedRecertBatch = await cache.match('./recert-batch.json');
  assert.deepEqual(cachedBacklog, { served: 'refreshed:./backlog.json' });
  assert.deepEqual(cachedDocsTree, { served: 'refreshed:./docs-tree.json' });
  assert.deepEqual(cachedRecertBatch, { served: 'refreshed:./recert-batch.json' });
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
