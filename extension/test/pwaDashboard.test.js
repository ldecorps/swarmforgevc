const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-097 dashboard-03: renders the REAL pwa/index.html + pwa/app.js in
// jsdom (mirroring test/helpers/renderPanel.js's own established pattern
// for asserting on browser-visible markup, not a hand-copied restatement
// of the rendering logic), fed a fake backlog.json response.

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

function fakeDashboard(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    board: {
      active: [{ id: 'BL-100', title: 'cost telemetry', swarm: 'primary', p50Iso: '2026-08-01T00:00:00Z' }],
      paused: [{ id: 'BL-101', title: 'paused thing', swarm: 'secondary-1' }],
      doneByMilestone: { M4: [{ id: 'BL-096', title: 'metrics', swarm: 'primary', status: 'done' }] },
    },
    metrics: {
      velocity: {
        weeklySeries: [{ periodStart: '2026-07-01T00:00:00Z', value: 3 }],
        trend: { direction: 'up', delta: 1, currentValue: 3, priorValue: 2, series: [] },
        rollingWindowCount: 5,
        rollingWindowDays: 7,
      },
      burndown: [
        {
          milestone: 'M4',
          currentRemaining: 2,
          trend: { direction: 'down', delta: -1, currentValue: 2, priorValue: 3, series: [] },
          dailySeries: [{ periodStart: '2026-07-01T00:00:00Z', value: 3 }],
        },
      ],
      cycleTime: {
        medianMs: 2 * 60 * 60 * 1000,
        p85Ms: 4 * 60 * 60 * 1000,
        sampleCount: 6,
        trend: { direction: 'flat', delta: 0, currentValue: 2, priorValue: 2, series: [] },
        weeklySeries: [],
      },
      forecasts: { tickets: [], milestones: [], throughputPerDay: 0.5 },
    },
    ...overrides,
  };
}

function renderDashboard(dashboardData) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  const { window } = dom;

  window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(dashboardData) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);

  return dom;
}

// jsdom's microtask queue needs a real tick to drain the fetch().then()
// chain app.js kicks off - a single resolved-promise await is enough since
// nothing else in the chain is timer-based.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('renders the state board, velocity, burndown, and cycle-time sections from one fetch (dashboard-03)', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  const document = dom.window.document;

  assert.match(document.getElementById('board').textContent, /BL-100/);
  assert.match(document.getElementById('board').textContent, /BL-101/);
  assert.match(document.getElementById('board').textContent, /M4: 1/);
  assert.match(document.getElementById('velocity').textContent, /5 closed/);
  assert.match(document.getElementById('burndown').textContent, /2 remaining/);
  assert.match(document.getElementById('cycleTime').textContent, /Median 2h, p85 4h over 6 ticket/);
  // BL-229: the ETA label is now a tr('etaPrefix') catalog lookup - English
  // mode must still render byte-for-byte the same text as before the change.
  assert.match(document.getElementById('board').textContent, /BL-100 — cost telemetry — ETA 2026-08-01/);
});

test('trend arrows match each section\'s own direction (up/down/flat) - the fixture varies them precisely so a swapped or dropped arrow is caught', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  const document = dom.window.document;

  // velocity.trend.direction: 'up'
  assert.match(document.getElementById('velocity').textContent, /5 closed ▲/);
  // burndown[0].trend.direction: 'down'
  assert.match(document.getElementById('burndown').textContent, /2 remaining ▼/);
  // cycleTime.trend.direction: 'flat'
  assert.match(document.getElementById('cycleTime').textContent, /ticket\(s\) ▬/);
});

test('shows a remote (non-primary) swarm assignment as a visible badge', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  assert.match(dom.window.document.getElementById('board').textContent, /BL-101.*\[secondary-1\]/);
});

test('shows the "as of" generation time and source SHA (dashboard-04\'s honesty requirement)', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  const asOf = dom.window.document.getElementById('asOf').textContent;
  assert.match(asOf, /As of/);
  assert.match(asOf, /abc123def4/);
});

