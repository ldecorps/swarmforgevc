'use strict';

// BL-1099: step handlers for retiring BL-303's superseded give-up cooldown
// scenario. Drives the pure helpers in
// specs/pipeline/scripts/bl1099GiveUpCooldownRetirement.js against the
// real on-disk feature / handler files, and re-runs BL-303 + BL-1088 via
// run_acceptance.sh (BL-112) so the surviving suites still pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  knownElapsed,
  knownProcessState,
  listScenarios,
  findScenarioCoveringCase,
  extractDefinePatternSources,
  orphanedRegistrations,
  hasScenarioNamed,
} = require('../scripts/bl1099GiveUpCooldownRetirement');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FEATURES_DIR = path.join(REPO_ROOT, 'specs', 'features');
const BL303_FEATURE = path.join(FEATURES_DIR, 'BL-303-supervisor-giveup-recovery.feature');
const BL1088_FEATURE = path.join(FEATURES_DIR, 'BL-1088-a-given-up-child-stays-down-for-its-whole-cooldown.feature');
const BL303_HANDLER = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'frontDeskSupervisorRecoverySteps.js');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');

const FEATURE =
  'One executable contract over the give-up cooldown decision, not two';

const RETIRED_SCENARIO = 're-armed only once the cooldown has passed';
const KEPT_SCENARIO = 'stays healthy long enough';

function readAllFeatureTexts() {
  return fs
    .readdirSync(FEATURES_DIR)
    .filter((f) => f.endsWith('.feature'))
    .map((f) => fs.readFileSync(path.join(FEATURES_DIR, f), 'utf8'));
}

function runAcceptance(featurePath) {
  const scratchRoot = path.join(REPO_ROOT, 'tmp');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(scratchRoot, 'bl1099-accept-'));
  try {
    const result = spawnSync('bash', [RUN_ACCEPTANCE, featurePath, outDir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    });
    return {
      status: result.status,
      output: `${result.stdout || ''}${result.stderr || ''}`,
    };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── retire-the-superseded-giveup-cooldown-scenario-01 ───────────────
  scoped(/^the BL-303 feature file$/, (ctx) => {
    ctx.bl303Text = fs.readFileSync(BL303_FEATURE, 'utf8');
  });

  scoped(/^its scenarios are listed$/, (ctx) => {
    ctx.bl303Scenarios = listScenarios(ctx.bl303Text);
  });

  scoped(/^the give-up cooldown scenario is absent$/, (ctx) => {
    assert.equal(
      hasScenarioNamed(ctx.bl303Text, RETIRED_SCENARIO),
      false,
      `expected the retired scenario to be gone, still present: ${JSON.stringify(ctx.bl303Scenarios.map((s) => s.name))}`
    );
  });

  scoped(/^the healthy-uptime attempt-count reset scenario is present$/, (ctx) => {
    assert.equal(
      hasScenarioNamed(ctx.bl303Text, KEPT_SCENARIO),
      true,
      `expected the healthy-uptime scenario to remain, got: ${JSON.stringify(ctx.bl303Scenarios.map((s) => s.name))}`
    );
  });

  // ── retire-the-superseded-giveup-cooldown-scenario-02 ───────────────
  scoped(
    /^a given-up child whose cooldown (has elapsed|has not elapsed) and whose recorded process is (dead|still alive)$/,
    (ctx, elapsed, processState) => {
      ctx.coverageCase = {
        elapsed: knownElapsed(elapsed),
        processState: knownProcessState(processState),
      };
    }
  );

  scoped(/^the repository's executable acceptance scenarios are searched for that case$/, (ctx) => {
    ctx.featureTexts = readAllFeatureTexts();
    ctx.coveringScenario = findScenarioCoveringCase(
      ctx.featureTexts,
      ctx.coverageCase.elapsed,
      ctx.coverageCase.processState
    );
  });

  scoped(/^at least one scenario asserts the supervisor's decision for it$/, (ctx) => {
    assert.ok(
      ctx.coveringScenario,
      `no scenario asserts the supervisor decision for cooldown ${ctx.coverageCase.elapsed} / process ${ctx.coverageCase.processState}`
    );
  });

  // ── retire-the-superseded-giveup-cooldown-scenario-03 ───────────────
  scoped(/^the step handlers registered for the BL-303 feature$/, (ctx) => {
    ctx.bl303HandlerSource = fs.readFileSync(BL303_HANDLER, 'utf8');
    ctx.bl303Patterns = extractDefinePatternSources(ctx.bl303HandlerSource);
  });

  scoped(/^the repository's feature files are searched for each registration's step text$/, (ctx) => {
    ctx.featureTexts = ctx.featureTexts || readAllFeatureTexts();
    ctx.orphans = orphanedRegistrations(ctx.bl303HandlerSource, ctx.featureTexts);
  });

  scoped(/^every remaining registration is referenced by at least one scenario$/, (ctx) => {
    assert.deepEqual(
      ctx.orphans,
      [],
      `BL-303 handler still registers steps no feature cites: ${JSON.stringify(ctx.orphans)} (patterns: ${JSON.stringify(ctx.bl303Patterns)})`
    );
  });

  // ── retire-the-superseded-giveup-cooldown-scenario-04 ───────────────
  scoped(/^the retirement has been applied$/, () => {
    // Structural: prior scenarios already proved absence + coverage. This
    // Given is the gate that the surviving suites are ready to re-run.
  });

  scoped(/^the BL-303 and BL-1088 acceptance features are run$/, (ctx) => {
    ctx.bl303Run = runAcceptance(BL303_FEATURE);
    ctx.bl1088Run = runAcceptance(BL1088_FEATURE);
  });

  scoped(/^both features pass with no scenario reported as missing a handler$/, (ctx) => {
    const missingHandler = /no step handler matched|missing a handler|unresolved step/i;
    for (const [label, run] of [
      ['BL-303', ctx.bl303Run],
      ['BL-1088', ctx.bl1088Run],
    ]) {
      assert.equal(run.status, 0, `${label} acceptance failed (status ${run.status}):\n${run.output}`);
      assert.equal(
        missingHandler.test(run.output),
        false,
        `${label} reported a missing handler:\n${run.output}`
      );
    }
  });
}

module.exports = { registerSteps };
