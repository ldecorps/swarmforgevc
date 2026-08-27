const assert = require('node:assert/strict');
const fc = require('fast-check');
const { awaitRealWatchEvent } = require('./boundedWatchWait');

// BL-933/BL-654: coder-authored property test for this ticket's declared
// invariant 2 ("no wait on an external event in these tests is left
// unbounded ... every such wait has an explicit deadline and, on expiry,
// fails naming the event that never arrived").
//
// Invariant 1 ("real fs.watch event delivery stays real ... never a fake or
// stubbed watcher") is a structural/qualitative fact about fixed source
// text in the three test files, not a property over an input range - it
// does not admit a fast-check-shaped encoding without being vacuous, and
// the ticket's own acceptance Scenario 3
// (specs/pipeline/steps/bl933BoundedWatchWaitSteps.js's source-text check
// for fakeWatcher|stubWatcher|mockWatcher) already exercises it. Stated
// non-encodability reason per architect bounce
// backlog/evidence/BL-933-real-fs-watch-waits-are-unbounded-and-fail-as-bare-timeouts-bounce-20260819.md's
// D1 - no property test for invariant 1 in this file, deliberately.
//
// Runs ONLY via `npm run test:properties`.
//
// Sweeps arbitrary non-empty eventLabel/watchedPath strings and timeoutMs
// values - a never-resolving input promise must always reject at its own
// configured deadline, naming BOTH the event and the path, regardless of
// which specific strings/number were used. The example-based tests in
// boundedWatchWait.test.js only prove this for one fixed label/path/timeout
// triple each; this closes the regression class a future edit could pass
// those while still, say, only formatting the message correctly for the
// three specific label/path strings the real activateBounceWatcher/
// bounceDrain/bounceWatcher tests happen to use.

test('BL-933 invariant 2: a never-resolving wait always rejects at its own configured deadline, naming the event and the path', async () => {
  vi.useFakeTimers();
  try {
    const timeoutsSeen = new Set();
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 15000 }),
        async (eventLabel, watchedPath, timeoutMs) => {
          timeoutsSeen.add(timeoutMs);
          const neverResolves = new Promise(() => {});
          const pending = awaitRealWatchEvent(neverResolves, { eventLabel, watchedPath, timeoutMs });
          let caught = null;
          const settled = pending.then(
            () => {
              throw new Error('expected the wait to reject on expiry, but it resolved');
            },
            (err) => {
              caught = err;
            }
          );
          await vi.advanceTimersByTimeAsync(timeoutMs);
          await settled;
          assert.ok(caught, 'expected an error to have been captured');
          assert.ok(
            caught.message.includes(eventLabel),
            `expected the failure message to name the event "${eventLabel}", got: ${caught.message}`
          );
          assert.ok(
            caught.message.includes(watchedPath),
            `expected the failure message to name the path "${watchedPath}", got: ${caught.message}`
          );
        }
      ),
      { numRuns: 100 }
    );
    // Reachability floor: the generator must actually have produced a
    // meaningfully varied range of deadlines, not one repeated value that
    // would let a hardcoded-constant defect slip through unnoticed.
    assert.ok(
      timeoutsSeen.size >= 10,
      `reachability floor: generator only produced ${timeoutsSeen.size} distinct timeoutMs values across 100 runs`
    );
  } finally {
    vi.useRealTimers();
  }
});
