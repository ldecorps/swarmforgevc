'use strict';

// BL-113: proves gherkin-mutator (vendored, pinned APS ref) is wired into
// the real feature -> base IR -> mutator -> mutated IRs -> runs chain via
// run_gherkin_mutation.sh + mutationWorker.js - driving the real bb
// subprocess and the real generate.js/runnerAdapter.js pipeline, never a
// reimplementation of mutation.clj's own logic.
//
// The fixture is copied into a fresh temp dir before every run: the tool
// writes its mutation manifest/stamp back into the feature file it ran
// against (BL-113's own "mutation manifests are tool-owned" gate), so
// running it against the COMMITTED fixture in place would leave stale,
// run-specific metadata in the repo on every test run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'run_gherkin_mutation.sh');
const FIXTURE_FEATURE = path.join(__dirname, 'fixtures', 'mutation-wiring.feature');
const STEPS_MODULE = path.join(__dirname, 'fixtures', 'mutationWiringSteps.js');

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-fixture-'));
  const featurePath = path.join(dir, 'mutation-wiring.feature');
  fs.copyFileSync(FIXTURE_FEATURE, featurePath);
  return featurePath;
}

function runMutation(featurePath, workDir, level) {
  return spawnSync('bash', [SCRIPT, featurePath, workDir, STEPS_MODULE, level || 'full'], { encoding: 'utf8' });
}

test('BL-113 gherkin-mutation-01: a mutant that changes asserted, load-bearing example data is reported killed', () => {
  const featurePath = copyFixture();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-work-'));
  try {
    const result = runMutation(featurePath, workDir, 'full');
    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.Total, 2, result.stdout + result.stderr);
    assert.equal(report.summary.Killed, 1);
    const killed = report.results.find((r) => r.Status === 'killed');
    assert.ok(killed, `expected one killed mutant; got: ${JSON.stringify(report.results)}`);
    // scenario 0 ("an asserted example value is load-bearing") is the
    // load-bearing one in this fixture.
    assert.match(killed.Mutation.Path, /^\$\.scenarios\[0\]/);
    assert.ok(killed.Mutation.Original, 'the original backend value must be attached');
    assert.ok(killed.Mutation.Mutated, 'the mutated value must be attached');
  } finally {
    fs.rmSync(path.dirname(featurePath), { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('BL-113 gherkin-mutation-02: a mutant whose example value is never asserted is reported surviving, naming the scenario and mutated value', () => {
  const featurePath = copyFixture();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-work-'));
  try {
    const result = runMutation(featurePath, workDir, 'full');
    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.Survived, 1, result.stdout + result.stderr);
    const survived = report.results.find((r) => r.Status === 'survived');
    assert.ok(survived, `expected one surviving mutant; got: ${JSON.stringify(report.results)}`);
    // scenario 1 ("an unused example value is not load-bearing") is the
    // non-load-bearing one in this fixture - the mutation's own Path
    // names exactly which scenario/example it came from.
    assert.match(survived.Mutation.Path, /^\$\.scenarios\[1\]\.examples\[0\]\.count$/);
    assert.match(survived.Mutation.Description, /count: 3 -> -?\d+/);
  } finally {
    fs.rmSync(path.dirname(featurePath), { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('BL-113 gherkin-mutation-03: a mutation run over multiple mutants emits progress/status output distinguishing it from a hang', () => {
  const featurePath = copyFixture();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-work-'));
  try {
    const result = runMutation(featurePath, workDir, 'full');
    // gherkin-mutator prints a status line before starting (0 completed)
    // and one after finishing (final counts) whenever --status-interval is
    // nonzero - proving the run is live/progressing, not silent, even
    // before any mutant has finished.
    const statusLines = result.stderr.split('\n').filter((line) => line.startsWith('status '));
    assert.ok(statusLines.length >= 2, `expected at least a start and end status line; got stderr:\n${result.stderr}`);
    assert.match(statusLines[0], /total=2 completed=0/);
    assert.match(statusLines[statusLines.length - 1], /completed=2/);
  } finally {
    fs.rmSync(path.dirname(featurePath), { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('a soft-level run writes a mutation manifest back into the feature file (tool-owned, never hand-edited)', () => {
  const featurePath = copyFixture();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-work-'));
  try {
    runMutation(featurePath, workDir, 'soft');
    const content = fs.readFileSync(featurePath, 'utf8');
    assert.match(content, /# acceptance-mutation-manifest-begin/);
    assert.match(content, /# acceptance-mutation-manifest-end/);
  } finally {
    fs.rmSync(path.dirname(featurePath), { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
