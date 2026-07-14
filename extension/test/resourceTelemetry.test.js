const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  filterResourceSampleEvents,
  computeResourceTrends,
  readResourceSampleEvents,
  appendResourceSample,
  sampleProcessStats,
  startResourceSampler,
  stopResourceSampler,
  sampleRolesOnce,
  latestSampleAtMs,
  shouldSampleThisInterval,
  DEFAULT_SAMPLER_INTERVAL_MS,
} = require('../out/metrics/resourceTelemetry');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-resource-telemetry-'));
}

function rawEvent(overrides = {}) {
  return { type: 'resource_sample', role: 'coder', rssBytes: 100_000_000, cpuPercent: 12.5, at: '2026-07-09T08:00:00Z', ...overrides };
}

// ── filterResourceSampleEvents (pure) ───────────────────────────────────

test('filterResourceSampleEvents keeps a well-formed resource_sample event', () => {
  const events = filterResourceSampleEvents([rawEvent()]);
  assert.deepEqual(events, [{ role: 'coder', rssBytes: 100_000_000, cpuPercent: 12.5, atMs: Date.parse('2026-07-09T08:00:00Z') }]);
});

test('filterResourceSampleEvents ignores events of other telemetry types (chase, nudge, dead-letter, respawn)', () => {
  const events = filterResourceSampleEvents([
    { type: 'chase', role: 'coder', at: '2026-07-09T08:00:00Z' },
    { type: 'nudge', role: 'coder', at: '2026-07-09T08:00:00Z' },
  ]);
  assert.deepEqual(events, []);
});

test('filterResourceSampleEvents skips a resource_sample event with a non-numeric rssBytes/cpuPercent', () => {
  const events = filterResourceSampleEvents([rawEvent({ rssBytes: 'not-a-number' })]);
  assert.deepEqual(events, []);
});

test('filterResourceSampleEvents skips an event with an unparseable timestamp', () => {
  const events = filterResourceSampleEvents([rawEvent({ at: 'not-a-date' })]);
  assert.deepEqual(events, []);
});

// ── computeResourceTrends (pure, over provided events) ──────────────────

test('computeResourceTrends reports the current value and a windowed trend per role (cost-04)', () => {
  const HOUR = 60 * 60 * 1000;
  const base = Date.parse('2026-07-09T00:00:00Z');
  const events = [
    { role: 'coder', rssBytes: 100, cpuPercent: 10, atMs: base },
    { role: 'coder', rssBytes: 200, cpuPercent: 20, atMs: base + HOUR },
  ];
  const result = computeResourceTrends(events, ['coder'], base + HOUR);
  assert.equal(result.coder.currentRssBytes, 200);
  assert.equal(result.coder.currentCpuPercent, 20);
  assert.equal(result.coder.rssTrend.direction, 'up');
  assert.equal(result.coder.cpuTrend.direction, 'up');
});

test('computeResourceTrends averages multiple samples within the same hourly bucket', () => {
  const base = Date.parse('2026-07-09T00:00:00Z');
  const events = [
    { role: 'coder', rssBytes: 100, cpuPercent: 10, atMs: base },
    { role: 'coder', rssBytes: 300, cpuPercent: 30, atMs: base + 10_000 },
  ];
  const result = computeResourceTrends(events, ['coder'], base + 10_000);
  assert.equal(result.coder.rssSeries.length, 1);
  assert.equal(result.coder.rssSeries[0].value, 200);
});

test('computeResourceTrends reports null/empty for a role with no samples at all, without error (cost-07)', () => {
  const result = computeResourceTrends([], ['coder'], Date.now());
  assert.equal(result.coder.currentRssBytes, null);
  assert.equal(result.coder.currentCpuPercent, null);
  assert.deepEqual(result.coder.rssSeries, []);
  assert.equal(result.coder.rssTrend.direction, 'unknown');
});

