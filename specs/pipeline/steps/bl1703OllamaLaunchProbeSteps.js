'use strict';

// BL-1703: step handlers for "a pack with a local model endpoint starts
// and probes ollama before it launches". Drives the REAL
// ollama_ancillary_lib.sh (sourced, never reimplemented) via a stand-in
// `ollama` binary and a stand-in HTTP responder - never the real server,
// never port 11434 (extension/test/helpers/ollamaAncillaryFixture.js).

const assert = require('node:assert/strict');
const path = require('node:path');
const { makeOllamaAncillaryFixture, findFreePort } = require('../../../extension/test/helpers/ollamaAncillaryFixture');

const FEATURE = 'BL-1703 a pack with a local model endpoint starts and probes ollama before it launches';

const STATE_SETUP = {
  'already answers': async (ctx) => {
    ctx.fixture.startExternalResponder(ctx.port);
    await new Promise((resolve) => setTimeout(resolve, 300));
  },
  'is silent until the swarm starts the server': (ctx) => {
    ctx.fixture.setMode('answers');
  },
  'never answers within the wait': (ctx) => {
    ctx.fixture.setMode('never');
    ctx.waitSeconds = 2;
  },
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a throwaway project whose launch uses a stand-in ollama binary$/, async (ctx) => {
    ctx.fixture = makeOllamaAncillaryFixture();
    ctx.port = await findFreePort();
    ctx.waitSeconds = 3;
    ctx.stateDir = path.join(ctx.fixture.root, 'state');
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => {
      ctx.fixture.cleanup();
    });
  });

  // ── Scenario 01 (Outline) / 02 shared Given ─────────────────────────
  scoped(/^the pack's seats use the local model endpoint$/, (ctx) => {
    ctx.usesLocal = 'yes';
  });

  scoped(/^the endpoint (already answers|is silent until the swarm starts the server|never answers within the wait)$/, async (ctx, state) => {
    ctx.state = state;
    await STATE_SETUP[state](ctx);
  });

  scoped(/^the pack is launched$/, (ctx) => {
    ctx.result = ctx.fixture.run({
      usesLocal: ctx.usesLocal,
      url: `http://127.0.0.1:${ctx.port}/v1`,
      stateDir: ctx.stateDir,
      binary: 'ollama',
      waitSeconds: ctx.waitSeconds,
      pollInterval: 1,
      logPath: path.join(ctx.stateDir, 'ollama', 'serve.log'),
      port: ctx.port,
    });
    ctx.record = ctx.fixture.readRecord(ctx.stateDir);
  });

  const RESULT_CHECKS = {
    'proceeds without starting a server': (ctx) => {
      assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}: ${ctx.result.stderr}`);
      assert.equal(ctx.fixture.ollamaInvoked(), false, 'expected the ollama binary never to run');
    },
    'starts the server once and proceeds when it answers': (ctx) => {
      assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}: ${ctx.result.stderr}`);
      assert.equal(ctx.fixture.ollamaInvoked(), true, 'expected the ollama binary to have run');
    },
    'refuses before any seat starts, naming the endpoint': (ctx) => {
      assert.equal(ctx.result.status, 1, `expected exit 1, got ${ctx.result.status}`);
      assert.ok(
        ctx.result.stderr.includes(`127.0.0.1:${ctx.port}`),
        `expected the refusal to name the endpoint, got: ${ctx.result.stderr}`
      );
    },
  };

  scoped(
    /^the launch (proceeds without starting a server|starts the server once and proceeds when it answers|refuses before any seat starts, naming the endpoint)$/,
    (ctx, result) => {
      RESULT_CHECKS[result](ctx);
    }
  );

  scoped(/^the ollama record says "([^"]+)"$/, (ctx, owner) => {
    if (owner === 'none') {
      assert.equal(ctx.record, null, `expected no ollama record, got: ${JSON.stringify(ctx.record)}`);
      return;
    }
    assert.ok(ctx.record, 'expected an ollama record');
    assert.equal(ctx.record.owner, owner, `expected owner ${owner}, got: ${JSON.stringify(ctx.record)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^no ollama process the launch started is still running$/, (ctx) => {
    const startedPid = ctx.fixture.startedServerPid();
    assert.ok(startedPid, 'expected the launch to have started a server to check');
    assert.equal(ctx.fixture.pidAlive(startedPid), false, `expected pid ${startedPid} to be stopped`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the pack's seats all run Claude$/, (ctx) => {
    ctx.usesLocal = 'no';
  });

  scoped(/^no endpoint probe ran, no ollama process was started and no ollama record exists$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}: ${ctx.result.stderr}`);
    assert.equal(ctx.fixture.ollamaInvoked(), false, 'expected the ollama binary never to run');
    assert.equal(ctx.record, null, `expected no ollama record, got: ${JSON.stringify(ctx.record)}`);
  });
}

module.exports = { registerSteps };
