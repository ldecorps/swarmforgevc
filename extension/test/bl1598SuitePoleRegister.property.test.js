'use strict';

// BL-1598 declared invariant 1 (coder-authored, BL-654), AMENDED
// 2026-09-16 (specifier, on QA's Article 4.2 hold 93b31c8209): "a file with
// no register row measuring at or above PER_FILE_DURATION_BUDGET_MS times
// NEW_POLE_REFUSAL_FRACTION (1.5) fails npm test's exit code, and a file
// with no row measuring between the budget and that line is named in the
// verdict as watch on every run it occurs - never absent from the output."
//
// Pure injection over checkFileDurationBudget - the function IS the
// mechanism the invariant quantifies over, and every input (durations,
// budget, register, openTickets) is injected, never sampled from this
// host, so every generated case is a real instance of what the invariant
// is about, not a hoped-for approximation of it.
//
// Invariant 2 ("no test is removed to satisfy the gate") is a repo-history/
// process claim (comparing a test-file count across a git commit boundary),
// not a pure-module property; per BL-654 it is recorded with a stated
// reason in the coder evidence instead of a property test here.
//
// Non-vacuity checked by hand before landing: reverting the amendment (so
// any breach of the bare budget refuses, folding the watch band back into
// new-pole) fails the watch-band property immediately; hardcoding
// checkFileDurationBudget's `passed` to `true` (waving every new pole
// through) fails the refusal-band property immediately; both reverted and
// reconfirmed green.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { checkFileDurationBudget, NEW_POLE_REFUSAL_FRACTION } = require('../out/tools/check-suite-file-budget');

const FILE_NAME = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,20}\.test\.js$/);

const OTHER_ROW = fc.record({
  file: FILE_NAME,
  ticket: fc.constantFrom('BL-1', 'BL-2', 'BL-3'),
  firstSeen: fc.constant('2026-01-01'),
  measuredMs: fc.integer({ min: 1, max: 60000 }),
  note: fc.constant('fixture'),
});

test('BL-1598 invariant 1: a file with no row of its own at or above 1.5x the budget always fails as new-pole', () => {
  fc.assert(
    fc.property(
      FILE_NAME,
      fc.integer({ min: 100, max: 60000 }),
      fc.integer({ min: 0, max: 60000 }),
      fc.array(OTHER_ROW, { maxLength: 5 }),
      (offenderFile, budgetMs, overshoot, otherRows) => {
        // otherRows may name any file EXCEPT offenderFile - this run's
        // draw always leaves the offending file with no row of its own.
        const register = otherRows.filter((r) => r.file !== offenderFile);
        const durationMs = Math.ceil(budgetMs * NEW_POLE_REFUSAL_FRACTION) + overshoot;
        const durations = [{ file: offenderFile, durationMs }];
        const openTickets = new Set(['BL-1', 'BL-2', 'BL-3']);

        const result = checkFileDurationBudget(durations, budgetMs, register, openTickets);

        assert.equal(result.passed, false, `file at/above 1.5x budget with no row passed: ${JSON.stringify(result)}`);
        assert.equal(result.verdict, 'new-pole');
        assert.equal(result.watchFiles.length, 0, `expected no watch files, got ${JSON.stringify(result.watchFiles)}`);
        assert.ok(
          result.offenders.some((o) => o.file === offenderFile && o.durationMs === durationMs),
          `expected ${offenderFile} at ${durationMs}ms among offenders, got ${JSON.stringify(result.offenders)}`
        );
      }
    ),
    { numRuns: 100 }
  );
});

test('BL-1598 invariant 1: a file with no row of its own strictly between the budget and 1.5x is always watch, never refused', () => {
  fc.assert(
    fc.property(
      FILE_NAME,
      fc.integer({ min: 100, max: 60000 }),
      fc.array(OTHER_ROW, { maxLength: 5 }),
      (offenderFile, budgetMs, otherRows) => {
        const register = otherRows.filter((r) => r.file !== offenderFile);
        // budgetMs + 1 always lands strictly inside (budgetMs, budgetMs *
        // 1.5) for every budgetMs in the drawn range: the band's own width
        // (0.5 * budgetMs) exceeds 1 whenever budgetMs > 2, guaranteed by
        // the >= 100 floor above.
        const durationMs = budgetMs + 1;
        const durations = [{ file: offenderFile, durationMs }];
        const openTickets = new Set(['BL-1', 'BL-2', 'BL-3']);

        const result = checkFileDurationBudget(durations, budgetMs, register, openTickets);

        assert.equal(result.passed, true, `file in the watch band with no row was refused: ${JSON.stringify(result)}`);
        assert.equal(result.verdict, 'watch');
        assert.equal(result.offenders.length, 0, `expected no offenders, got ${JSON.stringify(result.offenders)}`);
        assert.ok(
          result.watchFiles.some((w) => w.file === offenderFile && w.durationMs === durationMs),
          `expected ${offenderFile} at ${durationMs}ms among watchFiles, got ${JSON.stringify(result.watchFiles)}`
        );
      }
    ),
    { numRuns: 100 }
  );
});

// The same claim holds with NO register at all, across the WHOLE duration
// range at once (not just the two boundary bands drawn separately above) -
// every file classifies into exactly one of offenders/watchFiles/neither
// by its own duration alone.
test('BL-1598 invariant 1: with no register at all, every file classifies correctly across the whole duration range', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ file: FILE_NAME, durationMs: fc.integer({ min: 1, max: 90000 }) }), { minLength: 1, maxLength: 6 }),
      fc.integer({ min: 100, max: 60000 }),
      (durations, budgetMs) => {
        const result = checkFileDurationBudget(durations, budgetMs);
        const threshold = budgetMs * NEW_POLE_REFUSAL_FRACTION;
        const expectedOffenders = durations.filter((d) => d.durationMs >= threshold);
        const expectedWatch = durations.filter((d) => d.durationMs > budgetMs && d.durationMs < threshold);

        assert.equal(result.passed, expectedOffenders.length === 0);
        assert.equal(result.offenders.length, expectedOffenders.length);
        assert.equal(result.watchFiles.length, expectedWatch.length);
        for (const d of expectedOffenders) {
          assert.ok(result.offenders.some((o) => o.file === d.file && o.durationMs === d.durationMs));
        }
        for (const d of expectedWatch) {
          assert.ok(result.watchFiles.some((w) => w.file === d.file && w.durationMs === d.durationMs));
        }
      }
    ),
    { numRuns: 100 }
  );
});
