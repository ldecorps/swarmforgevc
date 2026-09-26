'use strict';

// BL-1711: shared fixture for "a crashed ollama server is restarted while
// a local pack depends on it" - drives the REAL
// ollama_ancillary_restart_cli.sh (sourcing ollama_ancillary_lib.sh,
// never reimplemented) against a real stand-in `ollama serve` process (a
// real node child, orphaned via nohup+disown - see BL-1704's own fixture
// for why a direct Node child zombies during a synchronous spawnSync
// call) and a real local HTTP responder standing in for the endpoint.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { mkProcessTmpDir, sweepStaleTmpDirs } = require('./tmpDir');

const PREFIX = 'bl1711-ollama-restart-';
const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const OLLAMA_LIB = path.join(SCRIPTS_DIR, 'ollama_ancillary_lib.sh');
const RESTART_CLI = path.join(SCRIPTS_DIR, 'ollama_ancillary_restart_cli.sh');

const FAST_ENV = {
  OLLAMA_ANCILLARY_CRASH_CONFIRM_SECONDS: '1',
  OLLAMA_ANCILLARY_RESTART_WINDOW_SECONDS: '1800',
  OLLAMA_ANCILLARY_RESTART_MAX_IN_WINDOW: '3',
};

let sweptStaleRoots = false;
function sweepStaleRootsOnce() {
  if (!sweptStaleRoots) {
    sweptStaleRoots = true;
    sweepStaleTmpDirs({ prefix: PREFIX });
  }
}

// Orphaned real process (nohup + disown), never a direct Node child - see
// BL-1704's ollamaStopPathsFixture.js for why.
function spawnOrphaned(script) {
  const wrapper = 'nohup "$1" -e "$2" >/dev/null 2>&1 < /dev/null & echo $!; disown';
  const result = spawnSync('bash', ['-c', wrapper, 'bash', process.execPath, script], { encoding: 'utf8' });
  const pid = Number((result.stdout || '').trim());
  if (!pid) {
    throw new Error(`expected an orphaned stand-in's pid, got: ${JSON.stringify(result)}`);
  }
  return pid;
}

