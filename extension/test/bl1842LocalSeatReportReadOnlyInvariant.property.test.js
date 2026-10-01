'use strict';

// BL-1842 declared invariant (ticket YAML `invariants:`), encoded as an
// executable property per the architect's own bounce
// (backlog/evidence/BL-1842-architect-20260930-bounce.md, D1):
//
// "The local-seat report is read-only: running it changes no file, pane
// or process."
//
// The coder's first pass treated this as an unencodable code-shape claim
// (no `spit`/`kill`/etc call exists in the two files). The bounce's own
// point: that argument is itself evidence FOR a black-box encoding, not a
// reason to skip one - a directory-snapshot property confirms it
// mechanically across every input shape a hand grep cannot enumerate,
// exactly the way BL-1846's invariant 2 drives coordinator_config_lib.bb
// over generator-drawn conf text. This drives the REAL, shipped
// local_seat_report_cli.bb via execFileSync over a generator-built mkdtemp
// fixture and asserts the fixture's own file tree (path + content +
// mtime, recursively) is byte-identical before and after - never a
// reimplementation of what the CLI does internally.
//
// Generator reach: every generated case builds a real, well-formed qwen
// usage file, session chat file and Ollama log (the three record shapes
// the CLI reads), so every run genuinely exercises every read path - a
// generator that sometimes omitted a file would under-test the very
// surface this invariant is about.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REPORT_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_seat_report_cli.bb');

const usageEntryArb = fc.record({
  inputTokens: fc.integer({ min: 0, max: 5000 }),
  outputTokens: fc.integer({ min: 0, max: 5000 }),
  thoughtsTokens: fc.integer({ min: 0, max: 2000 }),
  minutesAgo: fc.integer({ min: 0, max: 120 }),
});

const caseArb = fc.record({
  seatVariant: fc.stringMatching(/^[a-z0-9]{1,8}$/),
  usageEntries: fc.array(usageEntryArb, { minLength: 1, maxLength: 5 }),
  compressions: fc.integer({ min: 0, max: 3 }),
  apiErrors: fc.integer({ min: 0, max: 3 }),
  layersOnGpu: fc.integer({ min: 0, max: 65 }),
  context: fc.integer({ min: 2048, max: 65536 }),
  tokensPerSecond: fc.float({ min: Math.fround(0.1), max: Math.fround(50), noNaN: true }),
  sessionsArg: fc.integer({ min: 1, max: 3 }),
});

function qwenCwdKey(worktreePath) {
  return worktreePath.replace(/[/.]/g, '-');
}

function buildFixture(root, { seatVariant, usageEntries, compressions, apiErrors, layersOnGpu, context, tokensPerSecond }) {
  const nowMs = Date.parse('2026-09-30T22:00:00Z');
  const seat = `coder@${seatVariant}`;
  const sessionId = `bl1842-ro-${seatVariant}`;
  const usageDir = path.join(root, '.qwen', 'usage');
  fs.mkdirSync(usageDir, { recursive: true });
  const usageLines = usageEntries.map((e) =>
    JSON.stringify({
      sessionId,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      thoughtsTokens: e.thoughtsTokens,
      timestamp: new Date(nowMs - e.minutesAgo * 60000).toISOString(),
    })
  );
  fs.writeFileSync(path.join(usageDir, 'token-usage-fixture.jsonl'), usageLines.join('\n') + '\n');

  const worktreePath = path.join(root, '.worktrees', `coder-${seatVariant}`);
  const chatDir = path.join(root, '.qwen', 'projects', qwenCwdKey(worktreePath), 'chats');
  fs.mkdirSync(chatDir, { recursive: true });
  const chatRows = [];
  for (let i = 0; i < compressions; i += 1) {
    chatRows.push(JSON.stringify({ type: 'system', subtype: 'chat_compression', tokensBefore: 9000 + i, tokensAfter: 1000 + i }));
  }
  for (let i = 0; i < apiErrors; i += 1) {
    chatRows.push(JSON.stringify({ type: 'system', subtype: 'ui_telemetry', apiError: true }));
  }
  fs.writeFileSync(path.join(chatDir, `${sessionId}.jsonl`), chatRows.join('\n') + (chatRows.length ? '\n' : ''));

  const ollamaLogPath = path.join(root, 'ollama-serve.log');
  fs.writeFileSync(
    ollamaLogPath,
    `load_tensors: offloaded ${layersOnGpu}/65 layers to GPU\n` +
      `llama_kv_cache: size = 512.00 MiB (f16)\n` +
      `llama_context: n_ctx      = ${context}\n` +
      `slot print_timing: prompt eval | tg = ${tokensPerSecond.toFixed(2)} t/s\n`
  );

  return { seat, nowMs, ollamaLogPath };
}

// Recursive, path+content+mtime snapshot - never a helper built for a
// different purpose's own exclusion defaults, which could hide exactly
// the paths this invariant cares about.
function snapshotTree(root) {
  const entries = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        entries.push(`${path.relative(root, full)}\t${hash}\t${stat.mtimeMs}\t${stat.size}`);
      }
    }
  }
  walk(root);
  return entries.join('\n');
}

test(
  'BL-1842 invariant: the local-seat report is read-only - running it changes no file, pane or process',
  () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const root = fs.realpathSync(mkTmpDir('bl1842-readonly-'));
        const { seat, nowMs, ollamaLogPath } = buildFixture(root, c);
        const before = snapshotTree(root);
        execFileSync(
          'bb',
          [
            REPORT_CLI,
            root,
            '--seat',
            seat,
            '--sessions',
            String(c.sessionsArg),
            '--now-ms',
            String(nowMs),
            '--qwen-home',
            path.join(root, '.qwen'),
            '--ollama-log',
            ollamaLogPath,
          ],
          { encoding: 'utf8' }
        );
        const after = snapshotTree(root);
        assert.equal(before, after, `the fixture tree changed after running the report for seat "${seat}"`);
        return true;
      }),
      { numRuns: 10 }
    );
  },
  propertyLaneTimeoutMs(30000)
);
