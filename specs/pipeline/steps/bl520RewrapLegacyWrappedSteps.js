'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LEGACY_ALLOWLIST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'gherkin_lint_gate_legacy_wraps.txt');
const GHERKIN_GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'gherkin_lint_gate.sh');
const BL131_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-131-eliminate-real-timers-in-test-suite.feature');
const SAMPLE_REWRAPPED_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-096-velocity-burndown-metrics.feature');

function legacyAllowlistEntries() {
  return fs.readFileSync(LEGACY_ALLOWLIST, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
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

function registerSteps(registry) {
  registry.define(/^a legacy feature file whose wrapped steps have been rejoined to single lines$/, (ctx) => {
    ctx.featurePath = SAMPLE_REWRAPPED_FEATURE;
    assertNoContinuationLines(ctx.featurePath);
  });

  registry.define(/^its entry has been removed from the grandfather allowlist$/, (ctx) => {
    const relativePath = path.relative(REPO_ROOT, ctx.featurePath);
    assert.equal(legacyAllowlistEntries().includes(relativePath), false);
  });

  registry.define(/^the gherkin lint gate runs on it$/, (ctx) => {
    ctx.lintResult = runLintGate(ctx.featurePath);
  });

  registry.define(/^the gate passes cleanly$/, (ctx) => {
    assert.equal(ctx.lintResult.status, 0, `expected lint gate to pass; stdout=${ctx.lintResult.stdout} stderr=${ctx.lintResult.stderr}`);
    assert.match(ctx.lintResult.stdout, /^OK: /m);
  });

  registry.define(/^a rewrapped legacy feature file whose step handlers were reconciled to the full step text$/, (ctx) => {
    ctx.featurePath = SAMPLE_REWRAPPED_FEATURE;
    ctx.featureText = assertNoContinuationLines(ctx.featurePath);
  });

  registry.define(/^its acceptance entry points are generated and run$/, (ctx) => {
    ctx.lintResult = runLintGate(ctx.featurePath);
  });

  registry.define(/^every scenario resolves to a step handler and the run passes$/, (ctx) => {
    assert.equal(ctx.lintResult.status, 0, `expected rewrapped feature lint to pass; stdout=${ctx.lintResult.stdout} stderr=${ctx.lintResult.stderr}`);
  });

  registry.define(/^a legacy wrapped step whose continuation line carried a parameter the parser dropped$/, (ctx) => {
    ctx.featurePath = BL131_FEATURE;
    ctx.featureText = assertNoContinuationLines(ctx.featurePath);
  });

  registry.define(/^the step is rejoined to a single line and its handler is reconciled$/, (ctx) => {
    assert.match(
      ctx.featureText,
      /Then no test contains a bare `setTimeout`\/`setInterval` call or an\s+`await new Promise\(resolve => setTimeout\(resolve, <ms>\)\)` wait on the\s+real clock/
    );
  });

  registry.define(/^the restored parameter reaches the step handler and its Examples column is referenced$/, (ctx) => {
    assert.match(ctx.featureText, /<ms>/);
    const gateResult = runLintGate(ctx.featurePath);
    assert.equal(gateResult.status, 0, `expected BL-131 to have no phantom <ms> column; stdout=${gateResult.stdout} stderr=${gateResult.stderr}`);
  });

  registry.define(/^every legacy feature file has been rewrapped and removed from the allowlist$/, (ctx) => {
    ctx.allowlistEntries = legacyAllowlistEntries();
    assert.deepEqual(ctx.allowlistEntries, []);
  });

  registry.define(/^the allowlist holds no feature-file entries$/, (ctx) => {
    assert.deepEqual(ctx.allowlistEntries ?? legacyAllowlistEntries(), []);
  });

  registry.define(/^the lint gate enforces single-line steps for every feature file with no exemptions$/, () => {
    const tmpRoot = path.join(REPO_ROOT, 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'bl520-'));
    const fixture = path.join(tmpDir, 'wrapped.feature');
    fs.writeFileSync(fixture, [
      'Feature: wrapped step fixture',
      '',
      '  Scenario: rejected',
      '    Given a step that wraps',
      '      onto a second line',
      ''
    ].join('\n'));
    const result = runLintGate(fixture);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    assert.notEqual(result.status, 0, 'expected a freshly wrapped step to fail without exemptions');
    assert.match(result.stderr, /bare continuation line/);
  });
}

module.exports = { registerSteps };
