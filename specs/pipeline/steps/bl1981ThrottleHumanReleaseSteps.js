'use strict';

// BL-1981: step handlers for "A cleared throttle signal holds the cap
// until a human releases it" (Article 3.5's 2026-10-05 amendment). Drives
// the REAL effective_backlog_depth_cli.bb (which itself shells to the REAL
// compiled emit-throttle-recommendation.js) and the REAL compiled release
// CLI (release-intake-throttle.js) end to end - never a re-implementation
// of the episode/hold logic in JS. The fixture's own extension/ is a
// symlink to this checkout's real, already-compiled one, same convention
// as bl432AutoTuneIntakeThrottleSteps.js/bl1429StandingRedThrottleSteps.js.
//
// "the register has fallen back under every threshold" repeats BL-1429's
// own step text word for word - registered with defineScoped (BL-425) so
// it answers only THIS feature; BL-1429's own unscoped registration for
// the identical text stays completely untouched.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const { throttleRecommendationPath, throttleChangeLogPath } = require(path.join(EXTENSION_DIR, 'out', 'tools', 'emit-throttle-recommendation'));
const { recordThrottleRelease } = require(path.join(EXTENSION_DIR, 'out', 'tools', 'release-intake-throttle'));
const { describeStandingRedSignal } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'standingRedSignal'));
const { writeStandingRedRegisterFixture } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'standingRedRegisterFixture'));

const FEATURE = 'BL-1981 A cleared throttle signal holds the cap until a human releases it';

function mkTmp(prefix) {
  return trackedTmpRoot(prefix);
}

function confPath(targetRepo) {
  return path.join(targetRepo, 'swarmforge', 'swarmforge.conf');
}

function writeConfKey(targetRepo, key, value) {
  const lines = (() => {
    try {
      return fs
        .readFileSync(confPath(targetRepo), 'utf8')
        .split('\n')
        .filter(Boolean)
        .filter((l) => !l.startsWith(`config ${key} `));
    } catch {
      return [];
    }
  })();
  lines.push(`config ${key} ${value}`);
  fs.mkdirSync(path.join(targetRepo, 'swarmforge'), { recursive: true });
  fs.writeFileSync(confPath(targetRepo), lines.join('\n') + '\n');
}

function writeOverThreshold(targetRepo) {
  // count 15 > default max-count (10) - the same count-threshold fixture
  // shape BL-1429's own handler uses.
  writeStandingRedRegisterFixture(targetRepo, { count: 15, oldestAgeDays: 2, unownedCount: 0, filePrefix: 'bl1981-acceptance-fixture' });
}

function writeUnderThreshold(targetRepo) {
  writeStandingRedRegisterFixture(targetRepo, { count: 3, oldestAgeDays: 2, unownedCount: 0, filePrefix: 'bl1981-acceptance-fixture' });
}

function runEffectiveDepthCli(ctx) {
  const out = execFileSync('bb', [EFFECTIVE_CLI, ctx.targetRepo], { encoding: 'utf8' });
  ctx.effectiveCap = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(ctx.effectiveCap)) {
    throw new Error(`expected effective_backlog_depth_cli.bb to print an integer, got: ${JSON.stringify(out)}`);
  }
  ctx.recommendation = readRecommendation(ctx.targetRepo);
}

