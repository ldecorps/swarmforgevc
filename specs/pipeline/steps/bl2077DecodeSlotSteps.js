'use strict';

// BL-2077: step handler for "one decode slot on the host, held by a seat
// across its burst". Boots the REAL local_model_tool_call_shim.py (BL-2076's
// own pattern: spawned as a subprocess, stderr piped to capture its log
// lines) in front of a fake Ollama that holds EVERY chat completion until
// the step text itself releases it - the Background's own wording, and the
// one way to prove a seat genuinely waited rather than trusting a log line
// alone.
//
// Seats are identified at the fake Ollama by the request body's own user-
// message content: the shim strips /seat/<seat>/ before forwarding, so no
// seat name ever reaches upstream any other way.
//
// Scenarios 01-03 (ordering/waiting only, never streamed) use a plain
// (toolless) completion - the simplest shape, and BL-2076's own test
// convention. Scenario 04 (streamed, needs a keepalive while it waits) uses
// a tool-declaring completion, which goes through _respond's worker-thread
// keepalive loop; the plain-passthrough path waits for the slot
// synchronously, with no keepalive of its own - a pre-existing gap in ITS
// OWN slow-upstream handling (it has never had a keepalive, slot or not),
// not one this ticket introduces. Flagged here for the architect's
// hand-over-rules review, per the ticket's own direction.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const FEATURE = 'One decode slot on the host, held by a seat across its burst';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SHIM_PY = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_model_tool_call_shim.py');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

// Short enough to keep this feature fast; long enough that the steps'
// own small setup delays never race past them by accident.
const IDLE_GRACE_S = 0.15;
const HOLD_QUANTUM_S = 0.15;
const KEEPALIVE_S = 0.05;

let state = null;

