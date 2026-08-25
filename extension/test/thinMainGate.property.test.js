const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  applyAllowlist,
  allowlistOnlyShrinks,
  parcelIgnoresAllowlist,
} = require('../out/quality/thinMainGate');

// BL-534 invariants:
// 1. Parcel mode never consults the allowlist.
// 2. Allowlist may only shrink after first land.

function finding(basename) {
  return {
    filePath: `src/tools/${basename}`,
    basename,
    reason: 'complexity',
    complexity: 5,
  };
}

test('property: parcel mode always retains every finding regardless of allowlist', () => {
  fc.assert(
    fc.property(fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*\.ts$/), { minLength: 1, maxLength: 8 }), (names) => {
      const findings = names.map(finding);
      const allow = new Set(names.filter((_, i) => i % 2 === 0));
      const kept = applyAllowlist(findings, 'parcel', allow);
      assert.equal(kept.length, findings.length);
      for (const f of findings) {
        assert.ok(parcelIgnoresAllowlist(f, allow).length === 1);
      }
    }),
    { numRuns: 50 }
  );
});

test('property: allowlistOnlyShrinks holds iff next ⊆ previous', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.stringMatching(/^[a-z]+\.ts$/), { maxLength: 10 }),
      fc.uniqueArray(fc.stringMatching(/^[a-z]+\.ts$/), { maxLength: 10 }),
      (prev, next) => {
        const expected = next.every((n) => prev.includes(n));
        assert.equal(allowlistOnlyShrinks(prev, next), expected);
      }
    ),
    { numRuns: 80 }
  );
});
