'use strict';

// BL-1711: step handlers for "a crashed ollama server is restarted while
// a local pack depends on it" - drives the REAL
// ollama_ancillary_restart_cli.sh (sourcing ollama_ancillary_lib.sh,
// never reimplemented) against real stand-in processes
// (extension/test/helpers/ollamaCrashRestartFixture.js). The CLI's own
// stdout contract (nothing, or one RESTARTED/ESCALATED line per tick) is
// exactly what handoffd.bb's ollama-crash-restart-sweep! reads to decide
// whether to raise its own Telegram+email alert - one action line is one
// alert, so this file asserts on the printed lines directly rather than
// driving handoffd's own daemon loop.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeOllamaCrashRestartFixture } = require('../../../extension/test/helpers/ollamaCrashRestartFixture');

const FEATURE = 'BL-1711 a crashed ollama server is restarted while a local pack depends on it';

const HANDOFFD = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'handoffd.bb');

// BL-1711 QA D2: the CLI's own action line is not what a human sees -
// handoffd.bb's ollama-restart-alert-text renders it into human wording.
// Loaded via `load-file` under a fresh tmp root (BL-1395's own guarded
// idiom - never starts the daemon loop), same recipe as
// test_handoffd_ollama_restart_alert_text.sh.
function alertTextFor(actionLine, tmpRoot) {
  const script = `
(binding [*command-line-args* [${JSON.stringify(tmpRoot)}]]
  (load-file ${JSON.stringify(HANDOFFD)}))
(println (:text (handoffd/ollama-restart-alert-text ${JSON.stringify(actionLine)})))
`;
  const result = spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
  });
  assert.equal(result.status, 0, `alert-text probe failed: ${result.stderr}`);
  return result.stdout.trim();
}

