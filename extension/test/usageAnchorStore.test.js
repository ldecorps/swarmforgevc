const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  usageAnchorsFilePath,
  isValidAnchorPct,
  readUsageAnchors,
  appendUsageAnchor,
  DEFAULT_ANCHOR_SCOPE,
} = require('../out/metrics/usageAnchorStore');

// BL-619: the impure read/write layer over .swarmforge/operator/usage-anchors.jsonl.

function mkTmp() {
  return mkTmpDir('sfvc-usage-anchor-store-');
}

test('reading from a target with no anchors file yet returns an empty array, never a crash', () => {
  const target = mkTmp();
  assert.deepEqual(readUsageAnchors(target), []);
});

// anchor-validation-07
test('isValidAnchorPct accepts 0..100 inclusive and rejects out-of-range or non-finite values', () => {
  assert.equal(isValidAnchorPct(23), true);
  assert.equal(isValidAnchorPct(0), true);
  assert.equal(isValidAnchorPct(100), true);
  assert.equal(isValidAnchorPct(130), false);
  assert.equal(isValidAnchorPct(-5), false);
  assert.equal(isValidAnchorPct(NaN), false);
  assert.equal(isValidAnchorPct(Infinity), false);
});

// anchor-validation-07: persists the checkpoint
test('appendUsageAnchor persists a valid checkpoint and readUsageAnchors reads it back', () => {
  const target = mkTmp();
  const result = appendUsageAnchor(target, 1784980800000, 23, 'all-models');
  assert.equal(result.ok, true);
  assert.deepEqual(readUsageAnchors(target), [{ atMs: 1784980800000, pct: 23, scope: 'all-models' }]);
});

test('appendUsageAnchor defaults scope to all-models when omitted', () => {
  const target = mkTmp();
  appendUsageAnchor(target, 1784980800000, 40);
  assert.deepEqual(readUsageAnchors(target), [{ atMs: 1784980800000, pct: 40, scope: DEFAULT_ANCHOR_SCOPE }]);
});

// anchor-validation-07: rejects the value
test('appendUsageAnchor rejects an out-of-range percentage and writes nothing to disk', () => {
  const target = mkTmp();
  const overResult = appendUsageAnchor(target, Date.now(), 130);
  assert.equal(overResult.ok, false);
  assert.match(overResult.error, /0\.\.100/);

  const underResult = appendUsageAnchor(target, Date.now(), -5);
  assert.equal(underResult.ok, false);

  assert.equal(fs.existsSync(usageAnchorsFilePath(target)), false);
  assert.deepEqual(readUsageAnchors(target), []);
});

test('multiple anchors append in order and all read back', () => {
  const target = mkTmp();
  appendUsageAnchor(target, 100, 10, 'all-models');
  appendUsageAnchor(target, 200, 15, 'all-models');
  assert.deepEqual(readUsageAnchors(target), [
    { atMs: 100, pct: 10, scope: 'all-models' },
    { atMs: 200, pct: 15, scope: 'all-models' },
  ]);
});

test('a malformed line in the anchors file is skipped, never a crash', () => {
  const target = mkTmp();
  appendUsageAnchor(target, 100, 10, 'all-models');
  fs.appendFileSync(usageAnchorsFilePath(target), 'not json\n');
  fs.appendFileSync(usageAnchorsFilePath(target), JSON.stringify({ atMs: 200, pct: 999, scope: 'all-models' }) + '\n');
  assert.deepEqual(readUsageAnchors(target), [{ atMs: 100, pct: 10, scope: 'all-models' }]);
});

// A record that is well-formed JSON but not a well-formed anchor - each
// field individually malformed, not just missing - must be rejected the
// same as an unparseable line, never crash and never partially accepted.
test('a present-but-malformed anchor record is rejected field by field', () => {
  const target = mkTmp();
  appendUsageAnchor(target, 100, 10, 'all-models');
  const malformedRecords = [
    null,
    'a string, not an object',
    { atMs: 'not-a-number', pct: 10, scope: 'all-models' },
    { atMs: Infinity, pct: 10, scope: 'all-models' },
    { atMs: 200, pct: 'not-a-number', scope: 'all-models' },
    { atMs: 200, pct: 10, scope: 42 },
    { atMs: 200, pct: 10, scope: '' },
    { atMs: 200 },
  ];
  for (const record of malformedRecords) {
    fs.appendFileSync(usageAnchorsFilePath(target), JSON.stringify(record) + '\n');
  }
  assert.deepEqual(readUsageAnchors(target), [{ atMs: 100, pct: 10, scope: 'all-models' }]);
});
