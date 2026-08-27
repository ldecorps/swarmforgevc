const { mkTmpDir } = require('./helpers/tmpDir');
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
  filterHostLoadSampleEvents,
  readHostLoadSampleEvents,
  appendHostLoadSample,
  sampleHostLoadRatio,
  computeHostLoadVerdict,
  hostLoadSevereRatioThreshold,
  hostLoadSustainedMs,
  DEFAULT_HOST_LOAD_SEVERE_RATIO,
  DEFAULT_HOST_LOAD_SUSTAINED_MINUTES,
} = require('../out/metrics/resourceTelemetry');

function mkTmp() {
  return mkTmpDir('sfvc-resource-telemetry-');
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

// BL-822: sampleRolesOnce also records host load on the same tick,
// independently of role pid resolution (implementation shape 2).

test('sampleRolesOnce records a host-load sample on the same tick even when every role pid is unresolvable', () => {
  const targetPath = mkTmp();
  const roles = [{ role: 'coder', getPid: () => null }];

  const count = sampleRolesOnce(targetPath, roles, sampleProcessStats, Date.parse('2026-08-06T00:00:00Z'), () => 22.5);

  assert.equal(count, 0, 'no role was sampled');
  assert.deepEqual(readResourceSampleEvents(targetPath), [], 'no role sample was written');
  const hostLoadEvents = readHostLoadSampleEvents(targetPath);
  assert.equal(hostLoadEvents.length, 1, 'the host-load sample must still be written');
  assert.equal(hostLoadEvents[0].ratio, 22.5);
});

test('sampleRolesOnce does not record a host-load sample when the ratio cannot be resolved', () => {
  const targetPath = mkTmp();
  const roles = [{ role: 'coder', getPid: () => 111 }];

  sampleRolesOnce(targetPath, roles, () => ({ rssBytes: 1, cpuPercent: 1 }), Date.now(), () => null);

  assert.deepEqual(readHostLoadSampleEvents(targetPath), []);
});

test('sampleRolesOnce defaults to the real sampleHostLoadRatio adapter when none is injected', () => {
  const targetPath = mkTmp();
  const roles = [{ role: 'coder', getPid: () => 111 }];

  sampleRolesOnce(targetPath, roles, () => ({ rssBytes: 1, cpuPercent: 1 }), Date.now());

  // A real host always has a resolvable loadavg/cpu count on macOS/Linux
  // (this project's only target OSes), so the default adapter records one.
  assert.equal(readHostLoadSampleEvents(targetPath).length, 1);
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

// ── host load (BL-822) ────────────────────────────────────────────────────

function rawHostLoadEvent(overrides = {}) {
  return { type: 'host_load_sample', role: 'host', ratio: 20, at: '2026-08-06T08:00:00Z', ...overrides };
}

test('filterHostLoadSampleEvents keeps a well-formed host_load_sample event', () => {
  const events = filterHostLoadSampleEvents([rawHostLoadEvent()]);
  assert.deepEqual(events, [{ ratio: 20, atMs: Date.parse('2026-08-06T08:00:00Z') }]);
});

test('filterHostLoadSampleEvents ignores resource_sample and other telemetry types', () => {
  const events = filterHostLoadSampleEvents([
    { type: 'resource_sample', role: 'coder', rssBytes: 1, cpuPercent: 1, at: '2026-08-06T08:00:00Z' },
    { type: 'chase', role: 'coder', at: '2026-08-06T08:00:00Z' },
  ]);
  assert.deepEqual(events, []);
});

test('filterHostLoadSampleEvents skips an event with a non-numeric ratio', () => {
  assert.deepEqual(filterHostLoadSampleEvents([rawHostLoadEvent({ ratio: 'not-a-number' })]), []);
});

test('filterHostLoadSampleEvents skips an event with an unparseable timestamp', () => {
  assert.deepEqual(filterHostLoadSampleEvents([rawHostLoadEvent({ at: 'not-a-date' })]), []);
});

test('appendHostLoadSample writes a host_load_sample line that readHostLoadSampleEvents reads back', () => {
  const targetPath = mkTmp();
  appendHostLoadSample(targetPath, 20, Date.parse('2026-08-06T08:00:00Z'));

  const events = readHostLoadSampleEvents(targetPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].ratio, 20);
});

test('appendHostLoadSample never throws even if the telemetry directory cannot be created', () => {
  const targetPath = mkTmp();
  fs.writeFileSync(path.join(targetPath, '.swarmforge'), 'not a directory');
  assert.doesNotThrow(() => appendHostLoadSample(targetPath, 20, Date.now()));
});

test('appendHostLoadSample leaves existing resource_sample telemetry in the same file intact (additive, same family)', () => {
  const targetPath = mkTmp();
  appendResourceSample(targetPath, 'coder', 1, 1, Date.parse('2026-08-06T08:00:00Z'));
  appendHostLoadSample(targetPath, 20, Date.parse('2026-08-06T08:05:00Z'));

  assert.equal(readResourceSampleEvents(targetPath).length, 1);
  assert.equal(readHostLoadSampleEvents(targetPath).length, 1);
});

test('a host_load_sample event never sets resourceSamplesObserved-relevant role data - readResourceSampleEvents does not see it', () => {
  const targetPath = mkTmp();
  appendHostLoadSample(targetPath, 20, Date.now());
  assert.deepEqual(readResourceSampleEvents(targetPath), []);
});

test('readHostLoadSampleEvents returns an empty array when no telemetry exists yet', () => {
  assert.deepEqual(readHostLoadSampleEvents(mkTmp()), []);
});

// ── sampleHostLoadRatio (thin OS adapter, injectable) ────────────────────

test('sampleHostLoadRatio divides the injected 1-minute load average by the injected core count', () => {
  assert.equal(sampleHostLoadRatio(() => 8, () => 4), 2);
});

test('sampleHostLoadRatio returns null when the core count is zero', () => {
  assert.equal(sampleHostLoadRatio(() => 8, () => 0), null);
});

test('sampleHostLoadRatio returns null when either reading is non-finite', () => {
  assert.equal(sampleHostLoadRatio(() => NaN, () => 4), null);
});

test('sampleHostLoadRatio returns null rather than throwing when an injected reader throws', () => {
  assert.equal(
    sampleHostLoadRatio(
      () => {
        throw new Error('boom');
      },
      () => 4
    ),
    null
  );
});

test('sampleHostLoadRatio reads real host values by default', () => {
  const ratio = sampleHostLoadRatio();
  assert.ok(ratio === null || (Number.isFinite(ratio) && ratio >= 0));
});

// ── computeHostLoadVerdict (pure, BL-822 ruling 2: ratio AND duration) ───

function hostLoadSeries(ratio, minutes, intervalMs = DEFAULT_SAMPLER_INTERVAL_MS, endMs = Date.parse('2026-08-06T12:00:00Z')) {
  const sampleCount = Math.max(1, Math.round((minutes * 60_000) / intervalMs));
  const events = [];
  for (let i = 0; i < sampleCount; i++) {
    events.push({ ratio, atMs: endMs - i * intervalMs });
  }
  return events;
}

// BL-822 severity-needs-ratio-and-duration-05 scenario outline, driven
// directly against the pure function (the acceptance feature drives the
// same table end to end through the sidecar; this locks the underlying
// arithmetic in isolation).
const OUTLINE_ROWS = [
  { ratio: 20, minutes: 240, severe: true },
  { ratio: 6, minutes: 30, severe: true },
  { ratio: 20, minutes: 5, severe: false },
  { ratio: 3, minutes: 240, severe: false },
];

for (const row of OUTLINE_ROWS) {
  test(`computeHostLoadVerdict: ${row.ratio}x for ${row.minutes}min is severe=${row.severe}`, () => {
    const verdict = computeHostLoadVerdict(hostLoadSeries(row.ratio, row.minutes), DEFAULT_HOST_LOAD_SEVERE_RATIO, DEFAULT_HOST_LOAD_SUSTAINED_MINUTES * 60_000);
    assert.equal(verdict.severe, row.severe);
  });
}

test('computeHostLoadVerdict reports null ratio and not severe for an empty event list', () => {
  const verdict = computeHostLoadVerdict([]);
  assert.equal(verdict.severe, false);
  assert.equal(verdict.ratio, null);
});

test('computeHostLoadVerdict is not fooled by a stale spike that has since come back down (walks from the most recent sample)', () => {
  const base = Date.parse('2026-08-06T12:00:00Z');
  const events = [
    // A severe run long ago...
    ...hostLoadSeries(20, 240, DEFAULT_SAMPLER_INTERVAL_MS, base - 6 * 60 * 60 * 1000),
    // ...but the CURRENT, most recent run is quiet.
    ...hostLoadSeries(1.5, 30, DEFAULT_SAMPLER_INTERVAL_MS, base),
  ];
  const verdict = computeHostLoadVerdict(events);
  assert.equal(verdict.severe, false);
});

test('computeHostLoadVerdict respects injected severeRatioThreshold/sustainedMs overrides', () => {
  const events = hostLoadSeries(3, 10);
  assert.equal(computeHostLoadVerdict(events, 2, 5 * 60_000).severe, true, 'threshold lowered below the observed ratio');
  assert.equal(computeHostLoadVerdict(events, 4, 5 * 60_000).severe, false, 'default-ish threshold still above the observed ratio');
});

// ── hostLoadSevereRatioThreshold / hostLoadSustainedMs (config dials) ────

function writeConf(targetPath, lines) {
  const dir = path.join(targetPath, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'swarmforge.conf'), lines.join('\n') + '\n');
}

test('hostLoadSevereRatioThreshold defaults when no config file exists', () => {
  assert.equal(hostLoadSevereRatioThreshold(mkTmp()), DEFAULT_HOST_LOAD_SEVERE_RATIO);
});

test('hostLoadSevereRatioThreshold reads the configured override', () => {
  const targetPath = mkTmp();
  writeConf(targetPath, ['config host_load_severe_ratio 6']);
  assert.equal(hostLoadSevereRatioThreshold(targetPath), 6);
});

test('hostLoadSevereRatioThreshold degrades to the default on a malformed value', () => {
  const targetPath = mkTmp();
  writeConf(targetPath, ['config host_load_severe_ratio not-a-number']);
  assert.equal(hostLoadSevereRatioThreshold(targetPath), DEFAULT_HOST_LOAD_SEVERE_RATIO);
});

test('hostLoadSustainedMs defaults when no config file exists', () => {
  assert.equal(hostLoadSustainedMs(mkTmp()), DEFAULT_HOST_LOAD_SUSTAINED_MINUTES * 60_000);
});

test('hostLoadSustainedMs reads the configured override, converted to milliseconds', () => {
  const targetPath = mkTmp();
  writeConf(targetPath, ['config host_load_sustained_minutes 30']);
  assert.equal(hostLoadSustainedMs(targetPath), 30 * 60_000);
});
