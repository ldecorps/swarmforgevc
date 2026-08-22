'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  classifyOutcome,
  markManifestInapplicable,
  readManifest,
} = require('../../specs/pipeline/gherkinMutationOutcome');

// BL-638 declared invariant (property authorship rests with the coder, first
// pass - BL-654): "A mutation run that generated zero mutants never reports a
// pass and never stamps the feature as covered - for any feature shape."
//
// The vendored, pinned gherkin-mutator (swarmforge/vendor/aps) is out of
// scope to modify, so this module - and this property - own the boundary at
// the JSON-report/feature-file layer, the only layer BL-638 is allowed to
// touch. "Feature shape" reduces to two independently-controllable axes at
// that boundary, and both are exercised here without relying on fast-check's
// random sampling for the boundary itself (only the incidental values on
// each side of it are fuzzed):
//
//   1. classifyOutcome: the axis is "how many mutants did `discover` ever
//      find for this feature" - reduced to Total+SkippedMutations. Both
//      sides of the zero/nonzero boundary are asserted directly (never
//      inferred from a single generator), so a broken implementation that
//      collapses the two cases cannot pass by chance.
//   2. markManifestInapplicable: the axis is the surrounding feature text
//      (scenario count/content) and the manifest's own shape (arbitrary
//      extra keys) - fuzzed directly, since the correction must hold
//      regardless of what a real feature file happens to contain around the
//      metadata block.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

test('BL-638 property (invariant, half 1): zero mutants ever discovered (Total=0 and SkippedMutations=0) is always inapplicable, never a pass, regardless of every other summary field', () => {
  fc.assert(
    fc.property(
      fc.record({
        Killed: fc.nat(5),
        Survived: fc.nat(5),
        Errors: fc.nat(5),
        SkippedScenarios: fc.nat(5),
      }),
      (extra) => {
        const summary = { Total: 0, SkippedMutations: 0, ...extra };
        const outcome = classifyOutcome(summary);
        assert.equal(
          outcome,
          'inapplicable',
          `zero mutants discovered must read as inapplicable, not "${outcome}", for summary ${JSON.stringify(summary)}`
        );
      }
    ),
    { numRuns: 200 }
  );
});

test('BL-638 property (invariant, half 1 - negative side): whenever real mutants were ever discovered (Total>0 or SkippedMutations>0) and none survived or errored, the outcome is a genuine pass, never inapplicable', () => {
  // The negative side matters as much as the positive one: a broken
  // implementation that reads ONLY `Total === 0` (ignoring SkippedMutations)
  // would wrongly call a fully soft-cached, previously-clean Scenario
  // Outline feature "inapplicable" - exactly the BL-460 legitimate-skip
  // shape this fix must never touch.
  fc.assert(
    fc.property(
      fc.oneof(
        fc.record({ total: fc.integer({ min: 1, max: 50 }), skippedMutations: fc.nat(20) }),
        fc.record({ total: fc.constant(0), skippedMutations: fc.integer({ min: 1, max: 50 }) })
      ),
      ({ total, skippedMutations }) => {
        const summary = { Total: total, Killed: total, Survived: 0, Errors: 0, SkippedMutations: skippedMutations };
        const outcome = classifyOutcome(summary);
        assert.equal(
          outcome,
          'pass',
          `real mutants with no survivors/errors must read as a pass, not "${outcome}", for summary ${JSON.stringify(summary)}`
        );
      }
    ),
    { numRuns: 200 }
  );
});

const manifestExtraArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean(), fc.constant(null))
);
const stampArb = fc.option(fc.stringMatching(/^[0-9a-f]{8,64}$/), { nil: null });
const featureLineArb = fc
  .string({ maxLength: 40 })
  .filter((s) => !s.includes('mutation-stamp') && !s.includes('acceptance-mutation-manifest'));

function buildFeatureText(manifest, stamp, suffixLines) {
  const lines = [];
  if (stamp !== null) {
    lines.push(`# mutation-stamp: sha256=${stamp}`);
  }
  lines.push('# acceptance-mutation-manifest-begin');
  lines.push('# ' + JSON.stringify(manifest));
  lines.push('# acceptance-mutation-manifest-end');
  lines.push('');
  lines.push(...suffixLines);
  return lines.join('\n');
}

test('BL-638 property (invariant, half 2): correcting an inapplicable run always strips the suppressing stamp and marks the manifest, for any manifest shape or surrounding feature content', () => {
  fc.assert(
    fc.property(manifestExtraArb, stampArb, fc.array(featureLineArb, { maxLength: 8 }), (manifestExtra, stamp, suffixLines) => {
      const manifest = { version: 1, implementation_hash: 'unknown', scenarios: [], ...manifestExtra };
      const text = buildFeatureText(manifest, stamp, suffixLines);

      const corrected = markManifestInapplicable(text);

      assert.doesNotMatch(corrected, /mutation-stamp/, 'a corrected feature file must never keep a suppressing stamp line');
      const readBack = readManifest(corrected);
      assert.equal(readBack.outcome, 'inapplicable', 'the embedded manifest must record outcome "inapplicable"');
      for (const line of suffixLines) {
        if (line.length > 0) {
          assert.ok(corrected.includes(line), `surrounding feature content must be preserved verbatim: missing "${line}"`);
        }
      }
    }),
    { numRuns: 150 }
  );
});
