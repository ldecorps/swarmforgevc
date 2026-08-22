'use strict';

// BL-968 architect pass (Property Testing section): lazy() is a new pure
// module the cleaner extracted (specs/pipeline/steps/lib/lazy.js), shared
// by five step-file call sites so a git rev-parse / live-file read /
// login-shell subprocess resolves at most once instead of on every step
// execution - the whole point of the DRY extraction. This is an
// UNDECLARED property (the ticket's two invariants are about registry
// loadability, not this helper) added because the module is pure,
// testable, and genuinely under-covered: no test anywhere calls lazy()
// directly, only indirectly through step files whose own tests never
// exercise the getter enough times to prove memoization holds.
//
// Property: for ANY number of getter calls >= 1 and any value `resolve`
// computes, the getter invokes `resolve` exactly once and every call
// returns the same value back.
//
// Non-vacuity (staged break, restored, run 2026-08-20): dropping the
// `resolved` guard (resolve() re-invoked on every getter call) turned this
// RED on the call-count assertion at the first multi-call draw. Restored;
// holds. Re-verified on the D1 re-fix re-review pass (lib/lazy.js itself
// unchanged by the D1 fix, which touched only the acceptance-step guard
// helper).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { lazy } = require('../../specs/pipeline/steps/lib/lazy');

const valueArb = fc.oneof(
  fc.integer(),
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.integer(), { maxLength: 5 })
);

test('BL-968 lazy() invokes resolve at most once and every call returns the same value', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 50 }), valueArb, (callCount, resolvedValue) => {
      let calls = 0;
      const getter = lazy(() => {
        calls += 1;
        return resolvedValue;
      });
      const results = [];
      for (let i = 0; i < callCount; i += 1) {
        results.push(getter());
      }
      assert.equal(calls, 1, `resolve() was called ${calls} times across ${callCount} getter calls, expected exactly 1`);
      for (const r of results) {
        assert.deepEqual(r, resolvedValue);
      }
    }),
    { numRuns: 100 }
  );
});