test('computeResourceTrends keeps distinct roles independent', () => {
  const base = Date.parse('2026-07-09T00:00:00Z');
  const events = [
    { role: 'coder', rssBytes: 100, cpuPercent: 10, atMs: base },
    { role: 'cleaner', rssBytes: 500, cpuPercent: 50, atMs: base },
  ];
  const result = computeResourceTrends(events, ['coder', 'cleaner'], base);
  assert.equal(result.coder.currentRssBytes, 100);
  assert.equal(result.cleaner.currentRssBytes, 500);
});

// ── readResourceSampleEvents / appendResourceSample (thin fs adapters) ──

test('appendResourceSample writes a resource_sample line that readResourceSampleEvents reads back', () => {
  const targetPath = mkTmp();
  appendResourceSample(targetPath, 'coder', 123456, 7.5, Date.parse('2026-07-09T08:00:00Z'));

  const events = readResourceSampleEvents(targetPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].role, 'coder');
  assert.equal(events[0].rssBytes, 123456);
  assert.equal(events[0].cpuPercent, 7.5);
});

test('appendResourceSample never throws even if the telemetry directory cannot be created', () => {
  // A file where a directory is expected forces mkdir to fail.
  const targetPath = mkTmp();
  fs.writeFileSync(path.join(targetPath, '.swarmforge'), 'not a directory');
  assert.doesNotThrow(() => appendResourceSample(targetPath, 'coder', 1, 1, Date.now()));
});

test('readResourceSampleEvents returns an empty array when no telemetry exists yet (cost-07)', () => {
  const targetPath = mkTmp();
  assert.deepEqual(readResourceSampleEvents(targetPath), []);
});

// ── sampleProcessStats (thin OS adapter) ────────────────────────────────

test('sampleProcessStats reads real rss/cpu for the current process', () => {
  const stats = sampleProcessStats(process.pid);
  assert.ok(stats);
  assert.ok(stats.rssBytes > 0);
  assert.ok(stats.cpuPercent >= 0);
});

test('sampleProcessStats returns null for a pid that does not exist', () => {
  // A pid astronomically unlikely to be alive.
  assert.equal(sampleProcessStats(999999), null);
});

// ── startResourceSampler / stopResourceSampler (injected clock, no real waits) ──

function fakeScheduler() {
  let tick = null;
  return {
    scheduleTick: (fn) => {
      tick = fn;
      return {};
    },
    clearTick: () => {
      tick = null;
    },
    fire: () => {
      if (tick) tick();
    },
  };
}

test('startResourceSampler samples every tracked role on each tick and stops cleanly', () => {
  const targetPath = mkTmp();
  const { scheduleTick, clearTick, fire } = fakeScheduler();
  const roles = [{ role: 'coder', getPid: () => 111 }];
  const getStats = (pid) => (pid === 111 ? { rssBytes: 42, cpuPercent: 3 } : null);

  const timer = startResourceSampler(targetPath, roles, getStats, scheduleTick, 60_000);
  fire();
  stopResourceSampler(timer, clearTick);

  const events = readResourceSampleEvents(targetPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].role, 'coder');
  assert.equal(events[0].rssBytes, 42);
});

test('startResourceSampler skips a role whose pid cannot be resolved, without throwing', () => {
  const targetPath = mkTmp();
  const { scheduleTick, clearTick, fire } = fakeScheduler();
  const roles = [{ role: 'coder', getPid: () => null }];

  const timer = startResourceSampler(targetPath, roles, sampleProcessStats, scheduleTick, 60_000);
  assert.doesNotThrow(() => fire());
  stopResourceSampler(timer, clearTick);
  assert.deepEqual(readResourceSampleEvents(targetPath), []);
});

test('stopResourceSampler prevents further ticks from sampling', () => {
  const targetPath = mkTmp();
  const { scheduleTick, clearTick, fire } = fakeScheduler();
  const roles = [{ role: 'coder', getPid: () => 111 }];
  const getStats = () => ({ rssBytes: 1, cpuPercent: 1 });

  const timer = startResourceSampler(targetPath, roles, getStats, scheduleTick, 60_000);
  stopResourceSampler(timer, clearTick);
  fire();
  assert.deepEqual(readResourceSampleEvents(targetPath), []);
});

