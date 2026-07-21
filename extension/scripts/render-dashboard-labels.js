#!/usr/bin/env node
// BL-229/BL-230: test-only harness for the acceptance pipeline. Renders the
// REAL pwa/index.html + pwa/app.js in jsdom (mirroring render-recert-mailto.js's
// own pattern) fed a provided backlog.json fixture, optionally toggles to a
// target locale, and prints the board/burndown sections' rendered text as
// JSON - lets BL-229/BL-230's acceptance steps assert against the real PWA
// code instead of reimplementing it in JS. Lives here (not specs/pipeline/)
// so its `require('jsdom')` resolves against this package's own
// node_modules.
//
// Usage: node render-dashboard-labels.js <backlog-json-path> [locale] [extraLocalesJson]
//
// BL-230: extraLocalesJson (optional) is merged into window.LOCALES before
// app.js loads - lets an acceptance scenario prove the toggle cycle and
// board title lookup work for a locale that is not yet a real, shipped
// chrome-catalog entry (e.g. the add-language-05 "adding a locale needs no
// code change" scenario), without writing a throwaway locale into the real
// pwa/locales.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const backlogPath = process.argv[2];
const locale = process.argv[3] || 'en';
const extraLocalesJson = process.argv[4];
if (!backlogPath) {
  console.error('Usage: render-dashboard-labels.js <backlog-json-path> [locale] [extraLocalesJson]');
  process.exit(1);
}
const backlog = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

function fakeDocsTree() {
  return { schemaVersion: 1, generatedAtIso: '2026-07-09T12:00:00Z', sourceSha: 'abc123def456', vision: [], milestones: [], tickets: [] };
}

function fakeRecertBatch() {
  return { schemaVersion: 1, generatedAtIso: '2026-07-09T12:00:00Z', batch: [] };
}

const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
dom.window.fetch = (url) => {
  if (url === './backlog.json') {
    return Promise.resolve({ json: () => Promise.resolve(backlog) });
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
if (extraLocalesJson) {
  Object.assign(dom.window.LOCALES, JSON.parse(extraLocalesJson));
}
dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));

// Same "single macrotask tick" flush convention as
// extension/test/pwaLocale.test.js and render-recert-mailto.js - never a
// real, arbitrary-duration wait.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// BL-230: the toggle cycles forward one configured locale per click (see
// app.js's own nextLocale) - clicking the target locale's index in
// window.LOCALES's key order reaches it generically, with no per-locale
// special case (index 0, the default/source locale, needs zero clicks;
// 'fr' still needs exactly one click, same as before this generalized).
async function clickToLocale(targetLocale) {
  const locales = Object.keys(dom.window.LOCALES || {});
  const clicks = Math.max(0, locales.indexOf(targetLocale));
  const toggle = dom.window.document.getElementById('localeToggle');
  for (let i = 0; i < clicks; i++) {
    toggle.dispatchEvent(new dom.window.Event('click'));
    await flush();
  }
}

flush()
  .then(() => clickToLocale(locale))
  .then(() => {
    process.stdout.write(
      JSON.stringify({
        boardText: dom.window.document.getElementById('board').textContent,
        burndownText: dom.window.document.getElementById('burndown').textContent,
      })
    );
  });
