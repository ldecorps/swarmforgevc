'use strict';

// BL-2094: PROPERTY test over the ticket's declared invariant
// (coder-authored first, per BL-654): "The property_runners row diffs the
// parcel's own change, from its merge-base with main to the gathered
// commit, and never an empty or a wider range." Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).
//
// Sweeps the PURE decision layer (the row's own build(), and
// resolveMergeBaseWithMain's fold over a runFn outcome) - the layer BL-2073
// got wrong without any lane seeing it, because every fixture and stub fed
// the decision a value directly rather than making it RESOLVE one. The
// real-git wiring proof (the row actually fed the true `git merge-base
// main <commit>`, never the commit itself, over a real repository) is this
// ticket's own acceptance feature (4 scenarios); this sweep covers the
// fold generatively, many more shapes than the acceptance's four fixed
// cases.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { CHECKLIST, resolveMergeBaseWithMain } = require('../out/quality/qaGather');

const ROW = CHECKLIST.find((c) => c.id === 'property_runners');

// ── the row's own build(): args/blocked depend ONLY on mergeBaseWithMain,
//    never on commit directly ──────────────────────────────────────────

// No surrounding whitespace: resolveMergeBaseWithMain trims stdout before
// comparing, so a sha WITH it would make the test's own expectation
// (the untrimmed value) wrong, not the production code.
const shaArb = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0 && s === s.trim());

test('property: the row always uses mergeBaseWithMain as --changed-from, never the gathered commit, whatever either value is', () => {
  fc.assert(
    fc.property(shaArb, shaArb, (commit, mergeBaseWithMain) => {
      const built = ROW.build({ root: '/r', ticketId: 'BL-1', commit, mergeBaseWithMain });
      assert.deepEqual(built.args, ['--changed-from', mergeBaseWithMain]);
      // Non-vacuity floor of the invariant's own "never the commit itself"
      // half: when the two values differ (true on every draw but a
      // vanishing hash collision), the ref actually used must differ from
      // commit too.
      if (commit !== mergeBaseWithMain) {
        assert.notEqual(built.args[1], commit);
      }
    }),
    { numRuns: 80 }
  );
});

test('property: the row blocks, naming the commit, for every falsy mergeBaseWithMain - whatever commit looks like, including a real-looking sha', () => {
  fc.assert(
    fc.property(shaArb, fc.constantFrom(undefined, '', null), (commit, falsy) => {
      const built = ROW.build({ root: '/r', ticketId: 'BL-1', commit, mergeBaseWithMain: falsy ?? undefined });
      assert.equal(built.blockedReason, `could not resolve merge-base main ${commit}`);
      assert.equal(built.command, undefined);
      assert.equal(built.args, undefined);
    }),
    { numRuns: 40 }
  );
});

// ── resolveMergeBaseWithMain's own fold over a runFn outcome ────────────

function fakeRunFn(outcome) {
  return () => outcome;
}

const SHAPES = ['success', 'notStarted', 'nonZeroExit', 'blankStdout'];
const coverage = { success: 0, notStarted: 0, nonZeroExit: 0, blankStdout: 0 };

test('property: resolveMergeBaseWithMain resolves to the trimmed stdout exactly on a started, zero-exit, non-blank answer - undefined on every other runFn outcome', () => {
  fc.assert(
    fc.property(shaArb, fc.constantFrom(...SHAPES), fc.constantFrom('', '\n', '  ', '\n\n'), (sha, shape, blank) => {
      coverage[shape] += 1;
      const outcome =
        shape === 'success'
          ? { started: true, exit: 0, stdout: `${sha}\n`, stderr: '' }
          : shape === 'notStarted'
            ? { started: false, exit: null, stdout: '', stderr: '', reason: 'boom' }
            : shape === 'nonZeroExit'
              ? { started: true, exit: 1, stdout: '', stderr: 'boom' }
              : { started: true, exit: 0, stdout: blank, stderr: '' };
      const result = resolveMergeBaseWithMain('/r', 'abc1234567', fakeRunFn(outcome));
      if (shape === 'success') {
        assert.equal(result, sha);
      } else {
        assert.equal(result, undefined, `expected undefined for shape ${shape}, got: ${JSON.stringify(result)}`);
      }
    }),
    { numRuns: 100 }
  );
  // Reachability floor (BL-1062): every shape this fold branches on was
  // actually exercised, not just hoped for.
  for (const shape of SHAPES) {
    assert.ok(coverage[shape] >= 10, `shape ${shape} reached only ${coverage[shape]} times`);
  }
});
