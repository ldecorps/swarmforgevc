'use strict';

// BL-1647: step handlers for "A pidfile naming a zombie is not a live
// component". Drives the REAL swarmforge/scripts/finish_shift_lib.sh via
// `bash -c` subprocess calls (the established pattern for shell-backed
// Gherkin steps in this repo). A reliable zombie needs its direct parent
// to never reap it for a known window - bash itself proved unsuitable
// (confirmed during authoring: bash services a just-killed background
// child's job-control status opportunistically between commands even
// with no explicit `wait`, so neither a `kill` inside a `$(...)` nor a
// dedicated `bash -c` parent blocked in `sleep` reliably left an
// externally observable zombie). Python has no such implicit reaping: a
// forked child that is killed and never passed to os.waitpid() stays a
// zombie until the parent explicitly reaps it or exits - the same
// technique `swarmforge/scripts/test/test_finish_shift_lib.sh`'s own new
// case 09 uses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const FEATURE = 'BL-1647 A pidfile naming a zombie is not a live component';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const FINISH_SHIFT_LIB = path.join(SCRIPTS_DIR, 'finish_shift_lib.sh');
const TEST_FILE = path.join(SCRIPTS_DIR, 'test', 'test_finish_shift_lib.sh');

const PIDFILE_FOR_COMPONENT = {
  'front-desk': 'front-desk-supervisor.pid',
  onboarder: 'onboarder-supervisor.pid',
  tunnels: 'resident-spy-cloudflared.pid',
};

function runBash(script, opts = {}) {
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

// Forks a real child, SIGKILLs it, and holds it as a zombie for `holdSeconds`
// before reaping - Python has no implicit job-control reaping, so this is
// fully deterministic (unlike any pure-bash reproduction attempt).
function spawnZombie(holdSeconds) {
  const out = execFileSync(
    'python3',
    [
      '-c',
      `
import os, signal, time
pid = os.fork()
if pid == 0:
    time.sleep(300)
    os._exit(0)
else:
    os.kill(pid, signal.SIGKILL)
    print(pid, flush=True)
    time.sleep(${holdSeconds})
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
`,
    ],
    { encoding: 'utf8' }
  ).trim();
  return parseInt(out, 10);
}

function cleanupFixture(state) {
  if (state.root) {
    fs.rmSync(state.root, { recursive: true, force: true });
    state.root = null;
  }
}

function ensureState(ctx) {
  if (!ctx.bl1647) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1647acc-'));
    fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
    ctx.bl1647 = { root, alivePids: [] };
  }
  return ctx.bl1647;
}

function componentRunning(root, component) {
  const { stdout } = runBash(
    `source "${FINISH_SHIFT_LIB}"; finish_shift_component_running "${root}" "${component}" && echo running || echo stopped`
  );
  return stdout.trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(
    /^a fixture root under a temporary directory with the finish-shift library loaded and its operator pidfiles pointing at fixture processes$/,
    (ctx) => {
      ensureState(ctx);
    }
  );

  // ── Given ─────────────────────────────────────────────────────────────
  scoped(
    /^the (front-desk|onboarder|tunnels) pidfile names a fixture process that was killed inside a command substitution and not reaped$/,
    (ctx, component) => {
      const state = ensureState(ctx);
      // Zombie held for well longer than this step's own execution -
      // reaped in the background by the spawning python3 process
      // regardless of when this scenario's own assertions run.
      const zombiePid = spawnZombie(5);
      fs.writeFileSync(path.join(state.root, '.swarmforge', 'operator', PIDFILE_FOR_COMPONENT[component]), String(zombiePid));
      state.component = component;
    }
  );

  scoped(/^the front-desk pidfile names a fixture process that is alive$/, (ctx) => {
    const state = ensureState(ctx);
    const result = spawnSync('bash', ['-c', 'sleep 300 </dev/null >/dev/null 2>&1 & echo $!; disown -a'], {
      encoding: 'utf8',
    });
    const pid = parseInt(result.stdout.trim(), 10);
    state.alivePids.push(pid);
    fs.writeFileSync(path.join(state.root, '.swarmforge', 'operator', PIDFILE_FOR_COMPONENT['front-desk']), String(pid));
    state.component = 'front-desk';
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the component's liveness is read through the finish-shift library$/, (ctx) => {
    const state = ensureState(ctx);
    state.result = componentRunning(state.root, state.component);
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the (front-desk|onboarder|tunnels) is reported as not running$/, (ctx, component) => {
    const state = ensureState(ctx);
    try {
      assert.equal(state.component, component);
      assert.equal(state.result, 'stopped', `expected ${component} to read as stopped, got: ${state.result}`);
    } finally {
      cleanupFixture(state);
    }
  });

  scoped(/^the front-desk is reported as running$/, (ctx) => {
    const state = ensureState(ctx);
    try {
      assert.equal(state.result, 'running', `expected front-desk to read as running, got: ${state.result}`);
    } finally {
      cleanupFixture(state);
    }
    for (const pid of state.alivePids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
  });

  // ── Scenario 03: the real shell test, run once ───────────────────────
  scoped(/^swarmforge\/scripts\/test\/test_finish_shift_lib\.sh runs once$/, (ctx) => {
    ctx.bl1647TestResult = execFileSync('bash', [TEST_FILE], { encoding: 'utf8', timeout: 60000 });
  });

  scoped(/^it reports PASS=12 FAIL=0$/, (ctx) => {
    assert.match(
      ctx.bl1647TestResult,
      /PASS=12 FAIL=0/,
      `expected PASS=12 FAIL=0, got: ${ctx.bl1647TestResult}`
    );
  });

  scoped(/^its passing lines include case 08 and a case 09 naming a zombie pidfile owner$/, (ctx) => {
    assert.match(ctx.bl1647TestResult, /PASS: 08:/, 'expected a PASS: 08: line');
    assert.match(ctx.bl1647TestResult, /PASS: 09:.*zombie/, 'expected a PASS: 09: line naming a zombie');
  });
}

module.exports = { registerSteps };
