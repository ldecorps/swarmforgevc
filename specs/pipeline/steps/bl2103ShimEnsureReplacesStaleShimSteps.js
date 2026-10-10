'use strict';

// BL-2103: step handlers for "Shim ensure replaces a running shim older
// than its code" - local_model_tool_call_shim.py's `ensure` must reuse
// only a process whose /shim/health names the shim AND reports the code
// fingerprint on disk, replace one running anything else (including a
// pre-ticket shim with no fingerprint at all, found by its own serve
// command line via pgrep -f), and never touch a process that is not the
// shim.
//
// Drives the REAL local_model_tool_call_shim.py (`serve` and `ensure`,
// spawned as subprocesses) against ephemeral ports and a fake Ollama
// upstream (plain node http). The "no fingerprint" stand-in disguises its
// own argv to literally contain "<SHIM_PY> serve --port <port> --upstream"
// - the exact shape a real pre-ticket shim's own invocation always had at
// this same path, which is what ensure's pgrep lookup matches on (never
// by port alone, per the ticket's own invariant). Every spawned process
// is killed in a disposer.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-2103 Shim ensure replaces a running shim older than its code';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SHIM_PY = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_model_tool_call_shim.py');

function diskFingerprint() {
  return crypto.createHash('sha256').update(fs.readFileSync(SHIM_PY)).digest('hex').slice(0, 16);
}

async function freePort() {
  const probe = net.createServer();
  const port = await new Promise((resolve, reject) => {
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
    probe.on('error', reject);
  });
  return port;
}

function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/shim/health', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function waitForHealth(port, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const health = await probeHealth(port);
    if (health && predicate(health)) {
      return health;
    }
    if (Date.now() > deadline) {
      throw new Error(`port ${port} never answered the expected health within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ensure(ctx) {
  if (ctx.bl2103) {
    return ctx.bl2103;
  }
  const root = trackedTmpRoot('bl2103-shim-ensure-');
  const st = {
    root,
    logPath: path.join(root, 'ensure.log'),
    upstream: null,
    upstreamServer: null,
    port: null,
    firstPid: null,
    lastEnsure: null,
    procs: [],
  };
  ctx.bl2103 = st;
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(async () => {
    for (const proc of st.procs) {
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // already gone
        }
      }
    }
    // ensure(), on the replace path, starts its own new shim via its own
    // detached Popen (start_new_session=True) - a real process this
    // handler never spawned directly and so cannot track in st.procs.
    // One last probe of the port finds whatever is serving there now
    // (the replacement shim, or the original if ensure never ran) and
    // kills it by the pid its own health reports.
    if (st.port !== null) {
      try {
        const health = await probeHealth(st.port);
        if (health && health.shim === 'local-model-tool-call-shim' && typeof health.pid === 'number') {
          try {
            process.kill(health.pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
      } catch {
        // nothing answering - nothing to clean up
      }
    }
    if (st.upstreamServer) {
      await new Promise((resolve) => st.upstreamServer.close(resolve));
    }
    if (st.foreignServer) {
      await new Promise((resolve) => st.foreignServer.close(resolve));
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  return st;
}

function startUpstream(st) {
  return new Promise((resolve) => {
    st.upstreamServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    st.upstreamServer.listen(0, '127.0.0.1', () => {
      st.upstream = `http://127.0.0.1:${st.upstreamServer.address().port}/v1`;
      resolve();
    });
  });
}

// Node, not ensure's own SIGTERM sender, is the OS parent of every process
// this handler spawns directly - so "has it exited" is answered by Node's
// own 'exit' event, never by polling kill(pid, 0): a just-killed child is
// a zombie (still "exists" to kill(pid, 0)) until Node's event loop reaps
// it, which can lag under load.
function trackExit(st, proc) {
  st.procs.push(proc);
  return new Promise((resolve) => proc.once('exit', resolve));
}

