const assert = require('node:assert/strict');
const { runDependencyCruiser } = require('../out/tools/dependency-gate');
const { parseDependencyCruiserOutput } = require('../out/quality/dependencyGate');
const { REAL_CONFIG_PATH, mkFixtureRoot, writeFixtureTsconfig, writeFile } = require('./helpers/dependencyGateFixture');

// BL-375: split from dependencyGateCli.test.js (family: dependencyGateCli*)
// so the real-engine files can run concurrently instead of one file
// serialising all 12 tests. This file holds the clean-fixture-passes and
// every-forbidden-rule real-engine tests - 2, at the ticket's own per-file
// cap - both booting the REAL pinned dependency-cruiser (BL-259) against a
// REAL isolated fixture tree. Never mocked, stubbed, or faked.

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
