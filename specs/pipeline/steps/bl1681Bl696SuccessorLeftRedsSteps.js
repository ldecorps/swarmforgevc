'use strict';

// BL-1681: step handlers for "BL-696's two successor-left scenarios
// retire, and the recoverability contract survives as a server-half
// scenario". Scenario 01 drives the REAL bridge server
// (extension/out/bridge/bridgeServer.js) through the same startBridge +
// letsTalk-mock fixture bl696LetsTalkSteps.js already uses, posting to
// the real /lets-talk/turn route twice - never a reimplementation of
// processLetsTalkTurn's retry/recoverability decision. Scenario 02
// spawns the REAL acceptance CLI (specs/pipeline/cli.js) against each of
// BL-696's own two feature files in a child process and reads its real
// TAP output - never a re-derivation of what those features assert.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sweepStaleTmpDirs } = require('../../../extension/test/helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'cli.js');
const FEATURES_DIR = path.join(REPO_ROOT, 'specs', 'features');

const FEATURE = "BL-1681 BL-696's two successor-left scenarios retire, and the recoverability contract survives as a server-half scenario";
const TOKEN = 'bl1681-recoverability-token';
const SAMPLE_AUDIO = Buffer.from('fake-audio-bytes').toString('base64');
const FIXTURE_PREFIX = 'sfvc-bl1681-';

// BL-1658: paths only - bridgeServer.js itself eagerly requires
// cursorBridgeAgentSession, so a mere require() of this file must not pay
// for the whole heavy production graph (@cursor/sdk etc.) through that
// transitive edge. Required once, on first use, and cached.
let _lib = null;
function lib() {
  if (!_lib) {
    _lib = {
      ...require(path.join(REPO_ROOT, 'extension', 'out', 'bridge', 'bridgeServer')),
      ...require(path.join(REPO_ROOT, 'extension', 'out', 'bridge', 'cursorBridgeAgentSession')),
    };
  }
  return _lib;
}

// BL-971/BL-1636/BL-968: a killed run traps no `finally`, so the previous
// run's fixture is swept by prefix BEFORE this one starts too - scoped by
// owner pid through the shared helper, never a blind prefix sweep
// (BL-1385/BL-1390's shape). Called from inside the step, never at module
// load (BL-968 invariant: module load is requires and pure constants only).
function mkFixture() {
  sweepStaleTmpDirs({ prefix: FIXTURE_PREFIX });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_PREFIX}${process.pid}-`));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function controlAuthHeaders() {
  return {
    authorization: `Bearer ${TOKEN}`,
    'x-control-token': TOKEN,
    'content-type': 'application/json',
  };
}

// The same "STT fails once, then succeeds" mock shape
// bl696LetsTalkSteps.js's own buildLetsTalkMocks uses for its (now
// retired) lets-talk-06 - the fixture, not the assertion, is what this
// ticket says to reuse.
function buildTransientFailureThenSuccessMocks(ctx) {
  return {
    agentSession: lib().createMockCursorBridgeAgentSession(ctx.root),
    transcribeAudio: async () => {
      ctx.sttCalls += 1;
      if (ctx.sttCalls === 1) {
        return { kind: 'transient-failure' };
      }
      return { kind: 'ok', transcript: 'hello after retry' };
    },
    synthesizeSpeech: async (text) => ({ kind: 'ok', audio: Buffer.from(`tts:${text}`) }),
  };
}

async function withBridge(ctx, fn) {
  const handle = await lib().startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {
    letsTalk: buildTransientFailureThenSuccessMocks(ctx),
  });
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

async function submitTurn(ctx) {
  await withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/turn`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ audioBase64: SAMPLE_AUDIO, mimeType: 'audio/webm' }),
    });
    ctx.turnStatus = res.status;
    ctx.turnResult = await res.json();
  });
}

function runFeatureAcceptance(featureBasename) {
  const featurePath = path.join(FEATURES_DIR, featureBasename);
  const result = spawnSync(process.execPath, [CLI, featurePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ...result, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: the recoverability contract, over the real route ──────
  scoped(/^a running Let's Talk bridge whose speech-to-text fails transiently once then succeeds$/, (ctx) => {
    ctx.root = mkFixture();
    ctx.sttCalls = 0;
  });

  scoped(/^a spoken turn is submitted to the audio turn route$/, async (ctx) => {
    await submitTurn(ctx);
  });

  scoped(/^the response reports the turn as not successful, recoverable, in state "([^"]+)"$/, (ctx, state) => {
    assert.equal(ctx.turnResult.success, false, `expected an unsuccessful first turn, got: ${JSON.stringify(ctx.turnResult)}`);
    assert.equal(ctx.turnResult.recoverable, true, `expected recoverable: true, got: ${JSON.stringify(ctx.turnResult)}`);
    assert.equal(ctx.turnResult.state, state, `expected state "${state}", got: ${JSON.stringify(ctx.turnResult)}`);
  });

  scoped(/^the same spoken turn is submitted again$/, async (ctx) => {
    await submitTurn(ctx);
  });

  scoped(/^the response reports success with a spoken reply$/, (ctx) => {
    assert.equal(ctx.turnResult.success, true, `expected the retried turn to succeed, got: ${JSON.stringify(ctx.turnResult)}`);
    assert.ok(ctx.turnResult.replyAudioBase64, 'expected a spoken reply on the successful retry');
  });

  // ── Scenario 02: both BL-696 features run green, retired names gone ────
  scoped(/^(.+) is run through the acceptance runner in a child process$/, (ctx, feature) => {
    ctx.acceptanceFeature = feature;
    ctx.acceptanceRun = runFeatureAcceptance(feature);
  });

  scoped(/^every scenario passes$/, (ctx) => {
    const { status, stdout, stderr } = ctx.acceptanceRun;
    assert.equal(
      status,
      0,
      `expected ${ctx.acceptanceFeature} to run clean (exit 0), got ${status}:\n${stdout}\n${stderr}`
    );
    assert.doesNotMatch(stdout, /^not ok /m, `expected no failing scenario in ${ctx.acceptanceFeature}:\n${stdout}`);
  });

  scoped(/^no scenario is named "([^"]+)"$/, (ctx, retiredName) => {
    assert.ok(
      !ctx.acceptanceRun.stdout.includes(retiredName),
      `expected "${retiredName}" to be retired, but it still appears in ${ctx.acceptanceFeature}'s run`
    );
  });

  scoped(/^the feature has exactly (\d+) scenarios$/, (ctx, count) => {
    const match = ctx.acceptanceRun.stdout.match(/^1\.\.(\d+)$/m);
    assert.ok(match, `expected a TAP "1..N" plan line in ${ctx.acceptanceFeature}'s output:\n${ctx.acceptanceRun.stdout}`);
    assert.equal(
      Number(match[1]),
      Number(count),
      `expected ${count} scenarios in ${ctx.acceptanceFeature}, TAP plan named ${match[1]}`
    );
  });
}

module.exports = { registerSteps };