test('renders a "no closed tickets yet" placeholder rather than crashing on an empty cycle-time result', async () => {
  const data = fakeDashboard();
  data.metrics.cycleTime = { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] };
  const dom = renderDashboard(data);
  await flush();
  assert.match(dom.window.document.getElementById('cycleTime').textContent, /No closed tickets yet/);
});

test('renders a "no milestones yet" placeholder for an empty burndown array', async () => {
  const data = fakeDashboard();
  data.metrics.burndown = [];
  const dom = renderDashboard(data);
  await flush();
  assert.match(dom.window.document.getElementById('burndown').textContent, /No milestones yet/);
});

test('does not attempt service worker registration in an environment without the API (dashboard-07), and renders anyway', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  assert.equal('serviceWorker' in dom.window.navigator, false);
  assert.match(dom.window.document.getElementById('board').textContent, /BL-100/, 'rendering must not depend on service worker support');
});

test('shows an honest failure message rather than a blank page when the fetch fails entirely', async () => {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/' });
  dom.window.fetch = () => Promise.reject(new Error('offline, nothing cached'));
  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);
  await flush();
  assert.match(dom.window.document.getElementById('asOf').textContent, /Could not load/);
});

// ── BL-213 cost-06b: cost & health card visibility ──────────────────────

function fakeCostHealth() {
  return {
    schemaVersion: 1,
    dateIso: '2026-07-09',
    agents: [{ role: 'coder', tokens: { value: 500, trend: { direction: 'up' } }, costUsd: { value: 3.5, trend: { direction: 'up' } } }],
    topExpensiveTickets: [{ ticketId: 'BL-100', costUsd: 12.5 }],
    flowBalance: { speccedPerDay: { value: 3, trend: { direction: 'flat' } }, closedPerDay: { value: 2, trend: { direction: 'down' } } },
    reliability: {
      chases: { value: 1, trend: { direction: 'up' } },
      nudges: { value: 0, trend: { direction: 'flat' } },
      respawns: { value: 0, trend: { direction: 'flat' } },
      failedDeliveries: { value: 0, trend: { direction: 'flat' } },
      daemonRestarts: { value: 0, trend: { direction: 'unknown' } },
    },
    resourceAnomalies: [{ role: 'coder', rssBytes: 250_000_000, cpuPercent: 12.3, rssTrend: { direction: 'up' }, cpuTrend: { direction: 'flat' } }],
  };
}

test('the cost & health card is shown and populated when backlog.json carries a costHealth field (cost-06b, present)', async () => {
  const dom = renderDashboard(fakeDashboard({ costHealth: fakeCostHealth() }));
  await flush();
  const section = dom.window.document.getElementById('costHealthSection');
  assert.notEqual(section.style.display, 'none');
  const text = dom.window.document.getElementById('costHealth').textContent;
  assert.match(text, /coder: 500 tokens/);
  assert.match(text, /\$3\.50/);
  assert.match(text, /BL-100: \$12\.50/);
  assert.match(text, /specced 3\/day/);
  assert.match(text, /1 chases/);
});

test('the cost & health card\'s trend arrows match each field\'s own direction, not just its number', async () => {
  const dom = renderDashboard(fakeDashboard({ costHealth: fakeCostHealth() }));
  await flush();
  const text = dom.window.document.getElementById('costHealth').textContent;
  // agents[0].tokens.trend.direction: 'up'
  assert.match(text, /500 tokens ▲/);
  // flowBalance.closedPerDay.trend.direction: 'down'
  assert.match(text, /closed 2\/day ▼/);
  // reliability.nudges.trend.direction: 'flat'
  assert.match(text, /0 nudges ▬/);
});

test('the cost & health card is hidden entirely when backlog.json carries no costHealth field (cost-06b, absent)', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  const section = dom.window.document.getElementById('costHealthSection');
  assert.equal(section.style.display, 'none');
});
