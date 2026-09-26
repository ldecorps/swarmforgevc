'use strict';

// BL-1704: step handlers for "the swarm stop paths stop the ollama server
// the swarm started". Drives the REAL stop paths
// (stop_ancillary_services.sh, kill_all_swarm.sh) and the REAL
// ollama_ancillary_lib.sh (sourced by both, never reimplemented) against
// REAL stand-in ollama processes (extension/test/helpers/ollamaStopPathsFixture.js)
// - never the real ollama binary, never port 11434.

const assert = require('node:assert/strict');
const { makeOllamaStopPathsFixture } = require('../../../extension/test/helpers/ollamaStopPathsFixture');

const FEATURE = 'BL-1704 the swarm stop paths stop the ollama server the swarm started';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a throwaway project with a stand-in ollama server and one runner child$/, async (ctx) => {
    ctx.fixture = makeOllamaStopPathsFixture();
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => ctx.fixture.cleanup());
    const { serverPid, runnerPid } = await ctx.fixture.startServerAndRunner();
    ctx.serverPid = serverPid;
    ctx.runnerPid = runnerPid;
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the ollama record says the server is "(swarm-owned|external)"$/, (ctx, owner) => {
    ctx.fixture.writeRecord(owner, owner === 'swarm-owned' ? ctx.serverPid : undefined);
  });

  scoped(/^the operator runs "(the full-stack stop|kill_all_swarm)"$/, (ctx, stopPath) => {
    ctx.stopResult = ctx.fixture.runStopPath(stopPath);
  });

  scoped(/^neither the server nor its runner child is running$/, (ctx) => {
    assert.ok(
      ctx.fixture.waitUntilGone(ctx.serverPid),
      `expected the server (pid ${ctx.serverPid}) to be stopped: ${ctx.stopResult.stderr}`
    );
    assert.ok(
      ctx.fixture.waitUntilGone(ctx.runnerPid),
      `expected the runner child (pid ${ctx.runnerPid}) to be stopped: ${ctx.stopResult.stderr}`
    );
  });

  scoped(/^the ollama record is gone$/, (ctx) => {
    assert.equal(ctx.fixture.recordExists(), false, 'expected the ollama record to have been removed');
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the server and its runner child are still running$/, (ctx) => {
    assert.ok(ctx.fixture.pidAlive(ctx.serverPid), `expected the external server (pid ${ctx.serverPid}) untouched`);
    assert.ok(
      ctx.fixture.pidAlive(ctx.runnerPid),
      `expected the external server's runner (pid ${ctx.runnerPid}) untouched`
    );
  });

  scoped(/^the stop log names the external server as left running$/, (ctx) => {
    assert.match(ctx.stopResult.stderr, /ollama-ancillary: leaving an external ollama server running/);
    assert.match(ctx.stopResult.stderr, /127\.0\.0\.1:11434/);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(
    /^the ollama record says the server is swarm-owned with a pid that (is no longer running|now belongs to a process that is not ollama serve)$/,
    (ctx, pidState) => {
      ctx.pidState = pidState;
      if (pidState === 'is no longer running') {
        // A pid guaranteed not to be alive: stop the real stand-in server
        // AND its runner child together (QA D1, 2026-09-26 - a
        // server-less "ollama runner" left alive here collides with the
        // live swarm's own real ghost janitor scanning this host), wait
        // for the server to actually be gone, then record its (now dead)
        // pid - never a guessed/huge literal pid. "No process was
        // signalled" is then checked against a fresh untitled process
        // instead of the (now also deliberately dead) runner.
        ctx.fixture.killServerAndRunner();
        assert.ok(ctx.fixture.waitUntilGone(ctx.serverPid), 'expected the stand-in server to actually exit first');
        ctx.fixture.writeRecord('swarm-owned', ctx.serverPid);
        ctx.untouchedPid = ctx.fixture.startUnrelatedProcess();
      } else {
        const unrelatedPid = ctx.fixture.startUnrelatedProcess();
        ctx.unrelatedPid = unrelatedPid;
        ctx.fixture.writeRecord('swarm-owned', unrelatedPid);
      }
    }
  );

  scoped(/^no process was signalled$/, (ctx) => {
    // A process never named by the stale/reused record must still be
    // untouched - proof that nothing was signalled beyond what the
    // record itself named. Example 1 ("is no longer running") already
    // deliberately killed the runner alongside its server (QA D1,
    // 2026-09-26), so it checks a fresh untitled process instead; example
    // 2 ("now belongs to...") never touches the runner, so it still
    // checks that.
    if (ctx.untouchedPid) {
      assert.ok(ctx.fixture.pidAlive(ctx.untouchedPid), 'expected the untouched stand-in process to still be alive');
    } else {
      assert.ok(ctx.fixture.pidAlive(ctx.runnerPid), 'expected the untouched runner child to still be alive');
    }
    if (ctx.unrelatedPid) {
      assert.ok(ctx.fixture.pidAlive(ctx.unrelatedPid), 'expected the unrelated process to be left untouched');
    }
  });

  scoped(/^the ollama record is gone and the stop log says why$/, (ctx) => {
    assert.equal(ctx.fixture.recordExists(), false, 'expected the stale/reused record to have been removed');
    // BL-1704 QA D1: the two examples must read differently in the log -
    // a dead pid is never worded the same as one recycled by another
    // process, so this asserts the PER-EXAMPLE wording, not a shared
    // regex loose enough to pass either way.
    if (ctx.pidState === 'is no longer running') {
      assert.match(
        ctx.stopResult.stderr,
        /ollama-ancillary: recorded swarm-owned ollama server \(pid .*\) is gone - clearing the stale record/
      );
    } else {
      assert.match(
        ctx.stopResult.stderr,
        /ollama-ancillary: recorded swarm-owned ollama server \(pid .*\) now belongs to .* - clearing the stale record/
      );
    }
  });
}

module.exports = { registerSteps };
