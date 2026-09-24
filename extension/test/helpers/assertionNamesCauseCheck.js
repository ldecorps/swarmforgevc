'use strict';

// BL-1695: pure, shared detection of "every assert call inside a named
// describe block interpolates a given token" - the ONE real
// implementation both bl1695ClosureFixtureCopiesOnlyTheClosureSteps.js
// and this invariant's own property test drive (the
// stepHandlerRequireCensus.js / frontDeskLaunchReadiness.js precedent:
// one shared checker, never re-derived per driver).

const ASSERT_CALL_RE = /assert\.(ok|equal)\([\s\S]*?\);/g;

// Every `assert.ok(...)`/`assert.equal(...)` call textually inside the
// describe block that STARTS at the first occurrence of blockAnchor in
// source and runs to the end of the string (callers slice a bounded
// region first when a block is not the last in the file).
function assertionsInBlock(source, blockAnchor) {
  const start = source.indexOf(blockAnchor);
  if (start === -1) return null;
  const block = source.slice(start);
  return block.match(ASSERT_CALL_RE) || [];
}

// True when every assertion whose text matches filterRe also contains
// token (a literal substring, e.g. '${removed}') - the shape "every
// assertion about X names X".
function everyMatchingAssertionInterpolates(assertions, filterRe, token) {
  const relevant = assertions.filter((line) => filterRe.test(line));
  if (relevant.length === 0) return { ok: false, relevant, missing: [] };
  const missing = relevant.filter((line) => !line.includes(token));
  return { ok: missing.length === 0, relevant, missing };
}

module.exports = { assertionsInBlock, everyMatchingAssertionInterpolates };
