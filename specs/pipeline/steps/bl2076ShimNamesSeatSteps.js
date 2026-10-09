'use strict';

// BL-2076: step handler for "the tool-call shim names the seat behind every
// chat completion". Boots the REAL local_model_tool_call_shim.py (spawned as
// a subprocess, stderr piped to capture its log lines) in front of a fake
// Ollama (http.createServer on 127.0.0.1:0 recording every request path and
// body). Seat URLs are built by awk-extracting local_model_seat_url from
// swarmforge.sh and eval'ing it in bash - exactly test_bl1917's posture:
// sourcing swarmforge.sh outright would run the launcher.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const FEATURE = 'The tool-call shim names the seat behind every chat completion';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const SHIM_PY = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_model_tool_call_shim.py');

let state = null;

function scoped(pattern, fn) {
  return function (ctx) {
    return fn(ctx);
  };
}

async function boot(ctx) {
  // A Scenario Outline example disposes this module's shim/fake-server
  // after each example (runtime.js's own cleanup), but `state` itself is
  // never reset - the next example's boot() must tell a disposed shim from
  // a live one. The disposer's own kill() call sets state.disposed itself,
  // synchronously - exitCode lags the SIGTERM by an event-loop tick or
  // more, too late for the next example's boot() to see.
  if (state && state.disposed) {
    state = null;
  }
  if (state) {
    return state.ready;
  }
  state = {
    fakeRequests: [],
    shimLog: '',
    fakeServer: null,
    shimProc: null,
    fakeUrl: null,
    shimBase: null,
    seatUrls: {},
    ready: null,
    disposed: false,
  };
  // The module-level `state` binding gets reassigned on the next boot();
  // disposables run later and must close over THIS call's object, not
  // whatever `state` happens to hold by then.
  const myState = state;

  // Fake Ollama: records (path, body) and answers /api/show with no
  // num_predict (the shim leaves the request unclamped) and every
  // /v1/chat/completions with a plain completion carrying usage.
  state.fakeServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      state.fakeRequests.push({ path: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/show') {
        res.end(JSON.stringify({ parameters: '' }));
        return;
      }
      res.end(JSON.stringify({
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        model: 'qwen3-coder',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  const fakeReady = new Promise((resolve) => {
    state.fakeServer.listen(0, '127.0.0.1', resolve);
  });
  await fakeReady;
  state.fakeUrl = `http://127.0.0.1:${state.fakeServer.address().port}`;

  // A free port picked the same way as the fake Ollama's, then handed to
  // the shim explicitly: `serve --port 0` lets the kernel pick, but the
  // shim's own startup log line (main()) names the literal --port argument,
  // not the bound socket, so a scanning probe for "a shim somewhere" would
  // find the host's own already-running production shim on its well-known
  // port (11439) before ever reaching this one's real, high ephemeral port.
  const portProbe = require('node:net').createServer();
  const shimPort = await new Promise((resolve, reject) => {
    portProbe.listen(0, '127.0.0.1', () => {
      const p = portProbe.address().port;
      portProbe.close(() => resolve(p));
    });
    portProbe.on('error', reject);
  });
  state.shimPort = shimPort;
  state.shimBase = `http://127.0.0.1:${shimPort}`;

  // The real shim, spawned as a subprocess (Python, not requireable),
  // stderr piped so the chat log lines land in state.shimLog.
  //
  // BL-2077: this feature's own seat-switch scenario sends from one seat
  // then another - with the shim's DEFAULT decode-slot durations
  // (idle_grace_s=30, hold_quantum_s=300), the second seat's completion
  // would genuinely wait out a real 30s idle grace before reaching the
  // fake Ollama. This feature cares only about seat naming and logging,
  // never the slot's own timing, so a negligible grace/quantum keeps any
  // inter-seat wait effectively instant - the same fix the shim's own
  // unittest file's LiveShimTests/SeatNamedLiveTests needed.
  const shimProc = spawn('python3', [
    SHIM_PY, 'serve', '--port', String(shimPort), '--upstream', `${state.fakeUrl}/v1`,
    '--idle-grace-s', '0.01', '--hold-quantum-s', '0.01',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.shimProc = shimProc;
  shimProc.stderr.on('data', (chunk) => { state.shimLog += chunk; });
  shimProc.stdout.on('data', () => {});

  // Readiness: poll the shim's own /shim/health on the exact port we gave it.
  const shimReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('shim did not start within 10s')), 10000);
    const probe = () => {
      const req = http.get(`${state.shimBase}/shim/health`, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j && j.shim === 'local-model-tool-call-shim') {
              clearTimeout(timer);
              resolve();
              return;
            }
          } catch {
            // not ready yet
          }
          setTimeout(probe, 50);
        });
      });
      req.on('error', () => setTimeout(probe, 50));
    };
    probe();
    shimProc.on('error', (err) => { clearTimeout(timer); reject(err); });
    shimProc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`shim exited early with code ${code}`)); });
  });

  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(() => {
    myState.disposed = true;
    if (myState.shimProc && myState.shimProc.exitCode === null) {
      myState.shimProc.kill('SIGTERM');
    }
  });
  ctx.__disposables.push(() => {
    if (myState.fakeServer) {
      myState.fakeServer.close();
    }
  });

  // local_model_seat_url, extracted from the live swarmforge.sh and eval'd
  // in bash (test_bl1917_local_model_seat_url.sh's posture). The function
  // calls local_model_shim_port, so that one is extracted too; the port is
  // pinned to the shim's kernel-assigned port via the env var the
  // function reads. Runs only after shimReady resolves - state.shimBase is
  // set inside that promise's own resolve path, not before it.
  state.ready = shimReady.then(() => {
    const extract = (fn) => execFileSync('bash', [
      '-c',
      `awk -v fn="${fn}" '$0 ~ "^"fn"\\\\(\\\\) \\\\{" { flag=1 } flag { print } flag && /^\\}/ { exit }' "${SWARMFORGE_SH}"`,
    ], { encoding: 'utf8' });
    const fnText = `${extract('local_model_shim_port')}\n${extract('local_model_seat_url')}`;
    const shimPort = state.shimBase.split(':').pop();
    // The extracted function text itself contains single quotes (printf
    // literals), so it cannot be embedded inside a single-quoted -c
    // argument - write it to a script file instead and call it by argv,
    // never by shell string interpolation.
    const scriptFile = path.join(os.tmpdir(), `bl2076-seat-url-${process.pid}.sh`);
    fs.writeFileSync(scriptFile, `${fnText}\nlocal_model_seat_url "" "$1"\n`);
    ctx.__disposables.push(() => {
      try { fs.unlinkSync(scriptFile); } catch { /* already gone */ }
    });
    const seatUrls = {};
    for (const role of ['coder', 'coder@2', 'qa']) {
      const out = execFileSync('bash', [scriptFile, role], {
        encoding: 'utf8',
        env: { ...process.env, SWARMFORGE_LOCAL_MODEL_SHIM_PORT: shimPort },
      }).trim();
      assert.ok(out.startsWith(`http://127.0.0.1:${shimPort}/seat/`), `unexpected seat URL for ${role}: ${out}`);
      seatUrls[role] = out;
    }
    state.seatUrls = seatUrls;
    return state;
  });
  return state.ready;
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    // Content-Length, not chunked: the shim's _read_body() only reads via
    // Content-Length (every real client - curl, the OpenAI SDK - sets it),
    // so a client that omits it (Node's default when write()/end() are
    // called separately) is read as an empty body.
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function chatBody() {
  return JSON.stringify({ model: 'qwen3-coder', messages: [{ role: 'user', content: 'hello' }] });
}

