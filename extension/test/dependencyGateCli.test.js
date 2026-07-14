const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, runDependencyCruiser, runGate, scanMediaFilesForStorageGlobals } = require('../out/tools/dependency-gate');
const { parseDependencyCruiserOutput } = require('../out/quality/dependencyGate');

// BL-259: runs the REAL pinned dependency-cruiser against small, isolated
// fixture trees using the REAL project ruleset (.dependency-cruiser.cjs) -
// per the ticket's own "the ruleset itself is validated by running the
// pinned checker against fixture code" requirement. No mocked checker
// output here (that half is covered by dependencyGate.test.js's recorded-
// output tests); this file proves the RULESET is actually wired to catch
// real violations, not just that the parser can read a hand-written
// fixture JSON blob.

const REAL_CONFIG_PATH = path.join(__dirname, '..', '.dependency-cruiser.cjs');

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-depgate-fixture-'));
}

function writeFixtureTsconfig(root) {
  // allowJs: a fixture that carries ONLY .js files (e.g. a media/-only
  // fixture with no .ts anywhere) otherwise leaves tsc's own `include`
  // resolution empty (TS18003), since tsc excludes .js from `include` by
  // default - the real project's own tsconfig.json never hits this because
  // src/**/*.ts always has plenty of real .ts files alongside media/.
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'commonjs', target: 'ES2022', allowJs: true }, include: ['src/**/*', 'media/**/*'] })
  );
}

function writeFile(root, relPath, content) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// ── parseArgs (pure) ───────────────────────────────────────────────────

test('parseArgs with no arguments defaults to full-repo scope (src, media)', () => {
  assert.deepEqual(parseArgs([]), { scopePaths: ['src', 'media'] });
});

test('parseArgs with file arguments scopes to exactly those (per-parcel mode)', () => {
  assert.deepEqual(parseArgs(['src/quality/coChange.ts', 'src/tools/co-change-report.ts']), {
    scopePaths: ['src/quality/coChange.ts', 'src/tools/co-change-report.ts'],
  });
});

// ── clean-passes-01 ──────────────────────────────────────────────────────

test('the REAL pinned checker + REAL project ruleset passes a clean fixture with no forbidden edge', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  writeFile(root, 'src/quality/clean.ts', "export function clean(x: number) { return x + 1; }\n");

  const rawJson = runDependencyCruiser(['src'], root, REAL_CONFIG_PATH);
  const result = parseDependencyCruiserOutput(rawJson);

  assert.equal(result.passed, true);
  assert.deepEqual(result.violations, []);
});

// ── violation-hard-fails-and-bounces-02 / ruleset-enforced-03 ────────────
// BL-362: six separate one-rule fixtures used to mean six separate real
// dependency-cruiser engine boots (~500ms apiece). Merged into ONE fixture
// carrying all six violations, proven from a SINGLE engine run. BL-259's own
// guardrail stays intact - every rule is still proven by the REAL pinned
// checker against REAL fixture code, never a mocked/canned result; only the
// NUMBER of engine boots changes, not what is proven.

test('the REAL checker catches every forbidden-dependency rule, from a single engine run', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  // no-io-from-policy
  writeFile(root, 'src/quality/bad.ts', "import * as fs from 'fs';\nexport function bad() { return fs.existsSync('.'); }\n");
  // view-not-import-host-io
  writeFile(root, 'src/swarm/hostThing.ts', 'export function hostThing() { return 1; }\n');
  writeFile(root, 'media/view.js', "const { hostThing } = require('../src/swarm/hostThing');\nhostThing();\n");
  // no-process-spawn-from-view
  writeFile(root, 'media/spawner.js', "const { execSync } = require('child_process');\nexecSync('ls');\n");
  // core-not-vscode-api
  writeFile(root, 'src/swarm/oops.ts', "import * as vscode from 'vscode';\nexport function oops() { return vscode; }\n");
  // no-webview-storage (the wrapper-package-import half; the bare-global
  // half is proven separately below, since it needs runGate, not the bare
  // dependency-cruiser call this fixture shares with the other five rules)
  writeFile(root, 'media/storage.js', "const localforage = require('localforage');\nlocalforage.setItem('x', 1);\n");
  // acyclic
  writeFile(root, 'src/swarm/a.ts', "import { b } from './b';\nexport function a() { return b; }\n");
  writeFile(root, 'src/swarm/b.ts', "import { a } from './a';\nexport function b() { return a; }\n");

  const rawJson = runDependencyCruiser(['src', 'media'], root, REAL_CONFIG_PATH);
  const result = parseDependencyCruiserOutput(rawJson);

  assert.equal(result.passed, false);
  const expectedViolations = [
    { rule: 'no-io-from-policy', from: 'src/quality/bad.ts', to: 'fs' },
    { rule: 'view-not-import-host-io', from: 'media/view.js', to: 'src/swarm/hostThing.ts' },
    { rule: 'no-process-spawn-from-view', from: 'media/spawner.js', to: 'child_process' },
    { rule: 'core-not-vscode-api', from: 'src/swarm/oops.ts', to: 'vscode' },
    { rule: 'no-webview-storage', from: 'media/storage.js', to: 'localforage' },
    { rule: 'acyclic', from: 'src/swarm/a.ts', to: 'src/swarm/b.ts' },
  ];
  for (const expected of expectedViolations) {
    const violation = result.violations.find((v) => v.rule === expected.rule);
    assert.ok(violation, `expected a ${expected.rule} violation, got: ${JSON.stringify(result.violations)}`);
    assert.equal(violation.from, expected.from);
    assert.equal(violation.to, expected.to);
  }
});

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

// ── deterministic-report-04 ────────────────────────────────────────────

test('running the REAL checker twice over identical fixture code produces byte-identical reports', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  writeFile(root, 'src/quality/bad.ts', "import * as fs from 'fs';\nexport function bad() { return fs.existsSync('.'); }\n");

  const first = parseDependencyCruiserOutput(runDependencyCruiser(['src'], root, REAL_CONFIG_PATH));
  const second = parseDependencyCruiserOutput(runDependencyCruiser(['src'], root, REAL_CONFIG_PATH));

  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

// ── scope-changed-vs-full-05 ──────────────────────────────────────────────

test('per-parcel mode (a single changed file) reports only violations reachable from that file, not the whole fixture', () => {
  const root = mkFixtureRoot();
  writeFixtureTsconfig(root);
  writeFile(root, 'src/quality/bad.ts', "import * as fs from 'fs';\nexport function bad() { return fs.existsSync('.'); }\n");
  writeFile(root, 'src/quality/clean.ts', 'export function clean() { return 1; }\n');

  const rawJson = runDependencyCruiser(['src/quality/clean.ts'], root, REAL_CONFIG_PATH);
  const result = parseDependencyCruiserOutput(rawJson);

  assert.equal(result.passed, true, 'scoping to only the clean file must not see the unrelated bad.ts violation');
});

// BL-362: the whole-real-project CLI scan (previously here, ~1.6s) is
// relocated to the acceptance path, where a full scan already belongs (the
// architect's own documented "run with no arguments for a full-repo scan"
// gate procedure - swarmforge/roles/architect.prompt) - see
// specs/features/BL-362-hot-test-files-stop-waiting.feature and
// specs/pipeline/steps/dependencyGateWholeProjectSteps.js. Never simply
// deleted: the same assertion (the compiled CLI, run for real with no
// scope args, exits 0 and prints PASSED for the true project tree) still
// runs, just outside the fast unit suite.
