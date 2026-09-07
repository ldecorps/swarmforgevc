'use strict';

// BL-1454 property tests (coder-authored, three DECLARED invariants), driving
// the REAL swarmforge/scripts/coordinator_activity_feed_lib.bb through
// specs/pipeline/steps/lib/bl1454ActivityFeedSweepCli.bb - never a JS
// reimplementation of the lib's decision logic.
//
//   Invariant 1: "No single tick of coordinator-activity-feed-sweep! runs
//   past its own deadline... whatever the size of coordinator/sent/ or of
//   the git log: traces it did not reach wait for the next tick."
//
//   Invariant 2: "The persisted cursor never lags a successful post by more
//   than one trace: after every successful post the cursor naming that
//   trace is on disk before the next post is attempted, so a tick killed
//   mid-batch re-posts nothing on restart."
//
//   Invariant 3: "A tick's file reads and header parses are proportional to
//   the number of traces NEWER than the cursor, never to the total count of
//   sent handoffs - filtering happens on the file name before any file is
//   opened."
//
// Generator-reach note (per the coder's own Invariants contract): each
// property below draws its trace COUNT randomly up to a few dozen/hundred,
// which is enough to distinguish "proportional to new" from "proportional
// to total" (invariant 3) and to force the interrupt to land at every
// possible position from 0 successes through "never interrupted"
// (invariant 2) - collision-by-construction, not independently-drawn luck.
//
// Non-vacuity PROVEN at authoring time (2026-09-07), each break restored:
//   - invariant 1: removed the `(>= (now-ms) deadline)` cond clause from
//     tick! (posts every trace regardless of the clock) - P1 caught it.
//   - invariant 2: moved the `write-cursor!` call from inside the loop to
//     only the terminal branches (GH-24's original shape) - P2 caught it
//     (writeCount stayed 0 through an interrupt that had 1+ successes).
//   - invariant 3: changed read-handoff-header to read ALL of
//     list-sent-handoff-names(), not just the survivors of new-handoffs -
//     P3 caught it (headerReadCount tracked total, not new-only).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1454ActivityFeedSweepCli.bb');

function pad(i) {
  return String(i).padStart(6, '0');
}

function writeCursorFile(daemonDir, cursor) {
  fs.writeFileSync(path.join(daemonDir, 'coordinator-activity-feed-state.json'), JSON.stringify(cursor));
}

function runTick(daemonDir, opts) {
  const input = JSON.stringify({
    'daemon-dir': daemonDir,
    'sent-handoffs': opts.sentHandoffs || [],
    commits: opts.commits || [],
    'post-cap': opts.postCap,
    'deadline-ms': opts.deadlineMs,
    'clock-advance-ms-per-post': opts.clockAdvanceMsPerPost,
    'fail-after-n-successes': opts.failAfterNSuccesses,
  });
  const result = spawnSync('bb', [CLI], { input, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `expected the CLI to exit 0, got ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function handoffFixture(totalNew) {
  const names = [];
  for (let i = 0; i < totalNew; i += 1) names.push(`00_${pad(i)}`);
  const sentHandoffs = names.map((file) => ({ file, header: { type: 'note', to: 'coder', task: file, message: null } }));
  return { names, sentHandoffs };
}

// ── Invariant 1: a tick never attempts a post once the clock has reached
// its own deadline, whatever the cap or the trace count. ───────────────────

const deadlineArb = fc.record({
  totalNew: fc.integer({ min: 0, max: 60 }),
  postCap: fc.integer({ min: 1, max: 60 }),
  clockAdvanceMsPerPost: fc.integer({ min: 0, max: 3000 }),
  deadlineMs: fc.integer({ min: 1, max: 20000 }),
});

test('invariant 1: a tick stops attempting posts once the simulated clock reaches its deadline', () => {
  fc.assert(
    fc.property(deadlineArb, ({ totalNew, postCap, clockAdvanceMsPerPost, deadlineMs }) => {
      const daemonDir = mkTmpDir('bl1454-p1-');
      const { names, sentHandoffs } = handoffFixture(totalNew);
      writeCursorFile(daemonDir, { 'handoff-cursor': '00_', 'commit-cursor': null });
      const result = runTick(daemonDir, { sentHandoffs, postCap, deadlineMs, clockAdvanceMsPerPost });
      const posted = result.posted.length;

      // Every successful post's pre-post clock check passed: the k-th post
      // (1-indexed) was attempted with clock = (k-1) * advance, which must
      // have been strictly under the deadline.
      for (let k = 1; k <= posted; k += 1) {
        assert.ok(
          (k - 1) * clockAdvanceMsPerPost < deadlineMs,
          `post ${k}/${posted} was attempted at clock=${(k - 1) * clockAdvanceMsPerPost}ms, at or past deadline=${deadlineMs}ms`
        );
      }

      // If traces remained available and the cap did not stop the tick, the
      // ONLY thing that could have stopped it is the deadline - and the
      // next attempt's pre-post clock must indeed be at or past it.
      const moreAvailable = posted < totalNew;
      const capNotReached = posted < postCap;
      if (moreAvailable && capNotReached) {
        assert.equal(result.result && result.result['deadline-reached'], true, 'expected the tick to report deadline-reached');
        assert.ok(
          posted * clockAdvanceMsPerPost >= deadlineMs,
          `expected the next post's clock (${posted * clockAdvanceMsPerPost}ms) to be at/past the deadline (${deadlineMs}ms)`
        );
      }
    }),
    { numRuns: 40 }
  );
});

