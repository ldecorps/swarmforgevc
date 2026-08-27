'use strict';

// BL-884: step handlers for the "Gherkin mutation runner rejects bad
// arguments before any mutant runs" feature. Spawns the real
// run_gherkin_mutation.sh (never a reimplementation of its validation) -
// specs/pipeline/test/ is run by no standing gate, so the extension/test/
// unit + property tests and this acceptance feature are the only gates on
// this behavior (shell has no mutation/CRAP/DRY wiring, BL-472 deferred).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const PIPELINE_DIR = path.join(__dirname, '..');
const SCRIPT = path.join(PIPELINE_DIR, 'scripts', 'run_gherkin_mutation.sh');
const REAL_STEPS_MODULE = path.join(PIPELINE_DIR, 'steps', 'index.js');

function runScript(featurePath, workDir, stepsModule, level) {
  const result = spawnSync('bash', [SCRIPT, featurePath, workDir, stepsModule, level], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// Distinguishes the runner's OWN rejection error from its always-present
// usage line, which mentions both "[steps-module-path]" and "[level]" in
// every rejection's stderr regardless of which argument was actually bad -
// a naive substring check on "level" or "steps-module" alone would pass
// trivially off the usage line and never really exercise the assertion.
const NAMES_STEPS_MODULE = 'steps-module path';
const NAMES_LEVEL = 'must be one of full, hard, soft';

function registerSteps(registry) {
  registry.define(/^a scratch work directory for a gherkin mutation run$/, (ctx) => {
    ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl884-'));
    ctx.workDir = path.join(ctx.dir, 'work');
    ctx.featurePath = path.join(ctx.dir, 'fixture.feature');
    fs.writeFileSync(
      ctx.featurePath,
      'Feature: BL-884 acceptance fixture\n\n  Scenario: a plain scenario with no outline\n    Given a fixture\n'
    );
  });

  registry.define(/^the gherkin mutation runner is invoked with the (steps-module|level) argument set to "([^"]*)"$/, (ctx, slot, badValue) => {
    const stepsModule = slot === 'steps-module' ? path.join(ctx.dir, badValue) : REAL_STEPS_MODULE;
    const level = slot === 'level' ? badValue : 'soft';
    ctx.result = runScript(ctx.featurePath, ctx.workDir, stepsModule, level);
    ctx.slot = slot;
  });

  registry.define(/^the runner exits non-zero naming the (steps-module|level) argument$/, (ctx, slot) => {
    if (ctx.result.status === 0) {
      throw new Error(`expected a non-zero exit; got 0. stderr=${ctx.result.stderr}`);
    }
    const expectedFragment = slot === 'steps-module' ? NAMES_STEPS_MODULE : NAMES_LEVEL;
    if (!ctx.result.stderr.includes(expectedFragment)) {
      throw new Error(`expected stderr to name the ${slot} argument (fragment "${expectedFragment}"); got: ${ctx.result.stderr}`);
    }
  });

  registry.define(/^no mutation manifest is written under the work directory$/, (ctx) => {
    if (fs.existsSync(ctx.workDir)) {
      throw new Error(`expected no work dir/manifest to be written; found: ${ctx.workDir}`);
    }
  });

  registry.define(/^the gherkin mutation runner is invoked with all four positionals valid$/, (ctx) => {
    ctx.result = runScript(ctx.featurePath, ctx.workDir, REAL_STEPS_MODULE, 'soft');
  });

  registry.define(/^the runner exit code is one of the established codes 0, 1, or 2$/, (ctx) => {
    if (![0, 1, 2].includes(ctx.result.status)) {
      throw new Error(`expected exit code 0, 1, or 2; got ${ctx.result.status}. stderr=${ctx.result.stderr}`);
    }
  });
}

module.exports = { registerSteps };