function makeOllamaCrashRestartFixture() {
  sweepStaleRootsOnce();
  const root = mkProcessTmpDir(`${PREFIX}${process.pid}-`);
  fs.mkdirSync(path.join(root, '.swarmforge', 'ollama'), { recursive: true });

  const port = 20000 + (process.pid % 5000);
  const endpoint = `http://127.0.0.1:${port}/v1`;
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const fakeOllama = path.join(binDir, 'fake-ollama');
  fs.writeFileSync(
    fakeOllama,
    `#!/usr/bin/env bash
if [ "\${1:-}" = "serve" ]; then
  exec node -e 'require("http").createServer((_q,r)=>{r.end("{}")}).listen(${port})'
fi
exit 0
`
  );
  fs.chmodSync(fakeOllama, 0o755);

  // BL-1711 hardening: a restart binary that starts a real, live process
  // (so ollama_ancillary_start_server gets a real pid back, exactly the
  // shape it always sees) but never opens the port - standing in for
  // "the replacement server never comes up", the one failure branch
  // ollama_ancillary_restart_if_crashed handles (stop the never-answering
  // new pid, escalate) that no scenario or category exercised before this
  // pass.
  //
  // QA bounce D3 (2026-09-25): the first cut ran `sleep infinity` as a
  // plain FOREGROUND command. This script isn't the last statement in the
  // file (an `exit 0` follows `fi`), so bash cannot tail-call into sleep -
  // it forks a real child and waits on it. ollama_ancillary_stop_pid's
  // TERM lands on THIS script's own pid (the value
  // ollama_ancillary_start_server captures via $!), and bash's default
  // response to SIGTERM while waiting on a foreground child is to die
  // immediately WITHOUT signalling that child - sleep is reparented to
  // init and never ends. Every property-lane run leaked one permanent
  // orphan (five from this ticket's own hardening runs, one from QA's).
  // Fixed by backgrounding sleep and trapping TERM to kill it explicitly -
  // this script's own recognizable cmdline (still `fake-ollama-never-
  // serves serve`, still matched by kill $pid) stays the live parent, but
  // now actually takes its child down instead of abandoning it.
  const fakeOllamaNeverServes = path.join(binDir, 'fake-ollama-never-serves');
  fs.writeFileSync(
    fakeOllamaNeverServes,
    `#!/usr/bin/env bash
if [ "\${1:-}" = "serve" ]; then
  # No 'exec' - a bash builtin exec replaces this process's own argv/cmdline
  # with the child's, so a later 'pgrep -f fake-ollama-never-serves' would
  # match nothing whether or not the pid was ever stopped (a vacuous check,
  # not proof of anything).
  trap 'kill "$child" 2>/dev/null' TERM
  sleep infinity &
  child=$!
  wait "$child"
fi
exit 0
`
  );
  fs.chmodSync(fakeOllamaNeverServes, 0o755);

  const recordPath = path.join(root, '.swarmforge', 'ollama', 'serve.json');
  const restartLogPath = path.join(root, '.swarmforge', 'ollama', 'restarts.log');
  const serverLogPath = path.join(root, 'server.log');
  const children = [];

  const fixture = {
    root,
    recordPath,
    endpoint,
    port,
    fakeOllamaNeverServes,

    writeRecord(owner, pid, ep = endpoint) {
      fs.mkdirSync(path.dirname(recordPath), { recursive: true });
      const script = `set -u
source "${OLLAMA_LIB}"
ollama_ancillary_write_record "$1" "$2" "$3" "2026-09-25T00:00:00Z" "$4"
`;
      spawnSync('bash', ['-c', script, 'bash', recordPath, owner, pid ? String(pid) : '', ep], { encoding: 'utf8' });
    },

    recordExists() {
      return fs.existsSync(recordPath);
    },

    deleteRecord() {
      fs.rmSync(recordPath, { force: true });
    },

    readRecord() {
      return fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : null;
    },

    // A real server child this fixture starts directly (stands in for
    // "the recorded pid" before it crashes) - orphaned, matching how a
    // real swarm-launched server is never a child of the daemon that
    // later restarts it.
    //
    // BL-1711 QA D1 (3rd pass, 2026-09-26): also binds the recorded port
    // (accepting connections, never answering them) - a real `ollama
    // serve` opens its HTTP port immediately at startup, well before it
    // can serve a request, and ollama_ancillary_any_ollama_serve_alive's
    // pid-less liveness check now reads exactly that port rather than a
    // host-wide process scan. Harmless for the pid-based scenarios (they
    // never reach that check) and released the instant killReal below
    // ends this process, same as any listening socket on process death.
    // Retries on EADDRINUSE (never crashes on the server's own 'error'
    // event) - this fixture's port is derived from this Node process's own
    // pid, reused by every scenario in the same acceptance run, so the
    // prior scenario's stand-in can still hold it for a moment after its
    // own killReal.
    startServer() {
      const pid = spawnOrphaned(`
process.title = "ollama serve";
(function bind(retriesLeft) {
  const srv = require("net").createServer((s) => { s.on("error", () => {}); });
  srv.on("error", () => { if (retriesLeft > 0) setTimeout(() => bind(retriesLeft - 1), 50); });
  srv.listen(${port});
})(40);
setInterval(() => {}, 1000);
`);
      children.push(pid);
      return pid;
    },

    // A real HTTP responder standing in for the recorded endpoint,
    // independent of the "server" process above so a scenario can crash
    // the process while the endpoint still answers, or vice versa.
    startEndpointResponder() {
      const pid = spawnOrphaned(
        `require("http").createServer((_q,r)=>{r.end("{}")}).listen(${port});`
      );
      children.push(pid);
      return pid;
    },

    startOrphanedRunner() {
      const pid = spawnOrphaned(`process.title = "ollama runner"; setInterval(() => {}, 1000);`);
      children.push(pid);
      return pid;
    },

    killReal(pid) {
      if (!pid) return;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    },

    pidAlive(pid) {
      if (!pid) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },

    waitUntilGone(pid, boundMs = 4000) {
      const deadline = Date.now() + boundMs;
      while (Date.now() < deadline) {
        if (!fixture.pidAlive(pid)) return true;
      }
      return !fixture.pidAlive(pid);
    },

    // No pid is ever printed for a failed restart's own new server (only
    // RESTARTED carries one) - so proving the never-answering replacement
    // was actually stopped (not merely that the CLI said so) means
    // searching by its distinctive command line, never a tracked pid.
    anyProcessMatching(pattern) {
      const result = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
      return result.status === 0 && result.stdout.trim().length > 0;
    },

    seedRestartHistory(count) {
      const now = Math.floor(Date.now() / 1000);
      fs.mkdirSync(path.dirname(restartLogPath), { recursive: true });
      fs.writeFileSync(restartLogPath, Array.from({ length: count }, () => now).join('\n') + '\n');
    },

    // Runs one restart-sweep tick. `binary` is the restart's OWN start
    // binary (ollama_ancillary_restart_if_crashed's 2nd positional) -
    // overridable so a scenario can make the REPLACEMENT server fail to
    // come up without touching the original (already-crashed) one.
    tick(envOverrides = {}, binary = fakeOllama) {
      const result = spawnSync(
        'bash',
        [RESTART_CLI, root, binary, '', '', '3', '1', serverLogPath],
        { encoding: 'utf8', env: { ...process.env, ...FAST_ENV, ...envOverrides } }
      );
      const stdout = (result.stdout || '').trim();
      // A RESTARTED line names a NEW pid the restart CLI itself spawned
      // (via nohup+disown, never tracked as this fixture's own child) -
      // track it here so cleanup() actually kills it; otherwise it leaks
      // into whatever port/state the NEXT fixture in this same process
      // happens to reuse (a real false-negative this fixture hit once:
      // a leftover live responder from a prior scenario made the next
      // scenario's endpoint always answer, masking every crash).
      if (stdout.startsWith('RESTARTED')) {
        const newPid = Number(stdout.split(' ')[2]);
        if (newPid) children.push(newPid);
      }
      return { status: result.status, stdout, stderr: result.stderr || '' };
    },

    // Ticks repeatedly (short real sleeps) until an action line appears
    // or the bound is hit - "runs until the window has passed" the
    // scenarios' own words. Returns every tick's result.
    runUntilWindowPassed(maxTicks = 6, binary = fakeOllama) {
      const results = [];
      for (let i = 0; i < maxTicks; i += 1) {
        const r = fixture.tick({}, binary);
        results.push(r);
        if (r.stdout) return results;
        spawnSync('sleep', ['0.6']);
      }
      return results;
    },

    cleanup() {
      for (const pid of children) fixture.killReal(pid);
      // QA bounce D3 backstop: the restart-fails-to-come-up category's own
      // pid is never added to `children` (it never prints RESTARTED), so
      // this sweeps by the fixture's own root path in every surviving
      // process's cmdline - real orphans from a killed/failed run, never a
      // host-wide pattern (BL-1385/1390), since `root` is this fixture's
      // own unique mkdtemp path. `ps` + a JS filter, never `pgrep -f root`
      // directly - pgrep's OWN argv contains the search pattern, so it
      // matches its own invocation every time (confirmed empirically: a
      // pattern guaranteed to match no real process still returned two
      // pids). `ps -eo pid,args` embeds no search pattern in its own
      // command line, so it cannot self-match.
      const psResult = spawnSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
      if (psResult.status === 0) {
        for (const line of psResult.stdout.split('\n')) {
          if (!line.includes(root)) continue;
          const pid = Number(line.trim().split(/\s+/)[0]);
          if (pid && pid !== process.pid) fixture.killReal(pid);
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };

  return fixture;
}

module.exports = { makeOllamaCrashRestartFixture };
