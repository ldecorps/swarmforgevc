#!/usr/bin/env node
// BL-338: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/app.js in jsdom (mirroring render-burndown-chart.js's
// own pattern - lives here, not specs/pipeline/, so its require('jsdom')
// resolves against this package's own node_modules) fed a provided
// backlog.json fixture, and prints the cost & health section's rendered
// cost-per-ticket structure as JSON - lets BL-338's acceptance steps assert
// the diagram genuinely reaches the real PWA surface, not just the
// underlying data.
//
// Usage: node render-cost-per-ticket-chart.js <backlog-json-path>
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const backlogPath = process.argv[2];
if (!backlogPath) {
  console.error('Usage: render-cost-per-ticket-chart.js <backlog-json-path>');
  process.exit(1);
}
const backlog = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
dom.window.fetch = (url) => {
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
  const container = document.getElementById('costHealth');
  process.stdout.write(
    JSON.stringify({
      costHealthText: container.textContent,
      hasSvg: container.querySelectorAll('svg').length > 0,
    })
  );
});
