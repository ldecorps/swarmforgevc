'use strict';

// BL-1840's two declared invariants (property authorship rests with the
// coder, first pass - BL-654), amended 2026-10-01 after the first premise
// (a written context.autoCompactThreshold) was proven false against the
// pinned qwen's own --debug log (backlog/evidence/BL-1840-hardener-bounce-20261001.md):
//
//   1. "The window gate flags exactly the served windows whose qwen
//      compaction trigger is below the trigger a 32768-token window
//      gives."
//   2. "The trigger the gate reports for a window equals the one the
//      pinned qwen computes for it."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Invariant 1 drives the REAL local_model_window_gate_cli.bb `dead-zone`
// subcommand against a fake Ollama, comparing its own reported trigger
// and verdict against an INDEPENDENT re-derivation of qwen's formula
// (qwenTrigger below) - never the gate's own source read back at itself.
// The acceptance feature's own outline fixes exactly four served windows;
// this property generalizes across a much wider, non-round range, so a
// floor/min slip that happens to agree at those four cannot hide.
//
// Invariant 2 drives the REAL pinned qwen binary (never a
// reimplementation of its own compaction decision), reusing the
// acceptance feature's own method (a throwaway HOME, a loopback fake
// endpoint, qwen's own `[compaction] cheap-gate ... auto=<n>` debug
// line) - across a handful of windows rather than many, since each run
// is a real qwen process.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw), invariant 1: windows
// drawn from the dead zone (33,001-60,852) and windows drawn outside it
// (1-32768, or 60,853-262,144) are each their OWN fc.assert - every run
// of the first hits 'in-dead-zone', every run of the second hits
// 'outside-dead-zone', never a draw that might have missed a boundary.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_model_window_gate_cli.bb');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const MODEL = 'ista-iq3s-coder:latest';

// qwen 0.24.7's own computeThresholds(window, pct), re-derived
// independently from the ticket's own spec text - NOT a call into the
// gate lib, which is what this test exists to check against.
const QWEN_PCT = 0.85;
const QWEN_MAX_OUTPUT = 20000;
const QWEN_BUFFER = 13000;
const REFERENCE_WINDOW = 32768;

function qwenTrigger(window) {
  const reserved = window - (QWEN_MAX_OUTPUT + QWEN_BUFFER);
  const pctTrigger = Math.floor(QWEN_PCT * window);
  return reserved > 0 ? Math.min(pctTrigger, reserved) : pctTrigger;
}

const REFERENCE_TRIGGER = qwenTrigger(REFERENCE_WINDOW);
const DEAD_ZONE_UPPER = QWEN_MAX_OUTPUT + QWEN_BUFFER + REFERENCE_TRIGGER; // 60852

function startFakeOllama(numCtx) {
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ parameters: `num_ctx                        ${numCtx}\nstop                            "</s>"` }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, endpointUrl: `http://127.0.0.1:${server.address().port}/v1` });
    });
  });
}

function runDeadZoneCli(endpointUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn('bb', [CLI, 'dead-zone', '--role', 'coder', '--model', MODEL, '--endpoint-url', endpointUrl], { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

// ── invariant 1: the gate's own trigger/verdict vs an independent re-derivation ──

const INVARIANT_1_CELLS = ['in-dead-zone', 'outside-dead-zone'];
const INVARIANT_1_RUNS = runsPerCell(8 * INVARIANT_1_CELLS.length, INVARIANT_1_CELLS.length);

async function checkWindow(reach, cell, window) {
  reach[cell] += 1;
  const { server, endpointUrl } = await startFakeOllama(window);
  try {
    const { code, stdout, stderr } = await runDeadZoneCli(endpointUrl);
    const expectedTrigger = qwenTrigger(window);
    const expectedFlagged = expectedTrigger < REFERENCE_TRIGGER;
    assert.equal(stdout.trim(), `TRIGGER: ${expectedTrigger}`, `window ${window}: expected TRIGGER: ${expectedTrigger}, got: ${stdout}`);
    if (expectedFlagged) {
      assert.equal(code, 1, `window ${window}: expected a flagged window to refuse (exit 1), got ${code}: ${stdout}${stderr}`);
      assert.match(stderr, /^REFUSE:/m, `window ${window}: expected a REFUSE line, got: ${stderr}`);
    } else {
      assert.equal(code, 0, `window ${window}: expected a non-flagged window to proceed (exit 0), got ${code}: ${stdout}${stderr}`);
    }
    return true;
  } finally {
    server.close();
  }
}

test(
  'BL-1840/BL-654 invariant 1: the window gate flags exactly the served windows whose qwen compaction trigger is below the trigger a 32768-token window gives',
  async () => {
    const reach = { 'in-dead-zone': 0, 'outside-dead-zone': 0 };

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: REFERENCE_WINDOW + 1, max: DEAD_ZONE_UPPER - 1 }), (window) =>
        checkWindow(reach, 'in-dead-zone', window)
      ),
      { numRuns: INVARIANT_1_RUNS }
    );

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.integer({ min: 1, max: REFERENCE_WINDOW }), fc.integer({ min: DEAD_ZONE_UPPER, max: 262144 })),
        (window) => checkWindow(reach, 'outside-dead-zone', window)
      ),
      { numRuns: INVARIANT_1_RUNS }
    );

    assertReachFloor(reach, INVARIANT_1_CELLS, INVARIANT_1_RUNS, 'BL-1840 dead-zone cell');
  },
  propertyLaneTimeoutMs(60000)
);

