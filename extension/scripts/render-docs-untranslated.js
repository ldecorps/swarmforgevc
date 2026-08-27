#!/usr/bin/env node
// BL-261: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/locales.js + pwa/app.js in jsdom (mirroring
// render-dashboard-font-size.js's own pattern) and drills into one of the
// four *Fr-reading surfaces, so BL-261's acceptance steps assert against
// the real PWA rendering code instead of reimplementing it in JS. Lives
// here (not specs/pipeline/) so its `require('jsdom')` resolves against
// this package's own node_modules.
//
// Usage: node render-docs-untranslated.js <title|description|vision|scenario> <flagged|clean>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

const [, , surface, mode] = process.argv;
if (!['title', 'description', 'vision', 'scenario'].includes(surface) || !['flagged', 'clean'].includes(mode)) {
  console.error('Usage: render-docs-untranslated.js <title|description|vision|scenario> <flagged|clean>');
  process.exit(1);
}
const flagged = mode === 'flagged';

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
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [
      {
        id: 'specification',
        title: 'Specification',
        kind: 'markdown',
        content: 'English prose.',
        contentFr: 'Prose française.',
        contentFrUntranslated: flagged,
      },
    ],
    milestones: [
      {
        milestone: 'M4',
        tickets: [{ id: 'BL-100', title: 'cost telemetry', titleFr: 'télémétrie des coûts', titleFrUntranslated: flagged, status: 'done', priority: 1 }],
      },
    ],
    tickets: [
      {
        id: 'BL-100',
        title: 'cost telemetry',
        titleFr: 'télémétrie des coûts',
        titleFrUntranslated: flagged,
        status: 'done',
        priority: 1,
        milestone: 'M4',
        description: 'English description.',
        descriptionFr: 'Description française.',
        descriptionFrUntranslated: flagged,
        scenarios: [
          {
            id: 'BL-100/s1',
            name: 'a scenario',
            text: 'Scenario: a scenario\n  Given x',
            textFr: 'Scénario : un scénario\n  Étant donné x',
            textFrUntranslated: flagged,
          },
        ],
      },
    ],
  };
}

function fakeRecertBatch() {
  return { schemaVersion: 1, generatedAtIso: '2026-07-09T12:00:00Z', batch: [] };
}

function renderDashboard() {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
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

function click(dom, element) {
  element.dispatchEvent(new dom.window.Event('click'));
}

const dom = renderDashboard();
flush().then(() => {
  const doc = dom.window.document;
  const explorer = doc.getElementById('docsExplorer');
  click(dom, doc.getElementById('localeToggle')); // switch to FR

  var ticketButton = null;
  if (surface === 'vision') {
    click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent === 'Specification'));
  } else {
    click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
    ticketButton = [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0);
    if (surface !== 'title') {
      click(dom, ticketButton);
      if (surface === 'scenario') {
        click(dom, explorer.querySelector('button'));
      }
    }
  }

  var noticeBeforeReveal = null;
  if (surface === 'scenario') {
    const noticeBefore = explorer.querySelector('.untranslated-notice');
    noticeBeforeReveal = noticeBefore ? noticeBefore.style.display !== 'none' : false;
    const revealBtn = [...explorer.querySelectorAll('button')].find(
      (b) => b.textContent.indexOf('French') !== -1 || b.textContent.indexOf('française') !== -1
    );
    click(dom, revealBtn);
  }

  const noticeEl = explorer.querySelector('.untranslated-notice');
  const result = {
    noticePresent: !!noticeEl,
    noticeVisible: noticeEl ? noticeEl.style.display !== 'none' : false,
    noticeBeforeReveal: noticeBeforeReveal,
    noticeText: noticeEl ? noticeEl.textContent : null,
    surfaceText: surface === 'title' ? ticketButton.textContent : explorer.textContent,
  };
  process.stdout.write(JSON.stringify(result));
});
