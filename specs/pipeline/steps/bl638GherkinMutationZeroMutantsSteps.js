'use strict';

// BL-638: step handlers for "a zero-mutant Gherkin mutation run never reads
// as a pass". Drives the REAL run_gherkin_mutation.sh wrapper (and, through
// it, the real vendored gherkin-mutator) against disposable copies of a
// synthetic outline-free fixture, the repo's own committed mutation-wiring
// fixture (a real Scenario Outline), and this ticket's own committed feature
// file (the "real corpus" scenario) - never a reimplementation of the
// wrapper's classification logic, which lives in gherkinMutationOutcome.js
// and has its own direct unit tests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WRAPPER = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_gherkin_mutation.sh');
const STEPS_MODULE = path.join(REPO_ROOT, 'specs', 'pipeline', 'test', 'fixtures', 'mutationWiringSteps.js');
const OUTLINE_FIXTURE = path.join(REPO_ROOT, 'specs', 'pipeline', 'test', 'fixtures', 'mutation-wiring.feature');
const REAL_CORPUS_FEATURE = path.join(
  REPO_ROOT,
  'specs',
  'features',
  'BL-638-gherkin-mutation-zero-mutants-reads-as-a-pass.feature'
);
const HARDENER_PROMPT = path.join(REPO_ROOT, 'swarmforge', 'roles', 'hardender.prompt');

const OUTLINE_FREE_FEATURE = [
  'Feature: BL-638 outline-free fixture (test-only, not a real ticket)',
  '',
  '  Scenario: a plain scenario with no example values',
  '    Given three items exist',
  '    Then the count is 3',
  '',
].join('\n');

const ADDED_OUTLINE = [
  '',
  '  Scenario Outline: an added example value is load-bearing',
  '    Given three items exist',
  '    Then the count is <count>',
  '',
  '    Examples:',
  '      | count |',
  '      | 3     |',
  '',
].join('\n');

function freshDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readManifest(featureText) {
  const lines = featureText.split('\n');
  const begin = lines.findIndex((l) => l.trim() === '# acceptance-mutation-manifest-begin');
  if (begin === -1) return null;
  const end = lines.findIndex((l, i) => i > begin && l.trim() === '# acceptance-mutation-manifest-end');
  const jsonLines = lines.slice(begin + 1, end).map((l) => l.replace(/^\s*#\s?/, ''));
  return JSON.parse(jsonLines.join(''));
}

function runWrapper(featurePath) {
  const workDir = freshDir('bl638-gm-work-');
  const result = spawnSync('bash', [WRAPPER, featurePath, workDir, STEPS_MODULE, 'soft'], { encoding: 'utf8' });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch (e) {
    report = null;
  }
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status, report };
}

function registerSteps(registry) {
  registry.define(/^a feature file with no Scenario Outline$/, (ctx) => {
    const dir = freshDir('bl638-gm-feature-');
    ctx.featurePath = path.join(dir, 'outline-free.feature');
    fs.writeFileSync(ctx.featurePath, OUTLINE_FREE_FEATURE);
  });

  registry.define(/^a feature file with at least one Scenario Outline$/, (ctx) => {
    const dir = freshDir('bl638-gm-feature-outline-');
    ctx.featurePath = path.join(dir, 'mutation-wiring.feature');
    fs.copyFileSync(OUTLINE_FIXTURE, ctx.featurePath);
  });

  registry.define(/^an outline-free feature file already committed under specs\/features\/$/, (ctx) => {
    const dir = freshDir('bl638-gm-real-corpus-');
    ctx.featurePath = path.join(dir, path.basename(REAL_CORPUS_FEATURE));
    fs.copyFileSync(REAL_CORPUS_FEATURE, ctx.featurePath);
  });

  registry.define(
    /^a feature file with no Scenario Outline that the mutation gate has already run against$/,
    (ctx) => {
      const dir = freshDir('bl638-gm-feature-prerun-');
      ctx.featurePath = path.join(dir, 'outline-free.feature');
      fs.writeFileSync(ctx.featurePath, OUTLINE_FREE_FEATURE);
      ctx.firstRun = runWrapper(ctx.featurePath);
    }
  );

  registry.define(/^its feature text is unchanged since that run$/, () => {
    // No-op: the Given step above already left the feature file untouched
    // by anything other than the mutation gate itself; this step only
    // documents the scenario's precondition.
  });

  registry.define(/^the mutation gate runs against it at the default level$/, (ctx) => {
    ctx.run = runWrapper(ctx.featurePath);
  });

  registry.define(/^the mutation gate runs against it again at the default level$/, (ctx) => {
    ctx.run = runWrapper(ctx.featurePath);
  });

  registry.define(/^a Scenario Outline is added to that feature file$/, (ctx) => {
    fs.appendFileSync(ctx.featurePath, ADDED_OUTLINE);
  });

  registry.define(/^the outcome is reported as inapplicable, not as a pass$/, (ctx) => {
    if (!ctx.run || !ctx.run.report) {
      throw new Error(
        `expected a parseable JSON report; got exit=${ctx.run && ctx.run.exitCode} stdout=${ctx.run && ctx.run.stdout} stderr=${ctx.run && ctx.run.stderr}`
      );
    }
    if (ctx.run.report.outcome !== 'inapplicable') {
      throw new Error(`expected outcome "inapplicable", got: ${JSON.stringify(ctx.run.report)}`);
    }
  });

  registry.define(/^the exit status is distinguishable from a clean sweep with survivors killed$/, (ctx) => {
    if (ctx.run.exitCode === 0) {
      throw new Error('expected a non-zero, distinguishable exit code for an inapplicable run; got 0 (a real pass\'s exit code)');
    }
  });

  registry.define(/^the second run's outcome matches the first run's outcome$/, (ctx) => {
    if (!ctx.firstRun || !ctx.firstRun.report) {
      throw new Error('expected a first run to have been recorded by the earlier Given step');
    }
    if (ctx.firstRun.report.outcome !== ctx.run.report.outcome || ctx.firstRun.exitCode !== ctx.run.exitCode) {
      throw new Error(
        `expected the second run to match the first: first=${JSON.stringify({ outcome: ctx.firstRun.report.outcome, exitCode: ctx.firstRun.exitCode })}, second=${JSON.stringify({ outcome: ctx.run.report.outcome, exitCode: ctx.run.exitCode })}`
      );
    }
  });

  registry.define(/^mutants are generated from its Examples-table cells$/, (ctx) => {
    if (!ctx.run.report || !(ctx.run.report.summary.Total > 0)) {
      throw new Error(`expected Total > 0; got: ${JSON.stringify(ctx.run.report)}`);
    }
  });

  registry.define(/^the outcome is reported as a normal pass or fail, with no new friction$/, (ctx) => {
    if (!['pass', 'fail'].includes(ctx.run.report.outcome)) {
      throw new Error(`expected outcome "pass" or "fail", got: ${JSON.stringify(ctx.run.report.outcome)}`);
    }
  });

  registry.define(
    /^the manifest does not record an empty scenario list beside an unknown implementation hash as if it were a success$/,
    (ctx) => {
      const manifest = readManifest(fs.readFileSync(ctx.featurePath, 'utf8'));
      const looksLikeSilentSuccess =
        manifest &&
        Array.isArray(manifest.scenarios) &&
        manifest.scenarios.length === 0 &&
        manifest.implementation_hash === 'unknown' &&
        manifest.outcome !== 'inapplicable';
      if (looksLikeSilentSuccess) {
        throw new Error(`manifest reads as a silent success with nothing proved: ${JSON.stringify(manifest)}`);
      }
    }
  );

  registry.define(/^the manifest marks the run inapplicable$/, (ctx) => {
    const manifest = readManifest(fs.readFileSync(ctx.featurePath, 'utf8'));
    if (!manifest || manifest.outcome !== 'inapplicable') {
      throw new Error(`expected the embedded manifest to record outcome "inapplicable", got: ${JSON.stringify(manifest)}`);
    }
  });

  registry.define(/^the hardener role prompt$/, (ctx) => {
    ctx.hardenerPromptText = fs.readFileSync(HARDENER_PROMPT, 'utf8');
  });

  registry.define(/^a mutation gate reports an inapplicable outcome for a parcel's code$/, () => {
    // No-op: the Given step above already loaded the prompt text; this step
    // names the scenario the prompt's fallback text must address.
  });

  registry.define(/^the prompt names the fallback action to take instead of silently treating it as passed$/, (ctx) => {
    if (/skip it, nothing to run/.test(ctx.hardenerPromptText)) {
      throw new Error('hardender.prompt still says "skip it, nothing to run" with no stated fallback');
    }
    if (!/inapplicable/.test(ctx.hardenerPromptText)) {
      throw new Error('hardender.prompt does not name the "inapplicable" outcome at all');
    }
  });

  registry.define(/^the outcome is reported as inapplicable, matching scenario 01$/, (ctx) => {
    if (!ctx.run.report || ctx.run.report.outcome !== 'inapplicable') {
      throw new Error(`expected outcome "inapplicable" for the real corpus fixture, got: ${JSON.stringify(ctx.run.report)}`);
    }
  });

  registry.define(/^mutants are actually generated on that run$/, (ctx) => {
    if (!ctx.run.report || !(ctx.run.report.summary.Total > 0)) {
      throw new Error(`expected Total > 0 after adding a Scenario Outline; got: ${JSON.stringify(ctx.run.report)}`);
    }
  });
}

module.exports = { registerSteps };
