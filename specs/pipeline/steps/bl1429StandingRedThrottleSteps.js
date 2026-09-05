'use strict';

// BL-1429: step handlers for "standing reds throttle intake". Drives the
// REAL, compiled emit-throttle-recommendation.js directly (scenarios 01-04)
// and the REAL effective_backlog_depth_cli.bb, which itself shells to that
// same compiled module (scenario 05) - never a re-implementation of the
// fold/threshold logic in JS. The fixture's own extension/ is a symlink to
// this checkout's real, already-compiled one, same convention as
// bl432AutoTuneIntakeThrottleSteps.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const { emitThrottleRecommendation, throttleChangeLogPath } = require(path.join(EXTENSION_DIR, 'out', 'tools', 'emit-throttle-recommendation'));
const { describeStandingRedSignal } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'standingRedSignal'));
const { persistReworkSignal } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'reworkObservatoryStore'));
const { writeStandingRedRegisterFixture } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'standingRedRegisterFixture'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
// already-written key intact - scenario 04 sets two keys across two Given
// steps, scenario 05 sets a third key that must not clobber either.
function writeConfKey(targetRepo, key, value) {
  const lines = readConfLines(targetRepo).filter((l) => !l.startsWith(`config ${key} `));
  lines.push(`config ${key} ${value}`);
  fs.mkdirSync(path.join(targetRepo, 'swarmforge'), { recursive: true });
  fs.writeFileSync(confPath(targetRepo), lines.join('\n') + '\n');
}

function writeRegisterFixture(targetRepo, opts) {
  writeStandingRedRegisterFixture(targetRepo, { ...opts, filePrefix: 'bl1429-acceptance-fixture' });
}

function writeReworkSignal(targetRepo, { reworkRate, baselineRate }) {
  persistReworkSignal(targetRepo, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate, baselineRate, topRole: null, topTicketClass: null },
  });
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

