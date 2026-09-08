'use strict';

// BL-1476's declared invariant 1 (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A completed tick's window row is identical to the row a
//                full walk of the same transcripts would write at that
//                moment - the persisted per-transcript summaries change what
//                is READ, never what is RECORDED.
//
// Drives the REAL compiled runTurnProfileProducer (the bounded, summary-
// cached producer) against real transcript fixtures under mkdtemp, across a
// GENERATED sequence of tick/mutate steps, comparing each completed tick's
// persisted row against buildTurnProfileWindowForGroups' own full walk of
// whatever the transcript set looks like at that exact moment - never a
// JavaScript restatement of the comparison.
//
// GENERATOR REACH (the asserted floor, never a hoped-for one). The defect
// this guards lives in exactly the corner where SOME files changed and
// OTHERS did not since the last tick, across MULTIPLE ticks in a row (a
// mutant that stops re-reading a file after its first read, or that never
// evicts a deleted file's stale summary, only shows up after at least one
// prior completed tick and at least one subsequent mutation). The sequence
// generator is drawn to guarantee this shape by construction: every run
// performs an initial full tick, then 2-6 further steps, each of which
// mutates a non-empty RANDOM SUBSET of the live file set (append to an
// existing file, delete one, or create a new one) before ticking again - so
// "some changed, some did not" is the step's own shape on every draw, never
// a rare corner of a wider distribution.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  buildTurnProfileWindowForGroups,
  readPersistedTurnProfileWindows,
  runTurnProfileProducer,
  windowDedupeKey,
} = require('../out/metrics/turnProfileProducer');
const { projectSlug } = require('../out/metrics/transcriptUsage');

const BASE_MS = 1_700_000_000_000;
let seq = 0;

function toolLine(atMs, toolName, input) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    message: { content: [{ type: 'tool_use', name: toolName, input }] },
  });
}

function randomLine() {
  seq += 1;
  const atMs = BASE_MS + seq * 1000;
  const kinds = [
    () => toolLine(atMs, 'Shell', { command: 'git merge --ff-only origin/main' }),
    () => toolLine(atMs, 'Shell', { command: 'npm run test' }),
    () => toolLine(atMs, 'Write', { file_path: '/tmp/notes.md', content: 'prose' }),
    () => toolLine(atMs, 'Read', { file_path: '/tmp/backlog.yaml' }),
  ];
  return kinds[seq % kinds.length]();
}

function setup() {
  seq += 1;
  const repoRoot = mkTmpDir(`sfvc-bl1476-prop-${seq}-repo-`);
  const claudeProjectsDir = mkTmpDir(`sfvc-bl1476-prop-${seq}-projects-`);
  const coderPath = path.join(repoRoot, '.worktrees', 'coder');
  fs.mkdirSync(coderPath, { recursive: true });
  const transcriptsDir = path.join(claudeProjectsDir, projectSlug(coderPath));
  fs.mkdirSync(transcriptsDir, { recursive: true });
  return { repoRoot, claudeProjectsDir, roleWorktrees: [{ role: 'coder', worktreePath: coderPath }], transcriptsDir };
}

function currentTranscriptPaths(transcriptsDir) {
  return fs
    .readdirSync(transcriptsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(transcriptsDir, f))
    .sort();
}

// One mutation step: touch a non-empty random subset of the CURRENT file
// set (append to some, delete others, and maybe create a fresh one) - never
// a no-op step, so every tick after the first genuinely has something to
// detect.
const stepArb = fc.record({
  createCount: fc.integer({ min: 0, max: 2 }),
  appendIndexes: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 3 }),
  deleteIndexes: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 2 }),
});

function applyStep(transcriptsDir, step) {
  const existing = currentTranscriptPaths(transcriptsDir);
  const toDelete = new Set(step.deleteIndexes.map((i) => i % Math.max(existing.length, 1)).filter((i) => i < existing.length));
  for (const i of toDelete) {
    fs.unlinkSync(existing[i]);
  }
  const survivors = existing.filter((_, i) => !toDelete.has(i));
  for (const i of step.appendIndexes) {
    if (survivors.length === 0) break;
    const target = survivors[i % survivors.length];
    if (fs.existsSync(target)) {
      fs.appendFileSync(target, `\n${randomLine()}\n`, 'utf8');
    }
  }
  for (let i = 0; i < step.createCount; i += 1) {
    seq += 1;
    fs.writeFileSync(path.join(transcriptsDir, `new-${seq}.jsonl`), `${randomLine()}\n`, 'utf8');
  }
}

function tickAndVerify(repoRoot, roleWorktrees, claudeProjectsDir, transcriptsDir) {
  const result = runTurnProfileProducer({ repoRoot, roleWorktrees, claudeProjectsDir });
  if (result.partial) {
    // Unbounded deadline in this test - never expected, but fail loudly
    // rather than silently skipping the comparison if it ever happened.
    throw new Error('unexpected partial tick with no deadline configured');
  }
  const telemetryDir = path.join(repoRoot, '.swarmforge', 'telemetry');
  const fullWalk = buildTurnProfileWindowForGroups([
    { stage: 'coder', transcriptPaths: currentTranscriptPaths(transcriptsDir) },
  ]);
  // Upserts key by windowDedupeKey (window_day + complete), so an empty-set
  // tick (window_day null) and a real-content tick land as DIFFERENT rows,
  // never overwriting each other - find the row this exact tick's own
  // dedupe key names, not merely "whatever was persisted last".
  const row = readPersistedTurnProfileWindows(telemetryDir).find(
    (candidate) => windowDedupeKey(candidate) === windowDedupeKey(fullWalk)
  );
  assert.deepEqual(row, fullWalk, `tick row must equal a full walk; result=${JSON.stringify(result)}`);
}

test('BL-1476 property (invariant 1): every completed tick equals a full walk of the current transcripts', () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 6 }), fc.array(stepArb, { minLength: 2, maxLength: 6 }), (initialCount, steps) => {
      const { repoRoot, claudeProjectsDir, roleWorktrees, transcriptsDir } = setup();
      for (let i = 0; i < initialCount; i += 1) {
        fs.writeFileSync(path.join(transcriptsDir, `t${i}.jsonl`), `${randomLine()}\n`, 'utf8');
      }
      tickAndVerify(repoRoot, roleWorktrees, claudeProjectsDir, transcriptsDir);
      for (const step of steps) {
        applyStep(transcriptsDir, step);
        tickAndVerify(repoRoot, roleWorktrees, claudeProjectsDir, transcriptsDir);
      }
    }),
    { numRuns: 25 }
  );
});
