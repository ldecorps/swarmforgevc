'use strict';

// BL-2034: step handlers for "A throttle signal that trips again is live,
// not awaiting release". Drives the REAL effective_backlog_depth_cli.bb
// (which itself shells to the REAL compiled emit-throttle-recommendation.js)
// end to end - never a re-implementation of the episode/hold logic in JS.
// The fixture's own extension/ is a symlink to this checkout's real,
// already-compiled one, same convention as
// bl1981ThrottleHumanReleaseSteps.js.
//
// "a fixture root with a standing-red register and a swarmforge.conf
// configuring an active_backlog_max_depth of 6" repeats BL-1981's own step
// text word for word - registered with defineScoped (BL-425) so it answers
// only THIS feature; BL-1981's own scoped registration for the identical
// text stays completely untouched.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const { throttleRecommendationPath } = require(path.join(EXTENSION_DIR, 'out', 'tools', 'emit-throttle-recommendation'));
const { writeStandingRedRegisterFixture } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'standingRedRegisterFixture'));

const FEATURE = 'BL-2034 A throttle signal that trips again is live, not awaiting release';

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
  // shape BL-1981's own handler uses.
  writeStandingRedRegisterFixture(targetRepo, { count: 15, oldestAgeDays: 2, unownedCount: 0, filePrefix: 'bl2034-acceptance-fixture' });
}

function writeUnderThreshold(targetRepo) {
  writeStandingRedRegisterFixture(targetRepo, { count: 3, oldestAgeDays: 2, unownedCount: 0, filePrefix: 'bl2034-acceptance-fixture' });
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

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture root with a standing-red register and a swarmforge\.conf configuring an active_backlog_max_depth of 6$/,
    (ctx) => {
      ctx.targetRepo = mkTmp('bl2034-throttle-retrip-');
      fs.symlinkSync(EXTENSION_DIR, path.join(ctx.targetRepo, 'extension'));
      writeConfKey(ctx.targetRepo, 'active_backlog_max_depth', 6);
      writeUnderThreshold(ctx.targetRepo);
    }
  );

  // ── an-episode-reads-as-awaiting-release-only-while-its-signal-is-clear-01 ──
  // The outline's <history> is a comma-separated phrase list; each phrase
  // is one register change followed by one depth-CLI run.
  scoped(/^the register goes (.+), with the depth CLI run after each change$/, (ctx, history) => {
    for (const phrase of history.split(',').map((p) => p.trim())) {
      if (phrase === 'over the count threshold') {
        writeOverThreshold(ctx.targetRepo);
      } else if (phrase === 'under it') {
        writeUnderThreshold(ctx.targetRepo);
      } else if (phrase === 'over it again') {
        writeOverThreshold(ctx.targetRepo);
      } else if (phrase === 'under it again') {
        writeUnderThreshold(ctx.targetRepo);
      } else {
        throw new Error(`unrecognized history phrase: ${JSON.stringify(phrase)}`);
      }
      runEffectiveDepthCli(ctx);
      // Record the first clear's instant the first time it appears, so
      // "since the second clear" can be checked against it.
      const ep = ctx.recommendation.episode;
      if (ep && ep.clearedAtIso !== null && ctx.firstClearedAtIso === undefined) {
        ctx.firstClearedAtIso = ep.clearedAtIso;
      }
    }
  });

  scoped(/^the depth CLI last printed 1$/, (ctx) => {
    assert.equal(ctx.effectiveCap, 1, `expected the last depth-CLI run to print 1, got ${ctx.effectiveCap}`);
  });

  scoped(/^the throttle recommendation reports no episode awaiting release$/, (ctx) => {
    const rec = ctx.recommendation;
    const awaiting = rec.episode !== null && rec.episode.answer === null && rec.episode.clearedAtIso !== null;
    assert.equal(awaiting, false, `expected no episode awaiting release, got: ${JSON.stringify(rec.episode)}`);
  });

  scoped(/^the throttle recommendation reports the episode awaiting release since the second clear$/, (ctx) => {
    const rec = ctx.recommendation;
    assert.ok(rec.episode, 'expected an open episode');
    assert.equal(rec.episode.answer, null, 'expected the episode to be unanswered (awaiting release)');
    assert.ok(rec.episode.clearedAtIso, 'expected the episode to record when its signal cleared');
    // The awaiting-release instant must be the SECOND clear, not the first:
    // the episode opened on the first "over", cleared, re-tripped, then
    // cleared again - the first clear's instant is stale after the re-trip.
    // ISO strings compare in chronological order.
    assert.ok(
      ctx.firstClearedAtIso !== undefined,
      'expected the history to have recorded a first clear before the re-trip'
    );
    assert.ok(
      rec.episode.clearedAtIso > ctx.firstClearedAtIso,
      `the awaiting-release instant must be later than the first clear (${ctx.firstClearedAtIso}), got ${rec.episode.clearedAtIso}`
    );
  });
}

module.exports = { registerSteps };
