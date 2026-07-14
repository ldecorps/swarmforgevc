const assert = require('node:assert/strict');
const { runDependencyCruiser, runGate, scanMediaFilesForStorageGlobals } = require('../out/tools/dependency-gate');
const { parseDependencyCruiserOutput } = require('../out/quality/dependencyGate');
const { REAL_CONFIG_PATH, mkFixtureRoot, writeFixtureTsconfig, writeFile } = require('./helpers/dependencyGateFixture');

// BL-375: split from dependencyGateCli.test.js (family: dependencyGateCli*)
// so the real-engine files can run concurrently instead of one file
// serialising all 12 tests. This file holds the localStorage/sessionStorage
// bare-global-reference tests (BL-259's own no-webview-storage rule half
// that dependency-cruiser's import/require-edge analysis alone cannot see)
// - 1 real-engine test (localstorage-global, via runGate/runDependencyCruiser),
// under the ticket's own per-file cap, alongside its cheaper
// scanMediaFilesForStorageGlobals-only siblings.

// ── QA bounce (6747a4812d): the REALISTIC no-webview-storage violation ──
// dependency-cruiser alone (the test above) cannot see this at all - it
// only sees import/require EDGES, never a bare global reference. This is
// QA's OWN exact repro command, reproduced here as a real regression test.

test('QA bounce repro: runGate flags a bare localStorage.setItem(...) global reference that depcruise alone misses', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  writeFile(root, 'media/real-violation.js', "localStorage.setItem('x', '1');\n");

  const depcruiseOnly = parseDependencyCruiserOutput(runDependencyCruiser(['media'], root, REAL_CONFIG_PATH));
  assert.equal(depcruiseOnly.passed, true, 'confirms depcruise alone genuinely cannot see this - the gap QA found');

  const full = runGate(['media'], root, REAL_CONFIG_PATH);
  assert.equal(full.passed, false);
  const violation = full.violations.find((v) => v.rule === 'no-webview-storage');
  assert.ok(violation, `expected a no-webview-storage violation, got: ${JSON.stringify(full.violations)}`);
  assert.equal(violation.from, 'media/real-violation.js');
});

test('QA bounce repro: sessionStorage is caught too, and a clean media file is not flagged', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  writeFile(root, 'media/bad.js', 'sessionStorage.getItem("x");\n');
  writeFile(root, 'media/clean.js', "console.log('hello');\n");

  const violations = scanMediaFilesForStorageGlobals(root, ['media']);

  assert.deepEqual(violations.map((v) => v.from).sort(), ['media/bad.js']);
});

test('scanMediaFilesForStorageGlobals only scans media/ scope paths - a src/ scope contributes nothing', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  writeFile(root, 'src/quality/notMedia.ts', "const localStorage_lookalike = 'localStorage in a comment or string';\n");

  const violations = scanMediaFilesForStorageGlobals(root, ['src']);

  assert.deepEqual(violations, []);
});

test('per-parcel mode: scanMediaFilesForStorageGlobals scans a single changed media file directly', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  writeFile(root, 'media/real-violation.js', "localStorage.setItem('x', '1');\n");

  const violations = scanMediaFilesForStorageGlobals(root, ['media/real-violation.js']);

  assert.deepEqual(violations, [{ from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' }]);
});

// QA bounce (2nd pass, 20260710): findMediaJsFiles's own CRAP gate breach
// (complexity=6, coverage=90%) traced to these two untested branches - a
// scope path that does not exist on disk at all (the statSync catch), and
// a per-parcel scope path pointing at an existing file that is NOT a .js
// file (the isDirectory-false / endsWith('.js')-false combination).

test('a media scope path that does not exist on disk contributes nothing, not a crash', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);

  const violations = scanMediaFilesForStorageGlobals(root, ['media/does-not-exist']);

  assert.deepEqual(violations, []);
});

test('per-parcel mode: a scope path pointing at an existing non-.js file contributes nothing', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  writeFile(root, 'media/notes.txt', 'localStorage mentioned here but not a JS file\n');

  const violations = scanMediaFilesForStorageGlobals(root, ['media/notes.txt']);

  assert.deepEqual(violations, []);
});
