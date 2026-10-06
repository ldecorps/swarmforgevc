'use strict';

// BL-1629 property test (coder-authored, bounce rework).
//
//   Declared invariant (narrowed to what is actually true - QA bounce
//   evidence S2 names the register's own ORIGINAL scope, where an owned
//   row in the healthy 80-100% band stays silent by design; this ticket's
//   own FIRM commitment is the ACCEPTED half only): an accepted register
//   row never goes silent - whatever its file measures this run, including
//   not being measured at all, classifyAcceptedRow always returns a
//   FileVerdict naming the row's file, never null.
//
// This is exactly QA bounce D1's own defect shape: classifyAcceptedRow
// returned null when the row's file was not measured this run (renamed,
// deleted or excluded), so an accepted row with a possibly-closed
// rationale ticket printed nothing on any run - "accepted and forgotten".
//
// REACH (BL-654's generator-reach clause): `measured` is drawn from
// `fc.option(fc.integer(...))` so `undefined` (D1's own exact trigger) is
// drawn on every run with ~50% probability, not left to chance across a
// wider value space; `measuredMs` and `budgetMs` are drawn independently
// across a wide range so both the stale (<80%), accepted (in-budget) and
// over-budget bands are reached without being hand-picked.
//
// Non-vacuity PROVEN at authoring time (2026-10-06), break restored:
//   - revert classifyAcceptedRow's `if (measured === undefined) return null;`
//     (the bounce's own D1 defect) - this property failed immediately,
//     every run, on the very first undefined draw.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { checkFileDurationBudget } = require('../out/tools/check-suite-file-budget');

test('property: an accepted register row never goes silent, whatever its file measures this run', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 100, max: 50000 }), // measuredMs (the register's own recorded value)
      fc.integer({ min: 1000, max: 20000 }), // budgetMs
      fc.option(fc.integer({ min: 0, max: 60000 }), { nil: undefined }), // this run's own measurement, or undefined (D1's trigger)
      (measuredMs, budgetMs, thisRunMs) => {
        const register = [
          {
            file: 'f.test.js',
            ticket: 'BL-999',
            firstSeen: '2026-01-01',
            measuredMs,
            disposition: 'accepted',
            note: 're-measure: 2026-12-17',
          },
        ];
        // The file list this run actually measured - omit f.test.js entirely
        // when thisRunMs is undefined, reproducing D1's own real trigger (a
        // renamed, deleted or lane-excluded file), rather than passing an
        // explicit `durationMs: undefined` entry no real vitest report
        // would ever contain.
        const durations =
          thisRunMs === undefined
            ? [{ file: 'unrelated.test.js', durationMs: 1 }]
            : [{ file: 'f.test.js', durationMs: thisRunMs }];

        const result = checkFileDurationBudget(durations, budgetMs, register, new Set());

        const reported = [...result.registeredPoles, ...result.staleRows, ...result.unownedRows, ...result.offenders].find(
          (v) => v.file === 'f.test.js'
        );
        assert.ok(
          reported,
          `an accepted row for f.test.js produced no verdict at all (measuredMs=${measuredMs}, budgetMs=${budgetMs}, thisRunMs=${thisRunMs})`
        );
        // FIRM: never unowned-row and never new-pole (the accepted row's own
        // whole reason to exist - its rationale ticket may be closed).
        assert.notEqual(reported.kind, 'unowned-row');
        assert.notEqual(result.offenders.some((o) => o.file === 'f.test.js'), true, 'an accepted row must never be reported as new-pole');
      }
    ),
    { numRuns: 200 }
  );
});