// ── Invariant 2: the persisted cursor never lags a successful post by more
// than one trace - proven by interrupting (throwing) at every possible
// success count, including "never" (drains cleanly) and "immediately" (zero
// successes). ───────────────────────────────────────────────────────────

const interruptArb = fc.integer({ min: 2, max: 80 }).chain((totalNew) =>
  fc.record({
    totalNew: fc.constant(totalNew),
    failAfter: fc.integer({ min: 0, max: totalNew }),
  })
);

test('invariant 2: the cursor on disk never lags the last successful post by more than one trace', () => {
  fc.assert(
    fc.property(interruptArb, ({ totalNew, failAfter }) => {
      const daemonDir = mkTmpDir('bl1454-p2-');
      const { names, sentHandoffs } = handoffFixture(totalNew);
      const seedCursor = '00_';
      writeCursorFile(daemonDir, { 'handoff-cursor': seedCursor, 'commit-cursor': null });
      const result = runTick(daemonDir, {
        sentHandoffs,
        postCap: totalNew + 10,
        deadlineMs: 10_000_000,
        failAfterNSuccesses: failAfter,
      });

      const willInterrupt = failAfter < totalNew;
      assert.equal(result.threw, willInterrupt, `expected threw=${willInterrupt} for failAfter=${failAfter}/${totalNew}`);
      assert.equal(result.posted.length, failAfter, 'expected exactly failAfter successful posts before the throw (or the drain)');
      assert.equal(result.writeCount, failAfter, 'expected exactly one cursor write per successful post - never more, never fewer');
      const expectedCursor = failAfter === 0 ? seedCursor : names[failAfter - 1];
      assert.equal(result.cursor['handoff-cursor'], expectedCursor, 'expected the persisted cursor to name exactly the last successfully posted trace');
    }),
    { numRuns: 40 }
  );
});

// ── Invariant 3: header reads (the expensive per-file open) are
// proportional to what is NEW, never to the total count of sent handoffs -
// varying the OLD count across runs while checking headerReadCount depends
// only on the NEW count is what would catch a "list-then-filter-after-open"
// regression. ───────────────────────────────────────────────────────────

const listingArb = fc.record({
  totalOld: fc.integer({ min: 0, max: 500 }),
  totalNew: fc.integer({ min: 0, max: 60 }),
});

test('invariant 3: header reads scale with new traces only, independent of how many old ones exist', () => {
  fc.assert(
    fc.property(listingArb, ({ totalOld, totalNew }) => {
      const daemonDir = mkTmpDir('bl1454-p3-');
      const total = totalOld + totalNew;
      const names = [];
      for (let i = 0; i < total; i += 1) names.push(`00_${pad(i)}`);
      const sentHandoffs = names.map((file) => ({ file, header: { type: 'note', to: 'coder', task: file, message: null } }));
      const cursor = totalOld === 0 ? '00_' : names[totalOld - 1];
      writeCursorFile(daemonDir, { 'handoff-cursor': cursor, 'commit-cursor': null });

      const result = runTick(daemonDir, { sentHandoffs, postCap: totalNew + 10, deadlineMs: 10_000_000 });

      assert.equal(result.headerReadCount, totalNew, `expected exactly ${totalNew} header reads (the new ones), got ${result.headerReadCount} with ${totalOld} old traces on disk`);
      assert.equal(result.posted.length, totalNew, 'expected every new trace to post (cap and deadline are both generous here)');
    }),
    { numRuns: 40 }
  );
});
