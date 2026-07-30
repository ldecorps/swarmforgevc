const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { findRawMkdtempCallSites } = require('./helpers/rawMkdtempGuard');

// BL-714 invariant: "Every extension/test file that creates a temp
// directory uses the shared mkTmpDir helper; the raw-mkdtemp migration
// guard finds zero call sites outside its documented exemptions."
//
// tmpDirMigrationGuard.test.js already pins this at four fixed examples
// (BL-420). Those examples don't vary prefix length, nesting depth, or
// surrounding file content, so they can't tell us the guard generalizes
// past the exact shapes someone thought to write by hand - which is exactly
// how the four BL-714 offenders (each a slightly different prefix, at a
// different line, amid different surrounding code) slipped past review in
// the first place. This property fuzzes prefix text, call-site line
// position, and surrounding noise lines so the guarantee covers "any raw
// mkdtemp call, anywhere in the file", not just the four already fixed.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const prefixArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}-$/);
const noiseLineArb = fc.constantFrom(
  "const x = 1;",
  "function helper() { return 42; }",
  "// a comment",
  "assert.equal(1, 1);",
  "",
);
const noiseLinesArb = fc.array(noiseLineArb, { minLength: 0, maxLength: 5 });

function rawCallLine(prefix) {
  return `const dir = fs.mkdtempSync(path.join(os.tmpdir(), '${prefix}'));`;
}

function mkTmpDirCallLine(prefix) {
  return `const dir = mkTmpDir('${prefix}');`;
}

test('a raw mkdtemp call is flagged at its true line number regardless of surrounding content or position', () => {
  const root = mkTmpDir('sfvc-mkdtemp-property-fixture-');

  fc.assert(
    fc.property(
      prefixArb,
      noiseLinesArb,
      noiseLinesArb,
      fc.integer({ min: 0, max: 1000 }),
      (prefix, before, after, seed) => {
        const lines = [...before, rawCallLine(prefix), ...after];
        const expectedLine = before.length + 1;
        const file = path.join(root, `case-${seed}.test.js`);
        fs.writeFileSync(file, lines.join('\n') + '\n');

        try {
          const violations = findRawMkdtempCallSites(root).filter((v) => v.file === file);
          assert.deepEqual(violations, [{ file, line: expectedLine }]);
        } finally {
          fs.rmSync(file, { force: true });
        }
      },
    ),
    { numRuns: 40 },
  );
});

test('the same call site migrated to mkTmpDir is never flagged, for any prefix', () => {
  const root = mkTmpDir('sfvc-mkdtemp-property-fixed-fixture-');

  fc.assert(
    fc.property(prefixArb, noiseLinesArb, noiseLinesArb, fc.integer({ min: 0, max: 1000 }), (prefix, before, after, seed) => {
      const lines = [...before, mkTmpDirCallLine(prefix), ...after];
      const file = path.join(root, `fixed-${seed}.test.js`);
      fs.writeFileSync(file, lines.join('\n') + '\n');

      try {
        const violations = findRawMkdtempCallSites(root).filter((v) => v.file === file);
        assert.deepEqual(violations, []);
      } finally {
        fs.rmSync(file, { force: true });
      }
    }),
    { numRuns: 40 },
  );
});
