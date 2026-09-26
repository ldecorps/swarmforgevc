'use strict';

// BL-1704: shared fixture for "the swarm stop paths stop the ollama
// server the swarm started" - drives the REAL stop paths
// (stop_ancillary_services.sh, kill_all_swarm.sh) and the REAL
// ollama_ancillary_lib.sh (sourced by both, never reimplemented) against
// REAL stand-in `ollama serve` / `ollama runner` processes (real node
// children with `process.title` set, matched by `ps -o args=` exactly the
// way the lib's own ollama_ancillary_pid_is_ollama_serve/
// ollama_ancillary_runner_children do) - never the real ollama binary,
// never port 11434.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { mkProcessTmpDir, sweepStaleTmpDirs } = require('./tmpDir');

// Real blocking wait (a futex, not a CPU spin) - the suite's existing
// synchronous-sleep idiom, e.g. test/helpers/waitForFileSync.js.
function sleepSyncMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const PREFIX = 'bl1704-ollama-stop-paths-';
const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const OLLAMA_LIB = path.join(SCRIPTS_DIR, 'ollama_ancillary_lib.sh');
const STOP_ANCILLARY = path.join(SCRIPTS_DIR, 'stop_ancillary_services.sh');
const KILL_ALL_SWARM = path.join(SCRIPTS_DIR, 'kill_all_swarm.sh');

const FAST_BOUNDS = {
  OLLAMA_ANCILLARY_STOP_TERM_GRACE_SECONDS: '1',
  OLLAMA_ANCILLARY_STOP_KILL_GRACE_SECONDS: '1',
  OLLAMA_ANCILLARY_STOP_POLL_INTERVAL_SECONDS: '1',
};

let sweptStaleRoots = false;
function sweepStaleRootsOnce() {
  if (!sweptStaleRoots) {
    sweptStaleRoots = true;
    sweepStaleTmpDirs({ prefix: PREFIX });
  }
}

// A real, long-lived node process whose `ps -o args=` reads like `ollama
// serve`/`ollama runner` - process.title rewrites argv in place (POSIX),
// which is exactly what a real ps invocation reads, unlike a mocked
// command table.
//
// Spawned via `nohup ... & disown` (the SAME idiom
// ollama_ancillary_start_server itself uses), never as a direct Node
// child of this fixture's own process: once the wrapping bash process
// exits, the stand-in is reparented to init, a REAL orphan. Without this,
// the stand-in stays a reapable child of the test process, and any
// synchronous spawnSync call later (running the stop path itself, which
// takes seconds) blocks that process's event loop from processing the
// child's SIGCHLD - the exited-but-unreaped process is a zombie for that
// whole window, and `kill -0` (what every liveness/`ollama_ancillary_pid_alive`
// check in the lib uses) reads a zombie as "still alive" regardless of
// which process asks, producing a false "still alive after TERM and KILL"
// that never happens against a real, in-production ollama process (whose
// parent is never this test's own event loop).
function spawnOrphaned(script) {
  const wrapper = 'nohup "$1" -e "$2" >/dev/null 2>&1 < /dev/null & echo $!; disown';
  const result = spawnSync('bash', ['-c', wrapper, 'bash', process.execPath, script], { encoding: 'utf8' });
  const pid = Number((result.stdout || '').trim());
  if (!pid) {
    throw new Error(`expected an orphaned stand-in's pid, got: ${JSON.stringify(result)}`);
  }
  return pid;
}

function spawnServerWithRunnerChild(execPath, runnerPidFile) {
  // `detached: true` (setsid) puts the runner in its OWN session/process
  // group, independent of the server's - it stays the server's real CHILD
  // (getppid unchanged, so pgrep -P still finds it exactly as the
  // production ollama_ancillary_runner_children does), but observed
  // intermittently killed without it: killing the server sometimes took
  // the still-attached runner with it. QA D1 (2026-09-26) identified the
  // real cause, previously misattributed here to a WSL2 kernel/session
  // reparenting quirk: the LIVE swarm's own real ghost janitor
  // (BL-1705/BL-1726) scans this host for an "ollama runner"-titled
  // process with no matching live server nearby and reaps it within
  // seconds - exactly the state a server-less runner is in, whatever
  // process group it sits in. detached: true removes an UNRELATED
  // dependency (this fixture's own server/runner kill ordering); it is
  // not, and never was, what protected against the janitor.
  const script = [
    'process.title = "ollama serve";',
    `const c = require("child_process").spawn(${JSON.stringify(execPath)}, ["-e", 'process.title = "ollama runner"; setInterval(() => {}, 1000);'], { stdio: "ignore", detached: true });`,
    'c.unref();',
    `require("fs").writeFileSync(${JSON.stringify(runnerPidFile)}, String(c.pid));`,
    'setInterval(() => {}, 1000);',
  ].join(' ');
  return spawnOrphaned(script);
}

function spawnStandIn(title) {
  return spawnOrphaned(`process.title = ${JSON.stringify(title)}; setInterval(() => {}, 1000);`);
}

