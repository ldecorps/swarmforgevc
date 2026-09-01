'use strict';

// BL-1322: step handlers for "bridge startup does not require CURSOR_API_KEY
// until a Cursor prompt is actually sent". Drives the REAL bridge server
// (out/bridge/bridgeServer.js) with NO options.letsTalk.agentSession
// override, so every scenario exercises the actual production code path
// (createLiveCursorBridgeAgentSession(targetPath) at bridgeServer.ts:2026) -
// the same path the fix moved the eager resolveCursorApiKey call out of.
// Scenario 03 ("reading the stored Cursor agent id") has no HTTP surface at
// all (readAgentId is a pure in-process session method, never wired to a
// route - grepped, confirmed) so it drives the session module directly,
// same shape bl915CursorBridgeGoneAgentSessionResetSteps.js already
// established for this module.

const assert = require('node:assert/strict');
const path = require('node:path');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { createLiveCursorBridgeAgentSession } = require(path.join(EXT_DIR, 'out', 'bridge', 'cursorBridgeAgentSession'));

const FEATURE = 'bridge startup does not require CURSOR_API_KEY until a Cursor prompt is actually sent';
const TOKEN = 'bl1322-lazy-api-key-token';

// Read-only routes (/backlog) need only the bearer; a control action
// (POST /lets-talk/turn) additionally requires the X-Control-Token step-up
// header (BL-241 control-requires-step-up-04) - both point at the same
// token here since startBridge(..., TOKEN, {}) seeds one device from a bare
// token string.
function readAuth() {
  return { authorization: `Bearer ${TOKEN}` };
}

function controlAuth() {
  return { authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN };
}

// Cleanup runs via node:test's own afterEach, not steps that only run on a
// scenario's happy path - a bounce-worthy assertion failure mid-scenario
// must still stop the bridge server, or the leaked listener keeps the
// runner's process alive and hangs the whole acceptance run (hit exactly
// this while developing: a failed assertion before the old manual
// ctx.bridge.stop() call left the bridge listening and the runner timed
// out at 2 minutes instead of reporting the failure). Same shape as
// bl915CursorBridgeGoneAgentSessionResetSteps.js.
let restoreFns = [];
afterEach(() => {
  while (restoreFns.length) {
    const fn = restoreFns.pop();
    try {
      fn();
    } catch {
      // best-effort - a restore throwing must never mask the scenario's
      // own pass/fail result, which node:test has already recorded by now.
    }
  }
});

async function startRealBridge(ctx) {
  ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, {});
  restoreFns.push(() => ctx.bridge.stop());
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^CURSOR_API_KEY is not set in the environment$/, (ctx) => {
    ctx.targetPath = mkSocketFixtureRoot('bl1322-acc-');
    const prevCursorApiKey = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    restoreFns.push(() => {
      if (prevCursorApiKey === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = prevCursorApiKey;
    });
  });

  scoped(/^CURSOR_API_KEY is not set in swarm\.env$/, () => {
    // No-op assertion: mkSocketFixtureRoot hands back a bare, freshly-minted
    // directory with no .swarmforge/swarm.env file at all, and
    // readSwarmEnvValue (swarmEnv.ts) returns undefined when that file is
    // absent - so this precondition holds by construction, nothing to write.
  });

  // ── When: the bridge server is started (scenario 01, no precondition) ──
  scoped(/^the bridge server is started for a target with no Let's Talk agent session override$/, async (ctx) => {
    try {
      await startRealBridge(ctx);
      ctx.startError = null;
    } catch (err) {
      ctx.startError = err;
    }
  });

  // ── Given: the bridge server has started (scenarios 02-04, precondition) ─
  scoped(/^the bridge server has started for a target with no Let's Talk agent session override$/, async (ctx) => {
    await startRealBridge(ctx);
  });

  scoped(/^bridge startup succeeds without throwing$/, (ctx) => {
    assert.equal(ctx.startError, null, `expected no error, got: ${ctx.startError && ctx.startError.message}`);
    assert.ok(ctx.bridge, 'expected a running bridge handle');
  });

  // ── Scenario 02: a non-Cursor route ─────────────────────────────────────
  scoped(/^a request is made to a bridge route that never exercises Cursor \/ Let's Talk routing$/, async (ctx) => {
    ctx.response = await fetch(`http://127.0.0.1:${ctx.bridge.port}/backlog`, { headers: readAuth() });
    ctx.responseBody = await ctx.response.json();
  });

  scoped(/^the request is served normally$/, (ctx) => {
    assert.equal(ctx.response.status, 200, `expected 200, got ${ctx.response.status}: ${JSON.stringify(ctx.responseBody)}`);
    assert.deepEqual(ctx.responseBody, { active: [], paused: [], done: [], hold: [] });
  });

  // ── Scenario 03: reading the stored agent id ────────────────────────────
  scoped(/^the stored Cursor agent id is read$/, (ctx) => {
    try {
      const session = createLiveCursorBridgeAgentSession(ctx.targetPath);
      ctx.readAgentIdResult = session.readAgentId();
      ctx.readAgentIdError = null;
    } catch (err) {
      ctx.readAgentIdError = err;
    }
  });

  scoped(/^the read succeeds without requiring CURSOR_API_KEY$/, (ctx) => {
    assert.equal(
      ctx.readAgentIdError,
      null,
      `expected readAgentId to succeed, got: ${ctx.readAgentIdError && ctx.readAgentIdError.message}`
    );
    assert.equal(ctx.readAgentIdResult, undefined, 'expected no stored agentId in a fresh fixture');
  });

  // ── Scenario 04: a real Let's Talk turn still fails loud ───────────────
  scoped(/^a Let's Talk turn is submitted$/, async (ctx) => {
    ctx.response = await fetch(`http://127.0.0.1:${ctx.bridge.port}/lets-talk/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...controlAuth() },
      body: JSON.stringify({ text: 'hello' }),
    });
    ctx.responseBody = await ctx.response.json();
  });

  scoped(/^the request fails with the CURSOR_API_KEY missing error$/, (ctx) => {
    assert.equal(ctx.responseBody.success, false, `expected a failed turn, got: ${JSON.stringify(ctx.responseBody)}`);
    assert.match(ctx.responseBody.reason, /CURSOR_API_KEY is not set for the headless bridge/);
  });

  scoped(/^the operator is told to set CURSOR_API_KEY in swarm\.env and restart the bridge supervisor$/, (ctx) => {
    assert.match(ctx.responseBody.reason, /\.swarmforge\/swarm\.env/);
    assert.match(ctx.responseBody.reason, /restart the bridge supervisor/);
  });
}

module.exports = { registerSteps };
