'use strict';

// BL-2076 declared invariant: "Every request the shim forwards reaches
// Ollama with the same method, body and /v1 path as before this slice; the
// seat changes only what the shim logs and reports." Exercises the REAL
// local_model_tool_call_shim.py (spawned once for the whole file) against a
// fake Ollama, varying the seat name and the JSON body across many runs -
// the generator must reach seats with no seat at all (plain /v1), seats
// with the @N suffix real multi-seat roles use (coder@2), and bodies of
// varying shape, or passing hundreds of runs would prove nothing about the
// one case that matters.
//
// Non-vacuous: breaking seat_of_path to always return the unmodified path
// (so a seat path forwards as /seat/<seat>/v1/chat/completions, which the
// fake Ollama never answers) turns this red before the fix restored it.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHIM_PY = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_model_tool_call_shim.py');

let fakeServer;
let fakeRequests;
let fakeUrl;
let shimProc;
let shimBase;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function waitForHealth(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(`${base}/shim/health`, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j && j.shim === 'local-model-tool-call-shim') {
              resolve();
              return;
            }
          } catch {
            // not ready yet
          }
          if (Date.now() > deadline) { reject(new Error('shim health timeout')); return; }
          setTimeout(probe, 20);
        });
      });
      req.on('error', () => {
        if (Date.now() > deadline) { reject(new Error('shim health timeout')); return; }
        setTimeout(probe, 20);
      });
    };
    probe();
  });
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

function getRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  fakeRequests = [];
  fakeServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      fakeRequests.push({ method: req.method, path: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/show') { res.end(JSON.stringify({ parameters: '' })); return; }
      res.end(JSON.stringify({
        id: 'chatcmpl-fake', object: 'chat.completion', model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
  fakeUrl = `http://127.0.0.1:${fakeServer.address().port}`;

  const shimPort = await freePort();
  shimBase = `http://127.0.0.1:${shimPort}`;
  shimProc = spawn('python3', [SHIM_PY, 'serve', '--port', String(shimPort), '--upstream', `${fakeUrl}/v1`], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitForHealth(shimBase, 10000);
}, 20000);

afterAll(() => {
  if (shimProc && shimProc.exitCode === null) shimProc.kill('SIGTERM');
  if (fakeServer) fakeServer.close();
});

const seatArb = fc.oneof(
  fc.constant(null), // no seat at all: the plain /v1 path
  fc.constantFrom('coder', 'coder@2', 'QA', 'architect', 'hardener', 'documenter'),
);

const bodyArb = fc.record({
  model: fc.constantFrom('m', 'qwen3-coder', 'x'),
  messages: fc.array(
    fc.record({ role: fc.constantFrom('user', 'assistant'), content: fc.string({ maxLength: 40 }) }),
    { minLength: 1, maxLength: 4 }
  ),
});

test('property (BL-2076 invariant): the shim forwards every request to Ollama with the same method, body and /v1 path, regardless of seat', async () => {
  await fc.assert(
    fc.asyncProperty(seatArb, bodyArb, async (seat, bodyObj) => {
      const url = seat === null
        ? `${shimBase}/v1/chat/completions`
        : `${shimBase}/seat/${seat}/v1/chat/completions`;
      const before = fakeRequests.length;
      const r = await postJson(url, bodyObj);
      assert.equal(r.status, 200, `seat=${seat} completion failed: ${r.status} ${r.data}`);
      const forwarded = fakeRequests.slice(before).filter((req) => req.path === '/v1/chat/completions');
      assert.equal(forwarded.length, 1, `expected exactly one /v1/chat/completions request upstream, got ${forwarded.length}`);
      const last = forwarded[forwarded.length - 1];
      assert.equal(last.method, 'POST');
      assert.deepEqual(JSON.parse(last.body), JSON.parse(JSON.stringify(bodyObj)), 'the body Ollama received must equal the body sent');
    }),
    { numRuns: 30 }
  );
}, 30000);

// D1 (BL-2076 bounce, 2026-10-08): only do_POST stripped the seat prefix -
// a GET/HEAD/DELETE at /seat/<seat>/v1/... forwarded with the prefix still
// on and Ollama 404'd. Draws the method alongside the seat so this would
// have caught it.
test('property (BL-2076 invariant, D1): a GET at a seat URL reaches Ollama at /v1/... with the prefix stripped, regardless of seat', async () => {
  await fc.assert(
    fc.asyncProperty(seatArb, async (seat) => {
      const url = seat === null
        ? `${shimBase}/v1/models`
        : `${shimBase}/seat/${seat}/v1/models`;
      const before = fakeRequests.length;
      const r = await getRequest(url);
      assert.equal(r.status, 200, `seat=${seat} GET failed: ${r.status} ${r.data}`);
      const forwarded = fakeRequests.slice(before).filter((req) => req.method === 'GET');
      assert.equal(forwarded.length, 1, `expected exactly one GET request upstream, got ${forwarded.length}`);
      assert.equal(forwarded[0].path, '/v1/models', 'Ollama must see the prefix stripped, not /seat/<seat>/v1/models');
    }),
    { numRuns: 15 }
  );
}, 20000);
