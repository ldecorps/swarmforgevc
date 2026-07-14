const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-291: renders the REAL pwa/index.html + pwa/locales.js + pwa/app.js in
// jsdom (mirroring pwaFontSize.test.js's own pattern) and exercises each
// section header's collapse/expand control by dispatching real click/
// keydown events - proving the app actually hides/shows the section body
// and persists per-section state via the SAME preferences Cache Storage
// instance as locale/font-size, never localStorage/sessionStorage.

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');
const PREF_CACHE_NAME = 'swarmforge-dashboard-preferences';
const COLLAPSE_PREF_KEY = './__section-collapsed-preference__';

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

function installFetch(dom, opts = {}) {
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
}

function renderDashboard(opts = {}) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  if (opts.withCaches) {
    installFakeCaches(dom);
  }
  installFetch(dom, opts);
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  return dom;
}

// A fresh JSDOM instance seeded with a persisted collapse map before app.js
// ever runs - simulates "reopen the PWA after a previous visit collapsed a
// section".
function reopenDashboardWithPersistedCollapse(collapseMap) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  installFakeCaches(dom);
  return dom.window.caches
    .open(PREF_CACHE_NAME)
    .then((c) => c.put(COLLAPSE_PREF_KEY, new dom.window.Response(JSON.stringify(collapseMap))))
    .then(() => {
      installFetch(dom);
      dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
      dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
      return dom;
    });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function click(dom, element) {
  element.dispatchEvent(new dom.window.Event('click'));
}

function keydown(dom, element, key) {
  const evt = new dom.window.Event('keydown', { cancelable: true });
  evt.key = key;
  element.dispatchEvent(evt);
}

function sectionHeader(dom, key) {
  return dom.window.document.querySelector('h2[data-i18n="' + key + '"]');
}

function sectionBody(dom, key) {
  return sectionHeader(dom, key).closest('section').querySelector('.section-body');
}

// ── collapsible-sections-01 ─────────────────────────────────────────────────

test('collapsible-sections-01: activating a section header hides its body, activating again shows it', async () => {
  const dom = renderDashboard();
  await flush();
  const header = sectionHeader(dom, 'velocityHeading');
  const body = sectionBody(dom, 'velocityHeading');
  assert.notEqual(body.style.display, 'none');
  click(dom, header);
  assert.equal(body.style.display, 'none');
  click(dom, header);
  assert.notEqual(body.style.display, 'none');
});

// ── collapsible-sections-02 ─────────────────────────────────────────────────

test('collapsible-sections-02: the header is keyboard-operable (Enter and Space) and aria-expanded tracks state', async () => {
  const dom = renderDashboard();
  await flush();
  const header = sectionHeader(dom, 'burndownHeading');
  const body = sectionBody(dom, 'burndownHeading');
  assert.equal(header.getAttribute('aria-expanded'), 'true');

  keydown(dom, header, 'Enter');
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  assert.equal(body.style.display, 'none');

  keydown(dom, header, ' ');
  assert.equal(header.getAttribute('aria-expanded'), 'true');
  assert.notEqual(body.style.display, 'none');
});

// ── collapsible-sections-03 ─────────────────────────────────────────────────

test('collapsible-sections-03: a collapsed state is written to the same Cache Storage instance as other preferences, not localStorage', async () => {
  const dom = renderDashboard({ withCaches: true });
  await flush();
  click(dom, sectionHeader(dom, 'burndownHeading'));
  await flush();

  const cache = await dom.window.caches.open(PREF_CACHE_NAME);
  const stored = await cache.match(COLLAPSE_PREF_KEY);
  assert.ok(stored, 'the section-collapse preference must be written into the existing dashboard cache');
  const data = await stored.json();
  assert.equal(data.burndownHeading, true);
});

test('collapsible-sections-03: a persisted collapsed section restores collapsed on reopen, others stay expanded', async () => {
  const dom = await reopenDashboardWithPersistedCollapse({ cycleTimeHeading: true });
  await flush();
  await flush();

  assert.equal(sectionHeader(dom, 'cycleTimeHeading').getAttribute('aria-expanded'), 'false');
  assert.equal(sectionBody(dom, 'cycleTimeHeading').style.display, 'none');
  assert.equal(sectionHeader(dom, 'velocityHeading').getAttribute('aria-expanded'), 'true');
  assert.notEqual(sectionBody(dom, 'velocityHeading').style.display, 'none');
});

// ── collapsible-sections-04 ─────────────────────────────────────────────────

test('collapsible-sections-04: collapsing one section leaves the others expanded', async () => {
  const dom = renderDashboard();
  await flush();
  click(dom, sectionHeader(dom, 'boardHeading'));

  assert.equal(sectionBody(dom, 'boardHeading').style.display, 'none');
  assert.notEqual(sectionBody(dom, 'needsApprovalHeading').style.display, 'none');
  assert.notEqual(sectionBody(dom, 'velocityHeading').style.display, 'none');
  assert.notEqual(sectionBody(dom, 'recertHeading').style.display, 'none');
});

// ── collapsible-sections-05 ─────────────────────────────────────────────────

test('collapsible-sections-05: with no saved state, every section starts expanded', async () => {
  const dom = renderDashboard({ withCaches: true });
  await flush();
  await flush();

  const keys = [
    'needsApprovalHeading',
    'boardHeading',
    'velocityHeading',
    'burndownHeading',
    'cycleTimeHeading',
    'suiteDurationHeading',
    'costHealthHeading',
    'documentationHeading',
    'recertHeading',
  ];
  keys.forEach((key) => {
    assert.equal(sectionHeader(dom, key).getAttribute('aria-expanded'), 'true', key + ' aria-expanded should be true');
  });
  // suiteDurationSection/costHealthSection are hidden by data-presence, not
  // by collapse - only assert body visibility for the always-shown sections.
  ['needsApprovalHeading', 'boardHeading', 'velocityHeading', 'burndownHeading', 'cycleTimeHeading', 'documentationHeading', 'recertHeading'].forEach((key) => {
    assert.notEqual(sectionBody(dom, key).style.display, 'none', key + ' body should start visible');
  });
});

