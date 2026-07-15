const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findRawMkdtempLines, findRawMkdtempCallSites } = require('./helpers/rawMkdtempGuard');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-420: the regression guard's own tests. findRawMkdtempLines is the pure
// per-file scanner (fixture strings, no filesystem); findRawMkdtempCallSites
// is the real directory walk, proven break-then-fix per the engineering
// article's disk-input rule before trusting it against the real suite.
//
// This file's own fixture strings deliberately contain the LITERAL raw
// pattern as test DATA - findRawMkdtempCallSites therefore excludes THIS
// file from its own "real tree" scan below (rawMkdtempGuard.js's
// SELF_EXEMPT_FILES), the same way it exempts helpers/tmpDir.js's one
// legitimate real call site - otherwise the migration-complete gate would
// permanently flag its own test fixtures as violations.

// ── findRawMkdtempLines (pure) ──────────────────────────────────────────

test('detects a raw fs.mkdtempSync(path.join(os.tmpdir(), ...)) call', () => {
  const text = "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n";
  assert.deepEqual(findRawMkdtempLines(text), [1]);
});

test('does not flag a call through the shared mkTmpDir helper', () => {
  const text = "const dir = mkTmpDir('x-');\n";
  assert.deepEqual(findRawMkdtempLines(text), []);
});

test('reports every offending line, not just the first', () => {
  const text = [
    "const a = fs.mkdtempSync(path.join(os.tmpdir(), 'a-'));",
    "const b = mkTmpDir('b-');",
    "const c = fs.mkdtempSync(path.join(os.tmpdir(), 'c-'));",
  ].join('\n');
  assert.deepEqual(findRawMkdtempLines(text), [1, 3]);
});

// ── findRawMkdtempCallSites (impure, real fs) - break-then-fix ─────────
// BL-420 test-helpers-clean-up-tmp-dirs-03

test('flags a raw call planted in a fixture test dir, then confirms clean once fixed', () => {
  const root = mkTmpDir('sfvc-mkdtemp-guard-fixture-');
  fs.mkdirSync(path.join(root, 'helpers'), { recursive: true });
  const offender = path.join(root, 'someFile.test.js');
  fs.writeFileSync(offender, "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n");

  const before = findRawMkdtempCallSites(root);
  assert.deepEqual(before, [{ file: offender, line: 1 }]);

  fs.writeFileSync(offender, "const dir = mkTmpDir('x-');\n");
  const after = findRawMkdtempCallSites(root);
  assert.deepEqual(after, []);
});

test('never flags the shared helper\'s own legitimate call site (helpers/tmpDir.js)', () => {
  const root = mkTmpDir('sfvc-mkdtemp-guard-helper-exempt-');
  fs.mkdirSync(path.join(root, 'helpers'), { recursive: true });
  fs.writeFileSync(path.join(root, 'helpers', 'tmpDir.js'), 'fs.mkdtempSync(path.join(os.tmpdir(), prefix));\n');

  assert.deepEqual(findRawMkdtempCallSites(root), []);
});

test('never flags a file named tmpDirMigrationGuard.test.js - this file\'s own fixture strings are test DATA, not real usage', () => {
  const root = mkTmpDir('sfvc-mkdtemp-guard-self-exempt-');
  fs.writeFileSync(path.join(root, 'tmpDirMigrationGuard.test.js'), "const text = \"fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\";\n");

  assert.deepEqual(findRawMkdtempCallSites(root), []);
});

test('still flags a raw call in a DIFFERENT helper file - only tmpDir.js itself is exempt', () => {
  const root = mkTmpDir('sfvc-mkdtemp-guard-other-helper-');
  fs.mkdirSync(path.join(root, 'helpers'), { recursive: true });
  const offender = path.join(root, 'helpers', 'someOtherHelper.js');
  fs.writeFileSync(offender, "fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n");

  assert.deepEqual(findRawMkdtempCallSites(root), [{ file: offender, line: 1 }]);
});

test('skips a "fixtures" directory - pinned task fixtures, not this suite\'s own tests', () => {
  const root = mkTmpDir('sfvc-mkdtemp-guard-fixtures-skip-');
  fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fixtures', 'pinned.test.js'), "fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n");

  assert.deepEqual(findRawMkdtempCallSites(root), []);
});

test('finds violations nested several directories deep, not just at the top level', () => {
  const root = mkTmpDir('sfvc-mkdtemp-guard-nested-');
  const nested = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  const offender = path.join(nested, 'deep.test.js');
  fs.writeFileSync(offender, "fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n");

  assert.deepEqual(findRawMkdtempCallSites(root), [{ file: offender, line: 1 }]);
});

// ── BL-420 test-helpers-clean-up-tmp-dirs-03: the actual migration-complete gate ──

test('the real extension/test/ tree has zero raw mkdtemp call sites outside the shared helper', () => {
  const testDir = __dirname;
  const violations = findRawMkdtempCallSites(testDir);
  assert.deepEqual(violations, [], `expected zero raw mkdtemp call sites, found:\n${violations.map((v) => `${v.file}:${v.line}`).join('\n')}`);
});
