'use strict';

// BL-1727: shared fixture for `ollama_ancillary_lib.sh`'s
// `ollama_ancillary_stop_pid` - used by both the acceptance step handler
// (specs/pipeline/steps/bl1727OllamaStopWaitsUntilGoneSteps.js) and its
// property test. Drives the REAL lib (sourced, never reimplemented)
// against REAL short-lived processes, started through the REAL
// `ollama_ancillary_start_server` (the Background step's own "started the
// way the launch starts the ollama server") - never a mock of process
// signalling.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { mkProcessTmpDir, sweepStaleTmpDirs } = require('./tmpDir');

const PREFIX = 'bl1727-ollama-stop-';
const LIB = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'ollama_ancillary_lib.sh');

// Behaviours a stand-in `ollama` binary's "serve" mode can exhibit,
// through a real Node child - precise, listener-based signal semantics
// rather than bash traps (POSIX trap-vs-blocked-command timing is
// version-dependent; a Node SIGTERM listener replaces the default
// terminate-on-TERM action outright, so "ignores it" and "exits N ms
// later" are both exact and reproducible).
//
// A behaviour that registers a SIGTERM listener writes READY_FILE right
// after registering it - startProcess() waits for that file before
// returning. Without this handshake there is a real race: if the process
// is sent TERM before its own `process.on("SIGTERM", ...)` line has run,
// Node's default (terminate) action still applies, and a test can look
// like it exercised "ignores TERM" while actually just tearing the
// process down before the listener existed - BL-1727's own first draft
// did exactly this and still passed against a deliberately broken
// ollama_ancillary_stop_pid (no wait, immediate return), because the
// unregistered-listener race killed the process anyway.
const REQUIRES_READY_HANDSHAKE = new Set(['exits-after-term', 'ignores-term']);

function behaviourScript(behaviour, readyFile) {
  const markReady = `require("fs").writeFileSync(${JSON.stringify(readyFile)}, "")`;
  switch (behaviour) {
    case 'exits-after-term':
      return `process.on("SIGTERM", () => setTimeout(() => process.exit(0), 300)); ${markReady}; setInterval(() => {}, 1000);`;
    case 'ignores-term':
      return `process.on("SIGTERM", () => {}); ${markReady}; setInterval(() => {}, 1000);`;
    case 'already-exited':
      return 'process.exit(0);';
    default:
      throw new Error(`unknown behaviour: ${behaviour}`);
  }
}

let sweptStaleRoots = false;
function sweepStaleRootsOnce() {
  if (!sweptStaleRoots) {
    sweptStaleRoots = true;
    sweepStaleTmpDirs({ prefix: PREFIX });
  }
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function makeStopPidFixture() {
  sweepStaleRootsOnce();
  const root = mkProcessTmpDir(`${PREFIX}${process.pid}-`);
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const modeFile = path.join(root, 'mode');
  const readyFile = path.join(root, 'ready');

  const behaviours = ['exits-after-term', 'ignores-term', 'already-exited'];
  writeExecutable(
    path.join(binDir, 'stand-in-ollama'),
    `#!/usr/bin/env bash
if [ "\${1:-}" = "serve" ]; then
  mode="\$(cat "${modeFile}" 2>/dev/null || echo already-exited)"
  case "\$mode" in
${behaviours.map((behaviour) => `    ${behaviour}) exec node -e '${behaviourScript(behaviour, readyFile)}' ;;`).join('\n')}
  esac
fi
exit 0
`
  );

  const fixture = {
    root,
    _started: [],

    // Bounded, real wait until PATH exists - used to confirm a behaviour
    // that registers a SIGTERM listener has actually done so before this
    // fixture signals it (see REQUIRES_READY_HANDSHAKE's own "why").
    waitForFile(filePath, boundMs) {
      const deadline = Date.now() + boundMs;
      while (Date.now() < deadline) {
        if (fs.existsSync(filePath)) {
          return true;
        }
      }
      return fs.existsSync(filePath);
    },

    // Starts a real process exhibiting BEHAVIOUR through the REAL
    // ollama_ancillary_start_server, returns its pid once the process
    // itself confirms it is ready to be signalled (behaviours that
    // register no listener need no such confirmation).
    startProcess(behaviour) {
      fs.writeFileSync(modeFile, behaviour);
      try {
        fs.unlinkSync(readyFile);
      } catch {
        /* did not exist yet */
      }
      const logPath = path.join(root, 'server.log');
      const script = `set -u
source "${LIB}"
ollama_ancillary_start_server "$1" "" "" "$2"
`;
      const result = spawnSync('bash', ['-c', script, 'bash', path.join(binDir, 'stand-in-ollama'), logPath], {
        encoding: 'utf8',
      });
      const pid = Number((result.stdout || '').trim());
      if (!pid) {
        throw new Error(`expected a started pid, got: ${JSON.stringify(result)}`);
      }
      fixture._started.push(pid);
      if (REQUIRES_READY_HANDSHAKE.has(behaviour)) {
        const ready = fixture.waitForFile(readyFile, 3000);
        if (!ready) {
          throw new Error(`pid ${pid} (${behaviour}) never signalled its SIGTERM listener was registered`);
        }
      }
      return pid;
    },

    // Bounded, real wait until PID is confirmed gone - used only to build
    // the "already exited" precondition deterministically rather than
    // racing a fixed sleep.
    waitUntilGone(pid, boundMs) {
      const deadline = Date.now() + boundMs;
      while (Date.now() < deadline) {
        if (!fixture.pidAlive(pid)) {
          return true;
        }
      }
      return !fixture.pidAlive(pid);
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

    // Runs the REAL ollama_ancillary_stop_pid against PID, in a fresh bash
    // process. `unsignallable` shadows the `kill` builtin with a shell
    // function scoped to that one process: `-0` (liveness) passes through
    // to the real builtin, so the process genuinely still looks alive;
    // every other signal (TERM, KILL) is swallowed - simulating "cannot be
    // signalled" (EPERM) without needing a real OS permission boundary,
    // which `kill -0` cannot reliably distinguish from "gone" in the first
    // place (BL-1727 Scenario 02).
    runStopPid(pid, { envOverrides = {}, unsignallable = false } = {}) {
      const guard = unsignallable ? 'kill() { case "$1" in -0) command kill "$@" ;; *) return 0 ;; esac; }\n' : '';
      const script = `${guard}set -u
source "${LIB}"
ollama_ancillary_stop_pid "$1"
`;
      const result = spawnSync('bash', ['-c', script, 'bash', String(pid)], {
        encoding: 'utf8',
        env: { ...process.env, ...envOverrides },
      });
      return { status: result.status, stderr: result.stderr || '' };
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
      for (const pid of fixture._started) {
        fixture.killReal(pid);
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };

  return fixture;
}

module.exports = { makeStopPidFixture };
