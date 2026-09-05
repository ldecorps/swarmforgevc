'use strict';

// BL-1364 declared invariants:
//
// 1. A stage with no classified turns in the window is ABSENT from the
//    series, never reported as a zero share - silence and a measured zero
//    must never be confused.
// 2. A window containing an unreadable or partial transcript is reported
//    incomplete and contributes no share, rather than diluting one (the
//    fail-closed posture every other sweep in this repo takes).
// 3. The category set comes from the walker's own definition; the series
//    never restates it, so the two cannot drift apart (BL-897).
//
// All three drive the REAL walker and the REAL production consumer over REAL
// transcript files on disk. A stubbed walker could not exhibit any of these:
// invariant 1 is a property of which stages the walk actually produces
// intervals for, and invariant 2 is a property of how a real file that fails
// to parse is treated.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { buildTurnProfileWindowRecord } = require('../out/metrics/turnProfileProducer');
const { INTERVAL_CATEGORIES } = require('../out/metrics/transcriptWalker');

const BASE_MS = 1_700_000_000_000;
const STAGES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'qa'];

function toolLine(atMs, toolName, input) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    message: { content: [{ type: 'tool_use', name: toolName, input }] },
  });
}

// Three line kinds the walker really classifies differently, so a generated
// stage's mix is a mix in the classifier's terms and not merely in the
// fixture's.
const LINE_KINDS = [
  (atMs) => toolLine(atMs, 'Shell', { command: 'git merge --ff-only origin/main' }),
  (atMs) => toolLine(atMs, 'Shell', { command: 'npm run test' }),
  (atMs) => toolLine(atMs, 'Write', { file_path: '/tmp/n.md', content: 'prose' }),
];

