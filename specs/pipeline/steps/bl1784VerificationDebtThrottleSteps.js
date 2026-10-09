'use strict';

// BL-1784: step handlers for "an unowned verification-debt category
// throttles intake". Drives the REAL, compiled emit-throttle-recommendation.js
// directly (scenarios 01-03) and the REAL effective_backlog_depth_cli.bb,
// which itself shells to that same compiled module (scenario 04) - never a
// re-implementation of the fold/threshold logic in JS, mirroring
// bl1429StandingRedThrottleSteps.js's own posture for the standing-red
// register. The fixture's own extension/ is a symlink to this checkout's
// real, already-compiled one, same convention as that sibling.

const FEATURE = "BL-1784 An unowned verification-debt category throttles intake";

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const { emitThrottleRecommendation, throttleChangeLogPath } = require(path.join(EXTENSION_DIR, 'out', 'tools', 'emit-throttle-recommendation'));
const { describeVerificationDebtSignal } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'verificationDebtSignal'));
const { persistReworkSignal } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'reworkObservatoryStore'));
const { writeVerificationDebtLedgerFixture, mintCategoryOwner } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'verificationDebtLedgerFixture'));
const { writeStandingRedRegisterFixture } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'standingRedRegisterFixture'));

// The ledger's own default threshold (verification_debt_ledger_lib.bb's
// default-threshold) - the background names it explicitly ("at the default
// threshold of 3"), so this handler never writes a verification_debt_threshold
// conf override; it relies on the library's own documented default.
const DEFAULT_THRESHOLD = 3;

function mkTmp(prefix) {
  return trackedTmpRoot(prefix);
}

function confPath(targetRepo) {
  return path.join(targetRepo, 'swarmforge', 'swarmforge.conf');
}

