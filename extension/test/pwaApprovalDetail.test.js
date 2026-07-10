const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-266: renders the REAL pwa/index.html + pwa/app.js + pwa/locales.js in
// jsdom (mirroring pwaDocsExplorer.test.js's own pattern), feeding BOTH
// backlog.json (the needsApproval id+title feed, BL-251) and docs-tree.json
// (the SAME description + resolved acceptance scenarios the docs explorer
// already reads, BL-117) - the detail view is a pure cross-reference from
// one into the other, never a second store.

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

function fakeBacklog(overrides = {}) {
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
    needsApproval: [],
    ...overrides,
  };
}

function fakeDocsTree(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [],
    milestones: [],
    tickets: [],
    ...overrides,
  };
}

function pendingTicket(overrides = {}) {
  return {
    id: 'BL-200',
    title: 'A ticket pending review',
    status: 'paused',
    priority: 12,
    milestone: 'M7',
    description: 'Full prose description of BL-200.',
    scenarios: [
      { name: 'first scenario', text: 'Scenario: first scenario\n  Given a thing\n  Then it works' },
      { name: 'second scenario', text: 'Scenario: second scenario\n  Given another thing\n  Then it also works' },
    ],
    ...overrides,
  };
}

function renderApp(backlogData, docsTreeData, speech) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  const { window } = dom;

  window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(backlogData) });
    }
    if (url === './docs-tree.json') {
      return Promise.resolve({ json: () => Promise.resolve(docsTreeData) });
    }
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

  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);

  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function click(dom, element) {
  element.dispatchEvent(new dom.window.Event('click'));
}

function needsApproval(dom) {
  return dom.window.document.getElementById('needsApproval');
}

function openTicket(dom, id) {
  const btn = Array.from(needsApproval(dom).querySelectorAll('button')).find((b) => b.textContent.indexOf(id) !== -1);
  click(dom, btn);
}

// ── approval-detail-shows-description-and-scenarios-01 ─────────────────

test('opening a pending ticket from the needs-approval list reveals its description and acceptance scenarios', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] })
  );
  await flush();

  openTicket(dom, 'BL-200');
  const text = needsApproval(dom).textContent;
  assert.match(text, /Full prose description of BL-200\./);
  assert.match(text, /first scenario/);
  assert.match(text, /second scenario/);
  assert.match(text, /Given a thing/);
  assert.match(text, /Given another thing/);
});

// ── approval-detail-single-source-02 ────────────────────────────────────

test('the shown description and scenarios are exactly the committed docs-tree entry, not a divergent copy', async () => {
  const ticket = pendingTicket({ description: 'THE EXACT committed description.' });
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] })
  );
  await flush();

  openTicket(dom, 'BL-200');
  const text = needsApproval(dom).textContent;
  assert.match(text, /THE EXACT committed description\./);
  ticket.scenarios.forEach((s) => {
    assert.ok(text.indexOf(s.text) !== -1, `expected the exact committed scenario text for "${s.name}"`);
  });
});

// ── approval-detail-read-only-03 ────────────────────────────────────────

test('the detail view offers no approve, reject, or other write action', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] })
  );
  await flush();

  openTicket(dom, 'BL-200');
  const container = needsApproval(dom);
  const writeControls = container.querySelectorAll('input, textarea, [contenteditable="true"], form');
  assert.equal(writeControls.length, 0);
  const approveRejectButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
    /approve|reject|accept|deny/i.test(b.textContent)
  );
  assert.equal(approveRejectButtons.length, 0);
});

// ── approval-detail-unavailable-state-04 ────────────────────────────────

test('a pending ticket whose acceptance scenarios cannot be resolved shows a localized empty state, not an error or blank', async () => {
  const ticket = pendingTicket({ scenarios: [] });
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] })
  );
  await flush();

  openTicket(dom, 'BL-200');
  assert.match(needsApproval(dom).textContent, /no scenarios resolved for this ticket/);
});

test('a needs-approval ticket absent from docs-tree shows a localized unavailable state, not an error', async () => {
  const dom = renderApp(fakeBacklog({ needsApproval: [{ id: 'BL-999', title: 'Missing from docs-tree' }] }), fakeDocsTree({ tickets: [] }));
  await flush();

  openTicket(dom, 'BL-999');
  assert.match(needsApproval(dom).textContent, /ticket not found/);
});