function withRoot(prefix, fn) {
  const root = mkTmpDir(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Each worked stage gets its own transcript and its own non-overlapping trail
// slot, so "worked" and "not worked" are unambiguous in the fixture.
function buildWindow(root, workedSpecs, extraPaths = []) {
  const paths = [...extraPaths];
  const trail = [];
  workedSpecs.forEach((spec, index) => {
    const slotStart = BASE_MS + index * 100_000;
    const lines = spec.kinds.map((kindIdx, n) => LINE_KINDS[kindIdx](slotStart + 1_000 + n * 1_000));
    const file = path.join(root, `${spec.stage}-${index}.jsonl`);
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    paths.push(file);
    trail.push({
      ticketId: 'BL-1364-PROP',
      stage: spec.stage,
      startMs: slotStart + 900,
      endMs: slotStart + 90_000,
    });
  });
  return { paths, trail };
}

const workedSpecArb = fc
  .uniqueArray(fc.integer({ min: 0, max: STAGES.length - 1 }), { minLength: 1, maxLength: 4 })
  .chain((stageIdxs) =>
    fc.tuple(
      ...stageIdxs.map((idx) =>
        fc
          .array(fc.integer({ min: 0, max: LINE_KINDS.length - 1 }), { minLength: 1, maxLength: 3 })
          .map((kinds) => ({ stage: STAGES[idx], kinds }))
      )
    )
  );

test('property (invariant 1): a stage nobody worked is absent, never a zero share', () => {
  const seen = { someUnworked: 0, allWorked: 0, multiWorked: 0 };
  fc.assert(
    fc.property(workedSpecArb, (workedSpecs) => {
      const worked = new Set(workedSpecs.map((spec) => spec.stage));
      const unworked = STAGES.filter((stage) => !worked.has(stage));
      if (unworked.length > 0) seen.someUnworked += 1;
      else seen.allWorked += 1;
      if (worked.size > 1) seen.multiWorked += 1;

      withRoot('sfvc-bl1364-inv1-', (root) => {
        const { paths, trail } = buildWindow(root, workedSpecs);
        // Every stage - worked or not - is declared in the trail, so absence
        // can only come from having no classified interval, which is the
        // distinction under test.
        const fullTrail = [
          ...trail,
          ...unworked.map((stage, i) => ({
            ticketId: 'BL-1364-PROP',
            stage,
            startMs: BASE_MS + 10_000_000 + i * 100_000,
            endMs: BASE_MS + 10_000_000 + i * 100_000 + 50_000,
          })),
        ];
        const record = buildTurnProfileWindowRecord({ transcriptPaths: paths, handoffTrail: fullTrail });
        const reported = new Set(record.stages.map((entry) => entry.stage));

        for (const stage of unworked) {
          assert.ok(
            !reported.has(stage),
            `${stage} did no work in the window but appears in the series: ${JSON.stringify(record.stages)}`
          );
        }
        for (const stage of worked) {
          assert.ok(reported.has(stage), `${stage} was worked but is missing from the series`);
        }
      });
    }),
    { numRuns: 25 }
  );

  // Reachability floors: a run that never generated an unworked stage would
  // pass invariant 1 without ever testing it.
  assert.ok(seen.someUnworked >= 1, `generator never left a stage unworked: ${JSON.stringify(seen)}`);
  assert.ok(seen.multiWorked >= 1, `generator never worked more than one stage: ${JSON.stringify(seen)}`);
});

test('property (invariant 2): one damaged transcript refuses the whole window', () => {
  const seen = { interior: 0, missing: 0, unreadablePath: 0 };
  fc.assert(
    fc.property(workedSpecArb, fc.integer({ min: 0, max: 2 }), (workedSpecs, brokenKind) => {
      if (brokenKind === 0) seen.interior += 1;
      else if (brokenKind === 1) seen.missing += 1;
      else seen.unreadablePath += 1;

      withRoot('sfvc-bl1364-inv2-', (root) => {
        // A control run first: the same window, whole, DOES report shares -
        // otherwise "no shares" would be trivially true and prove nothing.
        const whole = buildWindow(root, workedSpecs);
        const control = buildTurnProfileWindowRecord({
          transcriptPaths: whole.paths,
          handoffTrail: whole.trail,
        });
        assert.equal(control.complete, true, 'the control window should be complete');
        assert.ok(control.stages.length > 0, 'the control window reported no stage at all');

        let broken;
        if (brokenKind === 0) {
          // Interior damage: a bad line with a COMPLETE line after it. A torn
          // FINAL line is a different condition (an in-progress append) and is
          // covered by its own property below.
          broken = path.join(root, 'broken-interior.jsonl');
          fs.writeFileSync(broken, `garbage\n${LINE_KINDS[0](BASE_MS)}\n`, 'utf8');
        } else if (brokenKind === 1) {
          broken = path.join(root, 'broken-missing.jsonl');
        } else {
          // A path that exists but cannot be read at all. A directory raises
          // EISDIR, which is a real read failure without simulating one by
          // chmod (engineering.prompt forbids chmod-for-failure).
          broken = path.join(root, 'broken-unreadable.jsonl');
          fs.mkdirSync(broken, { recursive: true });
        }

        const record = buildTurnProfileWindowRecord({
          transcriptPaths: [...whole.paths, broken],
          handoffTrail: whole.trail,
        });

        assert.equal(record.complete, false, 'a window with an unreadable transcript claimed completeness');
        assert.deepEqual(record.stages, [], 'a partial window diluted a share instead of refusing one');
        assert.ok(
          record.unreadable_transcripts.includes(broken),
          'the record does not name the transcript it could not read'
        );
      });
    }),
    { numRuns: 15 }
  );

  assert.ok(seen.interior >= 1, `never generated interior damage: ${JSON.stringify(seen)}`);
  assert.ok(seen.missing >= 1, `never generated a missing transcript: ${JSON.stringify(seen)}`);
  assert.ok(seen.unreadablePath >= 1, `never generated an unreadable path: ${JSON.stringify(seen)}`);
});

// The other face of invariant 2, and the one the live repo actually exhibits:
// 6 of 2256 role transcripts on 2026-09-05 had a torn FINAL line because their
// agent was mid-append. If that sinks the window, the producer publishes
// nothing, ever - so the tolerated case needs a property of its own, or the
// distinction would rest entirely on one hand-written example.
test('property (invariant 2, tolerated face): an in-progress append never sinks the window', () => {
  const seen = { withTails: 0 };
  fc.assert(
    fc.property(workedSpecArb, fc.integer({ min: 1, max: 3 }), (workedSpecs, tailCount) => {
      seen.withTails += 1;
      withRoot('sfvc-bl1364-inv2-tail-', (root) => {
        const whole = buildWindow(root, workedSpecs);
        const tails = [];
        for (let i = 0; i < tailCount; i += 1) {
          const live = path.join(root, `live-${i}.jsonl`);
          fs.writeFileSync(live, `${LINE_KINDS[1](BASE_MS + i * 1_000)}\n{"type":"assis`, 'utf8');
          tails.push(live);
        }
        const record = buildTurnProfileWindowRecord({
          transcriptPaths: [...whole.paths, ...tails],
          handoffTrail: whole.trail,
        });
        assert.equal(record.complete, true, 'an in-progress append was treated as damage');
        assert.deepEqual(
          [...record.truncated_tail_transcripts].sort(),
          [...tails].sort(),
          'the tolerated condition must still be recorded, not absorbed silently'
        );
        assert.ok(record.stages.length > 0, 'the window reported no stage despite being complete');
      });
    }),
    { numRuns: 15 }
  );
  assert.ok(seen.withTails >= 1, 'generator never produced an in-progress append');
});

test('property (invariant 3): the stored category set is exactly the walker\'s own', () => {
  const expected = [...INTERVAL_CATEGORIES].sort();
  fc.assert(
    fc.property(workedSpecArb, (workedSpecs) => {
      withRoot('sfvc-bl1364-inv3-', (root) => {
        const { paths, trail } = buildWindow(root, workedSpecs);
        const record = buildTurnProfileWindowRecord({ transcriptPaths: paths, handoffTrail: trail });
        assert.ok(record.stages.length > 0, 'no stage was produced, so nothing was checked');
        for (const entry of record.stages) {
          assert.deepEqual(
            Object.keys(entry.category_shares).sort(),
            expected,
            `${entry.stage} restated the category set instead of following the walker`
          );
          // Shares are a partition of the stage's time: they must sum to 1
          // (within float tolerance), which is only true if no category the
          // walker can emit is silently missing from the record.
          const total = Object.values(entry.category_shares).reduce((sum, v) => sum + v, 0);
          assert.ok(
            Math.abs(total - 1) < 1e-9,
            `${entry.stage} shares sum to ${total}, so a category the walker emitted is unaccounted for`
          );
        }
      });
    }),
    { numRuns: 20 }
  );
});
