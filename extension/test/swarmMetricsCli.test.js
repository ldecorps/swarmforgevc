const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  resolveProjectRoot,
  resolveMainWorktreePath,
  formatOverview,
  formatDeliveryOverview,
  formatCostTelemetryLine,
  formatResourceTrendsLine,
  runCliMain,
} = require('../out/tools/swarm-metrics');

// realpath: macOS resolves /var -> /private/var, and git rev-parse
// --show-toplevel returns the resolved path, so an un-resolved tmpdir would
// never string-equal what resolveProjectRoot returns.
function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-metrics-cli-')));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// --- resolveProjectRoot (BL-056 lesson: anchor at worktree/repo root) ---

test('resolveProjectRoot finds the root from the main checkout itself', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'specifier\tmaster\t' + root + '\tswarmforge-specifier\tSpecifier\tclaude\ttask\n');

  assert.equal(resolveProjectRoot(root), root);
});

test('resolveProjectRoot finds the root from inside a linked worktree', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'specifier\tmaster\t' + root + '\tswarmforge-specifier\tSpecifier\tclaude\ttask\n');

  const coderWt = path.join(root, '.worktrees', 'coder');
  git(root, ['worktree', 'add', '-q', '-b', 'coder', coderWt]);

  assert.equal(resolveProjectRoot(coderWt), root);
});

// --- resolveMainWorktreePath ---

test('resolveMainWorktreePath resolves to the specifier role worktree', () => {
  const roles = [
    { role: 'coder', worktreePath: '/repo/.worktrees/coder', displayName: 'Coder' },
    { role: 'specifier', worktreePath: '/repo', displayName: 'Specifier' },
  ];
  assert.equal(resolveMainWorktreePath('/repo', roles), '/repo');
});

test('resolveMainWorktreePath falls back to the coordinator role when no specifier is configured', () => {
  const roles = [{ role: 'coordinator', worktreePath: '/repo', displayName: 'Coordinator' }];
  assert.equal(resolveMainWorktreePath('/repo', roles), '/repo');
});

test('resolveMainWorktreePath falls back to the project root when neither role is configured', () => {
  assert.equal(resolveMainWorktreePath('/repo', []), '/repo');
});

// --- formatOverview (BL-071 swarm-metrics-07/09) ---

test('formatOverview prints a short plain-text overview with mean time, busyness, and retries', () => {
  const metrics = {
    meanTicketTimeMs: 4 * 60 * 60 * 1000 + 12 * 60 * 1000,
    ticketSampleCount: 23,
    busyness: { coder: 0.45, cleaner: 0.02 },
    retryTotal: 3,
    retryByTicket: { 'BL-101': 2, 'BL-102': 1 },
    suiteDuration: { latestMs: 33000, meanMs: 33000, sampleCount: 5, warn: false },
    chaserTelemetry: {
      coder: { chases: 3, nudges: 1, deadLetters: 0, respawns: 0, recentDailyRate: 0.5 },
      cleaner: { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 },
    },
  };
  const text = formatOverview(metrics, ['coder', 'cleaner']);

  // Exact-equality (not just substring match) so the busyness ", " join,
  // the "(worst: ...)" suffix join, and the line-join separators are all
  // pinned down - a substring-only regex can't tell '', ' ' apart.
  assert.equal(
    text,
    [
      'Mean ticket time: 4h 12m over 23 ticket(s)',
      'Busyness: coder 45%, cleaner 2%',
      'Retries: 3 total (worst: BL-101 x2, BL-102 x1)',
      'Suite duration: 33s (mean 33s over 5 run(s))',
      'Chaser telemetry: coder 3 chases/1 nudges (0.50/day), cleaner 0 chases/0 nudges (0.00/day)',
    ].join('\n')
  );
});

test('formatOverview lists only the top 3 tickets by retry count, sorted descending', () => {
  const metrics = {
    meanTicketTimeMs: null,
    ticketSampleCount: 0,
    busyness: {},
    retryTotal: 10,
    retryByTicket: { 'BL-1': 1, 'BL-2': 5, 'BL-3': 3, 'BL-4': 2, 'BL-5': 4 },
    suiteDuration: { latestMs: null, meanMs: null, sampleCount: 0, warn: false },
  };
  const text = formatOverview(metrics, []);
  const retryLine = text.split('\n')[2];

  assert.equal(retryLine, 'Retries: 10 total (worst: BL-2 x5, BL-5 x4, BL-3 x3)');
});

