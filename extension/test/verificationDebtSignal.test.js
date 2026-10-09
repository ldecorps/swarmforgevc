'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  verificationDebtSignal,
  describeVerificationDebtSignal,
  computeVerificationDebtRecommendation,
  readVerificationDebtReport,
} = require('../out/metrics/verificationDebtSignal');
const { mkTmpDir } = require('./helpers/tmpDir');
const { writeVerificationDebtLedgerFixture, mintCategoryOwner, writeThreshold } = require('./helpers/verificationDebtLedgerFixture');

function mkTmp() {
  return mkTmpDir('sfvc-bl1784-signal-');
}

// A fake `bb` on PATH that prints exactly `stdout`, to exercise the shape
// validator's own false branches - a real reader CLI never emits a
// malformed shape, so this is the only way to reach them without
// exporting the (deliberately private) predicate itself.
function withFakeBbOutput(stdout, fn) {
  const dir = mkTmpDir('sfvc-bl1784-fakebb-');
  const script = path.join(dir, 'bb');
  const encoded = Buffer.from(stdout, 'utf8').toString('base64');
  fs.writeFileSync(script, `#!/bin/sh\necho ${encoded} | base64 -d\n`);
  fs.chmodSync(script, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}:${originalPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

function report(overrides) {
  return { categories: {}, unowned: [], ...overrides };
}

test('BL-1784: no unowned categories recommends nothing', () => {
  assert.equal(verificationDebtSignal(report({ unowned: [] })), null);
});

test('BL-1784: one unowned category recommends cap 1, naming it', () => {
  assert.deepEqual(verificationDebtSignal(report({ unowned: ['land-path-ownership'] })), {
    recommendedCap: 1,
    categories: ['land-path-ownership'],
  });
});

test('BL-1784: more than one unowned category names every one of them', () => {
  assert.deepEqual(verificationDebtSignal(report({ unowned: ['a', 'b'] })), {
    recommendedCap: 1,
    categories: ['a', 'b'],
  });
});

test('BL-1784: describeVerificationDebtSignal names a single category in the singular', () => {
  assert.equal(describeVerificationDebtSignal(['land-path-ownership']), 'the verification-debt category land-path-ownership');
});

test('BL-1784: describeVerificationDebtSignal names more than one category in the plural', () => {
  assert.equal(describeVerificationDebtSignal(['a', 'b']), 'the verification-debt categories a, b');
});

test('BL-1784: no ledger file at all reads as an empty report (never crashes), recommending nothing', () => {
  const root = mkTmp();
  assert.deepEqual(readVerificationDebtReport(root), { categories: {}, unowned: [] });
  assert.equal(computeVerificationDebtRecommendation(root), null);
});

test('BL-1784: a reader CLI that cannot run at all degrades to null (never crashes)', () => {
  // A root with no `bb` on PATH reachable (PATH cleared) - the same
  // guarded-shell-out-and-degrade path a missing/broken bb exercises.
  const root = mkTmp();
  const originalPath = process.env.PATH;
  process.env.PATH = '';
  try {
    assert.equal(readVerificationDebtReport(root), null);
    assert.equal(computeVerificationDebtRecommendation(root), null);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('BL-1784: an unowned category at threshold recommends cap 1 through the real reader CLI', () => {
  const root = mkTmp();
  writeThreshold(root, 2);
  writeVerificationDebtLedgerFixture(root, {
    rows: [
      { category: 'land-path-ownership', ticket: 'BL-9801', description: 'row one' },
      { category: 'land-path-ownership', ticket: 'BL-9802', description: 'row two' },
    ],
  });
  const rec = computeVerificationDebtRecommendation(root);
  assert.deepEqual(rec, { recommendedCap: 1, categories: ['land-path-ownership'] });
});

test('BL-1784: a category under its threshold recommends nothing', () => {
  const root = mkTmp();
  writeThreshold(root, 3);
  writeVerificationDebtLedgerFixture(root, {
    rows: [{ category: 'land-path-ownership', ticket: 'BL-9801', description: 'row one' }],
  });
  assert.equal(computeVerificationDebtRecommendation(root), null);
});

test('BL-1784: an owned category (an open ticket declares verification_category) recommends nothing even over threshold', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, {
    rows: [{ category: 'land-path-ownership', ticket: 'BL-9801', description: 'row one' }],
  });
  mintCategoryOwner(root, { category: 'land-path-ownership', ticket: 'BL-9700' });
  assert.equal(computeVerificationDebtRecommendation(root), null);
});

test('BL-1784: a settled (discharged) category reads 0 outstanding and is never unowned', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, {
    rows: [
      {
        category: 'land-path-ownership',
        ticket: 'BL-9801',
        description: 'row one',
        settle: { kind: 'discharge', by: 'hardener', evidence: 'backlog/evidence/fixture.md' },
      },
    ],
  });
  assert.equal(computeVerificationDebtRecommendation(root), null);
});

test('BL-1784: a settled (waived) category reads 0 outstanding and is never unowned', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, {
    rows: [
      {
        category: 'land-path-ownership',
        ticket: 'BL-9801',
        description: 'row one',
        settle: { kind: 'waive', by: 'specifier', reason: 'fixture: superseded' },
      },
    ],
  });
  assert.equal(computeVerificationDebtRecommendation(root), null);
});

test('BL-1784: a description requiring escaping (embedded quotes and backslashes) round-trips through the real CLI unharmed', () => {
  const root = mkTmp();
  writeThreshold(root, 1);
  writeVerificationDebtLedgerFixture(root, {
    rows: [
      {
        category: 'land-path-ownership',
        ticket: 'BL-9801',
        description: 'checked "by hand" with a back\\slash and a # mid-line comment-looking bit',
      },
    ],
  });
  const rec = computeVerificationDebtRecommendation(root);
  assert.deepEqual(rec, { recommendedCap: 1, categories: ['land-path-ownership'] });
});

// ── shape validation (hardener pass) ────────────────────────────────────

// The shape validator's own false branches (CRAP gate, hardener pass) - a
// real reader CLI never emits any of these, so each is reached only via a
// faked `bb`. Every one must degrade to null, never throw.
const MALFORMED_SHAPES = [
  ['a bare null', 'null'],
  ['a non-object primitive', '42'],
  ['an object missing categories entirely', '{"unowned":[]}'],
  ['categories present but not an object', '{"categories":"x","unowned":[]}'],
  ['unowned present but not an array', '{"categories":{},"unowned":"nope"}'],
  ['unowned an array of non-strings', '{"categories":{},"unowned":[1,2]}'],
];

for (const [label, stdout] of MALFORMED_SHAPES) {
  test(`BL-1784: a reader CLI reporting a malformed shape (${label}) degrades to null, never throws`, () => {
    const root = mkTmp();
    withFakeBbOutput(stdout, () => {
      assert.equal(readVerificationDebtReport(root), null);
      assert.equal(computeVerificationDebtRecommendation(root), null);
    });
  });
}

test('BL-1784: a reader CLI reporting the real shape (categories object, unowned string array) is accepted, even with zero unowned entries', () => {
  const root = mkTmp();
  withFakeBbOutput('{"categories":{"land-path-ownership":{"count":1}},"unowned":[]}', () => {
    assert.deepEqual(readVerificationDebtReport(root), { categories: { 'land-path-ownership': { count: 1 } }, unowned: [] });
    assert.equal(computeVerificationDebtRecommendation(root), null);
  });
});
