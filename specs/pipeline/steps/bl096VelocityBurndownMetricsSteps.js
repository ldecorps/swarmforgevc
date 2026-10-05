'use strict';

// BL-1937: step handlers for BL-096's delivery-metrics feature, closed in
// July with no step handler - 8/8 scenarios failed "no step handler
// matched" on main (QA's standing red, note 003788). Drives the REAL
// compiled modules (extension/out/metrics/deliveryMetrics.js,
// gitHistoryAdapter.js, swarmMetrics.js, out/panel/backlogReader.js) and,
// for metrics-09, the real bridge server plus the swarm-metrics CLI's own
// formatter/computation - never a restatement of any of them.
//
// Every handler that touches git builds a real, disposable fixture repo
// under a tracked mkdtemp root (fixtureReaper's trackedTmpRoot, or
// socketFixtureRoot's mkSocketFixtureRoot for metrics-09's bridge), seeded
// from the shared template (BL-1039's copySeededRepoInto) and proven
// inside the fixture root (git rev-parse --git-common-dir) before any
// mutating git command - this checkout's own git/backlog/.swarmforge is
// never read or written (BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { trackedTmpRoot } = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { copySeededRepoInto } = require(path.join(EXT_DIR, 'test', 'helpers', 'sharedRepoFixture'));

// BL-1687 shape: paths resolved once, modules required lazily on first use
// so a mere require() of this file never pays for the whole bridge graph.
let _deliveryMetrics = null;
function deliveryMetrics() {
  if (!_deliveryMetrics) _deliveryMetrics = require(path.join(EXT_DIR, 'out', 'metrics', 'deliveryMetrics'));
  return _deliveryMetrics;
}
let _gitHistoryAdapter = null;
function gitHistoryAdapter() {
  if (!_gitHistoryAdapter) _gitHistoryAdapter = require(path.join(EXT_DIR, 'out', 'metrics', 'gitHistoryAdapter'));
  return _gitHistoryAdapter;
}
let _backlogReader = null;
function backlogReader() {
  if (!_backlogReader) _backlogReader = require(path.join(EXT_DIR, 'out', 'panel', 'backlogReader'));
  return _backlogReader;
}
let _swarmMetricsTool = null;
function swarmMetricsTool() {
  if (!_swarmMetricsTool) _swarmMetricsTool = require(path.join(EXT_DIR, 'out', 'tools', 'swarm-metrics'));
  return _swarmMetricsTool;
}
let _bridgeServer = null;
function bridgeServer() {
  if (!_bridgeServer) _bridgeServer = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
  return _bridgeServer;
}

const FEATURE = 'delivery metrics computed from repo history and exposed via endpoint/CLI';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// BL-1390: proves a fixture root is its own, standalone repo before any
// mutating git command ever runs against it.
function mkGitFixtureRoot(prefix) {
  const root = trackedTmpRoot(prefix);
  copySeededRepoInto(root);
  const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
  return root;
}

function writeTicket(root, folder, id, yamlBody) {
  mkdirp(path.join(root, 'backlog', folder));
  fs.writeFileSync(path.join(root, 'backlog', folder, `${id}.yaml`), yamlBody);
}

function weekBucketIso(iso) {
  return new Date(Math.floor(Date.parse(iso) / WEEK_MS) * WEEK_MS).toISOString();
}

