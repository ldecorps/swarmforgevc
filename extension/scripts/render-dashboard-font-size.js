#!/usr/bin/env node
// BL-220: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/app.js in jsdom (mirroring render-dashboard-labels.js's
// own pattern) and drives the A-/A+ font-size control via real click events -
// lets BL-220's acceptance steps assert against the real PWA font-size code
// instead of reimplementing it in JS. Lives here (not specs/pipeline/) so its
// `require('jsdom')` resolves against this package's own node_modules.
//
// Usage:
//   node render-dashboard-font-size.js click <A-|A+> <count>
//   node render-dashboard-font-size.js persist <A-|A+> <count>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');
const APP_JS_SOURCE = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
// BL-249 bounce fix: parsed out of pwa/app.js's own PREFERENCES_CACHE_NAME
// source rather than duplicated by hand, so this harness can't silently drift
// from the real value the same way the pre-fix hardcoded literal did (same
// precedent as stamp-pwa-cache-name.ts parsing SHELL_ASSETS out of sw.js).
const CACHE_NAME_MATCH = APP_JS_SOURCE.match(/PREFERENCES_CACHE_NAME\s*=\s*'([^']+)'/);
if (!CACHE_NAME_MATCH) {
  throw new Error('render-dashboard-font-size.js: could not find PREFERENCES_CACHE_NAME in pwa/app.js');
}
const CACHE_NAME = CACHE_NAME_MATCH[1];
const FONT_SIZE_KEY = './__font-size-preference__';

const [, , mode, control, countArg] = process.argv;
if (!['click', 'persist'].includes(mode) || !['A-', 'A+'].includes(control)) {
  console.error('Usage: render-dashboard-font-size.js <click|persist> <A-|A+> <count>');
  process.exit(1);
}
const count = Number(countArg || '1');

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

function renderDashboard(withCaches) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  if (withCaches) {
    installFakeCaches(dom);
  }
  dom.window.fetch = (url) => {
    if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
    if (url === './recert-batch.json') return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function clickButton(dom, times) {
  const id = control === 'A+' ? 'fontIncrease' : 'fontDecrease';
  const button = dom.window.document.getElementById(id);
  for (let i = 0; i < times; i++) {
    button.dispatchEvent(new dom.window.Event('click'));
  }
}

function rootFontSizePx(dom) {
  return parseInt(dom.window.getComputedStyle(dom.window.document.documentElement).fontSize, 10);
}

if (mode === 'click') {
  const dom = renderDashboard(false);
  flush().then(() => {
    clickButton(dom, count);
    process.stdout.write(JSON.stringify({ fontSizePx: rootFontSizePx(dom) }));
  });
} else {
  const first = renderDashboard(true);
  flush()
    .then(() => {
      clickButton(first, count);
      return flush();
    })
    .then(() => first.window.caches.open(CACHE_NAME))
    .then((cache) => cache.match(FONT_SIZE_KEY))
    .then((stored) => stored.json())
    .then((persisted) => {
      const beforePx = rootFontSizePx(first);
      const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
      const second = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
      installFakeCaches(second);
      second.window.fetch = (url) => {
        if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
        if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
        if (url === './recert-batch.json') return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
        return Promise.reject(new Error('unexpected fetch: ' + url));
      };
      return second.window.caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(FONT_SIZE_KEY, new second.window.Response(JSON.stringify(persisted))))
        .then(() => {
          second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
          second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
          return flush().then(() => flush());
        })
        .then(() => {
          process.stdout.write(JSON.stringify({ beforePx, reopenPx: rootFontSizePx(second) }));
        });
    });
}
