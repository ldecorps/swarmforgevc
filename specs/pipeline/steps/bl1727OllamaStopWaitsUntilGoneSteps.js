'use strict';

// BL-1727: step handlers for "stopping a started ollama server waits until
// it is gone". Drives the REAL ollama_ancillary_lib.sh (sourced, never
// reimplemented) via a stand-in `ollama` binary and real short-lived
// processes (extension/test/helpers/ollamaStopPidFixture.js) - never the
// real server, never port 11434.

const assert = require('node:assert/strict');
const { makeStopPidFixture } = require('../../../extension/test/helpers/ollamaStopPidFixture');

const FEATURE = 'BL-1727 Stopping a started ollama server waits until it is gone';

// Short bounds so the outline's "ignores TERM" row escalates to KILL in
// about a second rather than the lib's real-world default (5s TERM grace);
// "exits two seconds after receiving TERM" still takes the real ~2s its
// own fixture behaviour needs, regardless of the bound.
const FAST_BOUNDS = {
  OLLAMA_ANCILLARY_STOP_TERM_GRACE_SECONDS: '1',
  OLLAMA_ANCILLARY_STOP_KILL_GRACE_SECONDS: '1',
  OLLAMA_ANCILLARY_STOP_POLL_INTERVAL_SECONDS: '1',
};

const BEHAVIOUR_SETUP = {
  'exits two seconds after receiving TERM': (ctx) => {
    ctx.pid = ctx.fixture.startProcess('exits-after-term');
  },
  'ignores TERM': (ctx) => {
    ctx.pid = ctx.fixture.startProcess('ignores-term');
  },
  'has already exited': (ctx) => {
    ctx.pid = ctx.fixture.startProcess('already-exited');
    const gone = ctx.fixture.waitUntilGone(ctx.pid, 3000);
    assert.ok(gone, `expected pid ${ctx.pid} to have exited on its own before the stop helper is called`);
  },
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture process started the way the launch starts the ollama server$/, (ctx) => {
    ctx.fixture = makeStopPidFixture();
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => {
      ctx.fixture.cleanup();
    });
  });

  // ── Scenario Outline 01 ──────────────────────────────────────────────
  scoped(
    /^the process (exits two seconds after receiving TERM|ignores TERM|has already exited)$/,
    (ctx, behaviour) => {
      BEHAVIOUR_SETUP[behaviour](ctx);
    }
  );

  // Shared with Scenario 02 below - same step text, so the branch on
  // ctx.unsignallable (set only by Scenario 02's own Given) is what tells
  // the two apart, not a second copy of this step.
  scoped(/^the stop helper is called on its pid$/, (ctx) => {
    ctx.result = ctx.fixture.runStopPid(ctx.pid, { envOverrides: FAST_BOUNDS, unsignallable: !!ctx.unsignallable });
  });

  scoped(/^the helper succeeds$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}: ${ctx.result.stderr}`);
  });

  scoped(/^the pid is not alive the moment the helper returns$/, (ctx) => {
    assert.equal(ctx.fixture.pidAlive(ctx.pid), false, `expected pid ${ctx.pid} to be stopped`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the process cannot be signalled by this user$/, (ctx) => {
    ctx.pid = ctx.fixture.startProcess('ignores-term');
    ctx.unsignallable = true;
  });

  scoped(/^the helper fails naming the pid that is still alive$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected a nonzero exit, got ${ctx.result.status}`);
    assert.ok(
      ctx.result.stderr.includes(String(ctx.pid)),
      `expected the failure to name pid ${ctx.pid}, got: ${ctx.result.stderr}`
    );
    ctx.fixture.killReal(ctx.pid);
  });
}

module.exports = { registerSteps };
