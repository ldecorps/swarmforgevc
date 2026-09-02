'use strict';

// BL-1294: step handlers for "Fixture script closure preserves dependency
// paths". Every scenario drives the REAL pinnedRepoFixture.js helpers -
// resolveScriptClosure/copyScriptClosure - against a real scratch filesystem
// tree, never a hand-rolled substitute: the defect this ticket closes lives
// in the COPY step (which does real fs.existsSync/copyFileSync calls), so a
// scenario that only drove the pure closure walk would not reach it.
//
// Scenario 03 is the one exception in shape, and deliberately so: it is the
// original incident's own reproduction, so it drives the REAL live
// swarmforge/scripts/ tree and the REAL swarm_handoff.bb CLI through
// enqueueRoleAnswerNote, exactly as telegramFrontDeskBotCli.test.js's BL-607
// tests already do - never a synthetic closure standing in for it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const { copyScriptClosure, copyLiveScriptClosureInto } = require(
  path.join(EXT, 'test', 'helpers', 'pinnedRepoFixture')
);
const { copySeededRepoInto } = require(path.join(EXT, 'test', 'helpers', 'sharedRepoFixture'));

const FEATURE = 'Fixture script closure preserves dependency paths';

function loadFileLine(depPath) {
  const quoted = depPath.split('/').map((p) => `"${p}"`).join(' ');
  return `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ${quoted})))`;
}

function cleanupLiveAndFixtureDirs(ctx) {
  fs.rmSync(ctx.bl1294.liveDir, { recursive: true, force: true });
  fs.rmSync(ctx.bl1294.fixtureRoot, { recursive: true, force: true });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a live scripts directory$/, (ctx) => {
    ctx.bl1294 = {
      liveDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1294-live-')),
      fixtureRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1294-fixture-')),
    };
    ctx.bl1294.targetScripts = path.join(ctx.bl1294.fixtureRoot, 'scripts');
  });

  scoped(/^"([^"]+)" load-files the dependency "([^"]+)"$/, (ctx, caller, dependency) => {
    fs.writeFileSync(path.join(ctx.bl1294.liveDir, caller), loadFileLine(dependency));
    ctx.bl1294.caller = caller;
  });

  scoped(/^the live scripts directory has a file at "([^"]+)"$/, (ctx, dependency) => {
    const dest = path.join(ctx.bl1294.liveDir, dependency);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, '(defn f [])');
  });

  scoped(/^the live scripts directory has no file at "([^"]+)"$/, (ctx, dependency) => {
    // Nothing to do - the previous step never wrote it. Asserted rather than
    // assumed, so a step-ordering slip cannot make this scenario vacuous.
    assert.ok(
      !fs.existsSync(path.join(ctx.bl1294.liveDir, dependency)),
      `${dependency} must genuinely be absent for this scenario to mean anything`
    );
  });

  scoped(/^the closure of "([^"]+)" is copied into a fixture scripts directory$/, (ctx, caller) => {
    try {
      ctx.bl1294.copied = copyScriptClosure(ctx.bl1294.liveDir, ctx.bl1294.targetScripts, [caller]);
    } catch (err) {
      ctx.bl1294.copyError = err;
    }
  });

  scoped(/^the fixture has a file at "([^"]+)"$/, (ctx, dependency) => {
    try {
      assert.equal(ctx.bl1294.copyError, undefined, `the copy must not fail: ${ctx.bl1294.copyError}`);
      assert.ok(
        fs.existsSync(path.join(ctx.bl1294.targetScripts, dependency)),
        `expected the fixture to have a file at ${dependency}`
      );
    } finally {
      cleanupLiveAndFixtureDirs(ctx);
    }
  });

  scoped(/^the copy fails naming "([^"]+)"$/, (ctx, dependency) => {
    try {
      assert.ok(ctx.bl1294.copyError, 'expected the copy to fail, but it succeeded');
      assert.ok(
        ctx.bl1294.copyError.message.includes(dependency),
        `the failure must name ${dependency}: ${ctx.bl1294.copyError.message}`
      );
    } finally {
      cleanupLiveAndFixtureDirs(ctx);
    }
  });

  // ── scenario 03: the original incident, reproduced against the real tree ──

  scoped(/^the live "([^"]+)" reaches a dependency held in a subdirectory$/, (ctx, entryPoint) => {
    const liveScripts = path.join(EXT, '..', 'swarmforge', 'scripts');
    // The premise, asserted rather than assumed (BL-654 reach): the entry
    // point's REAL closure really does contain a nested dependency today, or
    // this scenario would prove nothing about subdirectories at all.
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1294-probe-'));
    const probeScripts = path.join(probe, 'scripts');
    const copied = copyScriptClosure(liveScripts, probeScripts, [entryPoint]);
    fs.rmSync(probe, { recursive: true, force: true });
    assert.ok(
      copied.some((f) => f.includes('/')),
      `${entryPoint}'s closure must reach a nested dependency for this scenario to mean anything: ${JSON.stringify(copied)}`
    );
    ctx.bl1294.entryPoint = entryPoint;
    ctx.bl1294.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1294-e2e-'));
    copySeededRepoInto(ctx.bl1294.root);
  });

  scoped(/^a note draft is handed to the fixture's "([^"]+)"$/, (ctx, entryPoint) => {
    assert.equal(entryPoint, ctx.bl1294.entryPoint);
    copyLiveScriptClosureInto(path.join(ctx.bl1294.root, 'swarmforge', 'scripts'), [
      'commit_integrity_cli.bb', entryPoint, 'ambulance_cli.bb',
      'operator_ask.bb', 'role_ask.bb', 'support_thread.bb',
    ]);
    fs.mkdirSync(path.join(ctx.bl1294.root, '.swarmforge'), { recursive: true });
    const tsv = [
      ['specifier', 'session', ctx.bl1294.root, 'swarmforge-specifier', 'specifier', 'claude', 'task'].join('\t'),
      ['coordinator', 'session', ctx.bl1294.root, 'swarmforge-coordinator', 'coordinator', 'claude', 'task'].join('\t'),
    ].join('\n');
    fs.writeFileSync(path.join(ctx.bl1294.root, '.swarmforge', 'roles.tsv'), tsv + '\n');

    const { enqueueRoleAnswerNote } = require(
      path.join(EXT, 'out', 'tools', 'telegram-front-desk-bot')
    );
    ctx.bl1294.enqueueResult = null;
    ctx.bl1294.enqueuePromise = enqueueRoleAnswerNote(ctx.bl1294.root, 'specifier', 'use staging please')
      .then((ok) => { ctx.bl1294.enqueueResult = ok; })
      .catch((err) => { ctx.bl1294.enqueueError = err; });
  });

  scoped(/^the script loads every dependency it reaches without a missing-file error$/, async (ctx) => {
    await ctx.bl1294.enqueuePromise;
    assert.equal(ctx.bl1294.enqueueError, undefined, `expected no error: ${ctx.bl1294.enqueueError}`);
    assert.equal(
      ctx.bl1294.enqueueResult,
      true,
      'expected the note to be queued - a missing-file error at load would surface as a false return'
    );
    const outboxDir = path.join(ctx.bl1294.root, '.swarmforge', 'handoffs', 'outbox');
    const queued = fs.readdirSync(outboxDir);
    assert.equal(queued.length, 1, `expected exactly one queued handoff, got: ${JSON.stringify(queued)}`);
    fs.rmSync(ctx.bl1294.root, { recursive: true, force: true });
    cleanupLiveAndFixtureDirs(ctx);
  });
}

module.exports = { registerSteps };
