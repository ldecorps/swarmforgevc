'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  assessUnreachableStepHandlers,
  UNREACHABLE_STEP_HANDLER_REFUSAL,
} = require('../out/tools/unreachableStepHandlerCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

// BL-753 declared invariant 1 (backlog/active/BL-753-...yaml):
// "A registered step pattern in a run-touched specs/pipeline/steps/*.js file
// that matches no rendered step of the ticket's acceptance feature refuses
// land with reasonKind unreachable-step-handler — never silently treated as
// cosmetic."
//
// Encoded here on the pure assessor + the landPilotedTicket refuse path.
// Invariants 2–3 are prompt guidance (unit-asserted; no property required).
//
// Coder-authored per BL-654; runs only via npm run test:properties
// (vitest.properties.config.mjs — uses Vitest's global `test`, not node:test).

const FEATURE_NAME =
  'Unreachable acceptance step handlers are untested-behavior flags on /pilot land and in review prompts';

const stepWordArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,12}$/);

function pairedStepFile(patternSource, featureName = FEATURE_NAME) {
  return {
    path: 'specs/pipeline/steps/bl753PropFixtureSteps.js',
    text:
      `const FEATURE = ${JSON.stringify(featureName)};\n` +
      `scoped(registry, ${patternSource}, () => {});\n`,
  };
}

function mkGateDeps(unreachableOutcome) {
  const calls = { move: 0, receipt: 0 };
  let executedFeaturePath;
  return {
    calls,
    deps: {
      readAcceptanceDeclaration: () => 'specs/features/fixture.feature',
      resolveFeatureFilePath: () => '/repo/specs/features/fixture.feature',
      isLifecycleTeardownTicket: () => false,
      assessMultiworktreeFixture: () => ({
        satisfied: true,
        metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: '/repo' },
      }),
      runAcceptance: async () => ({ success: true, output: 'ok' }),
      recordAcceptanceExecution: (featureFilePath) => {
        executedFeaturePath = featureFilePath;
      },
      readAcceptanceExecution: () => executedFeaturePath,
      checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
      checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
      checkShellEntryPointDrive: () => ({
        checked: true,
        shellTestsScanned: 0,
        entryPointsNamed: 0,
      }),
      checkUnreachableStepHandlers: () => unreachableOutcome,
      checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
      checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
      moveTicketToDone: () => {
        calls.move += 1;
        return { moved: true, destination: '/repo/backlog/done/BL-753-prop.yaml' };
      },
      writeReceipt: () => {
        calls.receipt += 1;
      },
      getLandedCommit: () => 'a'.repeat(40),
      checkOriginMainLanding: () => ({ reachable: true }),
      now: () => '2026-08-26T00:00:00.000Z',
    },
  };
}

test('property: unmatched registered pattern always yields a miss (never silent cosmetic pass)', () => {
  fc.assert(
    fc.property(stepWordArb, stepWordArb, (registered, rendered) => {
      fc.pre(registered !== rendered);
      const patternSource = `/^step ${registered}$/`;
      const result = assessUnreachableStepHandlers({
        feature: {
          name: FEATURE_NAME,
          scenarios: [{ steps: [{ text: `step ${rendered}` }], examples: [] }],
        },
        ticketId: 'BL-753',
        stepFiles: [pairedStepFile(patternSource)],
      });
      assert.equal(result.checked, true);
      assert.ok(result.miss, `expected miss for registered=${registered} rendered=${rendered}`);
      assert.match(result.miss.pattern, new RegExp(registered));
      assert.equal(result.miss.stepFilePath, 'specs/pipeline/steps/bl753PropFixtureSteps.js');
    }),
    { numRuns: 50 }
  );
});

