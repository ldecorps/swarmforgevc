'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { maxConcurrentSpans } = require('./helpers/maxConcurrentSpans');

// Architect-added (BL-871 property-testing pass, BL-654): `maxConcurrentSpans`
// is a pure, touched module with no direct test of its own - BL-871's
// invariant-1 property test exercises it only indirectly, through real
// subprocess timing data, which never pins its behavior against a known
// span set. This closes that gap without touching invariant 1's own test.
//
// Reference implementation: for half-open spans [start, end), the maximum
// overlap always occurs at one of the span start instants, so checking
// concurrency at every start (using the same [start, end) convention the
// real implementation's tie-break embodies - an ending span is not counted
// concurrently with a span starting at the same instant) is sufficient.
function bruteForceMaxOverlap(spans) {
  let max = 0;
  for (const t of spans.map((s) => s.start)) {
    const count = spans.filter((s) => s.start <= t && t < s.end).length;
    max = Math.max(max, count);
  }
  return max;
}

const spanArb = fc
  .tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 50 }))
  .map(([start, duration]) => ({ start, end: start + duration }));

test('property (BL-871, architect-added): maxConcurrentSpans matches a brute-force overlap count', () => {
  fc.assert(
    fc.property(fc.array(spanArb, { minLength: 0, maxLength: 12 }), (spans) => {
      const result = maxConcurrentSpans(spans);
      assert.equal(result, bruteForceMaxOverlap(spans));
      assert.ok(result >= 0 && result <= spans.length);
    }),
    { numRuns: 200 }
  );
});
