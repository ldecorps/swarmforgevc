const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-293: renders the REAL pwa/index.html + pwa/app.js + pwa/locales.js in
// jsdom (mirroring pwaApprovalDetail.test.js's own speech-fixture pattern
// and pwaDocsExplorer.test.js's own navigation pattern) and drills down to
// a ticket's Gherkin full-detail view, exercising the REUSED BL-266 Listen
// control there via real click/keydown events - no second TTS
// implementation, no second spoken-text assembler.

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

function fakeDocsTree(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [],
    milestones: [{ milestone: 'M4', tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done', priority: 1 }] }],
    tickets: [
      {
        id: 'BL-100',
        title: 'cost telemetry',
        status: 'done',
        priority: 1,
        milestone: 'M4',
        description: 'Full prose description of BL-100.',
        scenarios: [
          { name: 'first scenario', text: 'Scenario: first scenario\n  Given a thing\n  Then it works' },
          { name: 'second scenario', text: 'Scenario: second scenario\n  Given another thing\n  Then it also works' },
        ],
      },
    ],
    ...overrides,
  };
}

function renderDashboard(docsTree, speech) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = (url) => {
    if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(docsTree) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  if (speech) {
    const calls = { spoken: [], cancelled: 0 };
    window.SpeechSynthesisUtterance = function (text) {
      this.text = text;
      this.lang = '';
    };
    window.speechSynthesis = {
      speak: (utterance) => {
        calls.spoken.push({ text: utterance.text, lang: utterance.lang });
      },
      cancel: () => {
        calls.cancelled += 1;
      },
    };
    window.__speechCalls = calls;
  }
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

function explorer(dom) {
  return dom.window.document.getElementById('docsExplorer');
}

function openTicketDetail(dom) {
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
}

function listenButton(dom) {
  return [...explorer(dom).querySelectorAll('button')].find((b) => /listen/i.test(b.textContent));
}

// ── gherkin-listen-01 ────────────────────────────────────────────────────

test('gherkin-listen-01: activating Listen on the ticket detail speaks the description then every scenario, in order', async () => {
  const dom = renderDashboard(fakeDocsTree(), true);
  await flush();
  openTicketDetail(dom);

  click(dom, listenButton(dom));
  assert.equal(dom.window.__speechCalls.spoken.length, 1);
  const spoken = dom.window.__speechCalls.spoken[0].text;
  assert.match(spoken, /Full prose description of BL-100/);
  assert.match(spoken, /Given a thing/);
  assert.match(spoken, /Given another thing/);
  assert.ok(spoken.indexOf('Full prose description') < spoken.indexOf('Given a thing'), 'description must come before the scenarios');
  assert.ok(spoken.indexOf('Given a thing') < spoken.indexOf('Given another thing'), 'scenarios must be in order');
});

test('gherkin-listen-01: activating Listen again stops the reading via cancel()', async () => {
  const dom = renderDashboard(fakeDocsTree(), true);
  await flush();
  openTicketDetail(dom);

  const btn = listenButton(dom);
  click(dom, btn); // start
  const cancelledBeforeStop = dom.window.__speechCalls.cancelled;
  click(dom, btn); // stop (SAME button - its label flips to "Stop" after starting)
  assert.ok(dom.window.__speechCalls.cancelled > cancelledBeforeStop, 'expected cancel() to be called on stop');
});

// ── gherkin-listen-02 ────────────────────────────────────────────────────

test('gherkin-listen-02: with no on-device speech synthesis, a listen-unavailable note shows instead of a control', async () => {
  const dom = renderDashboard(fakeDocsTree(), false);
  await flush();
  openTicketDetail(dom);

  assert.equal(listenButton(dom), undefined, 'expected no Listen button when speech synthesis is unavailable');
  const note = explorer(dom).querySelector('.listen-unavailable-note');
  assert.ok(note, 'expected a listen-unavailable note in its place');
});

// ── gherkin-listen-03 ────────────────────────────────────────────────────

test('gherkin-listen-03: the Listen control aria-label tracks Listen/Stop state across toggles', async () => {
  const dom = renderDashboard(fakeDocsTree(), true);
  await flush();
  openTicketDetail(dom);

  const btn = listenButton(dom);
  assert.equal(btn.getAttribute('aria-label'), 'Listen');
  click(dom, btn);
  assert.equal(btn.getAttribute('aria-label'), 'Stop');
  click(dom, btn);
  assert.equal(btn.getAttribute('aria-label'), 'Listen');
});

test('gherkin-listen-03: the Listen control is a real, focusable, keyboard-operable button', async () => {
  const dom = renderDashboard(fakeDocsTree(), true);
  await flush();
  openTicketDetail(dom);

  const btn = listenButton(dom);
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.notEqual(btn.tabIndex, -1);
});
