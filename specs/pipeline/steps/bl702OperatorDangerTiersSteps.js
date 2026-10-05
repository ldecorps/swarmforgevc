'use strict';

// BL-1940 (BL-702 stamp-off): step handlers for "operator parse, env-reload,
// and danger tiers". Drives the REAL compiled telegramCursorBridgeCore.js /
// telegramCursorOperatorCore.js deciders directly, and the REAL
// telegramCursorOperatorExec.js executeOperatorVerb / swarmLauncher.js
// buildLaunchEnv against fixtures under a tracked mkdtemp root with stub
// scripts - never a restatement of the decision or execution logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
let _bridgeCore = null;
function bridgeCore() {
  if (!_bridgeCore) _bridgeCore = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgeCore'));
  return _bridgeCore;
}
let _operatorCore = null;
function operatorCore() {
  if (!_operatorCore) _operatorCore = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorOperatorCore'));
  return _operatorCore;
}
let _operatorExec = null;
function operatorExec() {
  if (!_operatorExec) _operatorExec = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorOperatorExec'));
  return _operatorExec;
}
let _swarmLauncher = null;
function swarmLauncher() {
  if (!_swarmLauncher) _swarmLauncher = require(path.join(EXT_DIR, 'out', 'swarm', 'swarmLauncher'));
  return _swarmLauncher;
}

const FEATURE = 'BL-702 operator parse, env-reload, and danger tiers';

const PRINCIPAL_ID = 'principal-1';
const INTRUDER_ID = 'intruder-99';
const CHAT_ID = 'chat-1';
const CURSOR_TOPIC_ID = 42;
const NON_OPS_TOPIC_ID = 7;

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function bounceSentinelPath(root) {
  return path.join(root, '.swarmforge', 'bounce');
}

function writeSwarmEnv(root, lines) {
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'swarm.env'), `${lines.join('\n')}\n`);
}

function writeEnsureStub(root) {
  const bin = path.join(root, 'swarm');
  fs.writeFileSync(bin, '#!/bin/sh\necho "ensure stub ok"\nexit 0\n');
  fs.chmodSync(bin, 0o755);
}

// The real chain (start_cursor_bridge.sh) sources swarm.env itself before
// passing it to the supervisor child - startRedeployRun's own spawn adds
// no env merging at the JS layer. This stub reproduces exactly that one
// shell-level step: source swarm.env, then write the merged key to a
// marker file, standing in for "the supervisor child started with it".
function writeRedeployBridgeStub(root, markerPath, keyName) {
  const scriptDir = path.join(root, 'swarmforge', 'scripts');
  mkdirp(scriptDir);
  const script = path.join(scriptDir, 'redeploy_cursor_bridge.sh');
  fs.writeFileSync(
    script,
    [
      '#!/usr/bin/env bash',
      `SWARM_ENV="$1/.swarmforge/swarm.env"`,
      '[ -f "$SWARM_ENV" ] && source "$SWARM_ENV"',
      `echo "\${${keyName}:-}" > ${JSON.stringify(markerPath)}`,
      'exit 0',
      '',
    ].join('\n')
  );
  fs.chmodSync(script, 0o755);
}

// Bounded synchronous wait for a detached stub script's marker - the same
// idiom test/telegramCursorOperatorExec.test.js's own redeploy tests use.
function waitFor(predicate, attempts = 100, stepMs = 20) {
  for (let i = 0; i < attempts && !predicate(); i += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stepMs);
  }
  return predicate();
}

function mkFixtureRoot(ctx) {
  if (ctx.root) return ctx.root;
  const root = trackedTmpRoot('sfvc-bl702-');
  writeSwarmEnv(root, ['export BL702_BASELINE="present"']);
  ctx.root = root;
  return root;
}

