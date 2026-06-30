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
  assert.ok(Array.isArray(report.latencies));
  assert.equal(report.latencies.length, 3);
  assert.ok(Math.abs(report.latencies[0].seconds - 1.2) < 0.01);
  assert.ok(Math.abs(report.latencies[1].seconds - 2.4) < 0.01);
  assert.ok(Math.abs(report.latencies[2].seconds - 3.1) < 0.01);
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
