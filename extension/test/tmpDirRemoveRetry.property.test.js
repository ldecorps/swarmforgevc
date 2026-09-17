'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');

// BL-1601 declared invariant
// (backlog/active/BL-1601-bl1204-redeploy-tests-race-the-tmpdir-sweep-with-a-detached-script.yaml):
// "A fixture root that never empties still fails the run: after the
// bounded retries the sweep rethrows the same error, never returns
// quietly, so the retry can only turn a race into a pass, never a leak
// into silence."
//
// Generator reach: every trial exercises a REAL call to sweepPendingTmpDirs
// through an injected rmFn (the ticket's own documented seam), varying the
// number of transient failures from 0 up to and past REMOVE_RETRY_ATTEMPTS -
// so both sides of the boundary (succeeds within budget / exhausts it) are
// reached on every run, not hoped for from a fixed sample.
function enotempty() {
  const err = new Error('ENOTEMPTY: directory not empty');
  err.code = 'ENOTEMPTY';
  throw err;
}

test('property: sweepPendingTmpDirs succeeds iff the transient-failure count is under the retry budget, and always rethrows the SAME error otherwise', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 10 }), (transientFailures) => {
      // A fresh module instance per trial - sweepPendingTmpDirs' `pending`
      // list is module-level state, so trials must not see each other's
      // registered roots (fast-check runs many trials in one process).
      delete require.cache[require.resolve('./helpers/tmpDir')];
      const { mkTmpDir, sweepPendingTmpDirs, REMOVE_RETRY_ATTEMPTS } = require('./helpers/tmpDir');

      const dir = mkTmpDir('bl1601-property-');
      let calls = 0;
      const rmFn = (target, opts) => {
        calls += 1;
        if (calls <= transientFailures) {
          enotempty();
        }
        // Real removal on the call that "succeeds" (transientFailures < the
        // budget) - genuinely proves the directory is gone, never simulated.
        require('node:fs').rmSync(target, opts);
      };

      const willExhaust = transientFailures >= REMOVE_RETRY_ATTEMPTS;

      if (willExhaust) {
        let threw = null;
        try {
          sweepPendingTmpDirs(rmFn);
        } catch (err) {
          threw = err;
        } finally {
          // The exhausted-retries path never actually removes the real
          // directory mkTmpDir created (rmFn always throws) - clean it up
          // directly so 50 fast-check trials leak nothing, never itself an
          // assertion.
          require('node:fs').rmSync(dir, { recursive: true, force: true });
        }
        assert.ok(threw, 'expected the sweep to rethrow once the transient-failure count reaches the retry budget');
        assert.equal(threw.code, 'ENOTEMPTY', 'the rethrown error must be the SAME error the writer produced, never a different one');
        assert.equal(calls, REMOVE_RETRY_ATTEMPTS, `expected exactly ${REMOVE_RETRY_ATTEMPTS} bounded attempts, got ${calls}`);
      } else {
        const swept = sweepPendingTmpDirs(rmFn);
        assert.deepEqual(swept, [dir], 'expected the sweep to complete quietly and report the root removed');
        assert.equal(calls, transientFailures + 1, 'expected exactly one more attempt than the number of transient failures');
        assert.equal(require('node:fs').existsSync(dir), false, 'the root must genuinely be gone, not just "not thrown"');
      }
    }),
    { numRuns: 50 }
  );
});
