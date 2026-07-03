const assert = require('node:assert/strict');
const test = require('node:test');
const { renderPanel } = require('./helpers/renderPanel');

// BL-071: drives the REAL webview shell + REAL media/panel.js in jsdom, not
// a hand-copied restatement of the rendering logic (BL-068 lesson).

test('the METRICS pane appears beside RECENT RUNS and BACKLOG and shows mean time, busyness, and retries', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'backlogUpdate', items: [{ id: 'BL-001', title: 't', status: 'todo' }] });
  dispatch({
    type: 'metricsUpdate',
    metrics: {
      meanTicketTimeMs: 4 * 60 * 60 * 1000 + 12 * 60 * 1000,
      ticketSampleCount: 23,
      busyness: { coder: 0.45, cleaner: 0.02 },
      retryTotal: 3,
      retryByTicket: { 'BL-101': 2 },
      suiteDuration: { latestMs: 33000, meanMs: 33000, sampleCount: 5, warn: false },
    },
    roles: ['coder', 'cleaner'],
  });

  const metrics = document.getElementById('metrics');
  const backlog = document.getElementById('backlog');
  assert.notEqual(metrics.style.display, 'none', 'METRICS pane should be visible');
  assert.notEqual(backlog.style.display, 'none', 'BACKLOG pane should still be visible beside METRICS');

  const text = document.getElementById('metrics-list').textContent;
  assert.match(text, /4h 12m/);
  assert.match(text, /23/);
  assert.match(text, /coder/);
  assert.match(text, /45%/);
  assert.match(text, /cleaner/);
  assert.match(text, /2%/);
  assert.match(text, /3/);
});

test('folding METRICS collapses only its own body, leaving RECENT RUNS and BACKLOG usable', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'backlogUpdate', items: [{ id: 'BL-001', title: 't', status: 'todo' }] });
  dispatch({
    type: 'metricsUpdate',
    metrics: {
      meanTicketTimeMs: null,
      ticketSampleCount: 0,
      busyness: {},
      retryTotal: 0,
      retryByTicket: {},
      suiteDuration: { latestMs: null, meanMs: null, sampleCount: 0, warn: false },
    },
    roles: [],
  });

  document.getElementById('metrics-toggle').click();

  const metrics = document.getElementById('metrics');
  const backlog = document.getElementById('backlog');
  assert.ok(metrics.classList.contains('collapsed'), 'METRICS should collapse');
  assert.ok(!backlog.classList.contains('collapsed'), 'BACKLOG must not collapse when METRICS folds');

  document.getElementById('metrics-toggle').click();
  assert.ok(!metrics.classList.contains('collapsed'), 'METRICS should unfold again');
});

test('a fresh run with no closed tickets renders placeholders, never NaN/Infinity/undefined', () => {
  const { document, dispatch } = renderPanel();
  dispatch({
    type: 'metricsUpdate',
    metrics: {
      meanTicketTimeMs: null,
      ticketSampleCount: 0,
      busyness: { coder: 0 },
      retryTotal: 0,
      retryByTicket: {},
      suiteDuration: { latestMs: null, meanMs: null, sampleCount: 0, warn: false },
    },
    roles: ['coder'],
  });

  const text = document.getElementById('metrics-list').textContent;
  assert.match(text, /—/);
  assert.match(text, /coder/);
  assert.match(text, /0%/);
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
});

// BL-078 suite-duration-03
test('the METRICS pane shows suite duration latest, mean, and sample count', () => {
  const { document, dispatch } = renderPanel();
  dispatch({
    type: 'metricsUpdate',
    metrics: {
      meanTicketTimeMs: null,
      ticketSampleCount: 0,
      busyness: {},
      retryTotal: 0,
      retryByTicket: {},
      suiteDuration: { latestMs: 33000, meanMs: 35000, sampleCount: 12, warn: false },
    },
    roles: [],
  });

  const text = document.getElementById('metrics-list').textContent;
  assert.match(text, /Suite duration/);
  assert.match(text, /33s/);
  assert.match(text, /35s/);
  assert.match(text, /12/);
});

// BL-078 suite-duration-04
test('a suite-duration entry flagged warn renders in the warning style', () => {
  const { document, dispatch } = renderPanel();
  dispatch({
    type: 'metricsUpdate',
    metrics: {
      meanTicketTimeMs: null,
      ticketSampleCount: 0,
      busyness: {},
      retryTotal: 0,
      retryByTicket: {},
      suiteDuration: { latestMs: 130000, meanMs: 35000, sampleCount: 5, warn: true },
    },
    roles: [],
  });

  const warnValue = document.querySelector('.metric-value-warn');
  assert.ok(warnValue, 'a warn-flagged suite duration must render with the warning style class');
  assert.match(warnValue.textContent, /2m 10s/);
  assert.match(document.getElementById('metrics-list').textContent, /WARN/);
});

test('a normal (not warn) suite-duration entry never renders the warning style', () => {
  const { document, dispatch } = renderPanel();
  dispatch({
    type: 'metricsUpdate',
    metrics: {
      meanTicketTimeMs: null,
      ticketSampleCount: 0,
      busyness: {},
      retryTotal: 0,
      retryByTicket: {},
      suiteDuration: { latestMs: 33000, meanMs: 35000, sampleCount: 5, warn: false },
    },
    roles: [],
  });

  assert.equal(document.querySelector('.metric-value-warn'), null);
});
