'use strict';

// BL-1982: step handlers for "The throttle release question reaches the
// human without a coordinator seat". Drives the REAL
// effective_backlog_depth_cli.bb (which itself shells to the REAL compiled
// emit-throttle-recommendation.js, role_ask.bb, deliver-role-answer.js and
// release-intake-throttle.js) end to end - never a re-implementation of the
// ask/apply logic in JS, same convention as bl1981ThrottleHumanReleaseSteps.js.
//
// Unlike BL-1981's own fixture (a plain, non-git tmpdir), this feature's
// scenarios need `node extension/out/tools/deliver-role-answer.js --role
// coordinator` to resolve a project root (resolveCliMainWorktreeContext,
// swarm-metrics.ts) - that requires a real git root carrying
// .swarmforge/roles.tsv. The fixture is git-inited (proven with
// `rev-parse --git-common-dir`, BL-1390) with a minimal coordinator row
// whose worktreePath is the fixture root itself - the same single-flat-root
// shape bl1698's own otherRoleRows use, just for one role.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const { throttleRecommendationPath, throttleChangeLogPath } = require(path.join(EXTENSION_DIR, 'out', 'tools', 'emit-throttle-recommendation'));
const { roleAwaitingAnswerPath, enqueueRoleAnswerNote, roleAnswerFilePointerPath } = require(path.join(
  EXTENSION_DIR,
  'out',
  'tools',
  'telegram-front-desk-bot'
));
const { writeStandingRedRegisterFixture } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'standingRedRegisterFixture'));

const FEATURE = 'BL-1982 The throttle release question reaches the human without a coordinator seat';
const COORDINATOR = 'coordinator';

// A fake runHandoff seam (BL-1982 ticket anchors) - enqueueRoleAnswerNote's
// own answer-file write already happens before this is ever called, so a
// no-op here just skips the real, ~1.3s-per-call `bb swarm_handoff.bb`
// spawn (which has no script to find in this flat fixture anyway) rather
// than letting it fail-and-log on every tapped/typed-answer step.
const noopRunHandoff = () => Promise.resolve();

function mkTmp(prefix) {
  return trackedTmpRoot(prefix);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
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
  // shape BL-1429's/BL-1981's own handlers use.
  writeStandingRedRegisterFixture(targetRepo, { count: 15, oldestAgeDays: 2, unownedCount: 0, filePrefix: 'bl1982-acceptance-fixture' });
}

function writeUnderThreshold(targetRepo) {
  writeStandingRedRegisterFixture(targetRepo, { count: 3, oldestAgeDays: 2, unownedCount: 0, filePrefix: 'bl1982-acceptance-fixture' });
}

function makeFixtureRoot() {
  const root = mkTmp('bl1982-throttle-release-ask-');
  fs.symlinkSync(EXTENSION_DIR, path.join(root, 'extension'));

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'bl1982-fixture@example.test']);
  git(root, ['config', 'user.name', 'BL-1982 Fixture']);

  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const realRoot = fs.realpathSync(root);
  const realCommon = fs.realpathSync(commonDir);
  if (!realCommon.startsWith(realRoot)) {
    throw new Error(`BL-1982 fixture: git-common-dir "${realCommon}" escapes fixture root "${realRoot}"`);
  }

  // A minimal roles.tsv so resolveProjectRoot/resolveMainWorktreePath
  // (swarm-metrics.ts, used by deliver-role-answer.js's CLI main()) resolve
  // this flat fixture root as both the project root and the coordinator's
  // own worktree - the only row this feature's CLI calls ever need.
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `${COORDINATOR}\tmaster\t${root}\tsf-coordinator\tCoordinator\tclaude\ttask\toff\tforward-only\n`
  );

  writeConfKey(root, 'active_backlog_max_depth', 6);
  writeUnderThreshold(root);
  return root;
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

function awaitingMarkerPath(targetRepo) {
  return roleAwaitingAnswerPath(targetRepo, COORDINATOR);
}

function readAwaitingMarker(targetRepo) {
  try {
    return JSON.parse(fs.readFileSync(awaitingMarkerPath(targetRepo), 'utf8'));
  } catch {
    return null;
  }
}

function writeAwaitingMarker(targetRepo, record) {
  const abs = awaitingMarkerPath(targetRepo);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(record));
}

