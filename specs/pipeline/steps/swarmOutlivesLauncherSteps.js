'use strict';

// BL-372: step handlers for "A launched swarm outlives whatever launched
// it". Drives the REAL detach mechanism (nohup ... &, the same portable
// idiom start_handoff_daemon.sh already proves for handoffd) and the REAL
// check_swarm_detached.bb CLI wrapper against real, disposable stand-in
// processes - never a real ./swarm/tmux launch, which is heavy, slow, and
// (per this ticket's own incident history and BL-367's postmortem) risky
// to exercise from an acceptance run. A full live-swarm proof is this
// ticket's own assigned E2E QA procedure. The pure decisions themselves
// are unit-tested directly in swarm_detach_lib_test_runner.bb.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECK_DETACHED = path.join(SCRIPTS_DIR, 'check_swarm_detached.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Waits for a condition without ever waiting out real time on its own -
// each poll checks a kernel-reported fact (process/file state) and the
// bound is tiny (native OS operations complete in microseconds), matching
// the "bounded scheduling-race guard, not a real-timer wait" pattern
// already used in test_swarm_outlives_launcher.sh.
function waitUntil(predicate, { attempts = 200, intervalMs = 5 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return true;
    execFileSync('sleep', [String(intervalMs / 1000)]);
  }
  return predicate();
}

// Spawns a caller process that nohup-backgrounds a disposable stand-in
// "swarm" child (a real sleep process), writes the child's pid to
// pidFile, then either exits immediately ("exit") or idles ("idle") so
// the caller can be signaled afterward - mirroring start-swarm.sh's own
// nohup ... & idiom exactly, never a divergent test-only mechanism.
function spawnCaller(root, mode) {
  const pidFile = path.join(root, 'child.pid');
  const script = path.join(root, 'caller.sh');
  fs.writeFileSync(
    script,
    `#!/usr/bin/env bash\nnohup sleep 60 >/dev/null 2>&1 &\necho $! > "${pidFile}"\n` +
      (mode === 'idle' ? 'sleep 60\n' : '')
  , { mode: 0o755 });
  const caller = spawn('bash', [script], { stdio: 'ignore' });
  // A referenced ChildProcess handle keeps Node's (and node --test's) event
  // loop alive until the child exits - unref it immediately so a caller
  // this scenario forgets to explicitly end can never stall the run for
  // the length of its own idle sleep.
  caller.unref();
  return { callerPid: caller.pid, pidFile };
}

function readChildPid(pidFile) {
  waitUntil(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '');
  return parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
}

