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
    notDoneCount: 2,
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

  // BL-290 suite-duration-pwa-05: tracks every fetch URL so a test can
  // assert the two-surface rule holds (backlog.json only, never a live
  // host endpoint) - additive, does not change any existing test's
  // behavior (an "unexpected fetch" still rejects exactly as before).
  dom.fetchCalls = [];
  window.fetch = (url) => {
    dom.fetchCalls.push(url);
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

// BL-238 keyboard-nav-tiles-01/pwa-parity-05: an explicit, visible focus
// ring for every native interactive element - several controls zero out
// their border, which in some browsers can also suppress the default
// focus ring on custom-styled buttons.
test('BL-238: index.html defines a visible focus-visible outline for interactive elements', () => {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  assert.match(html, /button:focus-visible[\s\S]*?outline:/, 'expected an explicit :focus-visible outline rule');
});

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

// ── BL-257: backlog board filter/search (backlog-board-filter-search-01) ──

function filterFixture() {
  return fakeDashboard({
    board: {
      active: [
        { id: 'BL-100', title: 'cost telemetry', swarm: 'primary', status: 'active', priority: 5 },
        { id: 'BL-101', title: 'suite duration trend', swarm: 'primary', status: 'active', priority: 12 },
      ],
      paused: [{ id: 'BL-102', title: 'cost telemetry followup', swarm: 'primary', status: 'paused', priority: 5 }],
      doneByMilestone: { M4: [{ id: 'BL-096', title: 'metrics', swarm: 'primary', status: 'done', priority: 5 }] },
    },
  });
}

function boardFilterInput(dom) {
  return dom.window.document.getElementById('boardFilterQuery');
}

function boardFilterStatus(dom) {
  return dom.window.document.getElementById('boardFilterStatus');
}

function boardFilterPriority(dom) {
  return dom.window.document.getElementById('boardFilterPriority');
}

function typeInto(dom, input, value) {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input'));
}

test('typing a text query filters the board to only matching tickets (by id or title)', async () => {
  const dom = renderDashboard(filterFixture());
  await flush();

  typeInto(dom, boardFilterInput(dom), 'cost telemetry');

  const text = dom.window.document.getElementById('board').textContent;
  assert.match(text, /BL-100/);
  assert.match(text, /BL-102/);
  assert.doesNotMatch(text, /BL-101/);
  assert.doesNotMatch(text, /BL-096/);
});

test('selecting a status filters the board to only that status', async () => {
  const dom = renderDashboard(filterFixture());
  await flush();

  boardFilterStatus(dom).value = 'paused';
  boardFilterStatus(dom).dispatchEvent(new dom.window.Event('change'));

  const text = dom.window.document.getElementById('board').textContent;
  assert.match(text, /BL-102/);
  assert.doesNotMatch(text, /BL-100/);
  assert.doesNotMatch(text, /BL-101/);
  assert.doesNotMatch(text, /BL-096/);
});

test('a priority filter shows only tickets with that exact priority', async () => {
  const dom = renderDashboard(filterFixture());
  await flush();

  typeInto(dom, boardFilterPriority(dom), '5');

  const text = dom.window.document.getElementById('board').textContent;
  assert.match(text, /BL-100/);
  assert.match(text, /BL-102/);
  assert.match(text, /M4: 1/); // BL-096's milestone still counts it - done items are never listed by id
  assert.doesNotMatch(text, /BL-101/);
});

test('text, status, and priority filters combine (AND, not OR)', async () => {
  const dom = renderDashboard(filterFixture());
  await flush();

  typeInto(dom, boardFilterInput(dom), 'cost telemetry');
  boardFilterStatus(dom).value = 'paused';
  boardFilterStatus(dom).dispatchEvent(new dom.window.Event('change'));

  const text = dom.window.document.getElementById('board').textContent;
  assert.match(text, /BL-102/);
  assert.doesNotMatch(text, /BL-100/);
});

test('clearing the filters restores the full unfiltered board', async () => {
  const dom = renderDashboard(filterFixture());
  await flush();

  typeInto(dom, boardFilterInput(dom), 'cost telemetry');
  typeInto(dom, boardFilterInput(dom), '');

  const text = dom.window.document.getElementById('board').textContent;
  assert.match(text, /BL-100/);
  assert.match(text, /BL-101/);
  assert.match(text, /BL-102/);
  assert.match(text, /M4: 1/);
});

test('a filter matching nothing shows a localized no-results state, not a blank section', async () => {
  const dom = renderDashboard(filterFixture());
  await flush();

  typeInto(dom, boardFilterInput(dom), 'no such ticket anywhere');

  assert.match(dom.window.document.getElementById('board').textContent, /No tickets match your filter/);
});

test('the board filter query input is not re-created across re-renders (focus/cursor survive)', async () => {
  const dom = renderDashboard(filterFixture());
  await flush();
  const inputBefore = boardFilterInput(dom);

  typeInto(dom, inputBefore, 'BL-100');

  assert.equal(boardFilterInput(dom), inputBefore);
});

// ── BL-251: needs-approval list (pwa-lists-pending-01) ────────────────────

test('the needs-approval section lists exactly the tickets in backlog.json\'s needsApproval, with id and title', async () => {
  const dom = renderDashboard(fakeDashboard({ needsApproval: [{ id: 'BL-200', title: 'A ticket pending review' }] }));
  await flush();
  const text = dom.window.document.getElementById('needsApproval').textContent;
  assert.match(text, /BL-200/);
  assert.match(text, /A ticket pending review/);
});

// BL-266: an entry is now an openable navButton-style control (tap to read
// its description + acceptance scenarios) - a read/navigate action, not a
// write one, same distinction the docs explorer's own navButton already
// draws. Narrowed from "zero interactive elements" to "zero WRITE-capable
// elements and zero approve/reject-labeled buttons" - the property this
// test actually intends to guard - so BL-266's legitimate open-ticket
// button doesn't false-fail a check aimed at a different concern.
test('the needs-approval section has no approve/reject control - read-only', async () => {
  const dom = renderDashboard(fakeDashboard({ needsApproval: [{ id: 'BL-200', title: 'A ticket pending review' }] }));
  await flush();
  const container = dom.window.document.getElementById('needsApproval');
  const writeControls = container.querySelectorAll('input, textarea, [contenteditable="true"], form');
  assert.equal(writeControls.length, 0);
  const approveRejectButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
    /approve|reject|accept|deny/i.test(b.textContent)
  );
  assert.equal(approveRejectButtons.length, 0);
});