test('formatOverview omits the "(worst: ...)" suffix entirely when there are no retries', () => {
  const metrics = {
    meanTicketTimeMs: null,
    ticketSampleCount: 0,
    busyness: {},
    retryTotal: 0,
    retryByTicket: {},
    suiteDuration: { latestMs: null, meanMs: null, sampleCount: 0, warn: false },
  };
  const text = formatOverview(metrics, []);
  const retryLine = text.split('\n')[2];

  assert.equal(retryLine, 'Retries: 0 total');
});

test('formatOverview on a fresh run prints placeholders, never NaN/Infinity/undefined', () => {
  const metrics = {
    meanTicketTimeMs: null,
    ticketSampleCount: 0,
    busyness: { coder: 0, cleaner: 0 },
    retryTotal: 0,
    retryByTicket: {},
    suiteDuration: { latestMs: null, meanMs: null, sampleCount: 0, warn: false },
  };
  const text = formatOverview(metrics, ['coder', 'cleaner']);

  assert.match(text, /Mean ticket time: —/);
  assert.match(text, /coder 0%/);
  assert.match(text, /Retries: 0 total/);
  const suiteLine = text.split('\n')[3];
  assert.equal(suiteLine, 'Suite duration: — (0 runs)', 'no WARN prefix and no stray text before "Suite duration"');
  // telemetry-05: absent chaserTelemetry (no field on this fixture at all,
  // simulating an older metrics object or a target with no telemetry log
  // yet) reads as zero for every role, never an error.
  assert.equal(text.split('\n')[4], 'Chaser telemetry: coder 0 chases/0 nudges (0.00/day), cleaner 0 chases/0 nudges (0.00/day)');
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
});

// BL-078 suite-duration-04
test('formatOverview prefixes WARN when the suite-duration entry is flagged', () => {
  const metrics = {
    meanTicketTimeMs: null,
    ticketSampleCount: 0,
    busyness: {},
    retryTotal: 0,
    retryByTicket: {},
    suiteDuration: { latestMs: 130000, meanMs: 35000, sampleCount: 5, warn: true },
  };
  const text = formatOverview(metrics, []);
  assert.match(text, /WARN Suite duration: 2m 10s/);
});

// BL-208: "By provider" line - grouped by agent/provider brand instead of
// role, the operator-facing proof of brand-agnostic-read-02.

test('formatOverview omits the "By provider" line entirely when no providerNames are given', () => {
  const metrics = {
    meanTicketTimeMs: null,
    ticketSampleCount: 0,
    busyness: {},
    retryTotal: 0,
    retryByTicket: {},
    suiteDuration: { latestMs: null, meanMs: null, sampleCount: 0, warn: false },
  };
  const text = formatOverview(metrics, []);
  assert.doesNotMatch(text, /By provider/);
});

test('formatOverview appends a "By provider" line grouped by provider brand, not role', () => {
  const metrics = {
    meanTicketTimeMs: null,
    ticketSampleCount: 0,
    busyness: {},
    retryTotal: 0,
    retryByTicket: {},
    suiteDuration: { latestMs: null, meanMs: null, sampleCount: 0, warn: false },
    providerTelemetry: {
      claude: { chases: 4, nudges: 1, deadLetters: 0, respawns: 0, recentDailyRate: 0.71 },
      aider: { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 },
    },
  };
  const text = formatOverview(metrics, ['coder', 'cleaner'], ['claude', 'aider']);
  const providerLine = text.split('\n').at(-1);
  assert.equal(providerLine, 'By provider: claude 4 chases/1 nudges (0.71/day), aider 0 chases/0 nudges (0.00/day)');
});

test('formatOverview reads an absent providerTelemetry field as zero for a listed provider, never a crash', () => {
  const metrics = {
    meanTicketTimeMs: null,
    ticketSampleCount: 0,
    busyness: {},
    retryTotal: 0,
    retryByTicket: {},
    suiteDuration: { latestMs: null, meanMs: null, sampleCount: 0, warn: false },
    // no providerTelemetry field at all - simulates an older SwarmMetrics object.
  };
  const text = formatOverview(metrics, [], ['claude']);
  const providerLine = text.split('\n').at(-1);
  assert.equal(providerLine, 'By provider: claude 0 chases/0 nudges (0.00/day)');
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
});

// --- formatDeliveryOverview / formatTrend (BL-096) ---
// formatTrend itself is private, but every direction/null-delta branch it
// has is reachable through formatDeliveryOverview's velocity line, so
// exercising it there covers formatTrend without widening the module's
// public surface just for a test seam.

