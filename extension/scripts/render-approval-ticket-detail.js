#!/usr/bin/env node
// BL-266: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/locales.js + pwa/app.js in jsdom (mirroring
// render-docs-untranslated.js's own pattern), against a fixture pending
// ticket + its needs-approval entry, drives the SAME interactions a real
// operator would (open, locale-toggle, listen, stop, back), and prints a
// JSON result so BL-266's acceptance steps assert against the real PWA
// rendering code instead of reimplementing it in JS. Lives here (not
// specs/pipeline/) so its `require('jsdom')` resolves against this
// package's own node_modules.
//
// Usage: node render-approval-ticket-detail.js <config-json>
// config: {
//   ticket: { id, title, description, scenarios: [{name, text}] } | null (missing from docs-tree),
//   locale: 'fr' | undefined,
//   actions: Array<'open'|'listen'|'stop'|'back'>,
//   speechAvailable: boolean (default true)
// }
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

const config = JSON.parse(process.argv[2]);
const needsApprovalId = config.ticket ? config.ticket.id : 'BL-999';
const needsApprovalTitle = config.ticket ? config.ticket.title : 'Missing ticket';

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
    needsApproval: [{ id: needsApprovalId, title: needsApprovalTitle }],
  };
}

function fakeDocsTree() {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [],
    milestones: [],
    tickets: config.ticket
      ? [
          {
            id: config.ticket.id,
            title: config.ticket.title,
            status: 'paused',
            priority: 12,
            milestone: 'M7',
            description: config.ticket.description,
            scenarios: config.ticket.scenarios || [],
          },
        ]
      : [],
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

const speechCalls = { spoken: [], cancelled: 0 };
if (config.speechAvailable !== false) {
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
    this.lang = '';
  };
  window.speechSynthesis = {
    speak: (utterance) => speechCalls.spoken.push({ text: utterance.text, lang: utterance.lang }),
    cancel: () => {
      speechCalls.cancelled += 1;
    },
  };
}

dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function click(element) {
  element.dispatchEvent(new window.Event('click'));
}

function container() {
  return window.document.getElementById('needsApproval');
}

function findButton(pattern) {
  return Array.from(container().querySelectorAll('button')).find((b) => pattern.test(b.textContent));
}

async function run() {
  await flush();
  if (config.locale) {
    click(window.document.getElementById('localeToggle'));
  }
  (config.actions || []).forEach((action) => {
    if (action === 'open') {
      click(findButton(new RegExp(needsApprovalId)));
    } else if (action === 'listen' || action === 'stop') {
      click(findButton(/listen|écouter|stop|arrêter/i));
    } else if (action === 'back') {
      click(findButton(/back|retour/i));
    }
  });
  const c = container();
  console.log(
    JSON.stringify({
      text: c.textContent,
      hasWriteControl: c.querySelectorAll('input, textarea, [contenteditable="true"], form').length > 0,
      hasApproveRejectButton: Array.from(c.querySelectorAll('button')).some((b) => /approve|reject|accept|deny/i.test(b.textContent)),
      hasListenButton: !!findButton(/listen|écouter/i),
      spoken: speechCalls.spoken,
      cancelledCount: speechCalls.cancelled,
    })
  );
}

run();