// The one place "effective_backlog_depth_cli.bb runs" actually runs - the
// REAL bb CLI, which itself shells to the REAL compiled node CLI.
function runEffectiveDepthCli(ctx) {
  const out = execFileSync('bb', [EFFECTIVE_CLI, ctx.targetRepo], { encoding: 'utf8' });
  ctx.effectiveCap = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(ctx.effectiveCap)) {
    throw new Error(`expected effective_backlog_depth_cli.bb to print an integer, got: ${JSON.stringify(out)}`);
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^a fixture root with a throttle recommendation store, a standing-red register and a swarmforge\.conf with the default thresholds$/,
    (ctx) => {
      ctx.targetRepo = mkTmp('bl1429-standing-red-throttle-');
      fs.symlinkSync(EXTENSION_DIR, path.join(ctx.targetRepo, 'extension'));
      // Empty register (no rows) - the coordinator state dir and any conf
      // file are left absent entirely, so "default thresholds" holds by
      // absence, matching readStandingRedThresholds's own documented
      // degrade-to-default behaviour.
      writeRegisterFixture(ctx.targetRepo, { count: 0, oldestAgeDays: 0, unownedCount: 0 });
    }
  );

  // ── the-register-recommends-a-cap-01 (Scenario Outline) ────────────────
  registry.define(/^the register reports (\d+) reds, an oldest age of (\d+) days and (\d+) unowned$/, (ctx, count, age, unowned) => {
    writeRegisterFixture(ctx.targetRepo, { count: Number(count), oldestAgeDays: Number(age), unownedCount: Number(unowned) });
  });

  registry.define(/^the throttle recommendation is emitted$/, (ctx) => {
    ctx.rec = emitThrottleRecommendation(ctx.targetRepo);
  });

  registry.define(/^the recommended cap is (none|\d+)$/, (ctx, cap) => {
    assert.equal(ctx.rec.recommendedCap, cap === 'none' ? null : Number(cap));
  });

  // Reads the PERSISTED recommendation's own standingRed field directly -
  // this is what "the recorded reason" names, independent of whether this
  // particular call happened to change the log (a first-ever "no signal"
  // call writes no log line at all, yet still has a recorded, checkable
  // reason: "no standing-red signal").
  registry.define(/^the recorded reason names (.+)$/, (ctx, signalText) => {
    if (signalText === 'no standing-red signal') {
      assert.equal(ctx.rec.standingRed, null, `expected no standing-red signal, got: ${JSON.stringify(ctx.rec.standingRed)}`);
      return;
    }
    assert.ok(ctx.rec.standingRed, `expected a standing-red signal naming "${signalText}", got none`);
    assert.equal(describeStandingRedSignal(ctx.rec.standingRed.signal), signalText);
  });

  // ── the-lower-recommendation-wins-02 ────────────────────────────────────
  registry.define(/^a rework diagnosis that recommends a cap of 0$/, (ctx) => {
    writeReworkSignal(ctx.targetRepo, { reworkRate: 0.5, baselineRate: 0.1 }); // past 4x baseline: severe -> 0
  });

  registry.define(/^the register is over the count threshold alone$/, (ctx) => {
    writeRegisterFixture(ctx.targetRepo, { count: 15, oldestAgeDays: 2, unownedCount: 0 });
  });

  registry.define(/^the emitted recommendation is the rework diagnosis's 0$/, (ctx) => {
    assert.equal(ctx.rec.recommendedCap, 0);
  });

  // ── recovery-withdraws-the-recommendation-03 ────────────────────────────
  registry.define(/^a prior recommendation of 1 caused by the red count$/, (ctx) => {
    writeRegisterFixture(ctx.targetRepo, { count: 15, oldestAgeDays: 2, unownedCount: 0 });
    const baked = emitThrottleRecommendation(ctx.targetRepo);
    assert.equal(baked.recommendedCap, 1, 'setup: expected the count-caused recommendation already in effect');
  });

  registry.define(/^the register has fallen back under every threshold$/, (ctx) => {
    writeRegisterFixture(ctx.targetRepo, { count: 3, oldestAgeDays: 2, unownedCount: 0 });
  });

  registry.define(/^the recommendation is withdrawn$/, (ctx) => {
    assert.equal(ctx.rec.recommendedCap, null);
  });

  registry.define(/^the change from 1 to none is logged naming the red count as cleared$/, (ctx) => {
    const lines = readChangeLogLines(ctx.targetRepo);
    assert.ok(lines.length >= 1, 'expected at least one change-log entry');
    const last = lines[lines.length - 1];
    assert.equal(last.from, 1);
    assert.equal(last.to, null);
    assert.ok(
      last.reason.includes(describeStandingRedSignal('count')) && /clear/.test(last.reason),
      `expected the clearing reason to name the red count as cleared, got: ${last.reason}`
    );
  });

  // ── thresholds-come-from-the-conf-04 ────────────────────────────────────
  registry.define(/^the swarmforge\.conf sets standing_red_max_count to (\d+) and standing_red_max_age_days to (\d+)$/, (ctx, maxCount, maxAgeDays) => {
    writeConfKey(ctx.targetRepo, 'standing_red_max_count', Number(maxCount));
    writeConfKey(ctx.targetRepo, 'standing_red_max_age_days', Number(maxAgeDays));
  });

  registry.define(/^the register would cross both default thresholds but neither raised one$/, (ctx) => {
    // 15 > default max-count (10) but <= the configured 30; 10 > default
    // max-age (7) but <= the configured 14.
    writeRegisterFixture(ctx.targetRepo, { count: 15, oldestAgeDays: 10, unownedCount: 0 });
  });

  registry.define(/^no standing-red recommendation is made$/, (ctx) => {
    assert.equal(ctx.rec.standingRed, null);
    assert.equal(ctx.rec.recommendedCap, null);
  });

  // ── the-effective-depth-folds-the-register-05 ───────────────────────────
  registry.define(/^a configured active_backlog_max_depth of (\d+)$/, (ctx, cap) => {
    writeConfKey(ctx.targetRepo, 'active_backlog_max_depth', Number(cap));
  });

  registry.define(/^effective_backlog_depth_cli\.bb runs on the fixture root$/, (ctx) => runEffectiveDepthCli(ctx));

  registry.define(/^it prints (\d+)$/, (ctx, printed) => {
    assert.equal(ctx.effectiveCap, Number(printed));
  });
}

module.exports = { registerSteps };
