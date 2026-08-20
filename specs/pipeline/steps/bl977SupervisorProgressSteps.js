'use strict';

// BL-977: step handlers for "the supervisor never halts a daemon that is
// demonstrably progressing". Scenarios 01-02 drive the REAL pure
// evaluate-health (loaded from handoffd_supervisor.bb itself, bl813's
// stop-file load pattern) with the REAL in-sweep budget constant; 03 and
// 05 run the REAL `--check-once` path over a fixture root (fake tmux bin,
// aged heartbeat/outbox files, a live placeholder pid); 04 watches the
// REAL run-sweep! + installed marker writer from OUTSIDE the process.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SUPERVISOR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd_supervisor.bb');
const GUARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'daemon_cycle_guard_lib.bb');

const FEATURE = 'BL-977 the supervisor never halts a daemon that is demonstrably progressing';

const STALL_MS = 30000;

// KNOWN_VALUES: the outline's marker tokens -> in-flight sweep age (ms),
// null meaning "no qualifying marker" (idle and absent are deliberately
// the same observation; the distinct fixture halves live in scenario 04).
const KNOWN_MARKERS = {
  'sweep-87000ms': 87000,
  'sweep-31000ms': 31000,
  'sweep-235000ms': 235000,
  'sweep-1000ms': 1000,
  idle: null,
  absent: null,
};
const KNOWN_VERDICTS = new Set(['healthy', 'stalled', 'dead']);

let trackedRoots = [];
let trackedPids = [];

