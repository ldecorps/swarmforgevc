'use strict';

// BL-432 (epic BL-429 slice 3 - ACT, the mandatory wiring slice): step
// handlers for "the swarm auto-throttles its own intake when it diagnoses
// too much rework". Drives the REAL, compiled/executable artifacts end to
// end - never a re-implementation of the combination logic in JS:
//   - persistReworkSignal (reworkObservatoryStore.js) seeds BL-430's real
//     signal store exactly as the live observatory sweep would.
//   - "the coordinator decides whether to promote the next item" shells to
//     the REAL effective_backlog_depth_cli.bb, the actual entry point
//     coordinator.prompt calls before every promotion - which itself shells
//     to the REAL compiled emit-throttle-recommendation.js (Babashka has no
//     way to import compiled TS). One process boundary crossed exactly the
//     way production crosses it, so this proves the WIRING, not just each
//     language's own half in isolation.
// The fixture's own extension/ is a symlink to this checkout's real,
// already-compiled one (mirrors the Stryker sandbox siblings' own
// cross-directory-symlink convention) - never a copy, never a fake.
//
// BL-1869: emit-throttle-recommendation's main() now refreshes BL-430's
// observatory signal from the fixture's OWN git history before diagnosing
// (51591aab4a) rather than trusting whatever a prior writeSignal() left on
// disk. Scenarios 01-05 build that history directly - tickets closed
// (backlog/active/ -> backlog/done/, the shape suboptimalityVerdictLineCli
// .test.js already uses) within a trailing 14-day live window and a 14-28
// day baseline, bounced ones carrying a backlog/evidence/ file (BL-430's
// own evidenceTicketIdSet OR, never a second "bounced" encoding). Scenario
// 06 pins the regression this hotfix fixes: a persisted diagnosis left on
// disk by an earlier run must not survive a refresh against a live window
// that shows no rework.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const { persistReworkSignal } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'reworkObservatoryStore'));

