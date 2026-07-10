const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { computeChaseTrend, formatChaseTrendLine, CHASE_TREND_WINDOW_DAYS } = require('../out/tools/chase-trend-line');

function mkFixtureRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chase-trend-test-'));
  fs.mkdirSync(path.join(dir, '.swarmforge', 'telemetry'), { recursive: true });
  return dir;
}

function writeTelemetryEvent(dir, monthKey, event) {
  const file = path.join(dir, '.swarmforge', 'telemetry', `chaser-${monthKey}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
}

// ── computeChaseTrend ────────────────────────────────────────────────────

test('a busier current window than the prior one trends up', () => {
  const dir = mkFixtureRoot();
  const nowMs = Date.parse('2026-07-10T12:00:00Z');
  const windowMs = CHASE_TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // Prior window (14-7 days ago): 1 chase. Current window (7-0 days ago): 4 chases.
  writeTelemetryEvent(dir, '2026-06', { type: 'chase', role: 'coder', count: 1, at: new Date(nowMs - windowMs - 60000).toISOString() });
  for (let i = 0; i < 4; i++) {
    writeTelemetryEvent(dir, '2026-07', { type: 'chase', role: 'coder', count: 1, at: new Date(nowMs - 60000 * (i + 1)).toISOString() });
  }

  const trend = computeChaseTrend(dir, ['coder'], nowMs);

  assert.equal(trend.direction, 'up');
});

test('no telemetry at all yields an unknown-direction trend, not a crash', () => {
  const dir = mkFixtureRoot();
  const trend = computeChaseTrend(dir, ['coder'], Date.parse('2026-07-10T12:00:00Z'));
  assert.equal(trend.currentValue, 0);
});

test('an event from a role not in roleNames is excluded', () => {
  const dir = mkFixtureRoot();
  const nowMs = Date.parse('2026-07-10T12:00:00Z');
  writeTelemetryEvent(dir, '2026-07', { type: 'chase', role: 'architect', count: 1, at: new Date(nowMs - 60000).toISOString() });

  const trend = computeChaseTrend(dir, ['coder'], nowMs);

  assert.equal(trend.currentValue, 0);
});

test('an event of an uncounted type (e.g. resource_sample) is excluded', () => {
  const dir = mkFixtureRoot();
  const nowMs = Date.parse('2026-07-10T12:00:00Z');
  writeTelemetryEvent(dir, '2026-07', { type: 'resource_sample', role: 'coder', at: new Date(nowMs - 60000).toISOString() });

  const trend = computeChaseTrend(dir, ['coder'], nowMs);

  assert.equal(trend.currentValue, 0);
});

test('an event with a malformed timestamp is excluded, not a crash', () => {
  const dir = mkFixtureRoot();
  const nowMs = Date.parse('2026-07-10T12:00:00Z');
  writeTelemetryEvent(dir, '2026-07', { type: 'chase', role: 'coder', at: 'not-a-date' });

  const trend = computeChaseTrend(dir, ['coder'], nowMs);

  assert.equal(trend.currentValue, 0);
});

test('an event older than both windows is excluded', () => {
  const dir = mkFixtureRoot();
  const nowMs = Date.parse('2026-07-10T12:00:00Z');
  const windowMs = CHASE_TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  writeTelemetryEvent(dir, '2026-06', { type: 'chase', role: 'coder', at: new Date(nowMs - 3 * windowMs).toISOString() });

  const trend = computeChaseTrend(dir, ['coder'], nowMs);

  assert.equal(trend.currentValue, 0);
  assert.equal(trend.priorValue, 0);
});

// ── formatChaseTrendLine ─────────────────────────────────────────────────
// graceful-missing-data-05

test('formats total chase/nudge/dead-letter counts with the trend direction', () => {
  const current = { coder: { chases: 3, nudges: 2, deadLetters: 1, respawns: 0, recentDailyRate: 0.5 } };
  const trend = { series: [], currentValue: 6, priorValue: 2, delta: 4, direction: 'up' };

  const text = formatChaseTrendLine(current, trend, ['coder']);

  assert.match(text, /3 chase\(s\), 2 nudge\(s\), 1 dead-letter\(s\)/);
  assert.match(text, /\+4 vs prior/);
});

test('zero activity across every role shows an explicit no-activity note, not a blank or zeroed line', () => {
  const current = { coder: { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 } };
  const trend = { series: [], currentValue: 0, priorValue: 0, delta: 0, direction: 'flat' };

  const text = formatChaseTrendLine(current, trend, ['coder']);

  assert.match(text, /no chase or nudge activity/);
});

test('a role missing from the telemetry map contributes zero, not a crash', () => {
  const text = formatChaseTrendLine({}, { series: [], currentValue: 0, priorValue: 0, delta: 0, direction: 'flat' }, ['coder']);
  assert.match(text, /no chase or nudge activity/);
});

// ── end-to-end: the compiled CLI's own real output ────────────────────────

test('the compiled CLI runs against the real repo and prints one line', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'chase-trend-line.js');
  const output = execFileSync('node', [cliPath], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' });
  assert.match(output, /^Chase\/nudge trend: /);
});
