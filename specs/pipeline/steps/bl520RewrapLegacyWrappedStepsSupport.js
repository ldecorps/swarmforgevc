'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LEGACY_ALLOWLIST_PATH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'gherkin_lint_gate_legacy_wraps.txt');
const GHERKIN_GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'gherkin_lint_gate.sh');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const BL131_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-131-eliminate-real-timers-in-test-suite.feature');
const SAMPLE_REWRAPPED_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-096-velocity-burndown-metrics.feature');

function readLegacyAllowlistEntries() {
  if (!fs.existsSync(LEGACY_ALLOWLIST_PATH)) {
    return [];
  }
  return fs.readFileSync(LEGACY_ALLOWLIST_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function assertNoLegacyAllowlistEntries() {
  assert.deepEqual(readLegacyAllowlistEntries(), []);
}

function assertNoContinuationLines(featurePath) {
  const text = fs.readFileSync(featurePath, 'utf8');
  const result = childProcess.spawnSync('bb', [
    '-e',
    `(load-file "swarmforge/scripts/gherkin_lint_gate_lib.bb")
     (let [findings (gherkin-lint-gate-lib/find-continuation-line-findings (slurp "${featurePath}"))]
       (when (seq findings)
         (binding [*out* *err*] (println findings))
         (System/exit 1)))`
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`expected no wrapped-step continuation lines in ${featurePath}; stdout=${result.stdout} stderr=${result.stderr}`);
  }
  return text;
}

function runLintGate(featurePath) {
  return childProcess.spawnSync('bash', [GHERKIN_GATE, featurePath, REPO_ROOT], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
}

function makeTmpDir(prefix) {
  const tmpRoot = path.join(REPO_ROOT, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  return fs.mkdtempSync(path.join(tmpRoot, prefix));
}

function runAcceptanceFixture({ featureText, stepsModuleText, sentinelName }) {
  const tmpDir = makeTmpDir('bl520-acceptance-');
  const featurePath = path.join(tmpDir, 'rewrapped.feature');
  const stepsModulePath = path.join(tmpDir, 'steps.js');
  const outDir = path.join(tmpDir, 'generated');
  const sentinelPath = path.join(tmpDir, sentinelName);
  fs.writeFileSync(featurePath, featureText, 'utf8');
  fs.writeFileSync(stepsModulePath, stepsModuleText(sentinelPath), 'utf8');
  const result = childProcess.spawnSync('bash', [RUN_ACCEPTANCE, featurePath, outDir, stepsModulePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  return { tmpDir, outDir, result, sentinelPath };
}

module.exports = {
  BL131_FEATURE,
  REPO_ROOT,
  SAMPLE_REWRAPPED_FEATURE,
  assertNoContinuationLines,
  assertNoLegacyAllowlistEntries,
  makeTmpDir,
  readLegacyAllowlistEntries,
  runAcceptanceFixture,
  runLintGate,
};