function dayBucketIso(iso) {
  return new Date(Math.floor(Date.parse(iso) / DAY_MS) * DAY_MS).toISOString();
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── metrics-01 ────────────────────────────────────────────────────────
  scoped(/^a repo whose history contains tickets closed into done\/ on known dates$/, (ctx) => {
    const root = mkGitFixtureRoot('sfvc-bl096-velocity-');
    writeTicket(root, 'active', 'BL-201', 'id: BL-201\ntitle: t\nstatus: active\n');
    writeTicket(root, 'active', 'BL-202', 'id: BL-202\ntitle: t\nstatus: active\n');
    writeTicket(root, 'active', 'BL-203', 'id: BL-203\ntitle: t\nstatus: active\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'spec BL-201/202/203'], '2026-01-01T08:00:00');

    mkdirp(path.join(root, 'backlog', 'done'));
    git(root, ['mv', 'backlog/active/BL-201.yaml', 'backlog/done/BL-201.yaml']);
    git(root, ['commit', '-q', '-m', 'close BL-201'], '2026-01-05T08:00:00'); // week A
    git(root, ['mv', 'backlog/active/BL-202.yaml', 'backlog/done/BL-202.yaml']);
    git(root, ['commit', '-q', '-m', 'close BL-202'], '2026-01-06T08:00:00'); // same week A
    git(root, ['mv', 'backlog/active/BL-203.yaml', 'backlog/done/BL-203.yaml']);
    git(root, ['commit', '-q', '-m', 'close BL-203'], '2026-01-20T08:00:00'); // a later week

    ctx.bl096 = { root, nowMs: Date.parse('2026-02-01T00:00:00Z') };
  });

  scoped(/^the velocity series is computed$/, (ctx) => {
    const { runGitLog, deriveTicketLifecycles } = gitHistoryAdapter();
    const { computeVelocity } = deliveryMetrics();
    const history = runGitLog(ctx.bl096.root, 'backlog');
    const lifecycles = [...deriveTicketLifecycles(history).values()];
    ctx.bl096.velocityA = computeVelocity(lifecycles, ctx.bl096.nowMs);
    ctx.bl096.velocityB = computeVelocity(lifecycles, ctx.bl096.nowMs);
  });

  scoped(/^each time bucket's count equals the closes git records for it$/, (ctx) => {
    const weekA = ctx.bl096.velocityA.weeklySeries.find((p) => p.periodStart === weekBucketIso('2026-01-05T08:00:00Z'));
    const weekB = ctx.bl096.velocityA.weeklySeries.find((p) => p.periodStart === weekBucketIso('2026-01-20T08:00:00Z'));
    assert.ok(weekA, 'expected a bucket for the week of the first two closes');
    assert.equal(weekA.value, 2, 'BL-201 and BL-202 both closed in the same git-recorded week');
    assert.ok(weekB, 'expected a bucket for the week of the third close');
    assert.equal(weekB.value, 1, 'BL-203 closed in its own git-recorded week');
  });

  scoped(/^recomputing on the same history yields the identical series$/, (ctx) => {
    assert.deepEqual(ctx.bl096.velocityA, ctx.bl096.velocityB);
  });

  // ── metrics-02 ────────────────────────────────────────────────────────
  scoped(/^a milestone whose tickets were specced and closed across history$/, (ctx) => {
    const root = mkGitFixtureRoot('sfvc-bl096-burndown-');
    writeTicket(root, 'active', 'BL-301', 'id: BL-301\ntitle: t\nstatus: active\nmilestone: M9\n');
    writeTicket(root, 'active', 'BL-302', 'id: BL-302\ntitle: t\nstatus: active\nmilestone: M9\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'spec BL-301/302'], '2026-03-01T08:00:00');

    mkdirp(path.join(root, 'backlog', 'done'));
    git(root, ['mv', 'backlog/active/BL-301.yaml', 'backlog/done/BL-301.yaml']);
    git(root, ['commit', '-q', '-m', 'close BL-301'], '2026-03-10T08:00:00');
    // BL-302 stays open, in the live backlog/active/ folder.

    ctx.bl096 = { root, nowMs: Date.parse('2026-03-20T00:00:00Z') };
  });

  scoped(/^its burndown series is computed$/, (ctx) => {
    const { runGitLog, deriveTicketLifecycles } = gitHistoryAdapter();
    const { computeBurndown } = deliveryMetrics();
    const { readBacklogFolders } = backlogReader();
    const history = runGitLog(ctx.bl096.root, 'backlog');
    const lifecycles = [...deriveTicketLifecycles(history).values()];
    const folders = readBacklogFolders(ctx.bl096.root);
    const milestoneByTicketId = new Map();
    for (const item of [...folders.active, ...folders.paused, ...folders.done]) {
      if (item.milestone) milestoneByTicketId.set(item.id, item.milestone);
    }
    ctx.bl096.burndown = computeBurndown(lifecycles, milestoneByTicketId, ctx.bl096.nowMs).find((b) => b.milestone === 'M9');
    ctx.bl096.folders = folders;
  });

  scoped(/^each point equals that date's remaining open-ticket count for the milestone$/, (ctx) => {
    const beforeClose = ctx.bl096.burndown.dailySeries.find((p) => p.periodStart === dayBucketIso('2026-03-05T00:00:00Z'));
    const afterClose = ctx.bl096.burndown.dailySeries.find((p) => p.periodStart === dayBucketIso('2026-03-15T00:00:00Z'));
    assert.ok(beforeClose && afterClose, 'expected daily points both before and after the close');
    assert.equal(beforeClose.value, 2, 'both tickets specced and neither closed yet');
    assert.equal(afterClose.value, 1, 'BL-301 closed, BL-302 remains');
  });

  scoped(/^the final point matches the current backlog folder state$/, (ctx) => {
    const last = ctx.bl096.burndown.dailySeries[ctx.bl096.burndown.dailySeries.length - 1];
    assert.equal(last.value, ctx.bl096.burndown.currentRemaining);
    const liveOpenCount =
      ctx.bl096.folders.active.filter((i) => i.milestone === 'M9').length +
      ctx.bl096.folders.paused.filter((i) => i.milestone === 'M9').length;
    assert.equal(
      ctx.bl096.burndown.currentRemaining,
      liveOpenCount,
      'currentRemaining must match the live backlog/ folder state, not a git-history count'
    );
  });

  // ── metrics-03 ────────────────────────────────────────────────────────
  scoped(/^a ticket specced at one commit date and closed at a later one$/, (ctx) => {
    ctx.bl096 = {
      nowMs: Date.parse('2026-04-20T00:00:00Z'),
      lifecycles: [
        { ticketId: 'BL-401', specDateIso: '2026-04-01T00:00:00Z', closeDateIso: '2026-04-06T00:00:00Z' }, // 5 days
        { ticketId: 'BL-402', specDateIso: '2026-04-01T00:00:00Z', closeDateIso: '2026-04-11T00:00:00Z' }, // 10 days
        { ticketId: 'BL-403', specDateIso: '2026-04-01T00:00:00Z', closeDateIso: '2026-04-16T00:00:00Z' }, // 15 days
      ],
    };
  });

  scoped(/^cycle-time metrics are computed$/, (ctx) => {
    const { computeCycleTime } = deliveryMetrics();
    ctx.bl096.cycleTime = computeCycleTime(ctx.bl096.lifecycles, ctx.bl096.nowMs);
  });

  scoped(/^that ticket contributes the spec-to-close duration$/, (ctx) => {
    assert.equal(ctx.bl096.cycleTime.sampleCount, 3);
    assert.equal(ctx.bl096.cycleTime.medianMs, 10 * DAY_MS, "BL-402's 10-day duration is the median of 5/10/15 days");
  });

  scoped(/^the reported median\/percentiles reflect the recent closed set$/, (ctx) => {
    assert.ok(ctx.bl096.cycleTime.medianMs !== null);
    assert.ok(ctx.bl096.cycleTime.p85Ms !== null);
    assert.ok(ctx.bl096.cycleTime.p85Ms >= ctx.bl096.cycleTime.medianMs, 'p85 must be at or above the median');
  });

  // ── metrics-08 ────────────────────────────────────────────────────────
  scoped(/^historical closes and a current open queue with dependencies$/, (ctx) => {
    ctx.bl096 = {
      nowMs: Date.parse('2026-05-15T00:00:00Z'),
      lifecycles: [
        { ticketId: 'BL-500', specDateIso: '2026-05-01T00:00:00Z', closeDateIso: '2026-05-06T00:00:00Z' },
        { ticketId: 'BL-501', specDateIso: '2026-05-01T00:00:00Z', closeDateIso: '2026-05-04T00:00:00Z' },
      ],
      openTickets: [
        { ticketId: 'BL-510', milestone: 'M10', priority: 1, dependsOn: [] },
        { ticketId: 'BL-511', milestone: 'M10', priority: 2, dependsOn: ['BL-510'] },
      ],
    };
  });

  scoped(/^forecasts are computed$/, (ctx) => {
    const { computeForecasts } = deliveryMetrics();
    ctx.bl096.forecasts = computeForecasts(ctx.bl096.lifecycles, ctx.bl096.openTickets, ctx.bl096.nowMs);
  });

  scoped(/^each open ticket reports p50 and p85 estimated delivery dates$/, (ctx) => {
    for (const t of ctx.bl096.forecasts.tickets) {
      assert.ok(t.p50Iso, `${t.ticketId} must carry a p50 date`);
      assert.ok(t.p85Iso, `${t.ticketId} must carry a p85 date`);
      assert.ok(Date.parse(t.p85Iso) >= Date.parse(t.p50Iso), `${t.ticketId}'s p85 must be at or after its p50`);
    }
  });

  scoped(/^no ticket's dates precede those of its depends_on tickets$/, (ctx) => {
    const byId = new Map(ctx.bl096.forecasts.tickets.map((t) => [t.ticketId, t]));
    const dependent = byId.get('BL-511');
    const dependency = byId.get('BL-510');
    assert.ok(Date.parse(dependent.p50Iso) >= Date.parse(dependency.p50Iso), 'BL-511 depends on BL-510 and must not forecast earlier');
    assert.ok(Date.parse(dependent.p85Iso) >= Date.parse(dependency.p85Iso));
  });

  scoped(/^each milestone reports the dates of its last-forecast ticket$/, (ctx) => {
    const m10 = ctx.bl096.forecasts.milestones.find((m) => m.milestone === 'M10');
    const dependent = ctx.bl096.forecasts.tickets.find((t) => t.ticketId === 'BL-511');
    assert.ok(m10);
    assert.equal(m10.p50Iso, dependent.p50Iso, "the milestone date is its own latest-forecast member's date");
  });

  // ── metrics-06 ────────────────────────────────────────────────────────
  scoped(/^at least two windows of history exist for a metric$/, (ctx) => {
    ctx.bl096 = {
      nowMs: Date.parse('2026-06-10T12:00:00Z'),
      lifecycles: [
        { ticketId: 'BL-600', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: '2026-06-02T00:00:00Z' }, // earlier week
        { ticketId: 'BL-601', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: '2026-06-09T00:00:00Z' }, // next week (exactly WEEK_MS later)
        { ticketId: 'BL-602', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: '2026-06-10T00:00:00Z' }, // same week as BL-601
      ],
    };
  });

  scoped(/^the metrics surface is queried$/, (ctx) => {
    const { computeVelocity, computeCycleTime } = deliveryMetrics();
    ctx.bl096.velocity = computeVelocity(ctx.bl096.lifecycles, ctx.bl096.nowMs);
    ctx.bl096.cycleTime = computeCycleTime(ctx.bl096.lifecycles, ctx.bl096.nowMs);
  });

  scoped(
    /^each metric reports its series, current-window value, and the delta and direction versus the prior window$/,
    (ctx) => {
      for (const trend of [ctx.bl096.velocity.trend, ctx.bl096.cycleTime.trend]) {
        assert.ok(trend.series.length >= 2, 'expected at least two windows in the series');
        assert.notEqual(trend.currentValue, null);
        assert.notEqual(trend.priorValue, null);
        assert.notEqual(trend.delta, null);
        assert.ok(['up', 'down', 'flat'].includes(trend.direction), `expected a real direction, got ${trend.direction}`);
      }
    }
  );

  // ── metrics-07 ────────────────────────────────────────────────────────
  scoped(/^an extension\/\.test-durations\.jsonl with runs across several days$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl096-suite-trend-');
    mkdirp(path.join(root, 'extension'));
    const lines = [
      { finished_at: '2026-07-01T10:00:00.000Z', duration_ms: 100000 },
      { finished_at: '2026-07-02T10:00:00.000Z', duration_ms: 120000 },
      { finished_at: '2026-07-03T10:00:00.000Z', duration_ms: 140000 },
    ];
    fs.writeFileSync(
      path.join(root, 'extension', '.test-durations.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
    );
    ctx.bl096 = {
      root,
      emptyRoot: trackedTmpRoot('sfvc-bl096-suite-trend-empty-'),
      nowMs: Date.parse('2026-07-04T00:00:00Z'),
    };
  });

  scoped(/^the metrics surface is queried locally$/, (ctx) => {
    const { computeSuiteDurationTrend } = deliveryMetrics();
    ctx.bl096.trend = computeSuiteDurationTrend(ctx.bl096.root, [], ctx.bl096.nowMs);
    ctx.bl096.emptyTrend = computeSuiteDurationTrend(ctx.bl096.emptyRoot, [], ctx.bl096.nowMs);
  });

  scoped(/^a test-suite duration series and trend are reported$/, (ctx) => {
    assert.equal(ctx.bl096.trend.hasLocalData, true);
    assert.equal(ctx.bl096.trend.dailySeries.length, 3);
    assert.notEqual(ctx.bl096.trend.trend.direction, 'unknown');
  });

  scoped(/^a machine without the file reports "no local data" without error$/, (ctx) => {
    assert.equal(ctx.bl096.emptyTrend.hasLocalData, false);
    assert.deepEqual(ctx.bl096.emptyTrend.dailySeries, []);
  });

  // ── metrics-09 ────────────────────────────────────────────────────────
  const TOKEN = 'bl096-metrics-token';

  scoped(/^the metrics have been computed$/, async (ctx) => {
    const root = mkSocketFixtureRoot('sfvc-bl096-bridge-');
    copySeededRepoInto(root);
    writeTicket(root, 'active', 'BL-701', 'id: BL-701\ntitle: t\nstatus: active\nmilestone: M11\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'spec BL-701'], '2026-08-01T08:00:00');

    ctx.bl096 = { root };
    ctx.bl096.bridge = await bridgeServer().startBridge(root, path.join(root, 'runs.jsonl'), TOKEN, {});
  });

  scoped(/^the bridge endpoint is queried with the bearer token$/, async (ctx) => {
    ctx.bl096.authedResponse = await fetch(`http://127.0.0.1:${ctx.bl096.bridge.port}/metrics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    ctx.bl096.authedBody = await ctx.bl096.authedResponse.json();
  });

  scoped(/^it returns the series, current values, trends, and forecasts as JSON$/, (ctx) => {
    assert.equal(ctx.bl096.authedResponse.status, 200);
    assert.ok(Array.isArray(ctx.bl096.authedBody.velocity.weeklySeries));
    assert.ok(ctx.bl096.authedBody.velocity.trend);
    assert.ok(Array.isArray(ctx.bl096.authedBody.forecasts.tickets));
  });

  scoped(/^the endpoint rejects requests without the bearer token$/, async (ctx) => {
    const res = await fetch(`http://127.0.0.1:${ctx.bl096.bridge.port}/metrics`);
    assert.equal(res.status, 401);
  });

  scoped(/^the metrics CLI reports the same numbers$/, (ctx) => {
    // Called here, right after the endpoint's own response, to keep the
    // two Date.now()-based computations (the live route's and this one's)
    // as close together in wall-clock time as possible - both bucket by
    // day/week, so a gap of milliseconds can never land them in different
    // buckets.
    // swarm-metrics.ts imports computeDeliveryMetrics from deliveryMetrics
    // but never re-exports it (it is not this ticket's to add - no
    // extension/src change). Call the same function the CLI module itself
    // calls, straight from its source.
    const { computeDeliveryMetrics } = deliveryMetrics();
    const { formatDeliveryOverview } = swarmMetricsTool();
    const cliMetrics = computeDeliveryMetrics(ctx.bl096.root, []);
    assert.deepEqual(
      ctx.bl096.authedBody,
      JSON.parse(JSON.stringify(cliMetrics)),
      'the bridge endpoint and the CLI computation must report the same numbers'
    );
    assert.ok(formatDeliveryOverview(cliMetrics).length > 0);
    ctx.bl096.bridge.stop();
  });

  // ── metrics-05 ────────────────────────────────────────────────────────
  scoped(/^metrics are computed twice with no intervening git changes$/, (ctx) => {
    const root = mkGitFixtureRoot('sfvc-bl096-noop-');
    writeTicket(root, 'active', 'BL-801', 'id: BL-801\ntitle: t\nstatus: active\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'spec BL-801'], '2026-09-01T08:00:00');

    const { computeDeliveryMetrics } = deliveryMetrics();
    const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
    const nowMs = Date.parse('2026-09-10T00:00:00Z');
    computeDeliveryMetrics(root, [], nowMs);
    computeDeliveryMetrics(root, [], nowMs);
    const after = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });

    ctx.bl096 = { before, after };
  });

  scoped(/^no file in the repo or \.swarmforge\/ was created or modified by the computation$/, (ctx) => {
    assert.equal(ctx.bl096.before, '', 'fixture setup must itself be clean before the computation runs');
    assert.equal(ctx.bl096.after, '', 'the computation must create or modify no tracked or untracked file');
  });
}

module.exports = { registerSteps };
