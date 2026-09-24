'use strict';

// BL-1703: shared throwaway-project fixture for
// `swarmforge/scripts/ollama_ancillary_lib.sh` - used by both the
// acceptance step handler
// (specs/pipeline/steps/bl1703OllamaLaunchProbeSteps.js) and the property
// test. Drives the REAL lib (sourced, never reimplemented) via a stand-in
// `ollama` binary on PATH and a stand-in HTTP responder - never the real
// server, never port 11434.

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFileSync, spawnSync, spawn } = require('child_process');
const { mkProcessTmpDir, sweepStaleTmpDirs } = require('./tmpDir');

const PREFIX = 'bl1703-ollama-';
const LIB = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'ollama_ancillary_lib.sh');

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

// A free TCP port, found by binding to port 0 and reading it back - never
// a hardcoded value, and never 11434.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function findFreePortSync() {
  // child_process-free synchronous port pick: ask the OS for one via a
  // short-lived server in a small worker, but tests here are already
  // async, so just expose the async finder and let callers await it.
  throw new Error('use findFreePort() (async)');
}
void findFreePortSync;

function makeOllamaAncillaryFixture() {
  sweepStaleRootsOnce();
  const root = mkProcessTmpDir(`${PREFIX}${process.pid}-`);
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const invokedMarker = path.join(root, 'ollama-invoked.marker');
  const modeFile = path.join(root, 'ollama-mode');
  const responderPidFile = path.join(root, 'responder.pid');

  // The stand-in `ollama` binary: records that it was invoked, then either
  // execs a tiny HTTP responder on OLLAMA_FIXTURE_PORT (mode "answers",
  // simulating the swarm's own `serve` bringing the endpoint up) or execs
  // a process that never listens (mode "never"). `exec` in both cases so
  // the started pid IS the tracked process, never a wrapper shell with an
  // orphanable child.
  writeExecutable(
    path.join(binDir, 'ollama'),
    `#!/usr/bin/env bash
if [ "\${1:-}" = "serve" ]; then
  echo "\$$" >> "${invokedMarker}"
  mode="\$(cat "${modeFile}" 2>/dev/null || echo never)"
  if [ "\$mode" = "answers" ]; then
    echo "\$\$" > "${responderPidFile}"
    exec node -e "require('http').createServer((req,res)=>{res.end('{}')}).listen(process.env.OLLAMA_FIXTURE_PORT)"
  fi
  echo "\$\$" > "${responderPidFile}"
  exec sleep 300
fi
exit 0
`
  );

  const fixture = {
    root,
    binDir,

    setMode(mode) {
      fs.writeFileSync(modeFile, mode);
    },

    binEnv(port) {
      return {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        OLLAMA_FIXTURE_PORT: String(port),
      };
    },

    ollamaInvoked() {
      return fs.existsSync(invokedMarker);
    },

    startedServerPid() {
      if (!fs.existsSync(responderPidFile)) {
        return null;
      }
      return Number(fs.readFileSync(responderPidFile, 'utf8').trim());
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

    // A pre-existing responder the swarm did NOT start (the "already
    // answers" case) - a real HTTP server this fixture owns and tears
    // down itself, independent of the ollama_ancillary_lib.sh's own
    // start/stop machinery.
    startExternalResponder(port) {
      const child = spawn(process.execPath, [
        '-e',
        `require('http').createServer((req,res)=>{res.end('{}')}).listen(${port})`,
      ]);
      fixture._external = fixture._external || [];
      fixture._external.push(child);
      return child;
    },

    recordPath(stateDir) {
      return path.join(stateDir, 'ollama', 'serve.json');
    },

    readRecord(stateDir) {
      const p = fixture.recordPath(stateDir);
      if (!fs.existsSync(p)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    },

    // Runs ollama_ancillary_ensure_ready_for_launch with the given args,
    // through a real bash process (never a reimplementation).
    run({ usesLocal, url, stateDir, binary, modelsDir, contextLength, waitSeconds, pollInterval, logPath, port }) {
      const script = `set -u
source "${LIB}"
ollama_ancillary_ensure_ready_for_launch "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9"
`;
      const result = spawnSync(
        'bash',
        [
          '-c',
          script,
          'bash',
          usesLocal,
          url,
          stateDir,
          binary,
          modelsDir || '',
          contextLength || '',
          String(waitSeconds),
          String(pollInterval),
          logPath,
        ],
        { env: fixture.binEnv(port), encoding: 'utf8' }
      );
      return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    },

    cleanup() {
      const started = fixture.startedServerPid();
      if (started && fixture.pidAlive(started)) {
        try {
          process.kill(started, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
      for (const child of fixture._external || []) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };

  return fixture;
}

module.exports = { makeOllamaAncillaryFixture, findFreePort };
