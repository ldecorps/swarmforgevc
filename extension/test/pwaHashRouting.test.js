const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-256 deep-links-into-pwa-04: on initial load, a #ticket=<id> or
// #approval=<id> URL fragment (as built by
// extension/src/metrics/pwaDeepLinks.ts's buildTicketDeepLink/
// buildApprovalDeepLink) opens directly to that PWA view - reusing the
// SAME rendering functions the docs explorer (BL-117) and approval detail
// (BL-266) already use for a manual tap, never a second, divergent
// rendering path.

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
    milestones: [{ milestone: 'M4', tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done', priority: 1 }] }],
    tickets: [
      {
        id: 'BL-100',
        title: 'cost telemetry',
        status: 'done',
        priority: 1,
        milestone: 'M4',
        description: 'Full prose description of BL-100.',
        scenarios: [{ name: 'a scenario', text: 'Scenario: a scenario\n  Given x\n  Then y' }],
      },
    ],
    ...overrides,
  };
}

function renderApp(url, backlogData, docsTreeData) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url, pretendToBeVisual: true });
  dom.window.fetch = (fetchUrl) => {
    if (fetchUrl === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(backlogData) });
    }
    if (fetchUrl === './docs-tree.json') {
      return Promise.resolve({ json: () => Promise.resolve(docsTreeData) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + fetchUrl));
  };
  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('a #ticket=<id> URL fragment opens directly to that ticket\'s docs view', async () => {
  const dom = renderApp('https://example.github.io/dashboard/#ticket=BL-100', fakeBacklog(), fakeDocsTree());
  await flush();

  const text = dom.window.document.getElementById('docsExplorer').textContent;
  assert.match(text, /Full prose description of BL-100\./);
});

test('a #ticket=<id> fragment naming an unknown ticket degrades to the existing not-found state, not a crash', async () => {
  const dom = renderApp('https://example.github.io/dashboard/#ticket=BL-999', fakeBacklog(), fakeDocsTree());
  await flush();

  assert.match(dom.window.document.getElementById('docsExplorer').textContent, /ticket not found/);
});

test('a #approval=<id> URL fragment opens directly to that ticket\'s approval detail view', async () => {
  const dom = renderApp(
    'https://example.github.io/dashboard/#approval=BL-100',
    fakeBacklog({ needsApproval: [{ id: 'BL-100', title: 'cost telemetry' }] }),
    fakeDocsTree()
  );
  await flush();

  const text = dom.window.document.getElementById('needsApproval').textContent;
  assert.match(text, /Full prose description of BL-100\./);
});

test('no hash at all renders the normal root views, unaffected', async () => {
  const dom = renderApp('https://example.github.io/dashboard/', fakeBacklog(), fakeDocsTree());
  await flush();

  assert.match(dom.window.document.getElementById('docsExplorer').textContent, /M4/);
  assert.doesNotMatch(dom.window.document.getElementById('docsExplorer').textContent, /Full prose description/);
});

test('an unrelated hash is ignored, not an error', async () => {
  const dom = renderApp('https://example.github.io/dashboard/#somethingElse', fakeBacklog(), fakeDocsTree());
  await flush();

  assert.match(dom.window.document.getElementById('docsExplorer').textContent, /M4/);
});