function chatLines(s) {
  // Every shim log line is timestamp-prefixed ("2026-...Z chat seat=..."),
  // never starts with "chat " itself.
  return s.shimLog.split('\n').filter((l) => / chat seat=/.test(l));
}

// The shim writes its chat log line to stderr AFTER it has already sent the
// HTTP response, so the line can still be in flight over the pipe when the
// step that reads it runs right after the response resolves - poll briefly
// rather than reading shimLog synchronously.
async function waitForChatLines(s, predicate, timeoutMs = 2000, minCount = 1) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = chatLines(s).filter(predicate);
    if (lines.length >= minCount) {
      return lines;
    }
    if (Date.now() > deadline) {
      return lines;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp("^a tool-call shim in front of a fake Ollama$"), (ctx) => {
    return boot(ctx);
  });

  scoped(new RegExp("^seat \"(.+?)\" sends a chat completion to the URL swarmforge\\.sh works out for it$"), (ctx, seat) => {
    return boot(ctx).then((s) => {
      const url = s.seatUrls[seat];
      assert.ok(url, `no seat URL built for ${seat}`);
      return postJson(`${url}/chat/completions`, chatBody()).then((r) => {
        assert.equal(r.status, 200, `seat ${seat} completion failed: ${r.status} ${r.data}`);
      });
    });
  });

  scoped(new RegExp("^the fake Ollama receives it at /v1/chat/completions with the same body$"), (ctx) => {
    return boot(ctx).then((s) => {
      const atV1 = s.fakeRequests.filter((r) => r.path === '/v1/chat/completions');
      assert.ok(atV1.length >= 1, `no request at /v1/chat/completions; got ${JSON.stringify(s.fakeRequests.map((r) => r.path))}`);
      const last = atV1[atV1.length - 1];
      const sent = JSON.parse(chatBody());
      const received = JSON.parse(last.body);
      assert.deepEqual(received, sent, `upstream body differs: sent ${JSON.stringify(sent)} got ${JSON.stringify(received)}`);
    });
  });

  scoped(new RegExp("^the shim log line for that completion names seat \"(.+?)\" with its duration and prompt tokens$"), (ctx, seat) => {
    return boot(ctx).then(async (s) => {
      const mine = await waitForChatLines(s, (l) => l.includes(`seat=${seat} `));
      assert.ok(mine.length >= 1, `no chat line for seat=${seat}; log: ${s.shimLog}`);
      const last = mine[mine.length - 1];
      assert.match(last, /duration_ms=\d+/, `no duration in: ${last}`);
      assert.match(last, /prompt_tokens=\d+/, `no prompt tokens in: ${last}`);
    });
  });

  scoped(new RegExp("^seat \"coder\" sends two chat completions and then seat \"QA\" sends one$"), (ctx) => {
    return boot(ctx).then((s) => {
      const send = (role) => postJson(`${s.seatUrls[role]}/chat/completions`, chatBody()).then((r) => {
        assert.equal(r.status, 200, `seat ${role} completion failed: ${r.status} ${r.data}`);
      });
      return send('coder').then(() => send('coder')).then(() => send('qa'));
    });
  });

  scoped(new RegExp("^the log line for coder's second completion reads switch=0$"), (ctx) => {
    return boot(ctx).then(async (s) => {
      const coderLines = await waitForChatLines(s, (l) => l.includes('seat=coder '), 2000, 2);
      assert.ok(coderLines.length >= 2, `expected two coder chat lines, got ${coderLines.length}; log: ${s.shimLog}`);
      const second = coderLines[1];
      assert.match(second, /switch=0/, `coder's second line does not read switch=0: ${second}`);
    });
  });

  scoped(new RegExp("^the log line for QA's completion reads switch=1$"), (ctx) => {
    return boot(ctx).then(async (s) => {
      const qaLines = await waitForChatLines(s, (l) => l.includes('seat=qa '));
      assert.ok(qaLines.length >= 1, `no qa chat line; log: ${s.shimLog}`);
      const last = qaLines[qaLines.length - 1];
      assert.match(last, /switch=1/, `QA's line does not read switch=1: ${last}`);
    });
  });

  scoped(new RegExp("^a client sends a chat completion at the shim's plain /v1 path$"), (ctx) => {
    return boot(ctx).then((s) => {
      const url = `${s.shimBase}/v1/chat/completions`;
      return postJson(url, chatBody()).then((r) => {
        assert.equal(r.status, 200, `plain /v1 completion failed: ${r.status} ${r.data}`);
      });
    });
  });

  scoped(new RegExp("^the shim log line for that completion names seat \"-\" with its duration and prompt tokens$"), (ctx) => {
    return boot(ctx).then(async (s) => {
      const dashLines = await waitForChatLines(s, (l) => l.includes('seat=- '));
      assert.ok(dashLines.length >= 1, `no seat=- chat line; log: ${s.shimLog}`);
      const last = dashLines[dashLines.length - 1];
      assert.match(last, /duration_ms=\d+/, `no duration in: ${last}`);
      assert.match(last, /prompt_tokens=\d+/, `no prompt tokens in: ${last}`);
    });
  });
}

module.exports = { FEATURE, registerSteps };