test('stopResourceSampler tolerates a null timer', () => {
  assert.doesNotThrow(() => stopResourceSampler(null, fakeScheduler().clearTick));
});

// ── sampleRolesOnce (BL-350: the headless-callable single tick) ──────────

test('sampleRolesOnce samples every tracked role once and returns the sampled count', () => {
  const targetPath = mkTmp();
  const roles = [{ role: 'coder', getPid: () => 111 }, { role: 'cleaner', getPid: () => 222 }];
  const getStats = (pid) => ({ rssBytes: pid, cpuPercent: 1 });

  const count = sampleRolesOnce(targetPath, roles, getStats, Date.parse('2026-07-13T00:00:00Z'));

  assert.equal(count, 2);
  const events = readResourceSampleEvents(targetPath);
  assert.deepEqual(events.map((e) => e.role).sort(), ['cleaner', 'coder']);
});

test('sampleRolesOnce skips a role with no resolvable pid and does not count it', () => {
  const targetPath = mkTmp();
  const roles = [{ role: 'coder', getPid: () => null }];

  const count = sampleRolesOnce(targetPath, roles, sampleProcessStats, Date.now());

  assert.equal(count, 0);
  assert.deepEqual(readResourceSampleEvents(targetPath), []);
});

test('sampleRolesOnce skips a role whose stats cannot be resolved and does not count it', () => {
  const targetPath = mkTmp();
  const roles = [{ role: 'coder', getPid: () => 111 }];

  const count = sampleRolesOnce(targetPath, roles, () => null, Date.now());

  assert.equal(count, 0);
  assert.deepEqual(readResourceSampleEvents(targetPath), []);
});

test('startResourceSampler still samples correctly after delegating each tick to sampleRolesOnce', () => {
  const targetPath = mkTmp();
  const { scheduleTick, fire } = fakeScheduler();
  const roles = [{ role: 'coder', getPid: () => 111 }];
  const getStats = () => ({ rssBytes: 42, cpuPercent: 3 });

  startResourceSampler(targetPath, roles, getStats, scheduleTick, 60_000);
  fire();

  const events = readResourceSampleEvents(targetPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].rssBytes, 42);
});

// ── latestSampleAtMs (pure) ───────────────────────────────────────────────

test('latestSampleAtMs returns null for an empty event list', () => {
  assert.equal(latestSampleAtMs([]), null);
});

test('latestSampleAtMs returns the max atMs across every role, not just the last in the array', () => {
  const events = [
    { role: 'coder', rssBytes: 1, cpuPercent: 1, atMs: 100 },
    { role: 'cleaner', rssBytes: 1, cpuPercent: 1, atMs: 300 },
    { role: 'coder', rssBytes: 1, cpuPercent: 1, atMs: 200 },
  ];
  assert.equal(latestSampleAtMs(events), 300);
});

// ── shouldSampleThisInterval (pure, BL-350 headless/host dedup gate) ─────

test('shouldSampleThisInterval is true when no sample has ever been recorded', () => {
  assert.equal(shouldSampleThisInterval(null, Date.now(), DEFAULT_SAMPLER_INTERVAL_MS), true);
});

test('shouldSampleThisInterval is false when the last sample is still within the interval', () => {
  const nowMs = 1_000_000;
  const lastSampleAtMs = nowMs - (DEFAULT_SAMPLER_INTERVAL_MS - 1000);
  assert.equal(shouldSampleThisInterval(lastSampleAtMs, nowMs, DEFAULT_SAMPLER_INTERVAL_MS), false);
});

test('shouldSampleThisInterval is true once the interval has fully elapsed since the last sample', () => {
  const nowMs = 1_000_000;
  const lastSampleAtMs = nowMs - DEFAULT_SAMPLER_INTERVAL_MS;
  assert.equal(shouldSampleThisInterval(lastSampleAtMs, nowMs, DEFAULT_SAMPLER_INTERVAL_MS), true);
});