function readRecommendation(targetRepo) {
  return JSON.parse(fs.readFileSync(throttleRecommendationPath(targetRepo), 'utf8'));
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

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture root with a standing-red register and a swarmforge\.conf configuring an active_backlog_max_depth of 6$/,
    (ctx) => {
      ctx.targetRepo = mkTmp('bl1981-throttle-hold-');
      fs.symlinkSync(EXTENSION_DIR, path.join(ctx.targetRepo, 'extension'));
      writeConfKey(ctx.targetRepo, 'active_backlog_max_depth', 6);
      writeUnderThreshold(ctx.targetRepo);
    }
  );

  // ── Given steps shared across scenarios ────────────────────────────────
  scoped(/^the register crossed the count threshold and the depth CLI printed 1$/, (ctx) => {
    writeOverThreshold(ctx.targetRepo);
    runEffectiveDepthCli(ctx);
    assert.equal(ctx.effectiveCap, 1, 'setup: expected the count-crossed register to recommend cap 1');
  });

  // BL-1429's own identical step text, scoped to THIS feature only
  // (BL-425) - BL-1429's unscoped registration is untouched.
  scoped(/^the register has fallen back under every threshold$/, (ctx) => {
    writeUnderThreshold(ctx.targetRepo);
  });

  scoped(/^the register has fallen back under every threshold and the depth CLI printed 1$/, (ctx) => {
    writeUnderThreshold(ctx.targetRepo);
    runEffectiveDepthCli(ctx);
    assert.equal(ctx.effectiveCap, 1, 'setup: expected the unanswered hold to keep the cap at 1 once the signal clears');
  });

  scoped(/^the register has fallen back under every threshold and the depth CLI printed 6$/, (ctx) => {
    writeUnderThreshold(ctx.targetRepo);
    runEffectiveDepthCli(ctx);
    assert.equal(ctx.effectiveCap, 6, 'setup: expected the pre-approved release to restore the configured cap once the signal cleared');
  });

  scoped(/^the release CLI recorded a release by "([^"]+)" while the register was over the count threshold$/, (ctx, by) => {
    recordThrottleRelease({ targetRepoPath: ctx.targetRepo, by, answer: { kind: 'release' } });
  });

  scoped(/^the depth CLI runs on the fixture root$/, (ctx) => runEffectiveDepthCli(ctx));

  scoped(/^the depth CLI prints (\d+)$/, (ctx, printed) => {
    assert.equal(ctx.effectiveCap, Number(printed));
  });

  // ── a-cleared-signal-holds-the-cap-01 ──────────────────────────────────
  scoped(
    /^the throttle recommendation reports the episode awaiting release, naming the red count and the configured cap of 6$/,
    (ctx) => {
      const rec = ctx.recommendation;
      assert.ok(rec.episode, 'expected an open episode');
      assert.equal(rec.episode.answer, null, 'expected the episode to be unanswered (awaiting release)');
      assert.ok(rec.episode.clearedAtIso, 'expected the episode to record when its signal cleared');
      assert.equal(rec.episode.openingSignal, describeStandingRedSignal('count'));
      assert.equal(rec.episode.configuredCapAtOpen, 6);
    }
  );

  scoped(/^the throttle change log records the cap held at 1 for a human release$/, (ctx) => {
    const lines = readChangeLogLines(ctx.targetRepo);
    const held = lines.find((l) => /held at 1 for a human release/.test(l.reason));
    assert.ok(held, `expected a change-log entry naming the hold, got: ${JSON.stringify(lines)}`);
  });

  // ── a-release-restores-the-configured-cap-02 ───────────────────────────
  scoped(/^the release CLI records a release by "([^"]+)"$/, (ctx, by) => {
    recordThrottleRelease({ targetRepoPath: ctx.targetRepo, by, answer: { kind: 'release' } });
  });

  scoped(/^the throttle recommendation reports no episode awaiting release$/, (ctx) => {
    const rec = readRecommendation(ctx.targetRepo);
    const awaiting = rec.episode !== null && rec.episode.answer === null && rec.episode.clearedAtIso !== null;
    assert.equal(awaiting, false, `expected no episode awaiting release, got: ${JSON.stringify(rec.episode)}`);
  });

  scoped(/^the throttle change log records the release by "([^"]+)"$/, (ctx, by) => {
    const lines = readChangeLogLines(ctx.targetRepo);
    const released = lines.find((l) => l.reason.includes(`release recorded by "${by}"`));
    assert.ok(released, `expected a change-log entry recording the release, got: ${JSON.stringify(lines)}`);
  });

  // ── a-keep-holds-the-value-the-human-gave-04 ───────────────────────────
  scoped(/^the release CLI records a keep at (\d+) by "([^"]+)"$/, (ctx, value, by) => {
    recordThrottleRelease({ targetRepoPath: ctx.targetRepo, by, answer: { kind: 'keep', value: Number(value) } });
  });

  // ── an-answer-never-lifts-a-live-signal-05 (Scenario Outline) ──────────
  // Both outline rows interpolate to the EXACT literal text scenarios
  // 02/04 already register above ("a release"/"a keep at 3" by "human") -
  // nothing further to add.
}

module.exports = { registerSteps };
