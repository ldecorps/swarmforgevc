'use strict';

// BL-1848 declared invariants (property authorship rests with the coder,
// first pass - BL-654):
//
//   1. "The window check is read-only: running it changes no file, window,
//      model load, pane or process."
//   2. "Gathering the window facts is bounded: a hung or absent Ollama costs
//      one sweep at most 3 seconds and yields no window finding."
//
// Every draw runs the REAL gatherer and check through
// swarmforge/scripts/test/bl1848_local_window_runner.bb against a fake
// Ollama in this process and a fixture usage dir. Invariant 1 is read off
// the two things the check can reach: the usage dir (every file's bytes and
// mtime before == after) and Ollama (only GET /api/ps is ever requested -
// no load, unload, pull, generate or delete). Panes and processes are not
// reachable from the gatherer at all; the Ollama request log is the
// observable for "model load".
//
// Generator reach (BL-654): draws are built so findings are COMMON, not
// rare - half of the models spill VRAM by construction and half of the
// usage rows are drawn at or above the 90% threshold inside the hour - and
// the run asserts a floor of finding-producing draws, so the read-only
// property is exercised on the states that emit CRITs, not only on quiet
// ones.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (run 2026-10-03, restored byte-for-byte after each):
//   break 1 - gather-local-window-facts given a POST to /api/generate
//     alongside /api/ps: RED, "Ollama saw a non-read request".
//   break 2 - local-window-http-timeout-ms raised to 10000 with the hung
//     server: RED, "a hung Ollama cost 10xxx ms".

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir, sweepStaleTmpDirs } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl1848_local_window_runner.bb');
const PREFIX = 'bl1848-prop-';
const MIB = 1048576;
const SWEEP_BOUND_MS = 3000;

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function runRunner(root, baseUrl, usageDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('bb', [RUNNER, root, 'check', JSON.stringify({ base_url: baseUrl, usage_dir: usageDir })]);
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`runner exited ${code}: ${out}${err}`));
      resolve(JSON.parse(out.trim().split('\n').pop()));
    });
  });
}

function snapshot(dir) {
  return fs.readdirSync(dir).sort().map((name) => {
    const p = path.join(dir, name);
    return { name, bytes: fs.readFileSync(p, 'utf8'), mtimeMs: fs.statSync(p).mtimeMs };
  });
}

const modelArb = fc.record({
  name: fc.constantFrom('ista-iq3s-coder:latest', 'other-model:latest', 'qwen3:8b'),
  sizeMib: fc.integer({ min: 1000, max: 20000 }),
  spills: fc.boolean(),
  spillMib: fc.integer({ min: 1, max: 999 }),
  context: fc.constantFrom(8192, 32768, 49152),
});

const usageArb = fc.record({
  model: fc.constantFrom('ista-iq3s-coder:latest', 'other-model:latest', 'qwen3:8b'),
  nearWindow: fc.boolean(),
  fraction: fc.double({ min: 0, max: 1, noNaN: true }),
  minutesAgo: fc.integer({ min: 0, max: 90 }),
});

describe('BL-1848 local window watch invariants', () => {
  beforeAll(() => sweepStaleTmpDirs({ prefix: PREFIX }));
  let root;
  afterAll(() => root && fs.rmSync(root, { recursive: true, force: true }));

  it('the window check is read-only over the usage dir and Ollama', async () => {
    root = fs.realpathSync(mkTmpDir(`${PREFIX}${process.pid}-`));
    let draws = 0;
    let withFindings = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(modelArb, { minLength: 1, maxLength: 3 }), fc.array(usageArb, { maxLength: 6 }),
        async (models, usage) => {
          draws += 1;
          const usageDir = path.join(root, `usage-${draws}`);
          fs.mkdirSync(usageDir);
          const now = Date.now();
          const ctxOf = new Map(models.map((m) => [m.name, m.context]));
          const lines = usage.map((u, i) => {
            const ctxLen = ctxOf.get(u.model) || 49152;
            const tokens = u.nearWindow
              ? Math.ceil(0.9 * ctxLen) + Math.floor(u.fraction * 0.1 * ctxLen)
              : Math.floor(u.fraction * 0.9 * ctxLen) - 1;
            return JSON.stringify({
              sessionId: `s${i}`, model: u.model, inputTokens: Math.max(0, tokens), outputTokens: 0,
              timestamp: new Date(now - u.minutesAgo * 60000).toISOString(),
            });
          });
          const month = new Date(now).toISOString().slice(0, 7);
          fs.writeFileSync(path.join(usageDir, `token-usage-${month}.jsonl`), `${lines.join('\n')}\n`);
          const before = snapshot(usageDir);

          const requests = [];
          const body = JSON.stringify({
            models: models.map((m) => ({
              name: m.name, size: m.sizeMib * MIB,
              size_vram: (m.spills ? m.sizeMib - m.spillMib : m.sizeMib) * MIB,
              context_length: m.context,
            })),
          });
          const server = await startServer((req, res) => {
            requests.push(`${req.method} ${req.url}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(body);
          });
          try {
            const result = await runRunner(root, `http://127.0.0.1:${server.address().port}`, usageDir);
            if (result.findings.length > 0) withFindings += 1;
          } finally {
            server.close();
          }
          for (const r of requests) assert.equal(r, 'GET /api/ps', `Ollama saw a non-read request: ${r}`);
          assert.deepEqual(snapshot(usageDir), before, 'the check changed the usage dir');
        }),
      { numRuns: 12 },
    );
    // Reachability floor: the CRIT-emitting states were actually exercised.
    assert.ok(withFindings >= 3, `only ${withFindings} of ${draws} draws produced a finding`);
  }, 120000);

  it('a hung or absent Ollama costs at most 3 seconds and yields no finding', async () => {
    root = root || fs.realpathSync(mkTmpDir(`${PREFIX}${process.pid}-`));
    const usageDir = path.join(root, 'usage-hung');
    fs.mkdirSync(usageDir, { recursive: true });
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('hung', 'absent'), async (state) => {
        const server = await startServer(() => { /* never answers */ });
        const port = server.address().port;
        if (state === 'absent') await new Promise((r) => server.close(r));
        try {
          const result = await runRunner(root, `http://127.0.0.1:${port}`, usageDir);
          assert.ok(result.elapsed_ms <= SWEEP_BOUND_MS, `a ${state} Ollama cost ${result.elapsed_ms} ms`);
          assert.deepEqual(result.findings, []);
        } finally {
          if (state === 'hung') server.closeAllConnections?.(), server.close();
        }
      }),
      { numRuns: 4 },
    );
  }, 60000);
});
