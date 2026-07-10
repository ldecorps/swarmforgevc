#!/usr/bin/env node
// BL-229: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/app.js in jsdom (mirroring render-recert-mailto.js's
// own pattern) fed a provided backlog.json fixture, optionally toggles to
// French, and prints the board/burndown sections' rendered text as JSON -
// lets BL-229's acceptance steps assert against the real PWA label-catalog
// code instead of reimplementing it in JS. Lives here (not specs/pipeline/)
// so its `require('jsdom')` resolves against this package's own
// node_modules.
//
// Usage: node render-dashboard-labels.js <backlog-json-path> [locale]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const backlogPath = process.argv[2];
const locale = process.argv[3] || 'en';
if (!backlogPath) {
  console.error('Usage: render-dashboard-labels.js <backlog-json-path> [locale]');
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
dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));

// Same "single macrotask tick" flush convention as
// extension/test/pwaLocale.test.js and render-recert-mailto.js - never a
// real, arbitrary-duration wait.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

flush()
  .then(() => {
    if (locale === 'fr') {
      const toggle = dom.window.document.getElementById('localeToggle');
      toggle.dispatchEvent(new dom.window.Event('click'));
      return flush();
    }
  })
  .then(() => {
    process.stdout.write(
      JSON.stringify({
        boardText: dom.window.document.getElementById('board').textContent,
        burndownText: dom.window.document.getElementById('burndown').textContent,
      })
    );
  });