function noSampleTrend() {
  return { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' };
}

function baseDeliveryMetrics(velocityTrend) {
  return {
    velocity: { weeklySeries: [], trend: velocityTrend, rollingWindowCount: 4, rollingWindowDays: 7 },
    burndown: [],
    cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, weeklySeries: [], trend: noSampleTrend() },
    forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
    suiteDurationTrend: { hasLocalData: false, dailySeries: [], trend: noSampleTrend() },
  };
}

test('formatDeliveryOverview on a fresh repo prints "no data" placeholders for every section, never NaN/Infinity/undefined', () => {
  const text = formatDeliveryOverview(baseDeliveryMetrics(noSampleTrend()));
  assert.match(text, /Velocity: 4 closed in trailing 7d/);
  assert.match(text, /Burndown: — \(no milestones\)/);
  assert.match(text, /Cycle time: — \(0 closed\)/);
  assert.match(text, /Forecasts: — \(no open milestone tickets\)/);
  assert.match(text, /Suite duration trend: no local data/);
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
});

test('formatDeliveryOverview omits the trend suffix when direction is unknown (empty or single-point series)', () => {
  const text = formatDeliveryOverview(baseDeliveryMetrics(noSampleTrend()));
  assert.doesNotMatch(text, /vs prior/);
});

test('formatDeliveryOverview marks an upward trend with a + sign and the delta magnitude', () => {
  const trend = { series: [], currentValue: 4, priorValue: 3, delta: 1, direction: 'up' };
  const text = formatDeliveryOverview(baseDeliveryMetrics(trend));
  assert.match(text, /Velocity: 4 closed in trailing 7d \(\+1 vs prior\)/);
});

test('formatDeliveryOverview marks a downward trend with a - sign and the absolute delta magnitude', () => {
  const trend = { series: [], currentValue: 2, priorValue: 5, delta: -3, direction: 'down' };
  const text = formatDeliveryOverview(baseDeliveryMetrics(trend));
  assert.match(text, /Velocity: 4 closed in trailing 7d \(-3 vs prior\)/);
});

test('formatDeliveryOverview marks a flat trend with a ± sign', () => {
  const trend = { series: [], currentValue: 4, priorValue: 4, delta: 0, direction: 'flat' };
  const text = formatDeliveryOverview(baseDeliveryMetrics(trend));
  assert.match(text, /Velocity: 4 closed in trailing 7d \(±0 vs prior\)/);
});

test('formatDeliveryOverview renders populated burndown, cycle time, and forecast sections', () => {
  const metrics = baseDeliveryMetrics(noSampleTrend());
  metrics.burndown = [
    { milestone: 'M1', dailySeries: [], trend: noSampleTrend(), currentRemaining: 3 },
    { milestone: 'M2', dailySeries: [], trend: noSampleTrend(), currentRemaining: 0 },
  ];
  metrics.cycleTime = { medianMs: 32_400_000, p85Ms: 90_000_000, sampleCount: 12, weeklySeries: [], trend: noSampleTrend() };
  metrics.forecasts = {
    tickets: [],
    milestones: [{ milestone: 'M1', p50Iso: '2026-07-15T00:00:00.000Z', p85Iso: '2026-07-20T00:00:00.000Z' }],
    throughputPerDay: 0.5,
  };

  const text = formatDeliveryOverview(metrics);
  // BL-228: the burndown line now also carries each milestone's forecast
  // ETA (M1 has one, M2 does not) and an overall "all remaining work" ETA.
  assert.match(text, /Burndown: M1 3 remaining \(ETA 2026-07-15, p85 2026-07-20\), M2 0 remaining \(no ETA yet\)/);
  assert.match(text, /overall ETA no ETA yet$/m);
  assert.match(text, /Cycle time: median 9h/);
  assert.match(text, /p85/);
  assert.match(text, /over 12 ticket\(s\)/);
  assert.match(text, /Forecasts: M1 p50 2026-07-15 \/ p85 2026-07-20/);
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
});

// --- BL-228: burndown ETA reuses the existing forecast, no new model ---