afterEach(() => {
  while (trackedPids.length) {
    try {
      process.kill(trackedPids.pop());
    } catch {
      // already gone
    }
  }
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

// The pure verdict, from the REAL evaluate-health and the REAL
// in-sweep-budget default, via bl813's stop-file load pattern.
function evaluateHealth(obs) {
  // The supervisor ns is created by load-file at RUNTIME, so every
  // reference to it must sit in a LATER top-level form - a single let
  // wrapping both fails sci analysis (same shape as the bb
  // require-alias-invisible-in-same-form rule).
  const expr = `
(require '[babashka.fs :as fs])
(def root (str (fs/create-temp-dir {:prefix "bl977-eval-"})))
(fs/create-dirs (fs/path root ".swarmforge" "daemon"))
(spit (str (fs/path root ".swarmforge" "daemon" "stop")) "")
(binding [*command-line-args* [root]]
  (load-file ${JSON.stringify(SUPERVISOR)}))
(def verdict (handoffd-supervisor/evaluate-health
              {:alive? ${obs.alive}
               :heartbeat-age-ms ${obs.heartbeatAgeMs === null ? 'nil' : obs.heartbeatAgeMs}
               :pending-outbox-age-ms ${obs.pendingOutboxAgeMs}
               :stall-ms ${STALL_MS}
               :in-flight-sweep-age-ms ${obs.inFlightAgeMs === null ? 'nil' : obs.inFlightAgeMs}
               :in-sweep-budget-ms handoffd-supervisor/in-sweep-budget-ms}))
(fs/delete-tree root)
(print (name verdict))
`;
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8', env: checkEnv() }).trim();
}

function checkEnv() {
  const env = { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1', SWARMFORGE_TERMINAL_BACKEND: 'none' };
  delete env.RESEND_API_KEY;
  delete env.SUPERVISOR_STALL_MS;
  delete env.SUPERVISOR_IN_SWEEP_BUDGET_MS;
  return env;
}

function mkSupervisorFixture(ctx) {
  ctx.root = fs.realpathSync(mkSocketFixtureRoot('bl977-'));
  trackedRoots.push(ctx.root);
  ctx.daemonDir = path.join(ctx.root, '.swarmforge', 'daemon');
  const coderWt = path.join(ctx.root, '.worktrees', 'coder');
  ctx.outboxDir = path.join(coderWt, '.swarmforge', 'handoffs', 'outbox');
  fs.mkdirSync(ctx.daemonDir, { recursive: true });
  fs.mkdirSync(ctx.outboxDir, { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'tmux-socket'), `${ctx.root}/fake.sock\n`);
  fs.writeFileSync(path.join(ctx.root, 'fake.sock'), '');
  fs.writeFileSync(
    path.join(ctx.root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  const fakeBin = path.join(ctx.root, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeTmux = path.join(fakeBin, 'tmux');
  fs.writeFileSync(fakeTmux, `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(path.join(ctx.root, 'tmux-calls.log'))}\nexit 0\n`);
  fs.chmodSync(fakeTmux, 0o755);
  // Pay the fresh-executable assessment cost outside any timed window.
  spawnSync(fakeTmux, [], { encoding: 'utf8' });
  ctx.fakeBin = fakeBin;

  // A live placeholder "daemon" pid.
  const child = spawn('sleep', ['300'], { detached: false, stdio: 'ignore' });
  trackedPids.push(child.pid);
  fs.writeFileSync(path.join(ctx.daemonDir, 'handoffd.pid'), `${child.pid}\n`);

  // Pending outbox mail older than the stall threshold.
  const outboxFile = path.join(ctx.outboxDir, '50_bl977.handoff');
  fs.writeFileSync(outboxFile, 'id: t\nfrom: coder\nto: coder\npriority: 50\ntype: note\nmessage: hello\n\nhello\n');
  const oldSec = (Date.now() - (STALL_MS + 30000)) / 1000;
  fs.utimesSync(outboxFile, oldSec, oldSec);
}

function ageHeartbeat(ctx, ageMs) {
  const hb = path.join(ctx.daemonDir, 'handoffd.heartbeat');
  fs.writeFileSync(hb, 'cycle=410-start\n');
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(hb, t, t);
}

function writeMarker(ctx, sweep, startedAgoMs) {
  fs.writeFileSync(
    path.join(ctx.daemonDir, 'handoffd.sweep-marker'),
    `${JSON.stringify({ sweep, started_at_ms: Date.now() - startedAgoMs })}\n`
  );
}

function runCheckOnce(ctx) {
  const env = checkEnv();
  env.PATH = `${ctx.fakeBin}:${env.PATH}`;
  const res = spawnSync('bb', [SUPERVISOR, ctx.root, '--check-once'], { encoding: 'utf8', env });
  return { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
}

function supervisorLog(ctx) {
  const p = path.join(ctx.daemonDir, 'handoffd-supervisor.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a supervisor whose stall threshold "SUPERVISOR_STALL_MS" is 30000 ms$/, (ctx) => {
    ctx.obs = { alive: true, heartbeatAgeMs: null, pendingOutboxAgeMs: STALL_MS + 15000, inFlightAgeMs: null };
  });

  scoped(/^pending outbox mail older than the stall threshold$/, (ctx) => {
    assert.ok(ctx.obs.pendingOutboxAgeMs > STALL_MS);
  });

  scoped(/^the tracked daemon process is alive$/, (ctx) => {
    ctx.obs.alive = true;
  });

  // ── Scenario 01 (outline) + 02, pure ─────────────────────────────────────
  scoped(/^the heartbeat file is (\d+) ms old$/, (ctx, ageToken) => {
    ctx.obs.heartbeatAgeMs = Number(ageToken);
  });

  scoped(/^the in-flight sweep marker state is "([^"]+)"$/, (ctx, marker) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_MARKERS, marker)) {
      throw new Error(`unknown <marker> token: ${marker}`);
    }
    ctx.obs.inFlightAgeMs = KNOWN_MARKERS[marker];
  });

  scoped(/^the tracked daemon process is gone$/, (ctx) => {
    ctx.obs.alive = false;
  });

  scoped(/^the supervisor evaluates health$/, (ctx) => {
    if (ctx.replayFixture) {
      ctx.checkResult = runCheckOnce(ctx);
    } else {
      ctx.verdict = evaluateHealth(ctx.obs);
    }
  });

  scoped(/^the verdict is "([^"]+)"$/, (ctx, verdict) => {
    if (!KNOWN_VERDICTS.has(verdict)) {
      throw new Error(`unknown <verdict> token: ${verdict}`);
    }
    if (ctx.replayFixture) {
      const status = JSON.parse(fs.readFileSync(path.join(ctx.daemonDir, 'handoffd.status.json'), 'utf8'));
      assert.equal(status.state, verdict, `status file state: ${JSON.stringify(status)}`);
    } else {
      assert.equal(ctx.verdict, verdict);
    }
  });

  // ── Scenario 03: the measured 2026-08-20 observations, real check! ───────
  scoped(/^the observations measured at 2026-08-20T07:55:35Z$/, (ctx) => {
    mkSupervisorFixture(ctx);
    ageHeartbeat(ctx, 61803);
    writeMarker(ctx, 'dropped-parcel-sweep', 87000);
    ctx.replayFixture = true;
  });

  scoped(/^the swarm halt is never invoked$/, (ctx) => {
    assert.equal(ctx.checkResult.status, 0, ctx.checkResult.output);
    const log = supervisorLog(ctx);
    assert.ok(!log.includes('alarm-and-halt'), `the halt fired on a progressing daemon:\n${log}`);
  });

  // ── Scenario 04: the daemon publishes and clears the marker ──────────────
  scoped(/^a daemon poll cycle that runs a sweep named "dropped-parcel-sweep"$/, (ctx) => {
    ctx.root = fs.realpathSync(mkSocketFixtureRoot('bl977-marker-'));
    trackedRoots.push(ctx.root);
    ctx.markerPath = path.join(ctx.root, 'handoffd.sweep-marker');
    const expr = `
(require '[babashka.fs :as fs])
(load-file ${JSON.stringify(GUARD_LIB)})
(daemon-cycle-guard-lib/install-sweep-marker-writer! ${JSON.stringify(ctx.markerPath)})
(daemon-cycle-guard-lib/run-sweep!
 (fn [_ _] nil)
 (fn [] (System/currentTimeMillis))
 "dropped-parcel-sweep"
 (fn [] (Thread/sleep 2500)))
`;
    ctx.sweepProc = spawn('bb', ['-e', expr], { stdio: 'ignore' });
  });

  scoped(/^the sweep is running$/, async (ctx) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !fs.existsSync(ctx.markerPath)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(fs.existsSync(ctx.markerPath), 'the marker file never appeared while the sweep ran');
  });

  scoped(/^the in-flight sweep marker names "dropped-parcel-sweep" with its start instant$/, (ctx) => {
    const marker = JSON.parse(fs.readFileSync(ctx.markerPath, 'utf8'));
    assert.equal(marker.sweep, 'dropped-parcel-sweep');
    assert.ok(Number.isFinite(marker.started_at_ms), `no start instant: ${JSON.stringify(marker)}`);
    assert.ok(Math.abs(Date.now() - marker.started_at_ms) < 15000, `implausible start instant: ${JSON.stringify(marker)}`);
  });

  scoped(/^that sweep returns$/, async (ctx) => {
    await new Promise((resolve) => {
      ctx.sweepProc.on('exit', resolve);
      setTimeout(resolve, 15000);
    });
  });

  scoped(/^the in-flight sweep marker state is "idle"$/, (ctx) => {
    const marker = JSON.parse(fs.readFileSync(ctx.markerPath, 'utf8'));
    assert.deepEqual(marker, { sweep: 'idle' });
  });

  // ── Scenario 05: a wedged loop is still caught, halt exactly once ────────
  scoped(/^a daemon whose poll loop has stopped advancing while its process remains alive$/, (ctx) => {
    mkSupervisorFixture(ctx);
    // The frozen loop: heartbeat and marker both far in the past - the
    // marker's sweep has been "in flight" well past the 225000 ms budget.
    ageHeartbeat(ctx, 400000);
    writeMarker(ctx, 'dropped-parcel-sweep', 300000);
  });

  scoped(/^the supervisor evaluates health repeatedly past the in-sweep budget$/, (ctx) => {
    ctx.firstCheck = runCheckOnce(ctx);
    ctx.secondCheck = runCheckOnce(ctx);
  });

  scoped(/^the verdict becomes "stalled"$/, (ctx) => {
    const log = supervisorLog(ctx);
    assert.ok(log.includes('alarm-and-halt stalled'), `expected a stalled halt in the log:\n${log}`);
  });

  scoped(/^the swarm halt is invoked once$/, (ctx) => {
    const log = supervisorLog(ctx);
    const halts = (log.match(/alarm-and-halt/g) || []).length;
    assert.equal(halts, 1, `expected exactly one halt across repeated checks:\n${log}`);
    // The second check skips - via the halted status ("already halted") or
    // via the stop file the halt itself dropped ("stop file present") -
    // whichever the halt path reached first; both are the once-only gate.
    assert.ok(
      log.includes('already halted') || log.includes('stop file present'),
      `the second check must skip, not re-halt:\n${log}`
    );
  });
}

module.exports = { registerSteps };