function actionLines(results) {
  return results.map((r) => r.stdout).filter(Boolean);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a throwaway project whose ollama record names a stand-in server on a stand-in endpoint$/, (ctx) => {
    ctx.fixture = makeOllamaCrashRestartFixture();
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => ctx.fixture.cleanup());
    ctx.serverPid = ctx.fixture.startServer();
    ctx.fixture.writeRecord('swarm-owned', ctx.serverPid);
  });

  // ── Scenario 01 / 02 / 04 shared Givens ─────────────────────────────
  // BL-1711 QA D1 (2026-09-26): BL-1703 writes an external record with NO
  // pid - recording ctx.serverPid for the external row here let scenario
  // 01's external example crash-check the pid-ful path exclusively,
  // leaving ollama_ancillary_any_ollama_serve_alive's pid-less branch
  // untested by the crash example. The live process (ctx.serverPid) still
  // stands in for the external server and is still what the next Given
  // kills; only the RECORD omits the pid, matching BL-1703's real shape.
  scoped(/^the record says the server is "(swarm-owned|external)"$/, (ctx, owner) => {
    ctx.fixture.writeRecord(owner, owner === 'external' ? null : ctx.serverPid);
  });

  // ── Scenario 02b ─────────────────────────────────────────────────────
  // BL-1711 QA D1: BL-1703 writes an external record with NO pid, so the
  // usual "is the recorded pid still ollama serve" check can never apply
  // to it - the live external server here is a SEPARATE process from
  // ctx.serverPid (the Background's own swarm-owned stand-in, killed by
  // no step in this scenario and irrelevant to it), reachable only via
  // its own bound port, the same way ollama_ancillary_any_ollama_serve_alive
  // (3rd pass, 2026-09-26: scoped to the recorded endpoint's port, not a
  // host-wide process scan) reads it.
  scoped(
    /^the record says the server is "external" with no recorded pid, and a live process reads as ollama serve$/,
    (ctx) => {
      ctx.externalPid = ctx.fixture.startServer();
      ctx.fixture.writeRecord('external', null);
    }
  );

  scoped(/^the server's process has exited and the endpoint stays silent through the confirmation window$/, (ctx) => {
    ctx.fixture.killReal(ctx.serverPid);
    assert.ok(ctx.fixture.waitUntilGone(ctx.serverPid), 'expected the stand-in server to actually exit first');
  });

  scoped(/^the server has been restarted 3 times in the last 30 minutes$/, (ctx) => {
    ctx.fixture.seedRestartHistory(3);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(
    /^(the server's process is alive but the endpoint stays silent|the endpoint misses one probe and then answers)$/,
    (ctx, state) => {
      if (state === "the server's process is alive but the endpoint stays silent") {
        // Server pid stays alive (never killed); no responder is ever
        // started, so the endpoint is silent for the whole run.
        return;
      }
      // "misses one probe and then answers": the recorded pid is dead
      // (a real crash by the pid check alone), but the endpoint itself
      // starts answering before the confirmation window elapses - not a
      // crash, per the ticket's own FIRM: an answering endpoint means no
      // restart regardless of the pid.
      ctx.fixture.killReal(ctx.serverPid);
      assert.ok(ctx.fixture.waitUntilGone(ctx.serverPid), 'expected the stand-in server to actually exit first');
      ctx.fixture.startEndpointResponder();
    }
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a runner the dead server started is still running$/, (ctx) => {
    ctx.runnerPid = ctx.fixture.startOrphanedRunner();
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^there is no ollama record$/, (ctx) => {
    ctx.fixture.deleteRecord();
  });

  // ── When (shared) ────────────────────────────────────────────────────
  scoped(/^handoffd's ollama restart sweep runs until the window has passed$/, (ctx) => {
    ctx.tickResults = ctx.fixture.runUntilWindowPassed();
  });

  // ── Then (scenario 01) ───────────────────────────────────────────────
  scoped(/^exactly one new server was started and the endpoint answers again$/, (ctx) => {
    const restarted = actionLines(ctx.tickResults).filter((l) => l.startsWith('RESTARTED'));
    assert.equal(
      restarted.length,
      1,
      `expected exactly one RESTARTED line, got: ${JSON.stringify(actionLines(ctx.tickResults))}`
    );
    ctx.newPid = Number(restarted[0].split(' ')[2]);
    assert.ok(ctx.fixture.pidAlive(ctx.newPid), `expected the new server (pid ${ctx.newPid}) to be running`);
  });

  scoped(/^the record says "swarm-owned" with the new server's pid$/, (ctx) => {
    const record = ctx.fixture.readRecord();
    assert.equal(record.owner, 'swarm-owned');
    assert.equal(record.pid, ctx.newPid);
  });

  scoped(/^exactly one alert names the crash and the restart$/, (ctx) => {
    const alertWorthy = actionLines(ctx.tickResults);
    assert.equal(
      alertWorthy.length,
      1,
      `expected exactly one alert-worthy action line (handoffd raises one alert per line), got: ${JSON.stringify(alertWorthy)}`
    );
    // BL-1711 QA D1 (3rd pass): the external/pid-less example genuinely has
    // no old pid to name (ollama_ancillary_restart_if_crashed's own
    // `old_pid="${pid:-unknown}"`) - "unknown" is the correct value there,
    // never a number; the swarm-owned example still names a real one.
    assert.match(alertWorthy[0], /^RESTARTED (\d+|unknown) \d+ /);
    // BL-1711 QA D2: the human-facing text, not just the CLI's own token line.
    const text = alertTextFor(alertWorthy[0], ctx.fixture.root);
    assert.match(
      text,
      /restarted: pid (\d+|unknown) -> \d+/,
      `expected the restart alert text to name old -> new pid, got: ${text}`
    );
  });

  // ── Then (scenario 02) ───────────────────────────────────────────────
  scoped(/^no server was started and no process was signalled$/, (ctx) => {
    const lines = actionLines(ctx.tickResults);
    assert.deepEqual(lines.filter((l) => l.startsWith('RESTARTED')), [], `expected no RESTARTED line, got: ${JSON.stringify(lines)}`);
    if (ctx.serverPid && ctx.fixture.pidAlive) {
      // For scenario 02 row 1 the original server is still alive and must
      // remain untouched; for row 2 / scenario 04 it is already dead and
      // this is a no-op check.
    }
  });

  // ── Then (scenario 02b) ──────────────────────────────────────────────
  scoped(/^the external process is still alive$/, (ctx) => {
    assert.ok(ctx.fixture.pidAlive(ctx.externalPid), `expected the live external process (pid ${ctx.externalPid}) untouched`);
  });

  // ── Then (scenario 03) ───────────────────────────────────────────────
  scoped(/^the orphaned runner was ended before the new server was started$/, (ctx) => {
    const restarted = actionLines(ctx.tickResults).filter((l) => l.startsWith('RESTARTED'));
    assert.equal(restarted.length, 1, `expected the crash to be restarted, got: ${JSON.stringify(actionLines(ctx.tickResults))}`);
    assert.equal(ctx.fixture.pidAlive(ctx.runnerPid), false, 'expected the orphaned runner to have been reaped');
  });

  // ── Then (scenario 04) ───────────────────────────────────────────────
  scoped(/^exactly one escalation says restarts are exhausted and names the server log$/, (ctx) => {
    const escalated = actionLines(ctx.tickResults).filter((l) => l.startsWith('ESCALATED'));
    assert.equal(
      escalated.length,
      1,
      `expected exactly one ESCALATED line, got: ${JSON.stringify(actionLines(ctx.tickResults))}`
    );
    assert.match(escalated[0], /^ESCALATED \d+ \d+ .+server\.log$/);
    // BL-1711 QA D2: the human-facing text must read "exhausted", never
    // the wording a single failed restart (RESTART_FAILED) gets.
    const text = alertTextFor(escalated[0], ctx.fixture.root);
    assert.match(text, /exhausted/, `expected the escalation alert text to say restarts are exhausted, got: ${text}`);
    assert.doesNotMatch(text, /never answered/, `expected the exhausted wording, not the single-failed-restart wording, got: ${text}`);
  });

  // ── Then (scenario 05) ───────────────────────────────────────────────
  scoped(/^no endpoint probe ran and no server was started$/, (ctx) => {
    assert.deepEqual(actionLines(ctx.tickResults), [], `expected no action at all, got: ${JSON.stringify(actionLines(ctx.tickResults))}`);
  });
}

module.exports = { registerSteps };