test('formatDeliveryOverview burndown line shows each milestone forecast ETA next to its remaining count', () => {
  const metrics = baseDeliveryMetrics(noSampleTrend());
  metrics.burndown = [{ milestone: 'M1', dailySeries: [], trend: noSampleTrend(), currentRemaining: 5 }];
  metrics.forecasts = {
    tickets: [{ ticketId: 'BL-1', p50Iso: '2026-08-01T00:00:00.000Z', p85Iso: '2026-08-05T00:00:00.000Z' }],
    milestones: [{ milestone: 'M1', p50Iso: '2026-08-01T00:00:00.000Z', p85Iso: '2026-08-05T00:00:00.000Z' }],
    throughputPerDay: 0.5,
  };
  const text = formatDeliveryOverview(metrics);
  assert.match(text, /Burndown: M1 5 remaining \(ETA 2026-08-01, p85 2026-08-05\) — overall ETA 2026-08-01/);
});

test('formatDeliveryOverview burndown line shows "no ETA yet" for a milestone with no computable forecast, never a fabricated date', () => {
  const metrics = baseDeliveryMetrics(noSampleTrend());
  metrics.burndown = [{ milestone: 'M1', dailySeries: [], trend: noSampleTrend(), currentRemaining: 5 }];
  metrics.forecasts = {
    tickets: [],
    milestones: [{ milestone: 'M1', p50Iso: null, p85Iso: null }],
    throughputPerDay: 0,
  };
  const text = formatDeliveryOverview(metrics);
  assert.match(text, /Burndown: M1 5 remaining \(no ETA yet\) — overall ETA no ETA yet/);
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
});

test('formatDeliveryOverview overall ETA is the latest (max) p50 across every open ticket, not the first or the milestone p50', () => {
  const metrics = baseDeliveryMetrics(noSampleTrend());
  metrics.burndown = [{ milestone: 'M1', dailySeries: [], trend: noSampleTrend(), currentRemaining: 5 }];
  metrics.forecasts = {
    tickets: [
      { ticketId: 'BL-1', p50Iso: '2026-08-01T00:00:00.000Z', p85Iso: null },
      { ticketId: 'BL-2', p50Iso: '2026-09-15T00:00:00.000Z', p85Iso: null },
      { ticketId: 'BL-3', p50Iso: '2026-08-20T00:00:00.000Z', p85Iso: null },
    ],
    milestones: [{ milestone: 'M1', p50Iso: '2026-08-01T00:00:00.000Z', p85Iso: null }],
    throughputPerDay: 0.5,
  };
  const text = formatDeliveryOverview(metrics);
  assert.match(text, /overall ETA 2026-09-15$/m);
});

test('formatDeliveryOverview omits the p85 range when a milestone forecast has no p85 date', () => {
  const metrics = baseDeliveryMetrics(noSampleTrend());
  metrics.burndown = [{ milestone: 'M1', dailySeries: [], trend: noSampleTrend(), currentRemaining: 5 }];
  metrics.forecasts = {
    tickets: [{ ticketId: 'BL-1', p50Iso: '2026-08-01T00:00:00.000Z', p85Iso: null }],
    milestones: [{ milestone: 'M1', p50Iso: '2026-08-01T00:00:00.000Z', p85Iso: null }],
    throughputPerDay: 0.5,
  };
  const text = formatDeliveryOverview(metrics);
  const burndownLine = text.split('\n').find((line) => line.startsWith('Burndown:'));
  assert.equal(burndownLine, 'Burndown: M1 5 remaining (ETA 2026-08-01) — overall ETA 2026-08-01');
});

test('formatDeliveryOverview forecast line falls back to the placeholder when a milestone has no p50/p85 date yet', () => {
  const metrics = baseDeliveryMetrics(noSampleTrend());
  metrics.forecasts = {
    tickets: [],
    milestones: [{ milestone: 'M1', p50Iso: null, p85Iso: null }],
    throughputPerDay: 0,
  };
  const text = formatDeliveryOverview(metrics);
  assert.match(text, /Forecasts: M1 p50 — \/ p85 —/);
});

test('formatDeliveryOverview reports the latest suite-duration sample and its trend when local data exists', () => {
  const metrics = baseDeliveryMetrics(noSampleTrend());
  const trend = { series: [], currentValue: 5000, priorValue: 4000, delta: 1000, direction: 'up' };
  metrics.suiteDurationTrend = {
    hasLocalData: true,
    dailySeries: [{ periodStart: '2026-07-08', value: 4000 }, { periodStart: '2026-07-09', value: 5000 }],
    trend,
  };
  const text = formatDeliveryOverview(metrics);
  assert.match(text, /Suite duration trend: 5s latest \(\+1s vs prior\)/);
});

// --- formatCostTelemetryLine / formatResourceTrendsLine (BL-100) ---