test('an empty needsApproval array shows an explicit no-data state, not a blank section (empty-state-04)', async () => {
  const dom = renderDashboard(fakeDashboard({ needsApproval: [] }));
  await flush();
  assert.match(dom.window.document.getElementById('needsApproval').textContent, /Nothing awaiting approval/);
});

test('trend arrows match each section\'s own direction (up/down/flat) - the fixture varies them precisely so a swapped or dropped arrow is caught', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  const document = dom.window.document;

  // velocity.trend.direction: 'up'
  assert.match(document.getElementById('velocity').textContent, /5 closed ▲/);
  // burndown[0].trend.direction: 'down'. BL-228: the ETA suffix now sits
  // between "remaining" and the trend arrow (this fixture's forecasts are
  // empty, so it's "no ETA yet").
  assert.match(document.getElementById('burndown').textContent, /2 remaining — no ETA yet ▼/);
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

// BL-263 surfaces-agree-02: renders backlog.json's own notDoneCount
// verbatim - never a client-side recomputation from board.active/paused.
test('shows the not-done total from backlog.json\'s notDoneCount field', async () => {
  const dom = renderDashboard(fakeDashboard({ notDoneCount: 7 }));
  await flush();
  assert.match(dom.window.document.getElementById('notDoneCount').textContent, /7/);
});

// BL-263 zero-state-03
test('shows a not-done total of zero rather than a blank when every ticket is done', async () => {
  const dom = renderDashboard(fakeDashboard({ notDoneCount: 0 }));
  await flush();
  const text = dom.window.document.getElementById('notDoneCount').textContent;
  assert.match(text, /0/);
  assert.notEqual(text.trim(), '');
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

// --- BL-287: burndown restyled as a classic sprint line chart ------------

function burndownFixture() {
  const data = fakeDashboard();
  data.metrics.burndown = [
    {
      milestone: 'M4',
      currentRemaining: 1,
      trend: { direction: 'down', delta: -1, currentValue: 1, priorValue: 2, series: [] },
      dailySeries: [
        { periodStart: '2026-07-01T00:00:00Z', value: 5 },
        { periodStart: '2026-07-02T00:00:00Z', value: 4 },
        { periodStart: '2026-07-03T00:00:00Z', value: 2 },
        { periodStart: '2026-07-04T00:00:00Z', value: 1 },
      ],
    },
  ];
  return data;
}

// BL-287 burndown-line-01
test('burndown-line-01: the remaining counts are drawn as one connected line, not bars', async () => {
  const dom = renderDashboard(burndownFixture());
  await flush();
  const document = dom.window.document;
  const polyline = document.querySelector('#burndown svg polyline.remaining-line');
  assert.ok(polyline, 'expected a connected polyline for the remaining counts');
  const points = polyline.getAttribute('points').trim().split(/\s+/);
  assert.equal(points.length, 4, 'expected one point per daily-series entry');
  assert.equal(document.querySelectorAll('#burndown svg rect').length, 0, 'expected no bar-chart rects');
});

// BL-287 burndown-line-02
test('burndown-line-02: date runs along the horizontal axis, remaining count up the vertical axis', async () => {
  const dom = renderDashboard(burndownFixture());
  await flush();
  const labels = Array.from(dom.window.document.querySelectorAll('#burndown svg text.chart-axis-label')).map((n) => n.textContent);
  assert.ok(labels.includes('2026-07-01'), `expected the first date on the horizontal axis, got: ${labels}`);
  assert.ok(labels.includes('2026-07-04'), `expected the last date on the horizontal axis, got: ${labels}`);
  assert.ok(labels.includes('5'), `expected the max remaining count on the vertical axis, got: ${labels}`);
  assert.ok(labels.includes('0'), `expected zero on the vertical axis, got: ${labels}`);
});

// BL-287 burndown-line-03
test('burndown-line-03: a dotted ideal line runs straight from the starting count to zero across the same dates', async () => {
  const dom = renderDashboard(burndownFixture());
  await flush();
  const idealLine = dom.window.document.querySelector('#burndown svg line.ideal-line');
  assert.ok(idealLine, 'expected a dedicated ideal-line element');
  assert.ok(idealLine.getAttribute('stroke-dasharray'), 'expected the ideal line to be dashed');
  // Same X positions as the remaining line's own first/last points (the
  // observed date span) - Y runs from the FIRST value down to 0.
  const polyline = dom.window.document.querySelector('#burndown svg polyline.remaining-line');
  const firstPoint = polyline.getAttribute('points').trim().split(/\s+/)[0].split(',');
  assert.equal(idealLine.getAttribute('x1'), firstPoint[0], 'expected the ideal line to start at the same date as the first remaining point');
  assert.equal(idealLine.getAttribute('y1'), firstPoint[1], 'expected the ideal line to start at the starting remaining count');
  const lastPoint = polyline.getAttribute('points').trim().split(/\s+/)[3].split(',');
  assert.equal(idealLine.getAttribute('x2'), lastPoint[0], 'expected the ideal line to end at the same date as the last remaining point');
  assert.notEqual(idealLine.getAttribute('y2'), lastPoint[1], 'expected the ideal line to end at zero, not the actual last remaining count');
});

// BL-287 burndown-line-04
test('burndown-line-04: a legend labels the solid remaining line and the dotted ideal line distinctly', async () => {
  const dom = renderDashboard(burndownFixture());
  await flush();
  const remainingEntry = dom.window.document.querySelector('#burndown .chart-legend .legend-remaining');
  const idealEntry = dom.window.document.querySelector('#burndown .chart-legend .legend-ideal');
  assert.ok(remainingEntry, 'expected a legend entry for the remaining line');
  assert.ok(idealEntry, 'expected a legend entry for the ideal line');
  assert.equal(remainingEntry.textContent, 'Remaining');
  assert.equal(idealEntry.textContent, 'Ideal');
});

// BL-287 burndown-line-05
test('burndown-line-05: with no milestone data the burndown shows its empty message and draws no chart', async () => {
  const data = fakeDashboard();
  data.metrics.burndown = [];
  const dom = renderDashboard(data);
  await flush();
  const document = dom.window.document;
  assert.match(document.getElementById('burndown').textContent, /No milestones yet/);
  assert.equal(document.querySelectorAll('#burndown svg').length, 0, 'expected no chart to be drawn');
});

test('BL-287: the burndown legend labels are localized (fr)', async () => {
  const dom = renderDashboard(burndownFixture());
  await flush();
  dom.window.document.getElementById('localeToggle').click();
  const remainingEntry = dom.window.document.querySelector('#burndown .chart-legend .legend-remaining');
  const idealEntry = dom.window.document.querySelector('#burndown .chart-legend .legend-ideal');
  assert.equal(remainingEntry.textContent, 'Restants');
  assert.equal(idealEntry.textContent, 'Idéal');
});

// --- BL-228: burndown shows each milestone's forecast ETA + an overall ETA ---
// Reuses the SAME forecasts data already present in backlog.json (no new
// computation) - deliveryMetrics.computeForecasts is unchanged.

test('milestone-eta-01: a burndown milestone with a forecast p50 shows its ETA alongside its remaining count', async () => {
  const data = fakeDashboard();
  data.metrics.forecasts = {
    tickets: [{ ticketId: 'BL-1', p50Iso: '2026-08-01T00:00:00Z', p85Iso: '2026-08-10T00:00:00Z' }],
    milestones: [{ milestone: 'M4', p50Iso: '2026-08-01T00:00:00Z', p85Iso: '2026-08-10T00:00:00Z' }],
    throughputPerDay: 0.5,
  };
  const dom = renderDashboard(data);
  await flush();
  assert.match(dom.window.document.getElementById('burndown').textContent, /M4: 2 remaining — ETA 2026-08-01 \(p85 2026-08-10\)/);
});

test('backlog-eta-02: an overall "all remaining work" ETA (the latest p50 across every open ticket) is shown', async () => {
  const data = fakeDashboard();
  data.metrics.forecasts = {
    tickets: [
      { ticketId: 'BL-1', p50Iso: '2026-08-01T00:00:00Z', p85Iso: null },
      { ticketId: 'BL-2', p50Iso: '2026-09-15T00:00:00Z', p85Iso: null },
    ],
    milestones: [{ milestone: 'M4', p50Iso: '2026-08-01T00:00:00Z', p85Iso: null }],
    throughputPerDay: 0.5,
  };
  const dom = renderDashboard(data);
  await flush();
  assert.match(dom.window.document.getElementById('burndown').textContent, /^Overall ETA: 2026-09-15/);
});

test('no-eta-03: a milestone whose forecast p50 is null shows "no ETA yet", never a fabricated date', async () => {
  const data = fakeDashboard();
  data.metrics.forecasts = {
    tickets: [],
    milestones: [{ milestone: 'M4', p50Iso: null, p85Iso: null }],
    throughputPerDay: 0,
  };
  const dom = renderDashboard(data);
  await flush();
  const text = dom.window.document.getElementById('burndown').textContent;
  assert.match(text, /^no ETA yet/);
  assert.match(text, /M4: 2 remaining — no ETA yet/);
  assert.doesNotMatch(text, /Invalid Date|NaN/);
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

function fakeCostHealth(overrides = {}) {
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
    ...overrides,
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

// ── BL-338: average cost/ticket diagram + trend on the PWA ──────────────

function fakeCostPerTicket(overrides = {}) {
  return {
    average: { value: 4.5, trend: { direction: 'down' } },
    sampleCount: 6,
    excludedCount: 1,
    series: [
      { periodStart: '2026-06-28T00:00:00.000Z', value: 6 },
      { periodStart: '2026-07-05T00:00:00.000Z', value: 4.5 },
    ],
    basis: 'Includes rework from bounces; excludes unpriced and unattributed usage.',
    ...overrides,
  };
}

test('BL-338: the average cost/ticket figure, trend, diagram, and accounting basis render on the PWA', async () => {
  const dom = renderDashboard(fakeDashboard({ costHealth: fakeCostHealth({ costPerTicket: fakeCostPerTicket() }) }));
  await flush();
  const container = dom.window.document.getElementById('costHealth');
  assert.match(container.textContent, /\$4\.50/);
  assert.match(container.textContent, /6/);
  assert.match(container.textContent, /Includes rework from bounces/);
  // the diagram itself: a real SVG chart, not just text - reuses barChart,
  // the SAME dependency-free chart already proven for velocity (dashboard-03).
  const svgs = container.querySelectorAll('svg');
  assert.ok(svgs.length > 0, 'expected an SVG chart to render for the cost/ticket trend');
});

test('BL-338: the average cost/ticket section is hidden when no delivered ticket has a priced cost yet (average null)', async () => {
  const dom = renderDashboard(fakeDashboard({ costHealth: fakeCostHealth({ costPerTicket: fakeCostPerTicket({ average: null, series: [] }) }) }));
  await flush();
  const container = dom.window.document.getElementById('costHealth');
  assert.doesNotMatch(container.textContent, /Includes rework from bounces/);
});

test('BL-338: the average cost/ticket section is absent entirely when backlog.json predates this ticket (no costPerTicket field)', async () => {
  const dom = renderDashboard(fakeDashboard({ costHealth: fakeCostHealth() }));
  await flush();
  const container = dom.window.document.getElementById('costHealth');
  assert.doesNotMatch(container.textContent, /Includes rework from bounces/);
});

// ── BL-290: suite-test duration on the static PWA ────────────────────────

function fakeSuiteDurationTrend(overrides = {}) {
  return {
    hasLocalData: true,
    dailySeries: [
      { periodStart: '2026-07-08T00:00:00Z', value: 30000 },
      { periodStart: '2026-07-09T00:00:00Z', value: 45000 },
    ],
    trend: { direction: 'up', delta: 15000, currentValue: 45000, priorValue: 30000, series: [] },
    warn: false,
    ...overrides,
  };
}

// fakeDashboard's own overrides param replaces top-level keys wholesale
// (a shallow spread), so a suiteDurationTrend fixture must be merged into
// a FULL metrics object, not passed as a made-up nested override key.
function fakeDashboardWithSuiteDuration(suiteDurationTrend) {
  const data = fakeDashboard();
  data.metrics.suiteDurationTrend = suiteDurationTrend;
  return data;
}

// BL-290 suite-duration-pwa-03
test('suite-duration-pwa-03: the static PWA shows the latest suite duration and its trend', async () => {
  const dom = renderDashboard(fakeDashboardWithSuiteDuration(fakeSuiteDurationTrend()));
  await flush();
  const section = dom.window.document.getElementById('suiteDurationSection');
  assert.notEqual(section.style.display, 'none');
  const text = dom.window.document.getElementById('suiteDuration').textContent;
  assert.match(text, /Suite duration: 45s latest ▲/);
});

// BL-290 suite-duration-pwa-04
test('suite-duration-pwa-04: a regressing suite duration is marked WARN on the PWA', async () => {
  const dom = renderDashboard(fakeDashboardWithSuiteDuration(fakeSuiteDurationTrend({ warn: true })));
  await flush();
  const text = dom.window.document.getElementById('suiteDuration').textContent;
  assert.match(text, /Suite duration \(WARN\): 45s latest/);
  const p = dom.window.document.querySelector('#suiteDuration p');
  assert.equal(p.className, 'metric-value-warn');
});

// BL-290 suite-duration-pwa-05
test('suite-duration-pwa-05: with local data absent (hasLocalData false) the PWA shows a no-data readout, still visible', async () => {
  const dom = renderDashboard(fakeDashboardWithSuiteDuration(fakeSuiteDurationTrend({ hasLocalData: false })));
  await flush();
  const section = dom.window.document.getElementById('suiteDurationSection');
  assert.notEqual(section.style.display, 'none');
  const text = dom.window.document.getElementById('suiteDuration').textContent;
  assert.match(text, /no local data/);
});

test('suite-duration-pwa-05: with the field entirely absent from backlog.json, the section is hidden and no live fetch is ever made', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  const section = dom.window.document.getElementById('suiteDurationSection');
  assert.equal(section.style.display, 'none');
  // The two-surface rule: the PWA only ever fetches its own three static,
  // committed JSON files (backlog.json/docs-tree.json/recert-batch.json,
  // pre-existing, unrelated to this ticket) - suite duration introduces NO
  // new fetch of its own (a live host endpoint) to reach the readout.
  const STATIC_COMMITTED_URLS = ['./backlog.json', './docs-tree.json', './recert-batch.json'];
  for (const url of dom.fetchCalls) {
    assert.ok(STATIC_COMMITTED_URLS.includes(url), `expected only static committed fetches, got a live fetch to: ${url}`);
  }
});

test('BL-290: the suite-duration labels are localized (fr)', async () => {
  const dom = renderDashboard(fakeDashboardWithSuiteDuration(fakeSuiteDurationTrend()));
  await flush();
  dom.window.document.getElementById('localeToggle').click();
  const text = dom.window.document.getElementById('suiteDuration').textContent;
  assert.match(text, /Durée de la suite : 45s \(dernière mesure\)/);
});

// ── BL-347 role-leaderboard-surface: the Role Leaderboard section ───────

function fakeBenchmarkReport(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-13T16:26:31.300Z',
    taskId: 'coder-task-01-word-frequency',
    qualityThreshold: 0.8,
    qualityThresholdDescription: 'A model is "cheapest acceptable" only if its mean quality score is >= 0.8.',
    provenance: 'Each recorded run executes the configured provider CLI headlessly.',
    models: [
      {
        modelId: 'claude-haiku',
        provider: 'claude',
        model: 'haiku',
        label: 'Claude Haiku 4.5',
        excluded: false,
        exclusionReason: null,
        repetitions: 2,
        meanQuality: 1,
        qualityStdDev: 0,
        meanCostUsd: 0.0431,
        costStdDev: 0.0009,
        meanDurationMs: 23420,
        meanTokens: 1762.5,
        runs: [],
      },
      {
        modelId: 'claude-sonnet',
        provider: 'claude',
        model: 'sonnet',
        label: 'Claude Sonnet 5',
        excluded: false,
        exclusionReason: null,
        repetitions: 2,
        meanQuality: 0.9,
        qualityStdDev: 0.05,
        meanCostUsd: 0.1383,
        costStdDev: 0.0003,
        meanDurationMs: 17815,
        meanTokens: 974,
        runs: [],
      },
    ],
    ranking: { bestByQuality: 'claude-haiku', bestByValue: 'claude-haiku', cheapestAcceptable: 'claude-sonnet', noAcceptableModelReason: null },
    ...overrides,
  };
}

test('role-leaderboard-surface-01: the leaderboard shows the best, best value, and cheapest acceptable model per role', async () => {
  const dom = renderDashboard(fakeDashboard({ roleLeaderboard: fakeBenchmarkReport() }));
  await flush();
  const section = dom.window.document.getElementById('roleLeaderboardSection');
  assert.notEqual(section.style.display, 'none');
  const text = dom.window.document.getElementById('roleLeaderboard').textContent;
  assert.match(text, /Role: coder/);
  assert.match(text, /Best/);
  assert.match(text, /Best value/);
  assert.match(text, /Cheapest acceptable/);
  assert.match(text, /Claude Haiku 4\.5/);
  assert.match(text, /Claude Sonnet 5/);
});

test('role-leaderboard-surface-02: the quality threshold for cheapest acceptable is stated, not implied', async () => {
  const dom = renderDashboard(fakeDashboard({ roleLeaderboard: fakeBenchmarkReport() }));
  await flush();
  const text = dom.window.document.getElementById('roleLeaderboard').textContent;
  assert.match(text, /Quality threshold: A model is "cheapest acceptable" only if its mean quality score is >= 0\.8\./);
});

test('role-leaderboard-surface-03: the reader can tell how old the numbers are', async () => {
  const dom = renderDashboard(fakeDashboard({ roleLeaderboard: fakeBenchmarkReport() }));
  await flush();
  const text = dom.window.document.getElementById('roleLeaderboard').textContent;
  const expectedDate = new Date('2026-07-13T16:26:31.300Z').toLocaleDateString();
  assert.match(text, new RegExp('Benchmark run: ' + expectedDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('role-leaderboard-surface-04: a difference between models can be told from noise (variance shown alongside the ranking)', async () => {
  const dom = renderDashboard(fakeDashboard({ roleLeaderboard: fakeBenchmarkReport() }));
  await flush();
  const text = dom.window.document.getElementById('roleLeaderboard').textContent;
  // claude-sonnet (cheapest acceptable here) carries qualityStdDev: 0.05
  assert.match(text, /90% \(±5%\)/);
});

test('role-leaderboard-surface-05: the leaderboard is hidden entirely when no benchmark has been committed, not rendered empty', async () => {
  const dom = renderDashboard(fakeDashboard());
  await flush();
  const section = dom.window.document.getElementById('roleLeaderboardSection');
  assert.equal(section.style.display, 'none');
});

test('a cheapest-acceptable model that does not exist shows the stated reason, never a blank row', async () => {
  const dom = renderDashboard(
    fakeDashboard({
      roleLeaderboard: fakeBenchmarkReport({
        ranking: { bestByQuality: 'claude-haiku', bestByValue: 'claude-haiku', cheapestAcceptable: null, noAcceptableModelReason: 'no model cleared the quality threshold' },
      }),
    })
  );
  await flush();
  const text = dom.window.document.getElementById('roleLeaderboard').textContent;
  assert.match(text, /Cheapest acceptable: no model cleared the quality threshold/);
});

test('role-leaderboard-surface-07: the section is collapsible like every other section', async () => {
  const dom = renderDashboard(fakeDashboard({ roleLeaderboard: fakeBenchmarkReport() }));
  await flush();
  const header = dom.window.document.querySelector('h2[data-i18n="roleLeaderboardHeading"]');
  const body = header.closest('section').querySelector('.section-body');
  assert.notEqual(body.style.display, 'none');
  header.dispatchEvent(new dom.window.Event('click'));
  assert.equal(body.style.display, 'none');
});

test('BL-347: the role leaderboard labels are localized (fr)', async () => {
  const dom = renderDashboard(fakeDashboard({ roleLeaderboard: fakeBenchmarkReport() }));
  await flush();
  dom.window.document.getElementById('localeToggle').click();
  const text = dom.window.document.getElementById('roleLeaderboard').textContent;
  assert.match(text, /Rôle : coder/);
  assert.match(text, /Meilleur rapport qualité-prix/);
});