// The Given step (below) spawns one idling caller before the Scenario
// Outline's example value is even known, so every departure mode ends the
// SAME idling caller, just via a different mechanism - SIGTERM stands in
// for "the shell reaches the end of its script and returns" (bash's
// default, untrapped disposition for SIGTERM is a clean process exit),
// matching the two examples that ARE real signals (SIGKILL, SIGHUP).
const CALLER_DEPARTURE_HANDLERS = {
  'exiting normally': (ctx) => {
    process.kill(ctx.callerPid, 'SIGTERM');
    waitUntil(() => !processAlive(ctx.callerPid));
  },
  'having its window killed': (ctx) => {
    process.kill(ctx.callerPid, 'SIGKILL');
    waitUntil(() => !processAlive(ctx.callerPid));
  },
  'receiving a hangup signal': (ctx) => {
    process.kill(ctx.callerPid, 'SIGHUP');
    waitUntil(() => !processAlive(ctx.callerPid));
  },
};

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a swarm launcher pointed at a target project$/, (ctx) => {
    ctx.root = mkTmp('aps-swarm-outlives-launcher-');
  });

  // ── swarm-outlives-its-launcher-01 ───────────────────────────────────────
  registry.define(/^the swarm has come up with every role running$/, (ctx) => {
    const { callerPid, pidFile } = spawnCaller(ctx.root, 'idle');
    ctx.callerPid = callerPid;
    ctx.childPid = readChildPid(pidFile);
    if (!processAlive(ctx.childPid)) {
      throw new Error('expected the stand-in swarm process to be running before the caller departs');
    }
  });

  registry.define(/^the caller goes away by (.+)$/, (ctx, departure) => {
    const handler = CALLER_DEPARTURE_HANDLERS[departure];
    if (!handler) {
      throw new Error(`unrecognized caller_departure in Examples table: "${departure}"`);
    }
    handler(ctx);
  });

  registry.define(/^the swarm's agents are still running$/, (ctx) => {
    if (!processAlive(ctx.childPid)) {
      throw new Error('expected the stand-in swarm process to survive its caller going away');
    }
    // "The swarm is still controllable" (the very next step in this
    // scenario) is textually IDENTICAL to BL-367's own control-socket
    // assertion in swarmSocketNotInTmpSteps.js - the global step registry
    // resolves by first-registration-wins with no per-feature scoping (see
    // stepRegistry.js), so only one file may own that literal text. This
    // scenario's own "controllable" proof runs HERE instead (BL-367's
    // established workaround for the same class of collision - see its
    // "the swarm launches" comment): still a live, non-zombie process we
    // can meaningfully signal, standing in for the real swarm's equivalent
    // (capture-pane, send a nudge), which is this ticket's own E2E QA
    // procedure. BL-367's colliding handler still runs afterward for this
    // scenario too (dead code here - it no-ops when ctx has neither of
    // its own expected fields, see its own guard).
    const result = spawnSync('ps', ['-o', 'stat=', '-p', String(ctx.childPid)], { encoding: 'utf8' });
    const state = (result.stdout || '').trim();
    if (!state || state.startsWith('Z')) {
      throw new Error(`expected the stand-in swarm process to still be a live, controllable process, got ps state: "${state || '(gone)'}"`);
    }
    // The proof is complete - never leave the disposable stand-in running
    // out its full sleep 60.
    try { process.kill(ctx.childPid, 'SIGKILL'); } catch { /* already gone */ }
  });

  // ── swarm-outlives-its-launcher-02 ───────────────────────────────────────
  registry.define(/^the swarm has come up still owned by the caller$/, (ctx) => {
    // A deliberately UNDETACHED child - a plain background job, still
    // parented to this very process (ctx.ownerPid), the broken case
    // scenario 02 must be able to catch.
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    child.unref();
    ctx.childPid = child.pid;
    ctx.ownerPid = process.pid;
  });

  registry.define(/^the launcher checks what owns the swarm$/, (ctx) => {
    const result = spawnSync('bb', [CHECK_DETACHED, '1', String(ctx.childPid), String(ctx.ownerPid)], { encoding: 'utf8' });
    ctx.checkResult = { ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' };
  });

  registry.define(/^the launch reports failure naming the swarm as still owned by its caller$/, (ctx) => {
    if (ctx.checkResult.ok) {
      throw new Error('expected the detachment check to fail for a still-owned child');
    }
    if (!/still owned by the caller/i.test(ctx.checkResult.stderr)) {
      throw new Error(`expected a diagnostic naming the swarm as still owned by its caller, got: ${ctx.checkResult.stderr}`);
    }
    process.kill(ctx.childPid, 'SIGKILL');
  });

  registry.define(/^it does not report the swarm as ready$/, (ctx) => {
    if (ctx.checkResult.ok) {
      throw new Error('expected no success/ready report on a failed launch check');
    }
    if (/is up and its tmux server is detached/i.test(ctx.checkResult.stdout)) {
      throw new Error(`expected no ready message on stdout for a failed check, got: ${ctx.checkResult.stdout}`);
    }
  });

  // ── swarm-outlives-its-launcher-03 ───────────────────────────────────────
  registry.define(/^the swarm does not finish coming up$/, (ctx) => {
    ctx.readyFlag = '0';
  });

  registry.define(/^the launcher reports its result$/, (ctx) => {
    // ready=0 short-circuits decide-launch-outcome before detachment is
    // even consulted (see swarm_detach_lib.bb) - pid arguments are
    // deliberately nonsense (readiness fails first, unconditionally).
    const result = spawnSync('bb', [CHECK_DETACHED, ctx.readyFlag, '1', '1'], { encoding: 'utf8' });
    ctx.checkResult = { ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' };
  });

  registry.define(/^the launch reports failure$/, (ctx) => {
    if (ctx.checkResult.ok) {
      throw new Error('expected the launch check to report failure when the swarm never became ready');
    }
    if (!/did not become ready/i.test(ctx.checkResult.stderr)) {
      throw new Error(`expected a diagnostic naming the swarm as not ready, got: ${ctx.checkResult.stderr}`);
    }
  });
}

module.exports = { registerSteps };
