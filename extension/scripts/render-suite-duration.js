#!/usr/bin/env node
// BL-290: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/app.js in jsdom (mirroring render-burndown-chart.js's
// own pattern - lives here, not specs/pipeline/, so its require('jsdom')
// resolves against this package's own node_modules) fed a provided
// backlog.json fixture, and prints the suite-duration section's rendered
// state as JSON - lets BL-290's acceptance steps assert against the real
// markup/visibility instead of reimplementing the render in JS. Tracks
// every fetch URL too, so a scenario can assert the two-surface rule holds
// (only the PWA's own pre-existing static committed fetches, never a live
// host endpoint).
//
// Usage: node render-suite-duration.js <backlog-json-path>
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const backlogPath = process.argv[2];
if (!backlogPath) {
  console.error('Usage: render-suite-duration.js <backlog-json-path>');
  process.exit(1);
}
const backlog = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
const fetchCalls = [];
dom.window.fetch = (url) => {
  fetchCalls.push(url);
  if (url === './backlog.json') {
    return Promise.resolve({ json: () => Promise.resolve(backlog) });
  }
  return Promise.reject(new Error('unexpected fetch: ' + url));
};
dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

flush().then(() => {
  const document = dom.window.document;
  const section = document.getElementById('suiteDurationSection');
  process.stdout.write(
    JSON.stringify({
      hidden: section.style.display === 'none',
      text: document.getElementById('suiteDuration').textContent,
      fetchCalls,
    })
  );
});
