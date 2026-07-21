#!/usr/bin/env node
// BL-257: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/locales.js + pwa/app.js in jsdom (mirroring
// render-docs-untranslated.js's own pattern) against fixture backlog.json/
// docs-tree.json data, drives the board filter/search and docs-explorer
// timeline interactions a real operator would, and prints a JSON result so
// BL-257's acceptance steps assert against the real PWA rendering code
// instead of reimplementing it in JS.
//
// Usage: node render-pwa-enrichment.js <config-json>
// config: {
//   board: { active: [], paused: [], doneByMilestone: {} },
//   tickets: [{ id, title, status, priority, milestone, specDateIso, closeDateIso }],
//   actions: Array<
//     | { type: 'filterQuery', value: string }
//     | { type: 'filterStatus', value: string }
//     | { type: 'filterPriority', value: string }
//     | { type: 'openMilestone', milestone: string }
//     | { type: 'openTicket', id: string }
//   >
// }
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

const config = JSON.parse(process.argv[2]);

function fakeBacklog() {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    board: config.board || { active: [], paused: [], doneByMilestone: {} },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
    needsApproval: [],
  };
}

function fakeDocsTree() {
  const tickets = config.tickets || [];
  const byMilestone = {};
  tickets.forEach((t) => {
    const m = t.milestone || 'unspecified';
    byMilestone[m] = byMilestone[m] || [];
    byMilestone[m].push({ id: t.id, title: t.title, status: t.status, priority: t.priority, implemented: t.status === 'done' });
  });
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [],
    milestones: Object.keys(byMilestone).map((m) => ({ milestone: m, tickets: byMilestone[m] })),
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      milestone: t.milestone,
      description: t.description || '',
      scenarios: t.scenarios || [],
      specDateIso: t.specDateIso,
      closeDateIso: t.closeDateIso,
    })),
  };
}

const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
const { window } = dom;

window.fetch = (url) => {
  if (url === './backlog.json') {
    return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
  }
  if (url === './docs-tree.json') {
    return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
  }
  return Promise.reject(new Error('unexpected fetch: ' + url));
};

dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function click(element) {
  element.dispatchEvent(new window.Event('click'));
}

function setValue(element, value, eventType) {
  element.value = value;
  element.dispatchEvent(new window.Event(eventType));
}

function findButtonByText(container, text) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent.indexOf(text) === 0 || b.textContent.indexOf(text) !== -1);
}

async function run() {
  await flush();
  const board = () => window.document.getElementById('board');
  const explorer = () => window.document.getElementById('docsExplorer');

  (config.actions || []).forEach((action) => {
    if (action.type === 'filterQuery') {
      setValue(window.document.getElementById('boardFilterQuery'), action.value, 'input');
    } else if (action.type === 'filterStatus') {
      setValue(window.document.getElementById('boardFilterStatus'), action.value, 'change');
    } else if (action.type === 'filterPriority') {
      setValue(window.document.getElementById('boardFilterPriority'), action.value, 'input');
    } else if (action.type === 'openMilestone') {
      click(findButtonByText(explorer(), action.milestone));
    } else if (action.type === 'openTicket') {
      click(findButtonByText(explorer(), action.id));
    }
  });

  console.log(JSON.stringify({ boardText: board().textContent, docsExplorerText: explorer().textContent }));
}

run();