// ── invariant 2: the gate's trigger vs the REAL pinned qwen's own logged trigger ──

function startCombinedFakeEndpoint(numCtx) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/show') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ parameters: `num_ctx                        ${numCtx}\nstop                            "</s>"` }));
        return;
      }
      void body;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = {
        id: 'chatcmpl-fixture',
        object: 'chat.completion.chunk',
        created: 0,
        model: MODEL,
        choices: [{ index: 0, delta: { role: 'assistant', content: 'ok.' }, finish_reason: 'stop' }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, endpointUrl: `http://127.0.0.1:${server.address().port}/v1` });
    });
  });
}

function writeQwenSettings(cwd, endpointUrl) {
  const script = `source '${SWARMFORGE_SH}'; write_local_model_qwen_settings '${cwd}' '${MODEL}' '${endpointUrl}' '' 'coder'`;
  return new Promise((resolve, reject) => {
    const child = spawn('zsh', ['-f', '-c', script], { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`write_local_model_qwen_settings exited ${code}: ${stdout}${stderr}`))));
    child.on('error', reject);
  });
}

function runRealQwen(home, cwd, endpointUrl) {
  const prompt = `MARKER-ONLY ${'x'.repeat(200)}`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      'qwen',
      ['--debug', '--auth-type', 'openai', '-y', '-m', MODEL, '--openai-base-url', endpointUrl, '--openai-api-key', 'fixture', '-p', prompt],
      { cwd, env: { ...process.env, HOME: home, OPENAI_API_KEY: 'fixture' }, timeout: 60000 }
    );
    child.on('close', () => resolve());
    child.on('error', reject);
  });
}

function readQwenDebugLog(home) {
  const debugDir = path.join(home, '.qwen', 'debug');
  let text = '';
  try {
    for (const f of fs.readdirSync(debugDir)) {
      text += fs.readFileSync(path.join(debugDir, f), 'utf8');
    }
  } catch {
    // no debug dir - text stays empty, the caller's assertion reports it.
  }
  return text;
}

const INVARIANT_2_WINDOWS = [REFERENCE_WINDOW, 49152, 65536];

test(
  "BL-1840/BL-654 invariant 2: the trigger the gate reports for a window equals the one the pinned qwen computes for it",
  async () => {
    for (const window of INVARIANT_2_WINDOWS) {
      const home = mkTmpDir('bl1840-property-home-');
      const cwd = mkTmpDir('bl1840-property-cwd-');
      const { server, endpointUrl } = await startCombinedFakeEndpoint(window);
      try {
        await writeQwenSettings(cwd, endpointUrl);
        await runRealQwen(home, cwd, endpointUrl);
        const debugLog = readQwenDebugLog(home);
        const m = /\[compaction\] cheap-gate[^\n]*auto=(\d+)/.exec(debugLog);
        assert.ok(m, `window ${window}: expected a [compaction] cheap-gate ... auto=<n> debug line, got: ${debugLog}`);
        assert.equal(Number(m[1]), qwenTrigger(window), `window ${window}: qwen's own logged trigger did not match the gate's own formula`);
      } finally {
        server.close();
      }
    }
  },
  propertyLaneTimeoutMs(60000)
);
