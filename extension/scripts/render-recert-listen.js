#!/usr/bin/env node
// BL-271: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/locales.js + pwa/app.js in jsdom (mirroring
// render-approval-ticket-detail.js's own pattern), against a fixture
// recert-batch.json, drives the SAME Listen/Stop interaction a real
// operator would in the recert view, and prints a JSON result so BL-271's
// acceptance steps assert against the real PWA rendering code instead of
// reimplementing it in JS. Lives here (not specs/pipeline/) so its
// `require('jsdom')` resolves against this package's own node_modules.
//
// Usage: node render-recert-listen.js <config-json>
// config: {
//   batch: [{ id, ticketId, name, text }],
//   actions: Array<'listen'|'stop'>,
//   speechAvailable: boolean (default true)
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
  return { schemaVersion: 1, generatedAtIso: '2026-07-09T12:00:00Z', sourceSha: 'abc123def456', vision: [], milestones: [], tickets: [] };
}

function fakeRecertBatch() {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    recertEmailTo: 'recert@tolokarooo.resend.app',
    batch: config.batch || [],
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
  return window.document.getElementById('recertContent');
}

function findListenButton() {
  return Array.from(container().querySelectorAll('button')).find((b) => /listen|écouter|stop|arrêter/i.test(b.textContent));
}

async function run() {
  await flush();
  (config.actions || []).forEach((action) => {
    if (action === 'listen' || action === 'stop') {
      click(findListenButton());
    }
  });
  const c = container();
  const listenBtn = findListenButton();
  console.log(
    JSON.stringify({
      text: c.textContent,
      hasListenButton: !!listenBtn,
      ariaLabel: listenBtn ? listenBtn.getAttribute('aria-label') : null,
      spoken: speechCalls.spoken,
      cancelledCount: speechCalls.cancelled,
    })
  );
}

run();
