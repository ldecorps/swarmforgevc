/**
 * BL-020: Tracing-bullet test — tracer utility functions.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generateTraceId,
  isTRACENote,
  createTraceLog,
  appendTraceHop,
  parseTraceLog,
  computeTraceReport,
  recordAgentDecision,
  recordStateChange,
  recordRetry,
  parseFullTraceLog,
} = require('../out/swarm/tracer');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-tracer-test-'));
}

// ── generateTraceId ────────────────────────────────────────────────────────

test('generateTraceId returns string starting with "trace-"', () => {
  const id = generateTraceId();
  assert.ok(id.startsWith('trace-'));
});

test('generateTraceId format matches trace-YYYYMMDDTHHMMSSz', () => {
  const id = generateTraceId();
  assert.match(id, /^trace-\d{8}T\d{6}z(-\d+)?$/);
});

test('generateTraceId called twice in same second appends counter suffix', () => {
  // Freeze clock by using a fixed date; instead just call twice and check they differ
  // or have a counter suffix. We mock by calling multiple times quickly.
  const ids = new Set();
  for (let i = 0; i < 5; i++) {
    ids.add(generateTraceId());
  }
  // If all calls happen in the same second, they'll have distinct counter suffixes
  // Either way each id must be unique
  assert.equal(ids.size, 5);
});

// ── isTRACENote ────────────────────────────────────────────────────────────

test('isTRACENote returns true when body starts with "TRACE "', () => {
  assert.equal(isTRACENote('TRACE trace-123 HOP coordinator 2026-06-30T00:00:00Z'), true);
});

test('isTRACENote returns false for normal note body', () => {
  assert.equal(isTRACENote('Backlog drained — no eligible next item.'), false);
});

test('isTRACENote returns false for empty string', () => {
  assert.equal(isTRACENote(''), false);
});

test('isTRACENote returns false when body starts with "trace" (lowercase)', () => {
  assert.equal(isTRACENote('trace-something'), false);
});

// ── createTraceLog ─────────────────────────────────────────────────────────

test('createTraceLog creates log file with initial body', () => {
  const tmp = mkTmp();
  const tracesDir = path.join(tmp, '.swarmforge', 'traces');
  const traceId = 'trace-20260630T000000z';
  const body = 'TRACE trace-20260630T000000z HOP coordinator 2026-06-30T00:00:00Z';
  createTraceLog(tracesDir, traceId, body);
  const logPath = path.join(tracesDir, `${traceId}.log`);
  assert.ok(fs.existsSync(logPath));
  assert.equal(fs.readFileSync(logPath, 'utf-8').trim(), body);
});

test('createTraceLog creates traces directory if absent', () => {
  const tmp = mkTmp();
  const tracesDir = path.join(tmp, '.swarmforge', 'traces');
  assert.equal(fs.existsSync(tracesDir), false);
  createTraceLog(tracesDir, 'trace-20260630T000000z', 'TRACE trace-20260630T000000z HOP coordinator 2026-06-30T00:00:00Z');
  assert.ok(fs.existsSync(tracesDir));
});

// ── appendTraceHop ─────────────────────────────────────────────────────────

test('appendTraceHop adds HOP line to existing log', () => {
  const tmp = mkTmp();
  const tracesDir = path.join(tmp, '.swarmforge', 'traces');
  const traceId = 'trace-20260630T000000z';
  createTraceLog(tracesDir, traceId, 'TRACE trace-20260630T000000z HOP coordinator 2026-06-30T00:00:00Z');
  appendTraceHop(tracesDir, traceId, 'specifier');
  const content = fs.readFileSync(path.join(tracesDir, `${traceId}.log`), 'utf-8');
  assert.ok(content.includes('HOP specifier'));
});

test('appendTraceHop HOP line includes ISO timestamp', () => {
  const tmp = mkTmp();
  const tracesDir = path.join(tmp, '.swarmforge', 'traces');
  const traceId = 'trace-20260630T000001z';
  createTraceLog(tracesDir, traceId, 'TRACE trace-20260630T000001z HOP coordinator 2026-06-30T00:00:00Z');
  appendTraceHop(tracesDir, traceId, 'coder');
  const content = fs.readFileSync(path.join(tracesDir, `${traceId}.log`), 'utf-8');
  assert.match(content, /HOP coder \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

// ── parseTraceLog ──────────────────────────────────────────────────────────

test('parseTraceLog extracts all HOP lines', () => {
  const content = [
    'TRACE trace-1 HOP coordinator 2026-06-30T00:00:00.000Z',
    'HOP specifier 2026-06-30T00:00:01.000Z',
    'HOP coder 2026-06-30T00:00:03.000Z',
    'HOP cleaner 2026-06-30T00:00:06.000Z',
  ].join('\n');
  const hops = parseTraceLog(content);
  assert.equal(hops.length, 4);
  assert.equal(hops[0].role, 'coordinator');
  assert.equal(hops[1].role, 'specifier');
  assert.equal(hops[2].role, 'coder');
  assert.equal(hops[3].role, 'cleaner');
});

test('parseTraceLog parses timestamps into Date objects', () => {
  const content = 'TRACE trace-1 HOP coordinator 2026-06-30T00:00:00.000Z\nHOP specifier 2026-06-30T00:00:01.000Z';
  const hops = parseTraceLog(content);
  assert.ok(hops[0].timestamp instanceof Date);
  assert.equal(hops[0].timestamp.toISOString(), '2026-06-30T00:00:00.000Z');
});

test('parseTraceLog returns empty array for empty content', () => {
  assert.deepEqual(parseTraceLog(''), []);
});

test('parseTraceLog ignores non-HOP lines', () => {
  const content = 'some random text\nHOP coordinator 2026-06-30T00:00:00.000Z\nother text';
  const hops = parseTraceLog(content);
  assert.equal(hops.length, 1);
});

// ── computeTraceReport ─────────────────────────────────────────────────────

test('computeTraceReport returns PASS when cleaner hop present', () => {
  const hops = [
    { role: 'coordinator', timestamp: new Date('2026-06-30T00:00:00.000Z') },
    { role: 'specifier',   timestamp: new Date('2026-06-30T00:00:01.000Z') },
    { role: 'coder',       timestamp: new Date('2026-06-30T00:00:03.000Z') },
    { role: 'cleaner',     timestamp: new Date('2026-06-30T00:00:06.000Z') },
  ];
  const report = computeTraceReport(hops);
  assert.equal(report.pass, true);
  assert.equal(report.lastHop, 'cleaner');
});

test('computeTraceReport computes per-hop latencies in seconds', () => {
  const hops = [
    { role: 'coordinator', timestamp: new Date('2026-06-30T00:00:00.000Z') },
    { role: 'specifier',   timestamp: new Date('2026-06-30T00:00:01.200Z') },
    { role: 'coder',       timestamp: new Date('2026-06-30T00:00:03.600Z') },
    { role: 'cleaner',     timestamp: new Date('2026-06-30T00:00:06.700Z') },
  ];
  const report = computeTraceReport(hops);
  assert.ok(Array.isArray(report.transitions));
  assert.equal(report.transitions.length, 3);
  assert.ok(Math.abs(report.transitions[0].seconds - 1.2) < 0.01);
  assert.ok(Math.abs(report.transitions[1].seconds - 2.4) < 0.01);
  assert.ok(Math.abs(report.transitions[2].seconds - 3.1) < 0.01);
});

test('computeTraceReport returns FAIL when cleaner hop absent', () => {
  const hops = [
    { role: 'coordinator', timestamp: new Date('2026-06-30T00:00:00.000Z') },
    { role: 'specifier',   timestamp: new Date('2026-06-30T00:00:01.000Z') },
  ];
  const report = computeTraceReport(hops);
  assert.equal(report.pass, false);
  assert.equal(report.lastHop, 'specifier');
});

test('computeTraceReport FAIL when no hops at all', () => {
  const report = computeTraceReport([]);
  assert.equal(report.pass, false);
  assert.equal(report.lastHop, null);
});

// ── recordAgentDecision ────────────────────────────────────────────────────

test('recordAgentDecision writes DECISION line to trace log', () => {
  const tmp = mkTmp();
  const tracesDir = path.join(tmp, '.swarmforge', 'traces');
  const traceId = 'trace-20260630T000002z';
  createTraceLog(tracesDir, traceId, 'TRACE trace-20260630T000002z HOP coordinator 2026-06-30T00:00:00Z');
  recordAgentDecision(tracesDir, traceId, 'coder', 'route_to_cleaner', 'implementation complete');
  const content = fs.readFileSync(path.join(tracesDir, `${traceId}.log`), 'utf-8');
  assert.ok(content.includes('DECISION coder'));
  assert.ok(content.includes('route_to_cleaner'));
});

// ── recordStateChange ──────────────────────────────────────────────────────

test('recordStateChange writes STATE_CHANGE line to trace log', () => {
  const tmp = mkTmp();
  const tracesDir = path.join(tmp, '.swarmforge', 'traces');
  const traceId = 'trace-20260630T000003z';
  createTraceLog(tracesDir, traceId, 'TRACE trace-20260630T000003z HOP specifier 2026-06-30T00:00:00Z');
  recordStateChange(tracesDir, traceId, 'specifier', 'idle', 'processing', 'handoff received');
  const content = fs.readFileSync(path.join(tracesDir, `${traceId}.log`), 'utf-8');
  assert.ok(content.includes('STATE_CHANGE specifier'));
  assert.ok(content.includes('idle->processing'));
});

// ── recordRetry ────────────────────────────────────────────────────────────

test('recordRetry writes RETRY line to trace log', () => {
  const tmp = mkTmp();
  const tracesDir = path.join(tmp, '.swarmforge', 'traces');
  const traceId = 'trace-20260630T000004z';
  createTraceLog(tracesDir, traceId, 'TRACE trace-20260630T000004z HOP coder 2026-06-30T00:00:00Z');
  recordRetry(tracesDir, traceId, 'coder', 1, 'timeout waiting for test completion');
  const content = fs.readFileSync(path.join(tracesDir, `${traceId}.log`), 'utf-8');
  assert.ok(content.includes('RETRY coder'));
  assert.ok(content.includes('attempt=1'));
});

// ── parseFullTraceLog ──────────────────────────────────────────────────────

test('parseFullTraceLog extracts hops, decisions, state changes, and retries', () => {
  const content = [
    'TRACE trace-1 HOP coordinator 2026-06-30T00:00:00.000Z',
    'DECISION coordinator 2026-06-30T00:00:00.100Z decision=route_to_specifier details="new work"',
    'STATE_CHANGE coordinator 2026-06-30T00:00:00.200Z idle->routing reason="handoff received"',
    'HOP specifier 2026-06-30T00:00:01.000Z',
    'RETRY specifier 2026-06-30T00:00:02.000Z attempt=1 reason="timeout"',
    'HOP coder 2026-06-30T00:00:03.000Z action=implement_feature',
  ].join('\n');
  const { hops, decisions, stateChanges, retries } = parseFullTraceLog(content);
  assert.equal(hops.length, 3);
  assert.equal(decisions.length, 1);
  assert.equal(stateChanges.length, 1);
  assert.equal(retries.length, 1);
  assert.equal(hops[2].action, 'implement_feature');
});

// ── computeTraceReport with full data ──────────────────────────────────────

test('computeTraceReport includes traceId, totalDuration, and hop details', () => {
  const hops = [
    { role: 'coordinator', timestamp: new Date('2026-06-30T00:00:00.000Z') },
    { role: 'specifier', timestamp: new Date('2026-06-30T00:00:05.000Z'), action: 'route' },
    { role: 'coder', timestamp: new Date('2026-06-30T00:00:10.000Z') },
  ];
  const report = computeTraceReport(hops, 'trace-test-1');
  assert.equal(report.traceId, 'trace-test-1');
  assert.equal(report.totalDuration, 10);
  assert.equal(report.hops.length, 3);
  assert.equal(report.hops[1].duration, 5);
  assert.equal(report.hops[1].action, 'route');
});
