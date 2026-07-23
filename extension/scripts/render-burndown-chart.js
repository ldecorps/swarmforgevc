#!/usr/bin/env node
// BL-287: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/app.js in jsdom (mirroring render-dashboard-labels.js's
// own pattern - lives here, not specs/pipeline/, so its require('jsdom')
// resolves against this package's own node_modules) fed a provided
// backlog.json fixture, and prints the burndown section's chart STRUCTURE
// as JSON - lets BL-287's acceptance steps assert against the real line/
// polyline/legend markup instead of reimplementing the chart in JS.
//
// Usage: node render-burndown-chart.js <backlog-json-path> [locale]
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const backlogPath = process.argv[2];
const locale = process.argv[3] || 'en';
if (!backlogPath) {
  console.error('Usage: render-burndown-chart.js <backlog-json-path> [locale]');
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
    const document = dom.window.document;
    const container = document.getElementById('burndown');
    const svg = container.querySelector('svg');
    const polyline = container.querySelector('polyline.remaining-line');
    const idealLine = container.querySelector('line.ideal-line');
    const axisLabels = Array.from(container.querySelectorAll('text.chart-axis-label')).map((n) => n.textContent);
    const remainingEntry = container.querySelector('.chart-legend .legend-remaining');
    const idealEntry = container.querySelector('.chart-legend .legend-ideal');

    process.stdout.write(
      JSON.stringify({
        burndownText: container.textContent,
        hasSvg: !!svg,
        hasBarRects: container.querySelectorAll('svg rect').length > 0,
        polylinePointCount: polyline ? polyline.getAttribute('points').trim().split(/\s+/).length : 0,
        idealLine: idealLine
          ? {
              present: true,
              dashed: !!idealLine.getAttribute('stroke-dasharray'),
              x1: idealLine.getAttribute('x1'),
              y1: idealLine.getAttribute('y1'),
              x2: idealLine.getAttribute('x2'),
              y2: idealLine.getAttribute('y2'),
            }
          : { present: false },
        axisLabels,
        legend: {
          remainingText: remainingEntry ? remainingEntry.textContent : null,
          idealText: idealEntry ? idealEntry.textContent : null,
        },
      })
    );
  });
