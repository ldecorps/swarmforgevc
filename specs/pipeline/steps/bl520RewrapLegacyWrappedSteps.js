'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LEGACY_ALLOWLIST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'gherkin_lint_gate_legacy_wraps.txt');
const GHERKIN_GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'gherkin_lint_gate.sh');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const BL131_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-131-eliminate-real-timers-in-test-suite.feature');
const SAMPLE_REWRAPPED_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-096-velocity-burndown-metrics.feature');

function legacyAllowlistEntries() {
  if (!fs.existsSync(LEGACY_ALLOWLIST)) {
    return [];
  }
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
    ctx.acceptanceResult = runAcceptanceFixture({
      sentinelName: 'full-step-ran.txt',
      featureText: [
        'Feature: full step reconciliation fixture',
        '',
        '  Scenario: full rewrapped step resolves',
        '    Given the legacy wrapped step has been rejoined to a single line with its restored trailing clause',
        ''
      ].join('\n'),
      stepsModuleText: (sentinelPath) => `
'use strict';
const fs = require('fs');

function registerSteps(registry) {
  registry.define(/^the legacy wrapped step has been rejoined to a single line with its restored trailing clause$/, () => {
    fs.writeFileSync(${JSON.stringify(sentinelPath)}, 'executed', 'utf8');
  });
}

module.exports = { registerSteps };
`
    });
  });

  registry.define(/^every scenario resolves to a step handler and the run passes$/, (ctx) => {
    const { tmpDir, outDir, result, sentinelPath } = ctx.acceptanceResult;
    try {
      assert.equal(result.status, 0, `expected generated acceptance run to pass; stdout=${result.stdout} stderr=${result.stderr}`);
      assert.match(result.stdout, /# pass 1/m);
      assert.equal(fs.existsSync(path.join(outDir, 'full-step-reconciliation-fixture.generated.test.js')), true);
      assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'executed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
    ctx.paramAcceptanceResult = runAcceptanceFixture({
      sentinelName: 'restored-ms.txt',
      featureText: [
        'Feature: restored parameter fixture',
        '',
        '  Scenario Outline: restored continuation parameter is substituted',
        '    Then the restored timeout wait is <ms> ms and reaches the reconciled handler',
        '',
        '    Examples:',
        '      | ms  |',
        '      | 137 |',
        ''
      ].join('\n'),
      stepsModuleText: (sentinelPath) => `
'use strict';
const fs = require('fs');

function registerSteps(registry) {
  registry.define(/^the restored timeout wait is (\\d+) ms and reaches the reconciled handler$/, (_ctx, ms) => {
    fs.writeFileSync(${JSON.stringify(sentinelPath)}, ms, 'utf8');
  });
}

module.exports = { registerSteps };
`
    });
  });

  registry.define(/^the restored parameter reaches the step handler and its Examples column is referenced$/, (ctx) => {
    assert.match(ctx.featureText, /<ms>/);
    const gateResult = runLintGate(ctx.featurePath);
    assert.equal(gateResult.status, 0, `expected BL-131 to have no phantom <ms> column; stdout=${gateResult.stdout} stderr=${gateResult.stderr}`);
    const { tmpDir, result, sentinelPath } = ctx.paramAcceptanceResult;
    try {
      assert.equal(result.status, 0, `expected restored <ms> acceptance fixture to pass; stdout=${result.stdout} stderr=${result.stderr}`);
      assert.equal(fs.readFileSync(sentinelPath, 'utf8'), '137');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  registry.define(/^every legacy feature file has been rewrapped and removed from the allowlist$/, (ctx) => {
    ctx.allowlistEntries = legacyAllowlistEntries();
    assert.deepEqual(ctx.allowlistEntries, []);
  });

  registry.define(/^the allowlist holds no feature-file entries$/, (ctx) => {
    assert.deepEqual(ctx.allowlistEntries ?? legacyAllowlistEntries(), []);
  });

  registry.define(/^the lint gate enforces single-line steps for every feature file with no exemptions$/, () => {
    const tmpDir = makeTmpDir('bl520-');
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
