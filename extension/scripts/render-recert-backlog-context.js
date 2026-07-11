#!/usr/bin/env node
// BL-280: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/locales.js + pwa/app.js in jsdom (mirroring
// render-recert-listen.js's own pattern), against a fixture recert-batch.json
// scenario and an optional matching docs-tree.json ticket, drives the SAME
// tap-through interaction a real caller would, and prints a JSON result so
// BL-280's acceptance steps assert against the real PWA rendering code
// instead of reimplementing it in JS. Lives here (not specs/pipeline/) so
// its `require('jsdom')` resolves against this package's own node_modules.
//
// Usage: node render-recert-backlog-context.js <config-json>
// config: {
//   scenario: { id, ticketId, ticketTitle?, ticketTitleFr?, name, text },
//   ticket: { id, title, ... } | null (absent from docs-tree),
//   locale: 'fr' | undefined,
//   tapTicketLine: boolean (default false)
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
    vision: [],
    milestones: [],
    tickets: config.ticket ? [config.ticket] : [],
  };
}

function fakeRecertBatch() {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    recertEmailTo: 'recert@tolokarooo.resend.app',
    batch: [config.scenario],
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
  if (url === './recert-batch.json') {
    return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
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

function recertContent() {
  return window.document.getElementById('recertContent');
}

function docsExplorer() {
  return window.document.getElementById('docsExplorer');
}

async function run() {
  await flush();
  if (config.locale) {
    click(window.document.getElementById('localeToggle'));
  }
  const contextEl = recertContent().querySelector('.recert-ticket-context');
  if (config.tapTicketLine && contextEl) {
    click(contextEl);
  }
  console.log(
    JSON.stringify({
      contextText: contextEl ? contextEl.textContent : null,
      contextTag: contextEl ? contextEl.tagName : null,
      docsExplorerText: docsExplorer().textContent,
    })
  );
}

run();
