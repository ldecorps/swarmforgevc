'use strict';

// BL-113: step handlers for the APS-stage3-gherkin-mutation feature.
// Drives the real gherkin-mutator (vendored, pinned APS ref) through
// run_gherkin_mutation.sh + mutationWorker.js against the test-only
// mutation-wiring fixture (specs/pipeline/test/fixtures/) - a real bb
// subprocess and the real generate.js/runnerAdapter.js chain, never a
// reimplementation of the tool's own mutation/reporting logic.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const PIPELINE_DIR = path.join(__dirname, '..');
const SCRIPT = path.join(PIPELINE_DIR, 'scripts', 'run_gherkin_mutation.sh');
const FIXTURE_FEATURE = path.join(PIPELINE_DIR, 'test', 'fixtures', 'mutation-wiring.feature');
const STEPS_MODULE = path.join(PIPELINE_DIR, 'test', 'fixtures', 'mutationWiringSteps.js');

// The tool writes its mutation manifest/stamp back into the feature file it
// runs against - copy into a fresh temp dir every time so the committed
// fixture is never mutated by an acceptance run (same reasoning as
// gherkinMutation.test.js).
function copyFixtureAndRun(ctx, level) {
  if (ctx.report) {
    return ctx.report;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-gherkin-mutation-steps-'));
  const featurePath = path.join(dir, 'mutation-wiring.feature');
  fs.copyFileSync(FIXTURE_FEATURE, featurePath);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-gherkin-mutation-work-'));
  const result = spawnSync('bash', [SCRIPT, featurePath, workDir, STEPS_MODULE, level || 'full'], { encoding: 'utf8' });
  ctx.rawStdout = result.stdout;
  ctx.rawStderr = result.stderr;
  ctx.report = JSON.parse(result.stdout);
  return ctx.report;
}

function registerSteps(registry) {
  // ── gherkin-mutation-01 ──────────────────────────────────────────────
  registry.define(/^a feature file whose example values drive the system under test$/, () => {
    // Non-behavioral: the fixture itself is the "Given" - nothing to set up.
  });

  registry.define(/^gherkin-mutator produces mutated IRs and the runs execute$/, (ctx) => {
    copyFixtureAndRun(ctx, 'full');
  });

  registry.define(/^each mutant that changes observable behavior is reported caught$/, (ctx) => {
    const killed = ctx.report.results.filter((r) => r.Status === 'killed');
    if (killed.length === 0) {
      throw new Error(`expected at least one killed mutant (load-bearing example data); got: ${ctx.rawStdout}`);
    }
  });

  // ── gherkin-mutation-02 ──────────────────────────────────────────────
  registry.define(/^a scenario whose example value is not actually asserted anywhere$/, () => {
    // Non-behavioral: the fixture's second scenario is exactly this case.
  });

  registry.define(/^its mutated IR run executes$/, (ctx) => {
    copyFixtureAndRun(ctx, 'full');
  });

  registry.define(/^the run reports that mutant as surviving, naming the scenario and the mutated value$/, (ctx) => {
    const survived = ctx.report.results.find((r) => r.Status === 'survived');
    if (!survived) {
      throw new Error(`expected a surviving mutant; got: ${ctx.rawStdout}`);
    }
    if (!/^\$\.scenarios\[\d+\]\.examples\[\d+\]\./.test(survived.Mutation.Path)) {
      throw new Error(`expected the surviving mutant's Path to name its scenario/example; got: ${survived.Mutation.Path}`);
    }
    if (!survived.Mutation.Mutated) {
      throw new Error('expected the surviving mutant to name its mutated value');
    }
  });

  // ── gherkin-mutation-03 ──────────────────────────────────────────────
  registry.define(/^a Gherkin mutation run over multiple mutants$/, (ctx) => {
    copyFixtureAndRun(ctx, 'full');
  });

  registry.define(/^periodic progress\/status output is emitted$/, (ctx) => {
    const statusLines = ctx.rawStderr.split('\n').filter((line) => line.startsWith('status '));
    if (statusLines.length < 2) {
      throw new Error(`expected at least a start and end status line; got stderr:\n${ctx.rawStderr}`);
    }
  });
}

module.exports = { registerSteps };
