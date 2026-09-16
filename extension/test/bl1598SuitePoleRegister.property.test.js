'use strict';

// BL-1598 declared invariant 1 (coder-authored, BL-654): "The gate never
// waves a new pole through: a file over PER_FILE_DURATION_BUDGET_MS with no
// register row fails npm test's exit code exactly as BL-378 did, before and
// after this change."
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
// Non-vacuity checked by hand before landing: hardcoding checkFileDurationBudget's
// `passed` to `true` (the gate waving every new pole through, the exact
// defect this invariant exists to catch) fails both properties below
// immediately; reverted and reconfirmed green.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { checkFileDurationBudget } = require('../out/tools/check-suite-file-budget');

const FILE_NAME = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,20}\.test\.js$/);

const OTHER_ROW = fc.record({
  file: FILE_NAME,
  ticket: fc.constantFrom('BL-1', 'BL-2', 'BL-3'),
  firstSeen: fc.constant('2026-01-01'),
  measuredMs: fc.integer({ min: 1, max: 60000 }),
  note: fc.constant('fixture'),
});

test('BL-1598 invariant 1: a file over budget with no register row of its own always fails as new-pole', () => {
  fc.assert(
    fc.property(
      FILE_NAME,
      fc.integer({ min: 1, max: 60000 }),
      fc.integer({ min: 1, max: 60000 }),
      fc.array(OTHER_ROW, { maxLength: 5 }),
      (offenderFile, budgetMs, overshoot, otherRows) => {
        // otherRows may name any file EXCEPT offenderFile - this run's
        // draw always leaves the offending file with no row of its own,
        // regardless of how many (or how few) other rows exist.
        const register = otherRows.filter((r) => r.file !== offenderFile);
        const durationMs = budgetMs + overshoot;
        const durations = [{ file: offenderFile, durationMs }];
        const openTickets = new Set(['BL-1', 'BL-2', 'BL-3']);

        const result = checkFileDurationBudget(durations, budgetMs, register, openTickets);

        assert.equal(result.passed, false, `file over budget with no row passed: ${JSON.stringify(result)}`);
        assert.equal(result.verdict, 'new-pole');
        assert.ok(
          result.offenders.some((o) => o.file === offenderFile && o.durationMs === durationMs),
          `expected ${offenderFile} at ${durationMs}ms among offenders, got ${JSON.stringify(result.offenders)}`
        );
      }
    ),
    { numRuns: 100 }
  );
});

// The same claim holds with NO register at all (the exact pre-BL-1598
// shape) - an empty register/empty openTickets is the true "before this
// change" case, not merely a special case of the general property above.
test('BL-1598 invariant 1: with no register at all, every over-budget file fails exactly as BL-378 always refused it', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ file: FILE_NAME, durationMs: fc.integer({ min: 1, max: 60000 }) }), { minLength: 1, maxLength: 6 }),
      fc.integer({ min: 1, max: 60000 }),
      (durations, budgetMs) => {
        const result = checkFileDurationBudget(durations, budgetMs);
        const expectedOffenders = durations.filter((d) => d.durationMs > budgetMs);
        assert.equal(result.passed, expectedOffenders.length === 0);
        assert.equal(result.offenders.length, expectedOffenders.length);
        for (const d of expectedOffenders) {
          assert.ok(result.offenders.some((o) => o.file === d.file && o.durationMs === d.durationMs));
        }
      }
    ),
    { numRuns: 100 }
  );
});