test('formatCostTelemetryLine reports total tokens and cost per role', () => {
  const costTelemetry = {
    coder: {
      byDay: {
        '2026-07-08': { usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 }, costUsd: 0.5 },
        '2026-07-09': { usage: { inputTokens: 200, outputTokens: 75, cacheCreationTokens: 0, cacheReadTokens: 0 }, costUsd: 0.75 },
      },
      byTicket: {},
    },
  };
  const text = formatCostTelemetryLine(costTelemetry, ['coder']);
  assert.equal(text, 'Cost telemetry: coder 425 tok / $1.25');
});

test('formatCostTelemetryLine prints the placeholder for a role with no telemetry at all', () => {
  const text = formatCostTelemetryLine({}, ['coder']);
  assert.equal(text, 'Cost telemetry: coder —');
});

test('formatCostTelemetryLine treats a null costUsd day as $0, not NaN', () => {
  const costTelemetry = {
    coder: {
      byDay: {
        '2026-07-09': { usage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 }, costUsd: null },
      },
      byTicket: {},
    },
  };
  const text = formatCostTelemetryLine(costTelemetry, ['coder']);
  assert.equal(text, 'Cost telemetry: coder 15 tok / $0.00');
  assert.doesNotMatch(text, /NaN/);
});

test('formatResourceTrendsLine reports current RSS in MB and CPU percent per role', () => {
  const resourceTrends = {
    coder: {
      currentRssBytes: 256 * 1024 * 1024,
      currentCpuPercent: 12.345,
      rssSeries: [],
      rssTrend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' },
      cpuSeries: [],
      cpuTrend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' },
    },
  };
  const text = formatResourceTrendsLine(resourceTrends, ['coder']);
  assert.equal(text, 'Resource usage: coder 256MB / 12.3% cpu');
});

test('formatResourceTrendsLine prints the placeholder for a role with no resource samples yet', () => {
  const text = formatResourceTrendsLine({}, ['coder']);
  assert.equal(text, 'Resource usage: coder —');
});

test('formatResourceTrendsLine prints the placeholder when only one of rss/cpu is null', () => {
  const resourceTrends = {
    coder: {
      currentRssBytes: 100 * 1024 * 1024,
      currentCpuPercent: null,
      rssSeries: [],
      rssTrend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' },
      cpuSeries: [],
      cpuTrend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' },
    },
  };
  const text = formatResourceTrendsLine(resourceTrends, ['coder']);
  assert.equal(text, 'Resource usage: coder —');
});

// --- end-to-end: the compiled CLI actually runs headless and exits 0 ---

test('the compiled swarm-metrics CLI runs from a worktree and exits 0 on a fresh repo', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  mkdirp(path.join(root, 'backlog', 'active'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'swarm-metrics.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.match(output, /Mean ticket time: —/);
  assert.doesNotMatch(output, /NaN|Infinity|undefined/);
});

// --- runCliMain: the shared require.main === module bootstrap ---

test('runCliMain runs the given main() and does not exit when it succeeds', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
  let ran = false;

  runCliMain(() => {
    ran = true;
  });

  assert.equal(ran, true);
  assert.equal(exitSpy.mock.calls.length, 0);
  exitSpy.mockRestore();
});

test('runCliMain reports a thrown Error and exits 1 instead of letting it propagate', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  assert.doesNotThrow(() => {
    runCliMain(() => {
      throw new Error('boom');
    });
  });

  assert.equal(errorSpy.mock.calls[0][0], 'Fatal error: boom');
  assert.deepEqual(exitSpy.mock.calls[0], [1]);
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

test('runCliMain reports a non-Error throw via String() and exits 1', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  runCliMain(() => {
    throw 'plain string failure';
  });

  assert.equal(errorSpy.mock.calls[0][0], 'Fatal error: plain string failure');
  assert.deepEqual(exitSpy.mock.calls[0], [1]);
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

// BL-118: an async main (generate-docs-tree.js's translation pass) must
// still be supported without breaking the synchronous tests above.

test('runCliMain awaits an async main() and does not exit when it succeeds', async () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
  let ran = false;

  runCliMain(async () => {
    await Promise.resolve();
    ran = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(ran, true);
  assert.equal(exitSpy.mock.calls.length, 0);
  exitSpy.mockRestore();
});

test('runCliMain reports a rejected async main() and exits 1 instead of an unhandled rejection', async () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  runCliMain(async () => {
    await Promise.resolve();
    throw new Error('async boom');
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(errorSpy.mock.calls[0][0], 'Fatal error: async boom');
  assert.deepEqual(exitSpy.mock.calls[0], [1]);
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});
