'use strict';

const assert = require('node:assert/strict');
const {
  assessUnreachableStepHandlers,
  extractRegisteredPatternSources,
  renderFeatureStepTexts,
  isStepHandlerPath,
  UNREACHABLE_STEP_HANDLER_REFUSAL,
} = require('../out/tools/unreachableStepHandlerCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

function mkDeps(overrides) {
  const calls = { move: 0, writeReceipt: 0 };
  let executedFeaturePath;
  const deps = {
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
    checkCommitClaims: () => ({ checked: true, commitsChecked: 1 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-753-fixture.yaml' };
    },
    writeReceipt: () => {
      calls.writeReceipt += 1;
    },
    getLandedCommit: () => 'abc1234567',
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-08-26T00:00:00.000Z',
    ...overrides,
  };
  return { deps, calls };
}

test('isStepHandlerPath only matches specs/pipeline/steps/*.js', () => {
  assert.equal(isStepHandlerPath('specs/pipeline/steps/bl753FooSteps.js'), true);
  assert.equal(isStepHandlerPath('specs/pipeline/steps/lib/helper.js'), false);
  assert.equal(isStepHandlerPath('extension/src/tools/x.ts'), false);
});

test('extractRegisteredPatternSources finds define, defineScoped, and scoped helpers', () => {
  const text = `
  registry.define(/^alpha step$/, () => {});
  registry.defineScoped(/^beta step$/, () => {}, 'Feat');
  scoped(registry, /^gamma step$/, () => {});
  `;
  assert.deepEqual(extractRegisteredPatternSources(text), [
    '/^alpha step$/',
    '/^beta step$/',
    '/^gamma step$/',
  ]);
});

test('renderFeatureStepTexts expands Examples rows', () => {
  const texts = renderFeatureStepTexts({
    background: [{ text: 'bg ready' }],
    scenarios: [
      {
        steps: [{ text: '<name> runs' }, { text: 'it passes' }],
        examples: [{ name: 'a.sh' }, { name: 'b.sh' }],
      },
    ],
  });
  assert.deepEqual(texts, ['bg ready', 'a.sh runs', 'it passes', 'bg ready', 'b.sh runs', 'it passes']);
});

test('assessUnreachableStepHandlers refuses unmatched registered pattern', () => {
  const result = assessUnreachableStepHandlers({
    feature: {
      name: 'Unreachable acceptance step handlers are untested-behavior flags on /pilot land and in review prompts',
      scenarios: [{ steps: [{ text: 'the land is completed' }], examples: [] }],
    },
    ticketId: 'BL-753',
    stepFiles: [
      {
        path: 'specs/pipeline/steps/bl753FixtureSteps.js',
        text:
          "const FEATURE = 'Unreachable acceptance step handlers are untested-behavior flags on /pilot land and in review prompts';\n" +
          "scoped(registry, /^a pattern that never matches$/, () => {});\n",
      },
    ],
  });
  assert.equal(result.checked, true);
  assert.ok(result.miss);
  assert.match(result.miss.pattern, /never matches/);
  assert.equal(result.miss.stepFilePath, 'specs/pipeline/steps/bl753FixtureSteps.js');
});

test('assessUnreachableStepHandlers passes when every pattern matches a rendered step', () => {
  const result = assessUnreachableStepHandlers({
    feature: {
      name: 'Feat',
      scenarios: [{ steps: [{ text: 'the land is completed' }], examples: [] }],
    },
    ticketId: 'BL-753',
    stepFiles: [
      {
        path: 'specs/pipeline/steps/bl753FixtureSteps.js',
        text: "const FEATURE = 'Feat';\nscoped(registry, /^the land is completed$/, () => {});\n",
      },
    ],
  });
  assert.deepEqual(result, {
    checked: true,
    stepFilesScanned: 1,
    patternsChecked: 1,
  });
});

test('assessUnreachableStepHandlers ignores step files not paired with the ticket feature', () => {
  const result = assessUnreachableStepHandlers({
    feature: {
      name: 'Ticket Feature',
      scenarios: [{ steps: [{ text: 'ok' }], examples: [] }],
    },
    ticketId: 'BL-753',
    stepFiles: [
      {
        path: 'specs/pipeline/steps/bl747OtherSteps.js',
        text:
          "const FEATURE = 'Some Other Feature';\n" +
          "scoped(registry, /^dead pattern$/, () => {});\n",
      },
    ],
  });
  assert.deepEqual(result, { checked: true, stepFilesScanned: 0, patternsChecked: 0 });
});

test('assessUnreachableStepHandlers no-ops when no step files touched', () => {
  const result = assessUnreachableStepHandlers({
    feature: { name: 'Feat', scenarios: [{ steps: [{ text: 'x' }], examples: [] }] },
    stepFiles: [],
  });
  assert.deepEqual(result, { checked: true, stepFilesScanned: 0, patternsChecked: 0 });
});

test('assessUnreachableStepHandlers fails open when feature or stepFiles are undefined', () => {
  assert.deepEqual(
    assessUnreachableStepHandlers({ feature: undefined, stepFiles: [] }),
    { checked: false }
  );
  assert.deepEqual(
    assessUnreachableStepHandlers({
      feature: { name: 'Feat', scenarios: [{ steps: [{ text: 'x' }], examples: [] }] },
      stepFiles: undefined,
    }),
    { checked: false }
  );
});

test('assessUnreachableStepHandlers fails open on unparsable pattern literals (no false miss)', () => {
  const result = assessUnreachableStepHandlers({
    feature: {
      name: 'Feat',
      scenarios: [{ steps: [{ text: 'the land is completed' }], examples: [] }],
    },
    ticketId: 'BL-753',
    stepFiles: [
      {
        path: 'specs/pipeline/steps/bl753FixtureSteps.js',
        text:
          "const FEATURE = 'Feat';\n" +
          // Invalid RegExp body — compilePatternLiteral returns undefined → fail open.
          'scoped(registry, /(?/, () => {});\n',
      },
    ],
  });
  assert.equal(result.checked, true);
  assert.equal(result.miss, undefined);
  assert.equal(result.patternsChecked, 1);
});

test('landPilotedTicket refuses unreachable-step-handler inertly', async () => {
  const { deps, calls } = mkDeps({
    checkUnreachableStepHandlers: () => ({
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
      checked: true,
      stepFilesScanned: 1,
      patternsChecked: 1,
      miss: {
        pattern: '/^dead handler$/',
        stepFilePath: 'specs/pipeline/steps/bl753FixtureSteps.js',
      },
    }),
  });
  const outcome = await landPilotedTicket('BL-753', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'unreachable-step-handler');
  assert.match(outcome.reason, new RegExp(UNREACHABLE_STEP_HANDLER_REFUSAL));
  assert.match(outcome.reason, /dead handler/);
  assert.match(outcome.reason, /bl753FixtureSteps/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});
