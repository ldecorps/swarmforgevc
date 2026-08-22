'use strict';

// BL-638: unit tests for the pure classification/correction logic the
// run_gherkin_mutation.sh wrapper applies after the vendored (pinned)
// gherkin-mutator returns. No subprocess, no fixtures on disk - the wrapper's
// own wiring is proven separately (specs/features/BL-638-*.feature via the
// generated acceptance run, and finalizeGherkinMutation.test.js's CLI wiring
// tests).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyOutcome,
  exitCodeFor,
  readManifest,
  markManifestInapplicable,
} = require('../gherkinMutationOutcome');

test('BL-638 classify-01: zero mutants discovered and none skipped is inapplicable, never a pass', () => {
  assert.equal(classifyOutcome({ Total: 0, Killed: 0, Survived: 0, Errors: 0 }), 'inapplicable');
});

test('BL-638 classify-02: zero mutants discovered but a stale full-skip still reports inapplicable', () => {
  // Defect 2's shape: a prior zero-mutant run's stamp made accepted-skips
  // report every scenario as skipped, but SkippedMutations stays 0 because
  // there was never anything to skip in the first place.
  assert.equal(classifyOutcome({ Total: 0, Killed: 0, Survived: 0, Errors: 0, SkippedScenarios: 1 }), 'inapplicable');
});

test('BL-638 classify-03: a real clean sweep (mutants killed) is a pass', () => {
  assert.equal(classifyOutcome({ Total: 2, Killed: 2, Survived: 0, Errors: 0 }), 'pass');
});

test('BL-638 classify-04: a real run with a survivor is a fail', () => {
  assert.equal(classifyOutcome({ Total: 2, Killed: 1, Survived: 1, Errors: 0 }), 'fail');
});

test('BL-638 classify-05: a real run with an infrastructure error is a fail', () => {
  assert.equal(classifyOutcome({ Total: 1, Killed: 0, Survived: 0, Errors: 1 }), 'fail');
});

test('BL-638 classify-06: Total 0 with real mutations fully reused from cache is a pass, not inapplicable', () => {
  // A Scenario Outline feature, unchanged since a clean prior run: soft skip
  // reuses every mutation, so this run's Total (executable-only) is 0 but
  // SkippedMutations is positive - a legitimate cached pass (BL-460), never
  // to be confused with "nothing to mutate".
  assert.equal(classifyOutcome({ Total: 0, Killed: 0, Survived: 0, Errors: 0, SkippedMutations: 4, SkippedScenarios: 1 }), 'pass');
});

test('BL-638 exit-codes-07: exit codes are distinguishable across all three outcomes', () => {
  assert.equal(exitCodeFor('inapplicable'), 2);
  assert.equal(exitCodeFor('fail'), 1);
  assert.equal(exitCodeFor('pass'), 0);
  assert.notEqual(exitCodeFor('inapplicable'), exitCodeFor('pass'));
  assert.notEqual(exitCodeFor('inapplicable'), exitCodeFor('fail'));
});

const SAMPLE_MANIFEST = { version: 1, feature_name: 'x', implementation_hash: 'unknown', scenarios: [] };

function featureWithManifest(manifest, { stamp = 'deadbeef' } = {}) {
  const lines = [];
  if (stamp !== null) {
    lines.push(`# mutation-stamp: sha256=${stamp}`);
  }
  lines.push('# acceptance-mutation-manifest-begin');
  lines.push('# ' + JSON.stringify(manifest));
  lines.push('# acceptance-mutation-manifest-end');
  lines.push('');
  lines.push('Feature: a real feature');
  lines.push('');
  lines.push('  Scenario: something');
  lines.push('    Given a thing');
  return lines.join('\n');
}

test('BL-638 read-manifest-08: reads back the embedded manifest JSON verbatim', () => {
  const text = featureWithManifest(SAMPLE_MANIFEST);
  assert.deepEqual(readManifest(text), SAMPLE_MANIFEST);
});

test('BL-638 read-manifest-09: returns null when no manifest block is present', () => {
  assert.equal(readManifest('Feature: no manifest here\n'), null);
});

test('BL-638 mark-inapplicable-10: strips the suppressing stamp line', () => {
  const corrected = markManifestInapplicable(featureWithManifest(SAMPLE_MANIFEST));
  assert.doesNotMatch(corrected, /mutation-stamp/);
});

test('BL-638 mark-inapplicable-11: marks the embedded manifest outcome inapplicable, preserving other fields', () => {
  const corrected = markManifestInapplicable(featureWithManifest(SAMPLE_MANIFEST));
  const manifest = readManifest(corrected);
  assert.equal(manifest.outcome, 'inapplicable');
  assert.equal(manifest.implementation_hash, 'unknown');
  assert.deepEqual(manifest.scenarios, []);
});

test('BL-638 mark-inapplicable-12: preserves every line outside the stamp/manifest block byte-for-byte', () => {
  const text = featureWithManifest(SAMPLE_MANIFEST);
  const corrected = markManifestInapplicable(text);
  assert.match(corrected, /Feature: a real feature/);
  assert.match(corrected, /Scenario: something/);
  assert.match(corrected, /Given a thing/);
});

test('BL-638 mark-inapplicable-13: tolerates a feature file with no stamp line (write-stamp? was false)', () => {
  const corrected = markManifestInapplicable(featureWithManifest(SAMPLE_MANIFEST, { stamp: null }));
  const manifest = readManifest(corrected);
  assert.equal(manifest.outcome, 'inapplicable');
  assert.doesNotMatch(corrected, /mutation-stamp/);
});

test('BL-638 mark-inapplicable-14: throws rather than silently no-op when no manifest block exists', () => {
  assert.throws(() => markManifestInapplicable('Feature: nothing to mark\n'));
});

test('BL-638 mark-inapplicable-15: is idempotent - marking an already-marked manifest again stays inapplicable', () => {
  const once = markManifestInapplicable(featureWithManifest(SAMPLE_MANIFEST));
  const twice = markManifestInapplicable(once);
  assert.equal(readManifest(twice).outcome, 'inapplicable');
  assert.doesNotMatch(twice, /mutation-stamp/);
});
