#!/usr/bin/env node
// BL-291: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/app.js in jsdom (mirroring render-dashboard-font-size.js's
// own pattern) and drives each section header's collapse/expand control via
// real click/keydown events - lets BL-291's acceptance steps assert against
// the real PWA collapse code instead of reimplementing it in JS. Lives here
// (not specs/pipeline/) so its `require('jsdom')` resolves against this
// package's own node_modules.
//
// Usage:
//   node render-dashboard-collapsible-sections.js click <key> <count>
//   node render-dashboard-collapsible-sections.js keydown <key> <keyName> <count>
//   node render-dashboard-collapsible-sections.js reopen <key>
//   node render-dashboard-collapsible-sections.js fresh
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');
const APP_JS_SOURCE = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
// BL-249 bounce fix precedent: parsed out of pwa/app.js's own
// PREFERENCES_CACHE_NAME source rather than duplicated by hand, so this
// harness can't silently drift from the real value.
const CACHE_NAME_MATCH = APP_JS_SOURCE.match(/PREFERENCES_CACHE_NAME\s*=\s*'([^']+)'/);
if (!CACHE_NAME_MATCH) {
  throw new Error('render-dashboard-collapsible-sections.js: could not find PREFERENCES_CACHE_NAME in pwa/app.js');
}
const CACHE_NAME = CACHE_NAME_MATCH[1];
const SECTION_COLLAPSE_KEY = './__section-collapsed-preference__';

const [, , mode, ...rest] = process.argv;
const USAGE =
  'Usage: render-dashboard-collapsible-sections.js <click <key> <count> | keydown <key> <keyName> <count> | reopen <key> | fresh>';
if (!['click', 'keydown', 'reopen', 'fresh'].includes(mode)) {
  console.error(USAGE);
  process.exit(1);
}

function fakeBacklog() {
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
}

function installFetch(dom) {
  dom.window.fetch = (url) => {
    if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
    if (url === './recert-batch.json') return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
}

function renderDashboard(withCaches) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  if (withCaches) {
    installFakeCaches(dom);
  }
  installFetch(dom);
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sectionHeader(dom, key) {
  return dom.window.document.querySelector('h2[data-i18n="' + key + '"]');
}

function sectionBody(dom, key) {
  return sectionHeader(dom, key).closest('section').querySelector('.section-body');
}

function readAllSectionStates(dom) {
  const headers = dom.window.document.querySelectorAll('h2[data-i18n]');
  const out = {};
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const key = header.getAttribute('data-i18n');
    const body = header.closest('section').querySelector('.section-body');
    out[key] = { ariaExpanded: header.getAttribute('aria-expanded'), bodyDisplay: body ? body.style.display : null };
  }
  return out;
}

function clickHeader(dom, key, times) {
  const header = sectionHeader(dom, key);
  for (let i = 0; i < times; i++) {
    header.dispatchEvent(new dom.window.Event('click'));
  }
}

function keydownHeader(dom, key, keyName, times) {
  const header = sectionHeader(dom, key);
  for (let i = 0; i < times; i++) {
    const evt = new dom.window.Event('keydown', { cancelable: true });
    evt.key = keyName;
    header.dispatchEvent(evt);
  }
}

if (mode === 'click') {
  const [key, countArg] = rest;
  const dom = renderDashboard(false);
  flush().then(() => {
    clickHeader(dom, key, Number(countArg || '1'));
    process.stdout.write(JSON.stringify({ sections: readAllSectionStates(dom) }));
  });
} else if (mode === 'keydown') {
  const [key, keyName, countArg] = rest;
  const dom = renderDashboard(false);
  flush().then(() => {
    keydownHeader(dom, key, keyName, Number(countArg || '1'));
    process.stdout.write(JSON.stringify({ sections: readAllSectionStates(dom) }));
  });
} else if (mode === 'fresh') {
  const dom = renderDashboard(true);
  flush()
    .then(() => flush())
    .then(() => {
      process.stdout.write(JSON.stringify({ sections: readAllSectionStates(dom) }));
    });
} else {
  // reopen <key>: collapse one section, persist, then simulate a fresh
  // load seeded from that persisted state - proves restore-on-reopen, not
  // just in-memory toggle state.
  const [key] = rest;
  const first = renderDashboard(true);
  flush()
    .then(() => {
      clickHeader(first, key, 1);
      return flush();
    })
    .then(() => first.window.caches.open(CACHE_NAME))
    .then((cache) => cache.match(SECTION_COLLAPSE_KEY))
    .then((stored) => stored.json())
    .then((persisted) => {
      const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
      const second = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
      installFakeCaches(second);
      installFetch(second);
      return second.window.caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(SECTION_COLLAPSE_KEY, new second.window.Response(JSON.stringify(persisted))))
        .then(() => {
          second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
          second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
          return flush().then(() => flush());
        })
        .then(() => {
          process.stdout.write(JSON.stringify({ sections: readAllSectionStates(second) }));
        });
    });
}
