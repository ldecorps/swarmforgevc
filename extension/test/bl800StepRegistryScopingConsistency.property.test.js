'use strict';

// BL-800 declared invariant (backlog/active/BL-800-bl623-acceptance-false-
// fails-under-full-step-registry.yaml): "For BL-623's feature, the focused
// entry point (specs/pipeline/steps/bl623Only.js) and the full registry
// (specs/pipeline/steps/index.js) resolve every step of every scenario to
// the same handler."
//
// Function-reference equality is meaningless here: steps/index.js and
// bl623Only.js each build an INDEPENDENT registry instance by calling
// bl623RoutingSkipTrailSteps.js's registerSteps() separately, and every
// call re-creates fresh arrow-function closures - even before this
// ticket's fix, the two resolved handlers would never have been reference-
// equal. What the invariant actually means is SOURCE equality:
// Function.prototype.toString() is byte-identical iff the handler resolved
// under each entry point is literally the same arrow-function literal in
// bl623RoutingSkipTrailSteps.js, never a DIFFERENT registration's handler
// shadowing it - exactly the BL-606-shadows-BL-623 failure mode this
// ticket's commit fixed (scoping BL-623's colliding registration via
// registry.defineScoped, pinned to its own Feature: title).
//
// Reuse, never reimplement (mirrors BL-761's own rule, acceptanceContract
// Gate.property.test.js's identical header note): the domain is built from
// the REAL BL-623 feature file via runnerAdapter.js's parseFeatureFile
// (the same vendored gherkin-parser the production CLI uses) and walked
// with resolve_contract_steps.js's own exampleCases plus runtime.js's
// scenarioSteps/substitute - never a second, hand-rolled IR walk.
//
// Generator reach: BL-623's real feature (7 scenarios, no Scenario
// Outlines) is this invariant's own finite domain - no wider space exists
// to sample from, there is one real feature file. numRuns is a large
// multiple of the domain size so fast-check's constantFrom covers every
// step with overwhelming probability (same reachability-floor reasoning as
// bl643NonPipelineAgentPaths.property.test.js's own precedent).
//
// Prerequisite: `npm run compile` first - the full registry
// (specs/pipeline/steps/index.js) requires extension/out/, the same
// prerequisite this ticket's own e2e QA procedure step 1 states.

const assert = require('node:assert/strict');
const path = require('node:path');
const fc = require('fast-check');
const { createStepRegistry } = require('../../specs/pipeline/stepRegistry');
const { scenarioSteps, substitute } = require('../../specs/pipeline/runtime');
const { exampleCases } = require('../../specs/pipeline/scripts/resolve_contract_steps');
const { parseFeatureFile } = require('../../specs/pipeline/runnerAdapter');
const { registerSteps: registerFullSteps } = require('../../specs/pipeline/steps/index');
const { registerSteps: registerFocusedSteps } = require('../../specs/pipeline/steps/bl623Only');

const FEATURE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'specs',
  'features',
  'BL-623-routing-skip-trail-records-actual-hop.feature'
);
const FEATURE_NAME = 'The routing skip trail records what a hop actually skipped';

function buildDomain(feature) {
  const domain = [];
  for (const scenario of feature.scenarios) {
    for (const { exampleIndex, row } of exampleCases(scenario)) {
      for (const step of scenarioSteps(feature, scenario)) {
        domain.push({ scenario: scenario.name, exampleIndex, stepText: substitute(step.text, row) });
      }
    }
  }
  return domain;
}

function buildRegistries() {
  const full = createStepRegistry();
  registerFullSteps(full);
  const focused = createStepRegistry();
  registerFocusedSteps(focused);
  return { full, focused };
}

test(
  'property: every BL-623 step resolves to the same handler under the full registry and the focused entry point',
  () => {
    const feature = parseFeatureFile(FEATURE_PATH);
    const domain = buildDomain(feature);
    assert.ok(domain.length > 0, 'fixture assumption broken: expected BL-623 to have at least one step');
    const { full, focused } = buildRegistries();

    fc.assert(
      fc.property(fc.constantFrom(...domain), (entry) => {
        const fromFull = full.resolve(entry.stepText, feature.name);
        const fromFocused = focused.resolve(entry.stepText, feature.name);
        assert.ok(fromFull, `scenario "${entry.scenario}": full registry did not resolve "${entry.stepText}"`);
        assert.ok(fromFocused, `scenario "${entry.scenario}": focused registry did not resolve "${entry.stepText}"`);
        assert.equal(
          fromFull.handler.toString(),
          fromFocused.handler.toString(),
          `scenario "${entry.scenario}": "${entry.stepText}" resolved to a DIFFERENT handler under the ` +
            'full registry than under the focused entry point - a shadowing collision (BL-800)'
        );
      }),
      { numRuns: domain.length * 10 }
    );
  },
  30000
);

test("property: the checker is non-vacuous - it catches BL-606 shadowing BL-623's own \"delivered to QA\" step", () => {
  // Reconstructs the PRE-FIX shape exactly: BL-606's real unscoped generic
  // pattern (copied from bl606RequiredStagesRoutingSteps.js's own source,
  // asserting on ctx.bounceHandoff) registered FIRST - as steps/index.js's
  // own DOMAINS order still loads it before BL-623's file - and BL-623's
  // own step registered UNSCOPED, as it was before this ticket's fix,
  // rather than via defineScoped. Never touches the real (now-fixed)
  // files; a self-contained fixture registry only.
  const brokenFull = createStepRegistry();
  brokenFull.define(/^the parcel is delivered to (.+)$/, (ctx, expected) => {
    if (ctx.bounceHandoff.to !== expected) {
      throw new Error(`expected the bounce to be delivered to ${expected}, got ${ctx.bounceHandoff.to}`);
    }
  });
  brokenFull.define(/^the parcel is delivered to QA$/, (ctx) => {
    if (ctx.lastHandoff.to !== 'QA') {
      throw new Error(`expected delivery to QA, got ${ctx.lastHandoff.to}`);
    }
  });

  const focused = createStepRegistry();
  registerFocusedSteps(focused);

  const fromBrokenFull = brokenFull.resolve('the parcel is delivered to QA', FEATURE_NAME);
  const fromFocused = focused.resolve('the parcel is delivered to QA', FEATURE_NAME);
  assert.ok(fromBrokenFull, 'fixture assumption broken: expected the broken full registry to resolve the step');
  assert.ok(fromFocused, 'fixture assumption broken: expected the focused registry to resolve the step');
  assert.notEqual(
    fromBrokenFull.handler.toString(),
    fromFocused.handler.toString(),
    'the non-vacuity fixture did not reproduce the BL-606-shadows-BL-623 mismatch - the property test above ' +
      'would be vacuously true'
  );
});
