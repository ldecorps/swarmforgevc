'use strict';

// BL-1601 declared invariant (property authorship rests with the coder,
// first pass - BL-654): "A fixture root that never empties still fails the
// run: after the bounded retries the sweep rethrows the same error, never
// returns quietly, so the retry can only turn a race into a pass, never a
// leak into silence."
//
// Encoded directly against the REAL sweepPendingTmpDirs (extension/test/
// helpers/tmpDir.js) - never a reimplementation of its retry loop. `rmFn`
// is injected (the helper's own signature) to make "removal fails N times"
// deterministic without a real racing writer.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const { mkTmpDir, sweepPendingTmpDirs } = require('./helpers/tmpDir');

const ATTEMPTS = 5;
const failuresBeforeSuccessArb = fc.integer({ min: 0, max: 8 });
const errorCodeArb = fc.constantFrom('ENOTEMPTY', 'EBUSY');

describe('BL-1601 tmpDir sweep retry invariant (property)', () => {
  it('the retry can only turn a race into a pass, never a leak into silence', () => {
    const coverage = { withinBound: false, exhausted: false };
    fc.assert(
      fc.property(failuresBeforeSuccessArb, errorCodeArb, (failuresBeforeSuccess, code) => {
        const root = mkTmpDir('bl1601-inv-');
        let calls = 0;
        const rmFn = (p, opts) => {
          calls += 1;
          if (calls <= failuresBeforeSuccess) {
            const err = new Error(`${code}: directory not empty`);
            err.code = code;
            throw err;
          }
          fs.rmSync(p, opts);
        };

        let threw = null;
        let result;
        try {
          result = sweepPendingTmpDirs({ rmFn, sleep: () => {}, attempts: ATTEMPTS });
        } catch (err) {
          threw = err;
        }

        if (failuresBeforeSuccess < ATTEMPTS) {
          coverage.withinBound = true;
          assert.equal(threw, null, `expected no throw - it would have succeeded within ${ATTEMPTS} attempts`);
          assert.deepEqual(result, [root]);
          assert.equal(calls, failuresBeforeSuccess + 1, 'expected the sweep to stop retrying the moment it succeeds');
          assert.equal(fs.existsSync(root), false);
        } else {
          coverage.exhausted = true;
          assert.ok(threw, 'expected the sweep to rethrow rather than return quietly when the root never empties');
          assert.equal(threw.code, code, 'expected the SAME error rethrown - never swallowed, never replaced');
          assert.equal(calls, ATTEMPTS, 'expected exactly the bounded number of attempts, never more, never fewer');
          // The stub never actually removed it - the directory is still real.
          fs.rmSync(root, { recursive: true, force: true });
        }
        return true;
      }),
      { numRuns: 60 }
    );
    // BL-654 generator-reach: both the "recovers within the bound" and the
    // "never empties, must still fail" branches are demonstrably drawn.
    assert.ok(coverage.withinBound, 'generator never drew a within-bound recovery case');
    assert.ok(coverage.exhausted, 'generator never drew a never-empties (must-fail) case');
  });
});