function readAnswerFile(targetRepo) {
  try {
    return JSON.parse(fs.readFileSync(path.join(targetRepo, roleAnswerFilePointerPath(COORDINATOR)), 'utf8'));
  } catch {
    return null;
  }
}

function outboxPath(targetRepo) {
  return path.join(targetRepo, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
}

function readOutboxLines(targetRepo) {
  try {
    return fs
      .readFileSync(outboxPath(targetRepo), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function episodeAwaitingRelease(rec) {
  const ep = rec.episode;
  return Boolean(ep && ep.answer === null && ep.clearedAtIso);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(
    /^a fixture root whose configured active_backlog_max_depth is 6 and whose register crossed the count threshold, after the depth CLI printed 1$/,
    (ctx) => {
      ctx.targetRepo = makeFixtureRoot();
      writeOverThreshold(ctx.targetRepo);
      runEffectiveDepthCli(ctx);
      assert.equal(ctx.effectiveCap, 1, 'setup: expected the count-crossed register to recommend cap 1');
    }
  );

  // ── Given/When steps shared across scenarios ──────────────────────────────
  scoped(/^the register has fallen back under every threshold$/, (ctx) => {
    writeUnderThreshold(ctx.targetRepo);
  });

  scoped(/^the register has fallen back under every threshold and the depth CLI raised the throttle question$/, (ctx) => {
    writeUnderThreshold(ctx.targetRepo);
    runEffectiveDepthCli(ctx);
    const marker = readAwaitingMarker(ctx.targetRepo);
    assert.ok(marker, 'setup: expected the depth CLI to raise a pending coordinator question');
    ctx.throttleAskedAtMs = marker.asked_at_ms;
  });

  scoped(/^another coordinator question is pending with a tapped answer recorded for it$/, async (ctx) => {
    const askedAtMs = Date.now() - 5000;
    writeAwaitingMarker(ctx.targetRepo, {
      question: 'Should the epic be renamed?',
      asked_at_ms: askedAtMs,
      options: [{ label: 'Yes' }, { label: 'No' }],
    });
    ctx.otherAskedAtMs = askedAtMs;
    await enqueueRoleAnswerNote(ctx.targetRepo, COORDINATOR, 'Yes', 1, noopRunHandoff);
  });

  scoped(/^the human's tapped answer "([^"]+)" is recorded for the coordinator$/, async (ctx, option) => {
    await enqueueRoleAnswerNote(ctx.targetRepo, COORDINATOR, option, 2, noopRunHandoff);
  });

  scoped(/^the human's typed answer "([^"]+)" is recorded for the coordinator$/, async (ctx, text) => {
    await enqueueRoleAnswerNote(ctx.targetRepo, COORDINATOR, text, 3, noopRunHandoff);
  });

  scoped(/^the depth CLI runs on the fixture root$/, (ctx) => runEffectiveDepthCli(ctx));

  scoped(/^the depth CLI prints (\d+)$/, (ctx, printed) => {
    assert.equal(ctx.effectiveCap, Number(printed));
  });

  // ── a-cleared-episode-raises-one-question-01 ───────────────────────────────
  scoped(
    /^the coordinator has one pending question naming the red count, how long it has read normal and the cap of 6 a release restores$/,
    (ctx) => {
      const marker = readAwaitingMarker(ctx.targetRepo);
      assert.ok(marker, 'expected a pending coordinator question');
      assert.match(marker.question, /the red count/, `expected the question to name the red count, got: ${marker.question}`);
      assert.match(marker.question, /has read normal for/, `expected the question to name how long it read normal, got: ${marker.question}`);
      assert.match(marker.question, /back to 6/, `expected the question to name the cap a release restores, got: ${marker.question}`);
    }
  );

  scoped(/^the pending question offers the options "Release the cap" and "Keep the throttle"$/, (ctx) => {
    const marker = readAwaitingMarker(ctx.targetRepo);
    const labels = (marker.options || []).map((o) => o.label);
    assert.deepEqual(labels, ['Release the cap', 'Keep the throttle'], `expected the two release options, got: ${JSON.stringify(marker.options)}`);
  });

  scoped(/^the throttle recommendation records the question as asked for the open episode$/, (ctx) => {
    const marker = readAwaitingMarker(ctx.targetRepo);
    const rec = readRecommendation(ctx.targetRepo);
    assert.ok(rec.episode, 'expected an open episode');
    assert.equal(rec.episode.releaseAskedAtMs, marker.asked_at_ms, 'expected the episode to record the live marker\'s asked_at_ms');
  });

  // ── a-second-run-asks-nothing-more-02 ──────────────────────────────────────
  scoped(/^the coordinator's pending question is the throttle question first raised$/, (ctx) => {
    const marker = readAwaitingMarker(ctx.targetRepo);
    assert.ok(marker, 'expected a pending coordinator question');
    assert.equal(marker.asked_at_ms, ctx.throttleAskedAtMs, 'expected the SAME question, never a second ask');
  });

  scoped(/^the coordinator outbox holds one throttle question$/, (ctx) => {
    const throttleLines = readOutboxLines(ctx.targetRepo).filter((l) => l.threadId === 'role-ask-coordinator');
    assert.equal(throttleLines.length, 1, `expected exactly one throttle question in the outbox, got: ${JSON.stringify(throttleLines)}`);
  });

  // ── another-pending-question-defers-the-ask-03 ─────────────────────────────
  scoped(/^the coordinator's pending question is the other question, with its answer still unconsumed$/, (ctx) => {
    const marker = readAwaitingMarker(ctx.targetRepo);
    assert.ok(marker, 'expected the other question to still be pending');
    assert.equal(marker.asked_at_ms, ctx.otherAskedAtMs, 'expected the throttle ask to have left the other question untouched');
    const answer = readAnswerFile(ctx.targetRepo);
    assert.ok(answer, 'expected the other question\'s tapped answer to still be on file');
    assert.equal(answer.consumedAt, undefined, 'expected the other question\'s answer to stay unconsumed');
  });

  scoped(/^the throttle recommendation records no question asked for the open episode$/, (ctx) => {
    const rec = readRecommendation(ctx.targetRepo);
    assert.ok(rec.episode, 'expected an open episode');
    assert.equal(rec.episode.releaseAskedAtMs, undefined, 'expected no question recorded as asked for this episode');
  });

  // ── a-tapped-option-is-applied-04 ──────────────────────────────────────────
  scoped(/^the throttle recommendation reports no episode awaiting release$/, (ctx) => {
    const rec = readRecommendation(ctx.targetRepo);
    assert.equal(episodeAwaitingRelease(rec), false, `expected no episode awaiting release, got: ${JSON.stringify(rec.episode)}`);
  });

  scoped(/^the throttle change log records the answer by "([^"]+)"$/, (ctx, by) => {
    const lines = readChangeLogLines(ctx.targetRepo);
    const found = lines.find((l) => l.reason.includes(`recorded by "${by}"`));
    assert.ok(found, `expected a change-log entry recording the answer by "${by}", got: ${JSON.stringify(lines)}`);
  });

  // ── a-typed-reply-is-kept-not-applied-05 ───────────────────────────────────
  scoped(/^the throttle recommendation reports the episode awaiting release, carrying the reply "([^"]+)"$/, (ctx, reply) => {
    const rec = readRecommendation(ctx.targetRepo);
    assert.ok(episodeAwaitingRelease(rec), `expected the episode to still read awaiting release, got: ${JSON.stringify(rec.episode)}`);
    assert.equal(rec.episode.releaseReply, reply, `expected the typed reply kept on the episode, got: ${JSON.stringify(rec.episode)}`);
  });

  // ── a-stale-ask-whose-marker-moved-on-is-untouched-06 (invariant 2) ────────
  // Discriminates apply-release-answer!'s asked-at-ms equality guard: our
  // episode already carries a releaseAskedAtMs (question-already-asked? is
  // true, so the run takes the apply branch), but the coordinator's LIVE
  // pending question is now a DIFFERENT one (another role_ask raised and
  // tapped in between). Invariant 2 requires the run to consume nothing in
  // this shape; a mutant that drops the equality half of the guard (keeping
  // only the truthiness of our-asked-at-ms) survived every other scenario
  // here, because none of them puts a non-matching marker in front of an
  // already-asked episode.
  scoped(/^the throttle recommendation reports the episode awaiting release, with no reply recorded$/, (ctx) => {
    const rec = readRecommendation(ctx.targetRepo);
    assert.ok(episodeAwaitingRelease(rec), `expected the episode to still read awaiting release, got: ${JSON.stringify(rec.episode)}`);
    assert.equal(rec.episode.releaseReply, undefined, `expected no reply recorded on the episode, got: ${JSON.stringify(rec.episode)}`);
  });
}

module.exports = { registerSteps };