test('property: every registered pattern matching a rendered step never yields a miss', () => {
  fc.assert(
    fc.property(stepWordArb, (word) => {
      const patternSource = `/^step ${word}$/`;
      const result = assessUnreachableStepHandlers({
        feature: {
          name: FEATURE_NAME,
          scenarios: [{ steps: [{ text: `step ${word}` }], examples: [] }],
        },
        ticketId: 'BL-753',
        stepFiles: [pairedStepFile(patternSource)],
      });
      assert.equal(result.checked, true);
      assert.equal(result.miss, undefined);
      assert.equal(result.patternsChecked, 1);
    }),
    { numRuns: 40 }
  );
});

test('property: unpaired or empty touched step sets are a no-op (no cosmetic false refuse)', () => {
  fc.assert(
    fc.property(stepWordArb, fc.boolean(), (word, useOtherFeature) => {
      const patternSource = `/^step ${word}$/`;
      const stepFiles = useOtherFeature
        ? [
            {
              path: 'specs/pipeline/steps/bl747OtherSteps.js',
              text:
                `const FEATURE = 'Some Other Feature';\n` +
                `scoped(registry, ${patternSource}, () => {});\n`,
            },
          ]
        : [];
      const result = assessUnreachableStepHandlers({
        feature: {
          name: FEATURE_NAME,
          scenarios: [{ steps: [{ text: 'unrelated' }], examples: [] }],
        },
        ticketId: 'BL-753',
        stepFiles,
      });
      assert.equal(result.checked, true);
      assert.equal(result.miss, undefined);
      assert.equal(result.stepFilesScanned, 0);
      assert.equal(result.patternsChecked, 0);
    }),
    { numRuns: 40 }
  );
});

test('property: land refuses unreachable-step-handler inertly whenever assess reports a miss', async () => {
  await fc.assert(
    fc.asyncProperty(stepWordArb, async (word) => {
      const pattern = `/^step ${word}$/`;
      const { deps, calls } = mkGateDeps({
        checked: true,
        stepFilesScanned: 1,
        patternsChecked: 1,
        miss: {
          pattern,
          stepFilePath: 'specs/pipeline/steps/bl753PropFixtureSteps.js',
        },
      });
      const outcome = await landPilotedTicket('BL-753', deps);
      assert.equal(outcome.landed, false);
      assert.equal(outcome.reasonKind, 'unreachable-step-handler');
      assert.match(outcome.reason, new RegExp(UNREACHABLE_STEP_HANDLER_REFUSAL));
      assert.match(outcome.reason, new RegExp(word));
      assert.equal(calls.move, 0);
      assert.equal(calls.receipt, 0);
    }),
    { numRuns: 30 }
  );
});

test('non-vacuity: unmatched-pattern property would fail if assessor always returned no miss', () => {
  const broken = { checked: true, stepFilesScanned: 1, patternsChecked: 1 };
  assert.equal(
    broken.miss,
    undefined,
    'broken always-ok assessor shape'
  );
  const real = assessUnreachableStepHandlers({
    feature: {
      name: FEATURE_NAME,
      scenarios: [{ steps: [{ text: 'step alpha' }], examples: [] }],
    },
    ticketId: 'BL-753',
    stepFiles: [pairedStepFile('/^step omega$/')],
  });
  assert.ok(real.miss, 'real assessor must miss on unmatched pattern');
  assert.notDeepEqual(
    broken,
    real,
    'expected the broken (always-ok) outcome to disagree with the real invariant, proving non-vacuity'
  );
});

test('non-vacuity: gate refuse property would fail if land ignored an unreachable miss', async () => {
  const { deps } = mkGateDeps({
    checked: true,
    stepFilesScanned: 1,
    patternsChecked: 1,
    miss: {
      pattern: '/^step dead$/',
      stepFilePath: 'specs/pipeline/steps/bl753PropFixtureSteps.js',
    },
  });
  // Broken shape: land as if the check were unwired (always green after acceptance).
  const brokenLanded = true;
  const real = await landPilotedTicket('BL-753', deps);
  assert.equal(real.landed, false);
  assert.equal(real.reasonKind, 'unreachable-step-handler');
  assert.notEqual(
    brokenLanded,
    real.landed,
    'expected the broken (ignore-miss) land to disagree with the real invariant, proving non-vacuity'
  );
});