const DAY_MS = 24 * 60 * 60 * 1000;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConfiguredCap(targetRepo, cap) {
  fs.mkdirSync(path.join(targetRepo, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${cap}\n`);
}

function writeSignal(targetRepo, overrides) {
  persistReworkSignal(targetRepo, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.5, baselineRate: 0.1, topRole: null, topTicketClass: null, ...overrides },
  });
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
}

// BL-1390: prove the fixture root is its OWN git repo before any mutating
// command touches it - never trust a bare mkdtemp dir not to have inherited
// a parent checkout's .git via upward lookup.
function assertOwnGitRoot(targetRepo) {
  const commonDir = execFileSync('git', ['-C', targetRepo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const resolved = path.resolve(targetRepo, commonDir);
  assert.ok(
    resolved.startsWith(path.join(targetRepo, '.git')),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function initFixtureRepo(targetRepo) {
  git(targetRepo, ['init', '-q', '-b', 'main']);
  assertOwnGitRoot(targetRepo);
  git(targetRepo, ['config', 'user.email', 't@t']);
  git(targetRepo, ['config', 'user.name', 't']);
  git(targetRepo, ['commit', '-q', '-m', 'init', '--allow-empty']);
}

function isoDaysAgo(days) {
  // The run's own clock, never a fixed calendar date - a fixed date would
  // drift out of the trailing 14/28-day windows as real time passes.
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

// Records one ticket CLOSED (backlog/done/) at a commit dated `daysAgo`
// days back - loadCompletedTicketRecords (reworkObservatorySource.ts) keys
// the live/baseline window split off this arrival date alone. `bounced`
// commits a backlog/evidence/ file alongside it in the SAME close commit -
// BL-430's own evidenceTicketIdSet OR, the real pipeline's own bounce
// signal, never a second "bounced" encoding invented for this fixture.
// No `mutation_cost:` field - classesByTicket (reworkObservatorySource.ts)
// would read one as the ticket's class, and a SINGLE repeated class across
// every bounced record makes reworkDiagnosis.ts's own describeLikelyCause
// see a concentrated, attributable cause - which classifyRemediationDisposition
// classifies 'escalate-only', so classifyThrottleSeverity returns null and
// the throttle never fires at all. These scenarios are the generic
// no-concentration circuit-breaker case (Article 3.5), so every bounced
// ticket here must carry neither an attributable role nor class.
function closeTicket(ctx, { daysAgo, bounced }) {
  ctx.ticketSeq = (ctx.ticketSeq ?? 0) + 1;
  const id = `BL-${9000 + ctx.ticketSeq}`;
  const dateIso = isoDaysAgo(daysAgo);
  fs.mkdirSync(path.join(ctx.targetRepo, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(ctx.targetRepo, 'backlog', 'done', `${id}.yaml`), `id: ${id}\n`);
  if (bounced) {
    fs.mkdirSync(path.join(ctx.targetRepo, 'backlog', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ctx.targetRepo, 'backlog', 'evidence', `${id}-qa-bounce.md`), 'bounce\n');
  }
  git(ctx.targetRepo, ['add', '.'], dateIso);
  git(ctx.targetRepo, ['commit', '-q', '-m', `close ${id}`], dateIso);
  return id;
}

// Shared by scenarios 01, 04 and 05: baseline (14-28d back) 1 bounced of 3
// closed -> baselineRate 1/3; live window (<14d) 1 bounced of 1 closed ->
// reworkRate 1.0 - 3x baseline, inside classifyThrottleSeverity's own
// (2x, 4x] "degraded" band (reworkDiagnosis.ts), comfortably clear of
// either boundary.
function buildDegradedHistory(ctx) {
  closeTicket(ctx, { daysAgo: 20, bounced: true });
  closeTicket(ctx, { daysAgo: 21, bounced: false });
  closeTicket(ctx, { daysAgo: 22, bounced: false });
  closeTicket(ctx, { daysAgo: 5, bounced: true });
}

// The one place "the coordinator decides whether to promote" actually runs -
// the REAL bb CLI, which itself shells to the REAL node CLI. Returns the
// printed effective cap as a number.
function decidePromotion(ctx) {
  const out = execFileSync('bb', [EFFECTIVE_CLI, ctx.targetRepo], { encoding: 'utf8' });
  ctx.effectiveCap = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(ctx.effectiveCap)) {
    throw new Error(`expected effective_backlog_depth_cli.bb to print an integer, got: ${JSON.stringify(out)}`);
  }
}

function changeLogPath(targetRepo) {
  return path.join(targetRepo, '.swarmforge', 'coordinator', 'throttle-changes.jsonl');
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a configured active-depth cap and a rework diagnosis$/, (ctx) => {
    ctx.targetRepo = mkTmp('bl432-auto-tune-');
    fs.symlinkSync(EXTENSION_DIR, path.join(ctx.targetRepo, 'extension'));
    initFixtureRepo(ctx.targetRepo);
    ctx.ticketSeq = 0;
    ctx.configuredCap = 3;
    writeConfiguredCap(ctx.targetRepo, ctx.configuredCap);
  });

  // ── auto-tune-intake-throttle-01 ────────────────────────────────────────
  registry.define(/^the rework diagnosis is degraded$/, (ctx) => {
    buildDegradedHistory(ctx);
  });

  registry.define(/^the coordinator decides whether to promote the next item$/, (ctx) => decidePromotion(ctx));

  registry.define(/^the effective active-depth cap is one$/, (ctx) => {
    assert.equal(ctx.effectiveCap, 1);
  });

  // ── auto-tune-intake-throttle-02 ────────────────────────────────────────
  registry.define(/^the rework diagnosis is severe$/, (ctx) => {
    // Baseline: 1 bounced of 5 closed -> baselineRate 0.2. Live window: 1
    // bounced of 1 closed -> reworkRate 1.0 - 5x baseline, past
    // SEVERE_BASELINE_MULTIPLIER (4x).
    closeTicket(ctx, { daysAgo: 20, bounced: true });
    closeTicket(ctx, { daysAgo: 21, bounced: false });
    closeTicket(ctx, { daysAgo: 22, bounced: false });
    closeTicket(ctx, { daysAgo: 23, bounced: false });
    closeTicket(ctx, { daysAgo: 24, bounced: false });
    closeTicket(ctx, { daysAgo: 5, bounced: true });
  });

  registry.define(/^the effective active-depth cap is zero$/, (ctx) => {
    assert.equal(ctx.effectiveCap, 0);
  });

  registry.define(/^no new item is promoted$/, (ctx) => {
    // A cap of zero means under-depth-cap? (backlog_depth_lib.bb, already
    // unit-tested in backlog_depth_test_runner.bb) is false for ANY
    // active-count >= 0 - there is no active-count at which zero admits a
    // promotion. Asserted here by definition of the printed value itself,
    // never a second re-derivation of that gate in JS.
    assert.equal(ctx.effectiveCap, 0, 'a cap of zero means the coordinator promotion gate can never open');
  });

  // Shared by auto-tune-intake-throttle-04 (BL-1981 retired scenario 03,
  // 2026-10-05 - a cleared signal no longer restores the cap by itself).
  registry.define(/^the effective active-depth cap is the configured value$/, (ctx) => {
    assert.equal(ctx.effectiveCap, ctx.configuredCap);
  });

  // ── auto-tune-intake-throttle-04 ────────────────────────────────────────
  // A recommendation only ever ranges over {0, 1} (recommendedCapForSeverity's
  // own allowlist), so "above the configured value" is reached the same way
  // the real pipeline reaches it: configure a cap BELOW what a degraded
  // diagnosis would recommend (0 < 1), never a synthetic recommendation the
  // real diagnosis pipeline could not actually produce.
  registry.define(/^a rework diagnosis recommending a cap above the configured value$/, (ctx) => {
    ctx.configuredCap = 0;
    writeConfiguredCap(ctx.targetRepo, ctx.configuredCap);
    buildDegradedHistory(ctx); // degraded -> recommends 1, which is > 0
  });

  // ── auto-tune-intake-throttle-05 ────────────────────────────────────────
  registry.define(/^the rework diagnosis lowers the effective cap$/, (ctx) => {
    buildDegradedHistory(ctx);
  });

  registry.define(/^the effective cap changes$/, (ctx) => decidePromotion(ctx));

  registry.define(/^the change is written to the log with its reason$/, (ctx) => {
    const lines = fs
      .readFileSync(changeLogPath(ctx.targetRepo), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.ok(lines.length >= 1, 'expected at least one change-log entry');
    const last = lines[lines.length - 1];
    assert.equal(last.to, 1);
    assert.ok(typeof last.reason === 'string' && last.reason.length > 0, `expected a non-empty reason, got: ${JSON.stringify(last)}`);
  });

  // ── auto-tune-intake-throttle-06 (added by BL-1869, the refresh-before-diagnose hotfix) ─
  registry.define(/^a persisted rework diagnosis from an earlier run that reads degraded$/, (ctx) => {
    // Exactly what the pre-hotfix fixture looked like: a stale signal
    // written directly to the observatory store, never refreshed against
    // live history.
    writeSignal(ctx.targetRepo, { reworkRate: 0.3, baselineRate: 0.1 });
  });

  registry.define(/^no ticket closed in the live window was bounced$/, (ctx) => {
    // A real baseline sample (so the diagnosis exercises the actual rate
    // comparison, not just the "no baseline" null-guard) plus one live-
    // window close that did NOT bounce. The refresh this ticket relies on
    // must overwrite the stale degraded signal above with THIS live
    // window before emitThrottleRecommendation ever reads it.
    closeTicket(ctx, { daysAgo: 20, bounced: true }); // baseline: rate 1.0
    closeTicket(ctx, { daysAgo: 5, bounced: false }); // live window: rate 0
  });
}

module.exports = { registerSteps };
