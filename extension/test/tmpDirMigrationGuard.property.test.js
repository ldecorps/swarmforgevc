const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { findRawMkdtempCallSites, SELF_EXEMPT_RELATIVE_PATHS } = require('./helpers/rawMkdtempGuard');

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

// BL-771 invariant 1: "The raw-mkdtemp migration guard finds zero call
// sites across the real extension/test tree; what counts as fixed is what
// the guard REPORTS, never a file list copied out of a bounce note."
//
// BL-714 shipped believing four NAMED files were "the fix" and left a fifth
// real offender (pricingTable.test.js) unmigrated, because the fix was
// scoped to a hand-copied list instead of re-running the scan. The two
// properties above already prove single-file correctness; this one proves
// the report stays exactly right - never a subset, never a superset - for
// an arbitrary MIX of already-migrated and still-raw files in the same
// directory, so a future "I fixed the ones the bounce note named" fix is
// provably wrong the moment the guard actually runs, regardless of how many
// sibling files are already clean.
const mixedFileArb = fc.array(fc.record({ raw: fc.boolean(), prefix: prefixArb }), { minLength: 1, maxLength: 8 });

test('the guard reports exactly the raw sites in an arbitrary mix of raw and migrated files - never a subset, never a superset', () => {
  const root = mkTmpDir('sfvc-mkdtemp-property-mix-fixture-');

  fc.assert(
    fc.property(mixedFileArb, fc.integer({ min: 0, max: 1000 }), (files, seed) => {
      const written = [];
      const expected = [];
      files.forEach((f, i) => {
        const file = path.join(root, `mix-${seed}-${i}.test.js`);
        fs.writeFileSync(file, (f.raw ? rawCallLine(f.prefix) : mkTmpDirCallLine(f.prefix)) + '\n');
        written.push(file);
        if (f.raw) {
          expected.push(file);
        }
      });

      try {
        const violations = findRawMkdtempCallSites(root)
          .filter((v) => written.includes(v.file))
          .map((v) => v.file)
          .sort();
        assert.deepEqual(violations, expected.sort());
      } finally {
        written.forEach((file) => fs.rmSync(file, { force: true }));
      }
    }),
    { numRuns: 40 },
  );
});

// BL-771 invariant 2: "The guard is not weakened to reach that state: no
// path is added to SELF_EXEMPT_RELATIVE_PATHS and RAW_MKDTEMP_PATTERN is
// not narrowed."
//
// tmpDirMigrationGuard.test.js pins the exempt list to its exact three
// entries by value - a single fixed example. This property complements
// that pin generatively: for ANY relative path that is NOT one of those
// three, planting a raw call there is still flagged, proving the exemption
// boundary is exactly the pinned three - not "the three plus whatever a
// future edit quietly adds to buy back a green scan".
const nonExemptBasenameArb = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9]{2,20}\.test\.js$/)
  .filter((name) => !SELF_EXEMPT_RELATIVE_PATHS.includes(name));

test('a raw call planted under any non-exempt filename is still flagged - the exemption boundary is exactly the pinned three', () => {
  const root = mkTmpDir('sfvc-mkdtemp-property-nonexempt-fixture-');

  fc.assert(
    fc.property(nonExemptBasenameArb, prefixArb, fc.integer({ min: 0, max: 1000 }), (basename, prefix, seed) => {
      const file = path.join(root, `${seed}-${basename}`);
      fs.writeFileSync(file, rawCallLine(prefix) + '\n');

      try {
        const violations = findRawMkdtempCallSites(root).filter((v) => v.file === file);
        assert.deepEqual(violations, [{ file, line: 1 }]);
      } finally {
        fs.rmSync(file, { force: true });
      }
    }),
    { numRuns: 40 },
  );
});
