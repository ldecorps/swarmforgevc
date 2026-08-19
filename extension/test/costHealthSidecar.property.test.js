const assert = require('node:assert/strict');
const fc = require('fast-check');
const { bucketDailyDaemonRestarts } = require('../out/notify/costHealthSidecar');

// BL-904/BL-654: coder-authored property tests for this ticket's two
// declared invariants, both against bucketDailyDaemonRestarts (the pure
// function where the actual counting/null-propagation logic lives) rather
// than the thin trendedDaemonRestarts wrapper or the impure fs-touching
// reader. Runs ONLY via `npm run test:properties`.

const DAEMON_ARB = fc.constantFrom('handoffd', 'babysitterd', 'concierge');
const ACTION_ARB = fc.constantFrom('restart', 'escalate');
const NOW_MS = Date.parse('2026-07-09T12:00:00Z');
const TODAY_EPOCH = Math.floor(Date.parse('2026-07-09T01:00:00Z') / 1000);

// Invariant 1: "No reliability field on the sidecar is a literal - every
// one is derived from a source, or absent." Sweeps an arbitrary mix of
// restart/escalate events (0-40 of them, all timestamped today) and
// asserts today's bucketed value always equals the number of
// action=restart events generated - never a fixed value regardless of
// input, and never inflated by the escalate events mixed in alongside
// them.
test('BL-904 invariant 1: today\'s bucketed restart count always equals the number of action=restart events generated for today', () => {
  let sawNonZero = false;
  let sawZero = false;
  fc.assert(
    fc.property(fc.array(fc.record({ daemon: DAEMON_ARB, action: ACTION_ARB }), { minLength: 0, maxLength: 40 }), (draws) => {
      const events = draws.map((d, i) => ({ epoch: TODAY_EPOCH + i, daemon: d.daemon, action: d.action }));
      const expectedRestarts = draws.filter((d) => d.action === 'restart').length;
      const series = bucketDailyDaemonRestarts(events, NOW_MS);
      const today = series.find((p) => p.periodStart.startsWith('2026-07-09'));
      if (!today) {
        throw new Error(`expected a bucket for today, got periods: ${JSON.stringify(series.map((p) => p.periodStart))}`);
      }
      if (today.value !== expectedRestarts) {
        throw new Error(`expected today's value to be ${expectedRestarts} (${draws.length} events drawn), got ${today.value}`);
      }
      if (expectedRestarts > 0) {
        sawNonZero = true;
      } else {
        sawZero = true;
      }
    }),
    { numRuns: 200 }
  );
  assert.ok(sawNonZero, 'reachability floor: generator never produced a day with at least one restart');
  assert.ok(sawZero, 'reachability floor: generator never produced a day with zero restarts');
});

// Invariant 2: "An unreadable or missing incident log yields no data,
// never a zero count." bucketDailyDaemonRestarts(null, ...) is the
// null-propagation half of that contract (the file-unreadable/missing
// case is reader-level, covered by swarmMetrics.test.js's own example
// tests - this property is about what happens to that null downstream).
// Sweeps arbitrary "now" instants and arbitrary (possibly empty, possibly
// escalate-only) non-null event arrays whose epochs are constrained to
// the real domain shape (a log entry is always at-or-before the instant
// it is read at, never from the future - drawing epoch and nowMs fully
// independently produced exactly that unrealistic case and broke
// fillDailyBuckets's own earliest-day/now-day loop, a real generator bug
// caught while writing this test, not a production defect): null must
// ALWAYS map to null (no data), and any non-null array - even one with
// zero restarts - must ALWAYS map to a real, non-null series (measured,
// distinguishable from no-data by construction).
test('BL-904 invariant 2: null events always yields null; any non-null events array always yields a real (non-null) series', () => {
  let sawEmptyEvents = false;
  let sawNonEmptyEvents = false;
  fc.assert(
    fc.property(
      fc
        .integer({ min: 1700000000, max: 1800000000 })
        .chain((nowSeconds) =>
          fc.tuple(
            fc.constant(nowSeconds * 1000),
            fc.array(
              fc.record({
                daemon: DAEMON_ARB,
                action: ACTION_ARB,
                epoch: fc.integer({ min: nowSeconds - 30 * 24 * 60 * 60, max: nowSeconds }),
              }),
              { maxLength: 10 }
            )
          )
        ),
      ([nowMs, events]) => {
        if (bucketDailyDaemonRestarts(null, nowMs) !== null) {
          throw new Error('expected bucketDailyDaemonRestarts(null, ...) to always be null');
        }
        const series = bucketDailyDaemonRestarts(events, nowMs);
        if (series === null) {
          throw new Error(`expected a non-null series for a non-null events array (length ${events.length}), got null`);
        }
        if (series.length < 1) {
          throw new Error('expected at least one bucketed point for a non-null events array');
        }
        if (events.length === 0) {
          sawEmptyEvents = true;
        } else {
          sawNonEmptyEvents = true;
        }
      }
    ),
    { numRuns: 200 }
  );
  assert.ok(sawEmptyEvents, 'reachability floor: generator never produced an empty (but non-null) events array');
  assert.ok(sawNonEmptyEvents, 'reachability floor: generator never produced a non-empty events array');
});
