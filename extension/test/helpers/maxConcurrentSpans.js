'use strict';

// BL-871 invariant 1: pure sweep-line helper - given [{start, end}, ...]
// wall-clock spans (ms since epoch), returns the maximum number of spans
// that overlap at any single instant. Used to turn each property-lane
// worker's own recorded start/end timestamps into a directly observable
// "how many were alive at once" signal.
function maxConcurrentSpans(spans) {
  const events = [];
  for (const { start, end } of spans) {
    events.push([start, 1]);
    events.push([end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let max = 0;
  for (const [, delta] of events) {
    current += delta;
    max = Math.max(max, current);
  }
  return max;
}

module.exports = { maxConcurrentSpans };