async function spawnRealShim(st) {
  const proc = spawn('python3', [SHIM_PY, 'serve', '--port', String(st.port), '--upstream', st.upstream], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = trackExit(st, proc);
  await waitForHealth(st.port, (h) => h.shim === 'local-model-tool-call-shim');
  return { pid: proc.pid, exited };
}

async function spawnModifiedCopy(st) {
  const original = fs.readFileSync(SHIM_PY, 'utf8');
  const modified = `${original}\n# BL-2103 fixture: one line changed to differ from disk\n`;
  const copyPath = path.join(st.root, 'shim-copy.py');
  fs.writeFileSync(copyPath, modified);
  const proc = spawn('python3', [copyPath, 'serve', '--port', String(st.port), '--upstream', st.upstream], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = trackExit(st, proc);
  await waitForHealth(st.port, (h) => h.shim === 'local-model-tool-call-shim');
  return { pid: proc.pid, exited };
}

// A pre-ticket shim: health names the shim and the upstream but carries
// neither fingerprint nor pid. Its argv is disguised to literally contain
// "<SHIM_PY> serve --port <port> --upstream" - the exact shape a genuine
// shim's own invocation always had at this same path - because
// _find_shim_pid_by_cmdline's pgrep lookup matches on that shape, never
// on port alone.
function spawnFingerprintlessStandIn(st) {
  const code = [
    'import http.server, json, os',
    "PORT = int(os.environ['BL2103_STANDIN_PORT'])",
    "UPSTREAM = os.environ['BL2103_STANDIN_UPSTREAM']",
    'class H(http.server.BaseHTTPRequestHandler):',
    '    def do_GET(self):',
    "        if self.path == '/shim/health':",
    "            body = json.dumps({'shim': 'local-model-tool-call-shim', 'upstream': UPSTREAM}).encode()",
    '            self.send_response(200)',
    "            self.send_header('Content-Type', 'application/json')",
    "            self.send_header('Content-Length', str(len(body)))",
    '            self.end_headers()',
    '            self.wfile.write(body)',
    '        else:',
    '            self.send_response(404)',
    '            self.end_headers()',
    '    def log_message(self, *a):',
    '        pass',
    "http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()",
  ].join('\n');
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'python3',
      ['-c', code, SHIM_PY, 'serve', '--port', String(st.port), '--upstream', st.upstream],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, BL2103_STANDIN_PORT: String(st.port), BL2103_STANDIN_UPSTREAM: st.upstream },
      }
    );
    const exited = trackExit(st, proc);
    waitForHealth(st.port, (h) => h.shim === 'local-model-tool-call-shim')
      .then(() => resolve({ pid: proc.pid, exited }))
      .catch(reject);
  });
}

function spawnForeignProcess(st) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not the shim');
    });
    server.listen(st.port, '127.0.0.1', () => {
      st.foreignServer = server;
      resolve();
    });
  });
}

function runEnsure(st) {
  const result = spawnSync(
    'python3',
    [SHIM_PY, 'ensure', '--port', String(st.port), '--upstream', st.upstream, '--log', st.logPath],
    { encoding: 'utf8', timeout: 30000 }
  );
  st.lastEnsure = result;
  return result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fake Ollama upstream$/, async (ctx) => {
    const st = ensure(ctx);
    await startUpstream(st);
  });

  scoped(/^the shim from disk is serving on the port$/, async (ctx) => {
    const st = ensure(ctx);
    st.port = await freePort();
    ({ pid: st.firstPid, exited: st.firstExited } = await spawnRealShim(st));
  });

  scoped(/^a copy of the shim with one line changed is serving on the port$/, async (ctx) => {
    const st = ensure(ctx);
    st.port = await freePort();
    ({ pid: st.firstPid, exited: st.firstExited } = await spawnModifiedCopy(st));
  });

  scoped(/^a stand-in that answers the shim's health without a code fingerprint is serving on the port$/, async (ctx) => {
    const st = ensure(ctx);
    st.port = await freePort();
    ({ pid: st.firstPid, exited: st.firstExited } = await spawnFingerprintlessStandIn(st));
  });

  scoped(/^a process that is not the shim is serving on the port$/, async (ctx) => {
    const st = ensure(ctx);
    st.port = await freePort();
    await spawnForeignProcess(st);
    st.firstPid = null; // a plain http.createServer has no separate OS process to track
    st.firstExited = null;
  });

  scoped(/^ensure runs for that port and upstream$/, (ctx) => {
    const st = ensure(ctx);
    runEnsure(st);
  });

  scoped(/^ensure exits (\d+)$/, (ctx, code) => {
    const st = ensure(ctx);
    assert.equal(st.lastEnsure.status, Number(code), `ensure stdout:\n${st.lastEnsure.stdout}\nstderr:\n${st.lastEnsure.stderr}`);
  });

  scoped(/^the first process still serves the port$/, async (ctx) => {
    const st = ensure(ctx);
    if (st.firstPid !== null) {
      assert.ok(isAlive(st.firstPid), `expected pid ${st.firstPid} to still be alive`);
    }
    const health = await probeHealth(st.port);
    assert.ok(health, `expected something to still answer on port ${st.port}`);
  });

  scoped(/^the first process has exited$/, async (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.firstPid !== null && st.firstExited, 'no first pid was recorded');
    const timedOut = Symbol('timed out');
    const outcome = await Promise.race([
      st.firstExited.then(() => 'exited'),
      new Promise((resolve) => setTimeout(() => resolve(timedOut), 5000)),
    ]);
    assert.notEqual(outcome, timedOut, `expected pid ${st.firstPid} to have exited within 5s`);
  });

  scoped(/^the process serving the port reports the code on disk$/, async (ctx) => {
    const st = ensure(ctx);
    const health = await waitForHealth(st.port, (h) => h.shim === 'local-model-tool-call-shim');
    assert.equal(health.fingerprint, diskFingerprint());
  });
}

module.exports = { FEATURE, registerSteps };