// ── approval-detail-localized-05 ────────────────────────────────────────

test('the detail view labels render in the active locale', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] })
  );
  await flush();
  click(dom, dom.window.document.getElementById('localeToggle'));

  openTicket(dom, 'BL-200');
  assert.match(needsApproval(dom).textContent, /Scénarios d'acceptation/);
});

// ── back navigation (not a named scenario, but required for the list to remain reachable) ──

test('a back control returns from the detail view to the needs-approval list', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] })
  );
  await flush();

  openTicket(dom, 'BL-200');
  assert.match(needsApproval(dom).textContent, /Full prose description/);

  const backBtn = Array.from(needsApproval(dom).querySelectorAll('button')).find((b) => /back/i.test(b.textContent));
  click(dom, backBtn);
  const text = needsApproval(dom).textContent;
  assert.doesNotMatch(text, /Full prose description/);
  assert.match(text, /BL-200/);
});

// ── slice 2: listen ──────────────────────────────────────────────────────
// listen-speaks-description-and-scenarios-06 / listen-uses-active-locale-07

test('activating listen speaks the description followed by each acceptance scenario in order', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] }),
    true
  );
  await flush();

  openTicket(dom, 'BL-200');
  const listenBtn = Array.from(needsApproval(dom).querySelectorAll('button')).find((b) => /listen/i.test(b.textContent));
  click(dom, listenBtn);

  assert.equal(dom.window.__speechCalls.spoken.length, 1);
  const spoken = dom.window.__speechCalls.spoken[0].text;
  const descIndex = spoken.indexOf('Full prose description of BL-200.');
  const s1Index = spoken.indexOf(ticket.scenarios[0].text);
  const s2Index = spoken.indexOf(ticket.scenarios[1].text);
  assert.ok(descIndex !== -1 && s1Index !== -1 && s2Index !== -1, `expected all parts present in: ${spoken}`);
  assert.ok(descIndex < s1Index && s1Index < s2Index, 'expected description before scenario 1 before scenario 2');
});

test('the spoken audio uses the active locale language, not the default', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] }),
    true
  );
  await flush();
  click(dom, dom.window.document.getElementById('localeToggle'));

  openTicket(dom, 'BL-200');
  const listenBtn = Array.from(needsApproval(dom).querySelectorAll('button')).find((b) => /écouter/i.test(b.textContent));
  click(dom, listenBtn);

  assert.equal(dom.window.__speechCalls.spoken[0].lang, 'fr-FR');
});

test('the spoken audio uses the default locale language when no toggle happened', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] }),
    true
  );
  await flush();

  openTicket(dom, 'BL-200');
  const listenBtn = Array.from(needsApproval(dom).querySelectorAll('button')).find((b) => /listen/i.test(b.textContent));
  click(dom, listenBtn);

  assert.equal(dom.window.__speechCalls.spoken[0].lang, 'en-US');
});

// ── listen-can-be-stopped-08 ─────────────────────────────────────────────

test('stopping listen halts playback via the speech adapter\'s cancel', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] }),
    true
  );
  await flush();

  openTicket(dom, 'BL-200');
  const listenBtn = Array.from(needsApproval(dom).querySelectorAll('button')).find((b) => /listen/i.test(b.textContent));
  click(dom, listenBtn); // start
  const cancelledBeforeStop = dom.window.__speechCalls.cancelled;
  click(dom, listenBtn); // now labelled stop - toggling stops it
  assert.ok(dom.window.__speechCalls.cancelled > cancelledBeforeStop, 'expected cancel() to be called on stop');
});

// ── listen-unavailable-degrades-gracefully-09 ────────────────────────────

test('with no on-device speech synthesis the listen control is unavailable with a localized note, not an error', async () => {
  const ticket = pendingTicket();
  const dom = renderApp(
    fakeBacklog({ needsApproval: [{ id: ticket.id, title: ticket.title }] }),
    fakeDocsTree({ tickets: [ticket] }),
    false
  );
  await flush();

  openTicket(dom, 'BL-200');
  const container = needsApproval(dom);
  const listenBtn = Array.from(container.querySelectorAll('button')).find((b) => /listen/i.test(b.textContent));
  assert.equal(listenBtn, undefined, 'expected no listen button when speech synthesis is unavailable');
  assert.match(container.textContent, /not available/i);
});