function freshGate() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function boot(ctx) {
  // Mirrors bl2076ShimNamesSeatSteps.js's own boot() reuse/dispose shape.
  if (state && state.disposed) {
    state = null;
  }
  if (state) {
    return state.ready;
  }
  state = {
    fakeRequests: [], // {seat, receivedAt}
    shimLog: '',
    fakeServer: null,
    shimProc: null,
    fakeUrl: null,
    shimBase: null,
    releaseGate: freshGate(),
    ready: null,
    disposed: false,
  };
  const myState = state;

  // Fake Ollama: records every chat completion's seat (read from the
  // request body, never the path) and holds it until releaseGate resolves
  // - exactly the Background's "answers only when the test releases it".
  myState.fakeServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      if (req.url === '/api/show') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ parameters: '' }));
        return;
      }
      let seat = '?';
      try {
        const parsed = JSON.parse(body);
        const user = (parsed.messages || []).find((m) => m.role === 'user');
        seat = (user && user.content) || '?';
      } catch {
        // leave seat as '?'
      }
      myState.fakeRequests.push({ seat, receivedAt: Date.now() });
      await myState.releaseGate.promise;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-fake', object: 'chat.completion', model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  await new Promise((resolve) => { myState.fakeServer.listen(0, '127.0.0.1', resolve); });
  myState.fakeUrl = `http://127.0.0.1:${myState.fakeServer.address().port}`;

  const portProbe = net.createServer();
  const shimPort = await new Promise((resolve, reject) => {
    portProbe.listen(0, '127.0.0.1', () => {
      const p = portProbe.address().port;
      portProbe.close(() => resolve(p));
    });
    portProbe.on('error', reject);
  });
  myState.shimBase = `http://127.0.0.1:${shimPort}`;

  const shimProc = spawn('python3', [
    SHIM_PY, 'serve', '--port', String(shimPort), '--upstream', `${myState.fakeUrl}/v1`,
    '--idle-grace-s', String(IDLE_GRACE_S), '--hold-quantum-s', String(HOLD_QUANTUM_S),
    '--keepalive-s', String(KEEPALIVE_S),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  myState.shimProc = shimProc;
  shimProc.stderr.on('data', (chunk) => { myState.shimLog += chunk; });
  shimProc.stdout.on('data', () => {});

  const shimReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('shim did not start within 10s')), 10000);
    const probe = () => {
      const req = http.get(`${myState.shimBase}/shim/health`, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(b);
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

  myState.pending = [];
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(async () => {
    myState.disposed = true;
    myState.releaseGate.resolve(); // never leave a held fake-Ollama request hanging
    // Some scenarios (01) deliberately end with a held and a still-
    // waiting completion outstanding - give both a moment to drain
    // through the now-released gate before the shim process dies under
    // them, or the client sees a bare "socket hang up" instead of the
    // response it was always going to get.
    await Promise.race([
      Promise.allSettled(myState.pending),
      new Promise((r) => setTimeout(r, 500)),
    ]);
    if (myState.shimProc && myState.shimProc.exitCode === null) {
      myState.shimProc.kill('SIGTERM');
    }
  });
  ctx.__disposables.push(() => {
    if (myState.fakeServer) {
      myState.fakeServer.close();
    }
  });
  ctx.__disposables.push(() => {
    if (myState.seatUrlScriptFile) {
      try { fs.unlinkSync(myState.seatUrlScriptFile); } catch { /* already gone */ }
    }
  });

  myState.ready = shimReady.then(() => myState);
  return myState.ready;
}

function postJson(url, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
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

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

// Scenario 05: both URLs come from swarmforge.sh's OWN writer
// (local_model_seat_url), the same extraction-and-eval posture
// bl2076ShimNamesSeatSteps.js already uses - never a restatement of the
// URL shape here. "rotating"/"standing" map to the rotation_signal values
// the writer's own call site passes ("router"/""), never read from this
// test; a Scenario Outline example disposes `state` between runs
// (boot()'s own reuse/dispose shape), so the extracted script is torn
// down and rebuilt with each fresh shim's port.
function seatUrlScript(s) {
  if (s.seatUrlScriptFile) {
    return s.seatUrlScriptFile;
  }
  const extract = (fn) => execFileSync('bash', [
    '-c',
    `awk -v fn="${fn}" '$0 ~ "^"fn"\\\\(\\\\) \\\\{" { flag=1 } flag { print } flag && /^\\}/ { exit }' "${SWARMFORGE_SH}"`,
  ], { encoding: 'utf8' });
  const fnText = `${extract('local_model_shim_port')}\n${extract('local_model_seat_url')}`;
  const scriptFile = path.join(os.tmpdir(), `bl2077-seat-url-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(scriptFile, `${fnText}\nlocal_model_seat_url "" "$1" "$2"\n`);
  s.seatUrlScriptFile = scriptFile;
  return scriptFile;
}

function seatUrlFor(s, role, pack) {
  const rotation = pack === 'rotating' ? 'router' : '';
  const shimPort = s.shimBase.split(':').pop();
  const out = execFileSync('bash', [seatUrlScript(s), role, rotation], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_LOCAL_MODEL_SHIM_PORT: shimPort },
  }).trim();
  assert.ok(out.startsWith(`http://127.0.0.1:${shimPort}/seat/`), `unexpected seat URL for ${role} on a ${pack} pack: ${out}`);
  return out;
}

// Scenarios 01-03: a plain completion - the seat name rides as the sole
// user message's content, which is all the fake Ollama ever reads.
function plainBody(seat) {
  return { model: 'm', messages: [{ role: 'user', content: seat }] };
}

// Scenario 04: a tool-declaring completion - the one path with full
// keepalive coverage while it waits for the slot (see file header).
function toolBody(seat, stream) {
  return {
    model: 'm',
    stream: !!stream,
    messages: [{ role: 'user', content: seat }],
    tools: [{ type: 'function', function: { name: 'noop', parameters: {} } }],
  };
}

function sendPlain(s, seat) {
  return sendPlainTo(s, `${s.shimBase}/seat/${seat}/v1`, seat);
}

// Scenario 05: the URL comes from the writer (seatUrlFor), never built
// here from a bare seat name - the URL's own shape (plain seat, or with a
// /pane/<id>/ segment) is exactly what this scenario is testing.
function sendPlainTo(s, url, seat) {
  const sent = postJson(`${url}/chat/completions`, plainBody(seat));
  // Tracked so disposal (a scenario that deliberately ends with a held or
  // still-waiting completion outstanding) can drain it before the shim
  // dies under it - .catch() only to keep the TRACKING copy from ever
  // itself becoming an unhandled rejection; the caller's own promise is
  // returned unwrapped.
  s.pending.push(sent.catch(() => {}));
  return sent;
}

async function waitForFakeRequest(s, seat, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (s.fakeRequests.some((r) => r.seat === seat)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`fake Ollama never received seat=${seat}'s request; got ${JSON.stringify(s.fakeRequests)}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Shared body of the "seat coder has held the slot for <held> the hold
// quantum and seat QA is waiting" Given. coder's FIRST completion is sent
// and reaches the fake Ollama, which holds it - coder's own
// _holder_since starts ticking right there, and the request STAYS held
// (never released here): the Scenario Outline's own words are "coder HAS
// HELD the slot for <held> the hold quantum", present tense, with coder's
// completion answered only in the When step that follows. QA's own
// completion is sent while coder is still genuinely in flight, so QA
// queues normally - never via an idle-grace takeover, which held-for-
// "longer than" would otherwise trigger by the time QA's request lands.
async function heldForQuantum(ctx, held) {
  const s = await boot(ctx);
  s.coderSendPromise = sendPlain(s, 'coder');
  await waitForFakeRequest(s, 'coder');
  if (held === 'longer than') {
    await new Promise((r) => setTimeout(r, (HOLD_QUANTUM_S + 0.15) * 1000));
  }
  s.qaSendPromise = sendPlain(s, 'QA');
  await new Promise((r) => setTimeout(r, 60)); // let QA genuinely start waiting
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a tool-call shim with one decode slot in front of a fake Ollama that answers only when the test releases it$/, (ctx) => boot(ctx));

  scoped(/^seat "coder" has a chat completion in flight$/, (ctx) => boot(ctx).then(async (s) => {
    s.lastSendPromise = sendPlain(s, 'coder');
    await waitForFakeRequest(s, 'coder');
  }));

  scoped(/^seat "QA" sends a chat completion$/, (ctx) => boot(ctx).then(async (s) => {
    s.qaSendPromise = sendPlain(s, 'QA');
    // Give it a beat: either it reaches Ollama (lone-seat case) or it
    // starts waiting (contended case) - the NEXT step asserts which.
    await new Promise((r) => setTimeout(r, 80));
  }));

  scoped(/^QA's completion has not reached the fake Ollama$/, (ctx) => boot(ctx).then((s) => {
    assert.ok(!s.fakeRequests.some((r) => r.seat === 'QA'), `QA's request reached the fake Ollama: ${JSON.stringify(s.fakeRequests)}`);
  }));

  scoped(/^the shim's health names coder as holding the slot and QA as waiting$/, (ctx) => boot(ctx).then(async (s) => {
    const health = await getJson(`${s.shimBase}/shim/health`);
    assert.equal(health.slot.holder, 'coder', `expected coder to hold the slot: ${JSON.stringify(health.slot)}`);
    assert.ok(
      health.slot.waiters.some((w) => w.seat === 'QA'),
      `expected QA to be waiting: ${JSON.stringify(health.slot)}`
    );
  }));

  scoped(/^seat "coder" has held the slot for less than the hold quantum and seat "QA" is waiting$/, (ctx) => heldForQuantum(ctx, 'less than'));

  scoped(/^seat "coder" has held the slot for (.+?) the hold quantum and seat "QA" is waiting$/, (ctx, held) => heldForQuantum(ctx, held));

  scoped(/^coder's completion is answered and coder sends nothing for longer than the idle grace$/, (ctx) => boot(ctx).then(async (s) => {
    s.releaseGate.resolve();
    await s.lastSendPromise;
    s.releaseGate = freshGate();
    await new Promise((r) => setTimeout(r, (IDLE_GRACE_S + 0.15) * 1000));
  }));

  scoped(/^QA's completion reaches the fake Ollama$/, (ctx) => boot(ctx).then(async (s) => {
    await waitForFakeRequest(s, 'QA');
    s.releaseGate.resolve();
    await s.qaSendPromise;
  }));

  scoped(/^the shim log records how long QA waited for the slot$/, (ctx) => boot(ctx).then((s) => {
    assert.match(
      s.shimLog, /slot_handover seat=QA wait_ms=\d+ previous=coder/,
      `no slot_handover line for QA in: ${s.shimLog}`
    );
  }));

  scoped(/^coder's completion is answered and coder sends its next one within the idle grace$/, (ctx) => boot(ctx).then(async (s) => {
    // coder's FIRST completion is still held from the Given step above -
    // answer it now, then coder's NEXT one goes promptly, well within the
    // idle grace.
    s.releaseGate.resolve();
    await s.coderSendPromise;
    s.releaseGate = freshGate();
    s.coderNextSendPromise = sendPlain(s, 'coder');
    await new Promise((r) => setTimeout(r, 40));
  }));

  scoped(/^(coder's next completion|QA's completion) reaches the fake Ollama before (QA's completion|coder's next completion)$/, (ctx, first) => boot(ctx).then(async (s) => {
    // Release whichever side is currently held, in whatever order the
    // slot itself resolves them, until BOTH completions have reached
    // Ollama - the step's own job is only to check the ORDER they arrived
    // in, never to dictate it. coder already has ONE entry from the
    // Given step's first completion, so "coder has reached" alone is not
    // enough - this scenario's own coder's NEXT completion is its SECOND.
    for (let i = 0; i < 4; i += 1) {
      const coderCount = s.fakeRequests.filter((r) => r.seat === 'coder').length;
      const qaCount = s.fakeRequests.filter((r) => r.seat === 'QA').length;
      if (coderCount >= 2 && qaCount >= 1) {
        break;
      }
      s.releaseGate.resolve();
      s.releaseGate = freshGate();
      await new Promise((r) => setTimeout(r, 80));
    }
    const coderReq = s.fakeRequests.filter((r) => r.seat === 'coder').pop();
    const qaReq = s.fakeRequests.filter((r) => r.seat === 'QA').pop();
    assert.ok(coderReq && qaReq, `both completions must have reached Ollama: ${JSON.stringify(s.fakeRequests)}`);
    if (first.startsWith('coder')) {
      assert.ok(coderReq.receivedAt <= qaReq.receivedAt, `expected coder's next completion first: ${JSON.stringify(s.fakeRequests)}`);
    } else {
      assert.ok(qaReq.receivedAt <= coderReq.receivedAt, `expected QA's completion first: ${JSON.stringify(s.fakeRequests)}`);
    }
    s.releaseGate.resolve();
    await Promise.all([s.coderNextSendPromise, s.qaSendPromise].filter(Boolean));
  }));

  scoped(/^seat "QA" sends a streamed chat completion$/, (ctx) => boot(ctx).then(async (s) => {
    s.qaStreamChunks = [];
    s.qaSendPromise = new Promise((resolve, reject) => {
      const body = JSON.stringify(toolBody('QA', true));
      const req = http.request(`${s.shimBase}/seat/QA/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        res.on('data', (c) => { s.qaStreamChunks.push(c.toString()); });
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    s.pending.push(s.qaSendPromise.catch(() => {}));
    // Long enough, at KEEPALIVE_S=0.05s, to accumulate several keepalive
    // comments while coder still holds the slot.
    await new Promise((r) => setTimeout(r, 300));
  }));

  scoped(/^QA receives keepalive comments while it waits$/, (ctx) => boot(ctx).then((s) => {
    const text = s.qaStreamChunks.join('');
    assert.ok(text.includes(': keepalive'), `expected at least one keepalive comment, got: ${JSON.stringify(text)}`);
  }));

  scoped(/^QA receives its reply after coder hands over the slot$/, (ctx) => boot(ctx).then(async (s) => {
    s.releaseGate.resolve(); // coder's own held completion finishes
    await s.lastSendPromise;
    s.releaseGate = freshGate();
    await waitForFakeRequest(s, 'QA');
    s.releaseGate.resolve();
    await s.qaSendPromise;
    const text = s.qaStreamChunks.join('');
    assert.ok(/"content":\s*"ok"/.test(text), `expected QA's reply in the stream, got: ${JSON.stringify(text)}`);
    assert.ok(text.includes('[DONE]'), `expected a [DONE] event, got: ${JSON.stringify(text)}`);
  }));

  // ── Scenario 05 (BL-2077 D1, QA note 003953): a role rotated into one pane is one seat to the slot ──

  scoped(/^a (rotating|standing) pack on which the coder's chat completion, sent to the URL swarmforge\.sh works out for the coder, has just been answered$/, (ctx, pack) => boot(ctx).then(async (s) => {
    s.pack = pack;
    const coderUrl = seatUrlFor(s, 'coder', pack);
    s.coderSendPromise = sendPlainTo(s, coderUrl, 'coder');
    await waitForFakeRequest(s, 'coder');
    s.releaseGate.resolve();
    await s.coderSendPromise;
    s.releaseGate = freshGate();
  }));

  scoped(/^the cleaner sends a chat completion to the URL swarmforge\.sh works out for the cleaner on that pack$/, (ctx) => boot(ctx).then(async (s) => {
    const cleanerUrl = seatUrlFor(s, 'cleaner', s.pack);
    s.cleanerSendPromise = sendPlainTo(s, cleanerUrl, 'cleaner');
  }));

  scoped(/^the cleaner's completion reaches the fake Ollama (before|after) the idle grace runs out$/, (ctx, when) => boot(ctx).then(async (s) => {
    if (when === 'before') {
      // A rotation-in-group grant never waits at all - well inside the
      // idle grace, not merely "eventually".
      await waitForFakeRequest(s, 'cleaner', IDLE_GRACE_S * 1000 * 0.5);
    } else {
      await new Promise((r) => setTimeout(r, IDLE_GRACE_S * 1000 * 0.5));
      assert.ok(!s.fakeRequests.some((r) => r.seat === 'cleaner'), "cleaner reached the fake Ollama before the idle grace ran out, on a standing pack where coder and cleaner are different seats");
      await waitForFakeRequest(s, 'cleaner', IDLE_GRACE_S * 1000 * 2);
    }
    s.releaseGate.resolve();
    await s.cleanerSendPromise;
  }));

  scoped(/^the shim's health names cleaner as holding the slot with no seat waiting$/, (ctx) => boot(ctx).then(async (s) => {
    const health = await getJson(`${s.shimBase}/shim/health`);
    assert.equal(health.slot.holder, 'cleaner', `expected cleaner to hold the slot: ${JSON.stringify(health.slot)}`);
    assert.deepEqual(health.slot.waiters, [], `expected no seat waiting: ${JSON.stringify(health.slot)}`);
  }));
}

module.exports = { FEATURE, registerSteps };