function decide(ctx, event, pending) {
  return bridgeCore().decideInboundAction(event, PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID, pending);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a principal-only Cursor Remote Telegram topic$/, (ctx) => {
    mkFixtureRoot(ctx);
  });

  scoped(/^\.swarmforge\/swarm\.env exists with operator keys$/, (ctx) => {
    mkFixtureRoot(ctx);
    assert.ok(fs.existsSync(path.join(ctx.root, '.swarmforge', 'swarm.env')));
  });

  scoped(/^unauthorised senders and wrong topics never mutate swarm state$/, () => {
    // Structural: every decision-only scenario below asserts a terminal
    // ignore/refuse BEFORE any execute call is ever made - there is
    // nothing to mutate on that path by construction.
  });

  // ── Unauthorised sender cannot run a hard-tier verb ─────────────────
  scoped(/^an unauthorised user sends "([^"]+)" in Cursor Remote$/, (ctx, text) => {
    ctx.decision = decide(ctx, { fromId: INTRUDER_ID, chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID, text, kind: 'text' });
  });

  scoped(/^the bridge refuses with no bounce sentinel written$/, (ctx) => {
    assert.equal(ctx.decision.action, 'refuse');
    assert.ok(!fs.existsSync(bounceSentinelPath(ctx.root)), 'no sentinel may exist - nothing executed');
  });

  // ── Hard-tier verb outside Cursor Remote is ignored ─────────────────
  scoped(/^the principal sends "([^"]+)" in a non-ops topic$/, (ctx, text) => {
    ctx.decision = decide(ctx, { fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId: NON_OPS_TOPIC_ID, text, kind: 'text' });
  });

  scoped(/^no kill or drain runs$/, (ctx) => {
    assert.equal(ctx.decision.action, 'ignore');
  });

  // ── Hard-tier verb requires confirm before execute (/ensure) ────────
  scoped(/^the principal sends "([^"]+)" in Cursor Remote$/, (ctx, text) => {
    ctx.verbText = text;
    ctx.decision = decide(ctx, { fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID, text, kind: 'text' });
  });

  scoped(/^the bridge prompts for confirmation and does not run ensure yet$/, (ctx) => {
    assert.equal(ctx.decision.action, 'prompt-operator-confirm');
    assert.equal(ctx.decision.tier, 'hard');
    assert.equal(ctx.decision.verb, '/ensure');
    ctx.pending = { tier: ctx.decision.tier, verb: ctx.decision.verb, args: ctx.decision.args };
  });

  scoped(/^the principal confirms$/, (ctx) => {
    ctx.decision = decide(
      ctx,
      { fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID, text: '', kind: 'callback', callbackData: 'op:confirm' },
      ctx.pending
    );
  });

  scoped(/^ensure runs single-flight and a summary is posted$/, (ctx) => {
    assert.equal(ctx.decision.action, 'execute-operator');
    assert.equal(ctx.decision.verb, '/ensure');
    writeEnsureStub(ctx.root);
    const result = operatorExec().executeOperatorVerb(ctx.root, '/ensure', ctx.decision.args, { principalId: PRINCIPAL_ID });
    assert.match(result.text, /^ensure: ok/, `expected the stub ./swarm ensure to succeed, got: ${result.text}`);
    // Single-flight: the lock is released once the run completes, so a
    // fresh acquire must succeed again immediately.
    assert.equal(operatorExec().tryAcquireEnsureLock(ctx.root), true, 'expected the ensure lock to be released after the run');
  });

  // ── Soft-tier verb needs a light confirm (/compile) ─────────────────
  // (shares "the principal sends ... in Cursor Remote" with the /ensure
  // scenario above - registered once there.)
  scoped(/^the bridge prompts for a single Confirm tap and does not run yet$/, (ctx) => {
    assert.equal(ctx.decision.action, 'prompt-operator-confirm');
    assert.equal(ctx.decision.tier, 'soft');
    ctx.pending = { tier: ctx.decision.tier, verb: ctx.decision.verb, args: ctx.decision.args };
  });

  scoped(/^compile runs and a short result is posted$/, (ctx) => {
    assert.equal(ctx.decision.action, 'execute-operator');
    assert.equal(ctx.decision.verb, '/compile');
    const result = operatorExec().executeOperatorVerb(ctx.root, '/compile');
    assert.match(result.text, /^compile:/, `expected a compile result, got: ${result.text}`);
  });

  // ── /confirm-off clears a pending hard confirm ──────────────────────
  scoped(/^a pending "([^"]+)" confirm$/, (ctx, verb) => {
    ctx.pending = { tier: 'hard', verb, args: undefined };
  });

  scoped(/^the principal sends "\/confirm-off"$/, (ctx) => {
    ctx.decision = decide(ctx, { fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID, text: '/confirm-off', kind: 'text' }, ctx.pending);
  });

  scoped(/^the pending confirm is cleared and no bounce runs$/, (ctx) => {
    assert.equal(ctx.decision.action, 'clear-operator-pending');
    assert.ok(!fs.existsSync(bounceSentinelPath(ctx.root)), 'no sentinel may exist - /bounce never ran');
  });

  // ── /restart relaunches after re-reading swarm.env ──────────────────
  scoped(/^swarm\.env defines a key that the current host process\.env lacks$/, (ctx) => {
    mkFixtureRoot(ctx);
    ctx.envKey = 'BL702_RESTART_KEY';
    assert.equal(process.env[ctx.envKey], undefined, 'the host must genuinely lack this key for the scenario to mean anything');
    writeSwarmEnv(ctx.root, ['export BL702_BASELINE="present"', `export ${ctx.envKey}="from-swarm-env"`]);
  });

  scoped(/^the principal confirms "\/restart"$/, (ctx) => {
    const result = operatorExec().executeOperatorVerb(ctx.root, '/restart');
    ctx.restartResult = result;
  });

  scoped(/^the relaunch child environment includes that key from swarm\.env$/, (ctx) => {
    assert.equal(ctx.restartResult.wroteBounceSentinel, true);
    assert.ok(fs.existsSync(bounceSentinelPath(ctx.root)));
    // The relaunch itself is a later, separate process (the swarm's own
    // bounce-detection path); what matters here is that the SAME function
    // that path calls (buildLaunchEnv) reads this repo's swarm.env fresh.
    const env = swarmLauncher().buildLaunchEnv(undefined, undefined, ctx.root);
    assert.equal(env[ctx.envKey], 'from-swarm-env');
  });

  // ── buildLaunchEnv merges swarm.env over host process.env ───────────
  scoped(/^a repo with \.swarmforge\/swarm\.env exporting a key absent from the host$/, (ctx) => {
    ctx.buildEnvRoot = trackedTmpRoot('sfvc-bl702-buildenv-');
    ctx.buildEnvKey = 'BL702_BUILDENV_KEY';
    assert.equal(process.env[ctx.buildEnvKey], undefined);
    writeSwarmEnv(ctx.buildEnvRoot, [`export ${ctx.buildEnvKey}="from-fixture"`]);
  });

  scoped(/^buildLaunchEnv is called with that repo root$/, (ctx) => {
    ctx.buildEnvResult = swarmLauncher().buildLaunchEnv(undefined, undefined, ctx.buildEnvRoot);
  });

  scoped(/^the returned env includes the key from swarm\.env$/, (ctx) => {
    assert.equal(ctx.buildEnvResult[ctx.buildEnvKey], 'from-fixture');
  });

  // ── /bounce bridge reloads swarm.env like /redeploy ─────────────────
  scoped(/^the principal confirms "\/bounce bridge"$/, (ctx) => {
    mkFixtureRoot(ctx);
    const key = 'BL702_BRIDGE_KEY';
    writeSwarmEnv(ctx.root, ['export BL702_BASELINE="present"', `export ${key}="bridge-merged-value"`]);
    const marker = path.join(ctx.root, '.swarmforge', 'operator', 'redeploy-env-marker.txt');
    mkdirp(path.dirname(marker));
    writeRedeployBridgeStub(ctx.root, marker, key);
    ctx.bridgeMarker = marker;
    ctx.bridgeExecResult = operatorExec().executeOperatorVerb(ctx.root, '/bounce', 'bridge');
  });

  scoped(/^the cursor bridge supervisor child is started with swarm\.env merged$/, (ctx) => {
    assert.match(ctx.bridgeExecResult.text, /^bounce bridge/);
    assert.ok(waitFor(() => fs.existsSync(ctx.bridgeMarker)), 'expected the redeploy stub to have run and written its marker');
    assert.equal(fs.readFileSync(ctx.bridgeMarker, 'utf8').trim(), 'bridge-merged-value');
  });

  // ── /syncenv reports key presence without values ────────────────────
  scoped(/^the principal confirms "\/syncenv"$/, (ctx) => {
    mkFixtureRoot(ctx);
    ctx.secretValue = 'super-secret-value-should-never-appear';
    writeSwarmEnv(ctx.root, ['export BL702_BASELINE="present"', `export MISTRAL_API_KEY="${ctx.secretValue}"`]);
    ctx.syncenvResult = operatorExec().executeOperatorVerb(ctx.root, '/syncenv');
  });

  scoped(/^the reply names required keys as present or missing$/, (ctx) => {
    assert.match(ctx.syncenvResult.text, /MISTRAL_API_KEY: present/);
  });

  scoped(/^the reply body contains no secret values$/, (ctx) => {
    assert.doesNotMatch(ctx.syncenvResult.text, new RegExp(ctx.secretValue));
  });

  // ── Soft-tier /pause freezes promotion via control-pause marker ────
  scoped(/^the principal confirms "\/pause"$/, (ctx) => {
    mkFixtureRoot(ctx);
    ctx.pauseResult = operatorExec().executeOperatorVerb(ctx.root, '/pause');
  });

  scoped(/^control-pause\.json is active$/, (ctx) => {
    assert.equal(operatorExec().readOperatorPauseState(ctx.root).active, true);
  });

  scoped(/^no bounce sentinel is written$/, (ctx) => {
    assert.ok(!fs.existsSync(bounceSentinelPath(ctx.root)));
  });

  // ── Soft-tier /resume clears the pause marker ───────────────────────
  scoped(/^an active control pause$/, (ctx) => {
    mkFixtureRoot(ctx);
    operatorExec().writeOperatorPauseState(ctx.root, { active: true }, 'bl702-fixture');
    assert.equal(operatorExec().readOperatorPauseState(ctx.root).active, true);
  });

  scoped(/^the principal confirms "\/resume"$/, (ctx) => {
    ctx.resumeResult = operatorExec().executeOperatorVerb(ctx.root, '/resume');
  });

  scoped(/^control-pause\.json is inactive$/, (ctx) => {
    assert.equal(operatorExec().readOperatorPauseState(ctx.root).active, false);
  });

  // ── Hard-tier /start writes bounce sentinel ─────────────────────────
  scoped(/^the principal confirms "\/start"$/, (ctx) => {
    mkFixtureRoot(ctx);
    ctx.startResult = operatorExec().executeOperatorVerb(ctx.root, '/start');
  });

  scoped(/^a swarm bounce sentinel is written$/, (ctx) => {
    assert.equal(ctx.startResult.wroteBounceSentinel, true);
    assert.equal(fs.readFileSync(bounceSentinelPath(ctx.root), 'utf8'), 'swarm');
  });
}

module.exports = { registerSteps };
