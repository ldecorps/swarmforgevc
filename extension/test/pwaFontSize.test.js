const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-220: renders the REAL pwa/index.html + pwa/locales.js + pwa/app.js in
// jsdom (mirroring pwaLocale.test.js's own pattern) and exercises the A-/A+
// font-size control by dispatching real click events - proving the app
// actually scales the root font-size rather than restating the control
// logic by hand.

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

function fakeBacklog(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    board: { active: [], paused: [], doneByMilestone: {} },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
    ...overrides,
  };
}

function fakeDocsTree() {
  return { schemaVersion: 1, generatedAtIso: '2026-07-09T12:00:00Z', sourceSha: 'abc123def456', vision: [], milestones: [], tickets: [] };
}

function fakeRecertBatch() {
  return { schemaVersion: 1, generatedAtIso: '2026-07-09T12:00:00Z', batch: [] };
}

function installFakeCaches(dom) {
  const store = new Map();
  dom.window.Response = function (body) {
    this._body = body;
  };
  dom.window.Response.prototype.json = function () {
    return Promise.resolve(JSON.parse(this._body));
  };
  dom.window.Response.prototype.clone = function () {
    return this;
  };
  dom.window.caches = {
    open(name) {
      if (!store.has(name)) {
        store.set(name, new Map());
      }
      const cache = store.get(name);
      return Promise.resolve({
        match(key) {
          return Promise.resolve(cache.get(String(key)));
        },
        put(key, response) {
          cache.set(String(key), response);
          return Promise.resolve();
        },
      });
    },
  };
  return store;
}

function renderDashboard(opts = {}) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  if (opts.withCaches) {
    installFakeCaches(dom);
  }
  dom.window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(opts.backlog || fakeBacklog()) });
    }
    if (url === './docs-tree.json') {
      return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
    }
    if (url === './recert-batch.json') {
      return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function click(dom, element) {
  element.dispatchEvent(new dom.window.Event('click'));
}

function rootFontSize(dom) {
  return dom.window.getComputedStyle(dom.window.document.documentElement).fontSize;
}

function decreaseButton(dom) {
  return dom.window.document.getElementById('fontDecrease');
}

function increaseButton(dom) {
  return dom.window.document.getElementById('fontIncrease');
}

// ── default-large-01 ──────────────────────────────────────────────────────

test('default-large-01: first launch (no saved preference) renders at the 28px default', async () => {
  const dom = renderDashboard();
  await flush();
  assert.equal(rootFontSize(dom), '28px');
});

test('default-large-01: the A-/A+ controls carry accessible labels from the catalog', async () => {
  const dom = renderDashboard();
  await flush();
  assert.equal(decreaseButton(dom).getAttribute('aria-label'), 'Decrease text size');
  assert.equal(increaseButton(dom).getAttribute('aria-label'), 'Increase text size');
});

// ── step-02 ────────────────────────────────────────────────────────────────

test('step-02: A+ grows the root font-size by one 2px step, instantly, no reload', async () => {
  const dom = renderDashboard();
  await flush();
  click(dom, increaseButton(dom));
  assert.equal(rootFontSize(dom), '30px');
});

test('step-02: A- shrinks the root font-size by one 2px step, instantly, no reload', async () => {
  const dom = renderDashboard();
  await flush();
  click(dom, decreaseButton(dom));
  assert.equal(rootFontSize(dom), '26px');
});

test('step-02: repeated taps compound the step in both directions', async () => {
  const dom = renderDashboard();
  await flush();
  click(dom, increaseButton(dom));
  click(dom, increaseButton(dom));
  assert.equal(rootFontSize(dom), '32px');
  click(dom, decreaseButton(dom));
  assert.equal(rootFontSize(dom), '30px');
});

// ── clamp-03 ─────────────────────────────────────────────────────────────

test('clamp-03: A+ never grows the root font-size past the 40px maximum', async () => {
  const dom = renderDashboard();
  await flush();
  for (let i = 0; i < 20; i++) {
    click(dom, increaseButton(dom));
  }
  assert.equal(rootFontSize(dom), '40px');
});

test('clamp-03: A- never shrinks the root font-size below the 16px minimum', async () => {
  const dom = renderDashboard();
  await flush();
  for (let i = 0; i < 20; i++) {
    click(dom, decreaseButton(dom));
  }
  assert.equal(rootFontSize(dom), '16px');
});

// ── persist-04 ─────────────────────────────────────────────────────────────

test('persist-04: a chosen size is written to the same Cache Storage instance as the locale preference, not localStorage', async () => {
  const dom = renderDashboard({ withCaches: true });
  await flush();
  click(dom, increaseButton(dom));
  await flush();

  const cache = await dom.window.caches.open('swarmforge-dashboard-preferences');
  const stored = await cache.match('./__font-size-preference__');
  assert.ok(stored, 'the font-size preference must be written into the existing dashboard cache');
  const data = await stored.json();
  assert.equal(data.fontSizePx, 30);
});

test('persist-04: a previously-chosen non-default size is restored on reopen, not the default', async () => {
  const first = renderDashboard({ withCaches: true });
  await flush();
  click(first, increaseButton(first));
  click(first, increaseButton(first));
  click(first, increaseButton(first));
  await flush();
  const cacheStore = await first.window.caches.open('swarmforge-dashboard-preferences');
  const stored = await cacheStore.match('./__font-size-preference__');
  const persisted = await stored.json();
  assert.equal(persisted.fontSizePx, 34);

  // "reopen": a fresh DOM/app instance, seeded with the same persisted cache entry.
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const second = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  installFakeCaches(second);
  await second.window.caches
    .open('swarmforge-dashboard-preferences')
    .then((c) => c.put('./__font-size-preference__', new second.window.Response(JSON.stringify({ fontSizePx: 34 }))));
  second.window.fetch = (url) => {
    if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
    if (url === './recert-batch.json') return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  await flush();
  await flush(); // one extra tick for the async cache lookup + re-apply

  assert.equal(rootFontSize(second), '34px');
});

test('persist-04: a corrupt/out-of-range saved value falls back to the 28px default, not a crash', async () => {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  installFakeCaches(dom);
  await dom.window.caches
    .open('swarmforge-dashboard-preferences')
    .then((c) => c.put('./__font-size-preference__', new dom.window.Response(JSON.stringify({ fontSizePx: 9999 }))));
  dom.window.fetch = (url) => {
    if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
    if (url === './recert-batch.json') return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  await flush();
  await flush();

  assert.equal(rootFontSize(dom), '28px');
});
