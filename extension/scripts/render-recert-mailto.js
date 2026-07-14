#!/usr/bin/env node
// BL-223: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/app.js in jsdom (mirroring
// extension/test/pwaRecertification.test.js's own pattern) fed a provided
// recert-batch.json fixture, taps the Confirm action, and prints the
// resulting mailto: link's {to, subject, body} as JSON - lets BL-223's
// acceptance steps assert against the real PWA mailto-composition code
// instead of reimplementing it in JS. Lives here (not specs/pipeline/) so
// its `require('jsdom')` resolves against this package's own node_modules.
//
// Usage: node render-recert-mailto.js <recert-batch-json-path>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const recertBatchPath = process.argv[2];
if (!recertBatchPath) {
  console.error('Usage: render-recert-mailto.js <recert-batch-json-path>');
  process.exit(1);
}
const recertBatch = JSON.parse(fs.readFileSync(recertBatchPath, 'utf8'));

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

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

const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
dom.window.fetch = (url) => {
  if (url === './backlog.json') {
    return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
  }
  if (url === './docs-tree.json') {
    return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
  }
  if (url === './recert-batch.json') {
    return Promise.resolve({ json: () => Promise.resolve(recertBatch) });
  }
  return Promise.reject(new Error('unexpected fetch: ' + url));
};
dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));

// BL-223 VIOLATION fix (architect): a real, arbitrary-duration wait ("hope
// 50ms is enough") is exactly the flaky real-timer pattern the engineering
// article's testability rule forbids. This is a single macrotask tick
// (0ms), the same flush() convention pwaRecertification.test.js's own
// tests already use - it drains the microtask queue (where app.js's
// fetch().then() chain resolves) deterministically, not a wall-clock wait.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

flush().then(() => {
  const contentEl = dom.window.document.getElementById('recertContent');
  const confirmLink = [...contentEl.querySelectorAll('a')].find((a) => a.textContent.indexOf('Confirm') === 0);
  if (!confirmLink) {
    console.error('no Confirm link was rendered - recert-batch.json fixture may be malformed');
    process.exit(1);
  }
  const url = new URL(confirmLink.href);
  process.stdout.write(
    JSON.stringify({
      to: decodeURIComponent(url.pathname),
      subject: url.searchParams.get('subject'),
      body: url.searchParams.get('body'),
    })
  );
});
