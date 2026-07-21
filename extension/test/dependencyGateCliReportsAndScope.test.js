const assert = require('node:assert/strict');
const { runDependencyCruiser } = require('../out/tools/dependency-gate');
const { parseDependencyCruiserOutput } = require('../out/quality/dependencyGate');
const { REAL_CONFIG_PATH, mkFixtureRoot, writeFixtureTsconfig, writeFile } = require('./helpers/dependencyGateFixture');

// BL-375: split from dependencyGateCli.test.js (family: dependencyGateCli*)
// so the real-engine files can run concurrently instead of one file
// serialising all 12 tests. This file holds the byte-identical-reports and
// per-parcel-scope real-engine tests - 2, at the ticket's own per-file cap -
// both booting the REAL pinned dependency-cruiser (BL-259) against a REAL
// isolated fixture tree. Never mocked, stubbed, or faked.

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
// specs/pipeline/steps/hotTestFilesStopWaitingSteps.js. Never simply
// deleted: the same assertion (the compiled CLI, run for real with no
// scope args, exits 0 and prints PASSED for the true project tree) still
// runs, just outside the fast unit suite.