function readConfLines(targetRepo) {
  try {
    return fs
      .readFileSync(confPath(targetRepo), 'utf8')
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Incremental: replaces only the named key's own line, leaving every other
// already-written key intact (same convention as
// bl1429StandingRedThrottleSteps.js's own writeConfKey).
function writeConfKey(targetRepo, key, value) {
  const lines = readConfLines(targetRepo).filter((l) => !l.startsWith(`config ${key} `));
  lines.push(`config ${key} ${value}`);
  fs.mkdirSync(path.join(targetRepo, 'swarmforge'), { recursive: true });
  fs.writeFileSync(confPath(targetRepo), lines.join('\n') + '\n');
}

function writeLedgerRows(targetRepo, { count, category, settle }) {
  const rows = Array.from({ length: count }, (_, i) => ({
    category,
    ticket: `BL-9${800 + i}`,
    description: `acceptance fixture row ${i}`,
    settle,
  }));
  writeVerificationDebtLedgerFixture(targetRepo, { rows });
}

// "category "<category>" is <state>" - the five states the Examples table
// names, each built at exactly the default threshold (3) except the one
// deliberately one row under it.
function applyCategoryState(targetRepo, category, state) {
  switch (state) {
    case 'at its threshold with no open owner':
      writeLedgerRows(targetRepo, { count: DEFAULT_THRESHOLD, category });
      return;
    case 'at its threshold and owned by an open ticket':
      writeLedgerRows(targetRepo, { count: DEFAULT_THRESHOLD, category });
      mintCategoryOwner(targetRepo, { category, ticket: 'BL-9700' });
      return;
    case 'at its threshold and discharged':
      writeLedgerRows(targetRepo, {
        count: DEFAULT_THRESHOLD,
        category,
        settle: { kind: 'discharge', by: 'hardener', evidence: 'backlog/evidence/fixture.md' },
      });
      return;
    case 'at its threshold and waived':
      writeLedgerRows(targetRepo, { count: DEFAULT_THRESHOLD, category, settle: { kind: 'waive', by: 'specifier', reason: 'fixture: superseded' } });
      return;
    case 'one row under its threshold':
      writeLedgerRows(targetRepo, { count: DEFAULT_THRESHOLD - 1, category });
      return;
    default:
      throw new Error(`unrecognised category state: "${state}"`);
  }
}

function applyOtherSignal(targetRepo, signal) {
  switch (signal) {
    case 'a rework diagnosis that recommends a cap of 0':
      persistReworkSignal(targetRepo, {
        kind: 'rework-rate',
        version: 1,
        computedAtIso: '2026-07-16T00:00:00Z',
        signal: { hasSample: true, sampleCount: 10, reworkRate: 0.5, baselineRate: 0.1, topRole: null, topTicketClass: null }, // past 4x baseline: severe -> 0
      });
      return;
    case 'an unowned standing red':
      writeStandingRedRegisterFixture(targetRepo, { count: 3, oldestAgeDays: 2, unownedCount: 1, filePrefix: 'bl1784-acceptance-standing-red-fixture' });
      return;
    default:
      throw new Error(`unrecognised other signal: "${signal}"`);
  }
}

function readChangeLogLines(targetRepo) {
  try {
    return fs
      .readFileSync(throttleChangeLogPath(targetRepo), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// The one place "the effective backlog depth is resolved" actually runs -
// the REAL bb CLI, which itself shells to the REAL compiled node CLI.
function runEffectiveDepthCli(ctx) {
  const out = execFileSync('bb', [EFFECTIVE_CLI, ctx.targetRepo], { encoding: 'utf8' });
  ctx.effectiveCap = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(ctx.effectiveCap)) {
    throw new Error(`expected effective_backlog_depth_cli.bb to print an integer, got: ${JSON.stringify(out)}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    new RegExp(
      "^a fixture root with a throttle recommendation store, an empty standing-red register, no rework signal and a verification-debt ledger at the default threshold of 3$"
    ),
    (ctx) => {
      ctx.targetRepo = mkTmp('bl1784-verification-debt-throttle-');
      fs.symlinkSync(EXTENSION_DIR, path.join(ctx.targetRepo, 'extension'));
      // Empty standing-red register and no rework signal/ledger file at
      // all yet - every one of those degrades to "no signal" by absence,
      // matching each reader's own documented behaviour.
      writeStandingRedRegisterFixture(ctx.targetRepo, { count: 0, oldestAgeDays: 0, unownedCount: 0, filePrefix: 'bl1784-acceptance-empty-register' });
    }
  );

  // ── the-unowned-category-recommends-a-cap-of-one-01 (Scenario Outline),
  //    also reused verbatim by scenarios 02 and 04 ───────────────────────
  scoped(new RegExp('^category "(.+?)" is (.+?)$'), (ctx, category, state) => {
    applyCategoryState(ctx.targetRepo, category, state);
  });

  scoped(new RegExp('^the throttle recommendation is emitted$'), (ctx) => {
    ctx.rec = emitThrottleRecommendation(ctx.targetRepo);
  });

  scoped(new RegExp('^the recommended cap is (.+?)$'), (ctx, cap) => {
    assert.equal(ctx.rec.recommendedCap, cap === 'none' ? null : Number(cap));
  });

  // Reads the PERSISTED recommendation's own verificationDebt field
  // directly - this is what "the recorded reason" names, independent of
  // whether this particular call happened to change the log.
  scoped(new RegExp('^the recorded reason names (.+?)$'), (ctx, signalText) => {
    if (signalText === 'no verification-debt signal') {
      assert.equal(ctx.rec.verificationDebt, null, `expected no verification-debt signal, got: ${JSON.stringify(ctx.rec.verificationDebt)}`);
      return;
    }
    assert.ok(ctx.rec.verificationDebt, `expected a verification-debt signal naming "${signalText}", got none`);
    assert.equal(describeVerificationDebtSignal(ctx.rec.verificationDebt.categories), signalText);
  });

  // ── the-lowest-recommendation-wins-02 (Scenario Outline's <other signal>
  //    column - a closed set of exactly the two Examples values, never a
  //    bare catch-all, so it can never shadow a later, unrelated step) ────
  scoped(new RegExp('^(a rework diagnosis that recommends a cap of 0|an unowned standing red)$'), (ctx, signal) => {
    applyOtherSignal(ctx.targetRepo, signal);
  });

  // ── minting-an-owner-withdraws-the-recommendation-03 ────────────────────
  scoped(new RegExp('^a prior recommendation of 1 caused by the verification-debt category "land-path-ownership"$'), (ctx) => {
    writeLedgerRows(ctx.targetRepo, { count: DEFAULT_THRESHOLD, category: 'land-path-ownership' });
    const baked = emitThrottleRecommendation(ctx.targetRepo);
    assert.equal(baked.recommendedCap, 1, 'setup: expected the verification-debt-caused recommendation already in effect');
  });

  scoped(new RegExp('^a ticket in backlog/paused now declares "verification_category: land-path-ownership"$'), (ctx) => {
    mintCategoryOwner(ctx.targetRepo, { category: 'land-path-ownership', ticket: 'BL-9700', dir: 'paused' });
  });

  scoped(new RegExp('^the recommendation is withdrawn$'), (ctx) => {
    assert.equal(ctx.rec.recommendedCap, null);
  });

  scoped(new RegExp('^the change from 1 to none is logged naming the verification-debt category "land-path-ownership" as cleared$'), (ctx) => {
    const lines = readChangeLogLines(ctx.targetRepo);
    assert.ok(lines.length >= 1, 'expected at least one change-log entry');
    const last = lines[lines.length - 1];
    assert.equal(last.from, 1);
    assert.equal(last.to, null);
    assert.ok(
      last.reason.includes(describeVerificationDebtSignal(['land-path-ownership'])) && /clear/.test(last.reason),
      `expected the clearing reason to name the category as cleared, got: ${last.reason}`
    );
  });

  // ── the-effective-depth-the-coordinator-reads-folds-the-signal-04 ──────
  scoped(new RegExp('^swarmforge\\.conf sets active_backlog_max_depth to 3$'), (ctx) => {
    writeConfKey(ctx.targetRepo, 'active_backlog_max_depth', 3);
  });

  scoped(new RegExp('^the effective backlog depth is resolved$'), (ctx) => runEffectiveDepthCli(ctx));

  scoped(new RegExp('^it prints 1$'), (ctx) => {
    assert.equal(ctx.effectiveCap, 1);
  });
}

module.exports = { registerSteps };