function makeOllamaStopPathsFixture() {
  sweepStaleRootsOnce();
  const root = mkProcessTmpDir(`${PREFIX}${process.pid}-`);
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  // stop_ancillary_services.sh sources lifecycle_matrix.sh et al and
  // dispatches every OTHER component too - none of them find anything to
  // stop in a bare throwaway root (idempotent by design), so no further
  // fixture setup is needed for those.

  const recordPath = path.join(root, '.swarmforge', 'ollama', 'serve.json');
  const children = [];

  const fixture = {
    root,
    recordPath,

    // Background: a stand-in server with one REAL runner child (spawned
    // by the server's own process, found by pgrep -P), both long-lived,
    // both orphaned (see spawnOrphaned), and matched by the lib's own
    // ps-based checks.
    async startServerAndRunner() {
      const runnerPidFile = path.join(root, 'runner.pid');
      const serverPid = spawnServerWithRunnerChild(process.execPath, runnerPidFile);
      children.push(serverPid);
      const deadline = Date.now() + 3000;
      let runnerPid = 0;
      while (Date.now() < deadline && !runnerPid) {
        if (fs.existsSync(runnerPidFile)) {
          runnerPid = Number(fs.readFileSync(runnerPidFile, 'utf8').trim());
        }
        if (!runnerPid) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      if (!runnerPid) {
        throw new Error('the stand-in server never wrote its runner\'s pid');
      }
      children.push(runnerPid);
      fixture.serverPid = serverPid;
      fixture.runnerPid = runnerPid;
      return { serverPid, runnerPid };
    },

    // A real, orphaned process this fixture does NOT track as a runner
    // child (used by the "pid now belongs to something else" outline
    // row) - no special title, so it never matches the server/runner
    // command-line checks.
    startUnrelatedProcess() {
      const pid = spawnOrphaned('setInterval(() => {}, 1000);');
      children.push(pid);
      return pid;
    },

    writeRecord(owner, pid, endpoint = 'http://127.0.0.1:11434/v1') {
      fs.mkdirSync(path.dirname(recordPath), { recursive: true });
      const script = `set -u
source "${OLLAMA_LIB}"
ollama_ancillary_write_record "$1" "$2" "$3" "2026-09-25T00:00:00Z" "$4"
`;
      const args = ['-c', script, 'bash', recordPath, owner, pid ? String(pid) : '', endpoint];
      const result = spawnSync('bash', args, { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`writeRecord failed: ${result.stderr}`);
      }
    },

    recordExists() {
      return fs.existsSync(recordPath);
    },

    pidAlive(pid) {
      if (!pid) {
        return false;
      }
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },

    // Polls at a bounded interval rather than busy-spinning: a tight
    // Date.now() loop pegs a CPU core for the whole boundMs on every
    // still-alive check, which starves the concurrently spawned stand-in
    // processes of scheduler time and was observed to flake scenario 03's
    // "no process was signalled" runner-liveness check under load. The
    // sleep is Atomics.wait on a SharedArrayBuffer (the suite's existing
    // synchronous-wait idiom, e.g. test/helpers/waitForFileSync.js) - a
    // real blocking wait, not a spin.
    waitUntilGone(pid, boundMs = 4000) {
      const deadline = Date.now() + boundMs;
      while (Date.now() < deadline) {
        if (!fixture.pidAlive(pid)) {
          return true;
        }
        sleepSyncMs(Math.max(0, Math.min(20, deadline - Date.now())));
      }
      return !fixture.pidAlive(pid);
    },

    // Runs the named stop path against this fixture's root, with the
    // lib's own TERM/KILL bounds shortened so a real stop completes in
    // about a second rather than the lib's real-world (server-friendly)
    // defaults.
    runStopPath(name) {
      const env = { ...process.env, ...FAST_BOUNDS };
      if (name === 'the full-stack stop') {
        const result = spawnSync('bash', [STOP_ANCILLARY, root], { encoding: 'utf8', env });
        return { status: result.status, stderr: result.stderr || '', stdout: result.stdout || '' };
      }
      if (name === 'kill_all_swarm') {
        const result = spawnSync('bash', [KILL_ALL_SWARM, root], { encoding: 'utf8', env });
        return { status: result.status, stderr: result.stderr || '', stdout: result.stdout || '' };
      }
      throw new Error(`unknown stop path: ${name}`);
    },

    // Calls ollama_ancillary_stop_swarm_owned directly - the same
    // function both stop paths call, without the other unrelated
    // components stop_ancillary_services.sh also dispatches (each with
    // its own ~1s sleep). Used by the property test, which cares only
    // about this one function's own invariant across many constructed
    // states.
    runStopSwarmOwned() {
      const env = { ...process.env, ...FAST_BOUNDS };
      const script = `set -u
source "${OLLAMA_LIB}"
ollama_ancillary_stop_swarm_owned "$1"
`;
      const result = spawnSync('bash', ['-c', script, 'bash', path.join(root, '.swarmforge')], {
        encoding: 'utf8',
        env,
      });
      return { status: result.status, stderr: result.stderr || '', stdout: result.stdout || '' };
    },

    // Scenario 03 example 1 ("is no longer running"): killing only the
    // stand-in server leaves its "ollama runner"-titled child alive with
    // no matching server nearby - indistinguishable, to the LIVE swarm's
    // real ghost janitor (BL-1705/BL-1726) scanning this whole host, from
    // an actually-leaked runner, so it gets reaped mid-test (QA D1,
    // 2026-09-26: "reaped-ollama-ghost pid=... cmd=ollama runner"). Kills
    // both together so no server-less "ollama runner" is ever left for
    // the real janitor to find.
    killServerAndRunner() {
      fixture.killReal(fixture.serverPid);
      fixture.killReal(fixture.runnerPid);
    },

    killReal(pid) {
      if (!pid) {
        return;
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    },

    cleanup() {
      for (const pid of children) {
        fixture.killReal(pid);
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };

  return fixture;
}

module.exports = { makeOllamaStopPathsFixture };
