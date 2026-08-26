'use strict';

// BL-980: RECENTLY CLOSED lines show how long ago each ticket closed.

const assert = require('node:assert/strict');

const {
  computePipelineBoard,
  formatRecentlyClosedAgeLabel,
  renderPipelineBoardBody,
  composePipelineBoardHtml,
} = require('../out/concierge/pipelineBoard');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

function closedItem(id, elapsedMs, title = 'effective-backlog') {
  return {
    id,
    title,
    filename: `${id}-${title}.yaml`,
    closedAtMs: NOW - elapsedMs,
  };
}

function board(recentlyClosed, nowMs = NOW) {
  return computePipelineBoard({}, [], {}, { recentlyClosed, nowMs });
}

function recentlyClosedLines(body) {
  const lines = body.split('\n');
  const start = lines.indexOf('RECENTLY CLOSED:');
  if (start === -1) {
    return [];
  }
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '' || /^[A-Z][A-Z ]*:$/.test(lines[i])) {
      break;
    }
    out.push(lines[i]);
  }
  return out;
}

// ── formatRecentlyClosedAgeLabel (pure, injected clock) ───────────────────

test('the relative-age ladder at every pinned boundary', () => {
  const cases = [
    [20000, 'just now'],
    [59999, 'just now'],
    [60000, '1min ago'],
    [600000, '10min ago'],
    [3599999, '59min ago'],
    [3600000, '1h ago'],
    [86399999, '23h ago'],
    [86400000, '1d ago'],
    [604800000, '7d ago'],
  ];
  for (const [elapsed, expected] of cases) {
    assert.equal(formatRecentlyClosedAgeLabel(NOW - elapsed, NOW), expected, `elapsed=${elapsed}`);
  }
});

test('no durable closure instant yields no age label', () => {
  assert.equal(formatRecentlyClosedAgeLabel(undefined, NOW), undefined);
});

// ── render path ─────────────────────────────────────────────────────────

test('a recently closed line ends with the parenthetical age suffix', () => {
  const data = board([closedItem('BL-966', 10 * MINUTE_MS)]);
  const body = renderPipelineBoardBody(data);
  const line = recentlyClosedLines(body)[0];
  assert.match(line, /966 effective-backlog \(10min ago\)$/);
});

test('a ticket with no recorded closure instant has no parenthetical', () => {
  const data = board([{ id: 'BL-100', title: 'no-stamp', filename: 'BL-100-no-stamp.yaml' }]);
  const body = renderPipelineBoardBody(data);
  const line = recentlyClosedLines(body)[0];
  assert.match(line, /^ {2}100 no-stamp$/);
  assert.doesNotMatch(line, /\(/);
});

test('the age comes from the durable closure record, not a file rewrite', () => {
  const data = board([closedItem('BL-966', 2 * HOUR_MS)]);
  const body = renderPipelineBoardBody(data);
  assert.match(recentlyClosedLines(body)[0], /\(2h ago\)$/);
});

test('parked, awaiting approval, root intake and grid captions carry no age suffix', () => {
  const data = computePipelineBoard(
    { coder: ['BL-1'] },
    [{ id: 'BL-2' }, { id: 'BL-3', humanApproval: 'pending' }],
    {
      'BL-1': { title: 'active ticket title here' },
      'BL-2': { title: 'parked ticket title' },
      'BL-3': { title: 'awaiting ticket title' },
    },
    {
      nowMs: NOW,
      activeIds: ['BL-1'],
      rootIntake: [{ id: 'INTAKE-foo', title: 'root intake item', filename: 'INTAKE-foo.md' }],
      recentlyClosed: [closedItem('BL-966', 10 * MINUTE_MS)],
    }
  );
  const body = renderPipelineBoardBody(data);
  const parkedBlock = body.slice(body.indexOf('PARKED:'), body.indexOf('AWAITING APPROVAL:'));
  assert.doesNotMatch(parkedBlock, /\([^)]*ago\)/);
  const awaitingBlock = body.slice(body.indexOf('AWAITING APPROVAL:'), body.indexOf('ROOT INTAKE:'));
  assert.doesNotMatch(awaitingBlock, /\([^)]*ago\)/);
  const intakeBlock = body.slice(body.indexOf('ROOT INTAKE:'), body.indexOf('RECENTLY CLOSED:'));
  assert.doesNotMatch(intakeBlock, /\([^)]*ago\)/);
  const gridBlock = body.slice(0, body.indexOf('PARKED:'));
  assert.doesNotMatch(gridBlock, /\([^)]*ago\)/);
});

test('plain-text and HTML render paths agree on the age suffix', () => {
  const data = board([closedItem('BL-966', 10 * MINUTE_MS)]);
  const body = renderPipelineBoardBody(data);
  const { html } = composePipelineBoardHtml(data, NOW, 'https://github.com/x/y');
  assert.match(body, /\(10min ago\)/);
  assert.match(html, /\(10min ago\)/);
});
