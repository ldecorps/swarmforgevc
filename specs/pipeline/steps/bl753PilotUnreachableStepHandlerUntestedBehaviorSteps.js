'use strict';

// BL-753: unreachable step-handler gate on /pilot land + review prompt rule.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessUnreachableStepHandlers,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { composePilotExpeditorPrompt } = require(path.join(
  EXT_DIR,
  'out',
  'tools',
  'telegramCursorBridgePilot'
));

const CLEANER = path.join(REPO_ROOT, 'swarmforge', 'roles', 'cleaner.prompt');
const HARDENDER = path.join(REPO_ROOT, 'swarmforge', 'roles', 'hardender.prompt');
const ARCHITECT = path.join(REPO_ROOT, 'swarmforge', 'roles', 'architect.prompt');

const FEATURE =
  'Unreachable acceptance step handlers are untested-behavior flags on /pilot land and in review prompts';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl753-'));
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-753-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl753-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.featureIr = ctx.featureIr || {
    name: FEATURE,
    scenarios: [{ steps: [{ text: 'the land is completed' }], examples: [] }],
  };
  ctx.stepFiles = ctx.stepFiles || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  return ctx;
}

function unreachableOutcome(ctx) {
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  return assessUnreachableStepHandlers({
    feature: ctx.featureIr,
    stepFiles: ctx.stepFiles,
    ticketId: ctx.ticketId,
  });
}

function baseDeps(ctx) {
  ensureCtx(ctx);
  let executedFeaturePath;
  return {
    readAcceptanceDeclaration: () => ctx.acceptanceDeclaration,
    resolveFeatureFilePath: (declaration) => resolveFeatureFilePath(ctx.repoRootFixture, declaration),
    isLifecycleTeardownTicket: () => false,
    assessMultiworktreeFixture: () => ({
      satisfied: true,
      metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: ctx.repoRootFixture },
    }),
    runAcceptance: async () => ctx.acceptanceRunResult,
    recordAcceptanceExecution: (featureFilePath) => {
      executedFeaturePath = featureFilePath;
    },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => unreachableOutcome(ctx),
    moveTicketToDone: () => {
      ctx.calls.move += 1;
      ctx.yamlMoved = true;
      return {
        moved: true,
        destination: path.join(ctx.repoRootFixture, 'backlog', 'done', `${ctx.ticketId}-fixture.yaml`),
      };
    },
    writeReceipt: (_ticketId, receipt) => {
      ctx.calls.receipt += 1;
      ctx.writtenReceipt = receipt;
    },
    getLandedCommit: () => 'e'.repeat(40),
    now: () => '2026-08-26T00:00:00.000Z',
  };
}

async function runGate(ctx) {
  ensureCtx(ctx);
  fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl753-fixture.feature'),
    'Feature: fixture\n',
    'utf8'
  );
  ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
}

function assertUntestedBehaviorQuestion(text, label) {
  const lower = text.toLowerCase();
  if (!/unreachable/.test(lower) && !/never matches/.test(lower) && !/registered/.test(lower)) {
    throw new Error(`${label}: expected unreachable/registered handler language`);
  }
  if (!/claim/.test(lower)) {
    throw new Error(`${label}: expected claim question`);
  }
  if (!/nit|cosmetic|dead.?code/.test(lower)) {
    throw new Error(`${label}: expected nit/cosmetic dead-code language`);
  }
}

/** Assert the most recently loaded, not-yet-checked role prompt (cleaner → hardener → architect). */
function assertNextUnreadRolePrompt(ctx) {
  const checks = [
    { key: 'cleanerPrompt', flag: '_cleanerChecked', label: 'cleaner.prompt' },
    { key: 'hardenderPrompt', flag: '_hardenderChecked', label: 'hardender.prompt' },
    { key: 'architectPrompt', flag: '_architectChecked', label: 'architect.prompt' },
  ];
  for (const { key, flag, label } of checks) {
    if (ctx[key] && !ctx[flag]) {
      assertUntestedBehaviorQuestion(ctx[key], label);
      ctx[flag] = true;
      return;
    }
  }
  throw new Error('no unread role prompt loaded for unreachable-handler assertion');
}

function fixtureStepFileText(patternLiteral) {
  // Build fixture source as data — do not embed /.../ regex literals in THIS
  // file or extractRegisteredPatternSources will treat them as live handlers.
  return (
    `const FEATURE = ${JSON.stringify(FEATURE)};\n` +
    'scoped(registry, ' +
    patternLiteral +
    ', () => {});\n'
  );
}

function registerSteps(registry) {
  scoped(registry, /^the pilot expeditor prompt composer is available$/, () => {});

  scoped(registry, /^the cleaner role prompt is read$/, (ctx) => {
    ctx.cleanerPrompt = fs.readFileSync(CLEANER, 'utf8');
  });

  scoped(registry, /^the hardener role prompt is read$/, (ctx) => {
    ctx.hardenderPrompt = fs.readFileSync(HARDENDER, 'utf8');
  });

  scoped(registry, /^the architect role prompt is read$/, (ctx) => {
    ctx.architectPrompt = fs.readFileSync(ARCHITECT, 'utf8');
  });

  scoped(
    registry,
    /^it requires asking what claim an unreachable step handler was meant to verify$/,
    (ctx) => {
      assertNextUnreadRolePrompt(ctx);
    }
  );

  scoped(registry, /^the offline expeditor prompt is composed for ticket "([^"]+)"$/, (ctx, ticket) => {
    ctx.pilotPrompt = composePilotExpeditorPrompt(ticket);
  });

  scoped(
    registry,
    /^the prompt requires treating an unreachable step handler as an untested-behavior flag until the claim question is answered$/,
    (ctx) => {
      const text = ctx.pilotPrompt || '';
      if (!/untested-behavior flag/i.test(text)) {
        throw new Error(`expected untested-behavior flag in /pilot prompt:\n${text}`);
      }
      if (!/what claim/i.test(text)) {
        throw new Error(`expected claim question in /pilot prompt:\n${text}`);
      }
      if (!/cosmetic dead code/i.test(text)) {
        throw new Error(`expected cosmetic dead code refusal in /pilot prompt:\n${text}`);
      }
    }
  );

  scoped(
    registry,
    /^the run's commits touched a step-handler file that registers a pattern$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.stepFiles = [
        {
          path: 'specs/pipeline/steps/bl753FixtureSteps.js',
          text: fixtureStepFileText('/^a handler that never matches any feature step$/'),
        },
      ];
      ctx.featureIr = {
        name: FEATURE,
        scenarios: [{ steps: [{ text: 'an unrelated rendered step' }], examples: [] }],
      };
    }
  );

  scoped(
    registry,
    /^the ticket feature file renders no step matching that pattern$/,
    (ctx) => {
      ensureCtx(ctx);
      // already set in prior Given
    }
  );

  scoped(
    registry,
    /^the run's commits touched a step-handler file whose every registered pattern matches a rendered feature step$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.featureIr = {
        name: FEATURE,
        scenarios: [{ steps: [{ text: 'the land is completed' }], examples: [] }],
      };
      ctx.stepFiles = [
        {
          path: 'specs/pipeline/steps/bl753FixtureSteps.js',
          text: fixtureStepFileText('/^the land is completed$/'),
        },
      ];
    }
  );

  scoped(
    registry,
    /^the run's commits touched a step-handler file with an unmatched registered pattern$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.stepFiles = [
        {
          path: 'specs/pipeline/steps/bl753FixtureSteps.js',
          text: fixtureStepFileText('/^dead unmatched pattern$/'),
        },
      ];
      ctx.featureIr = {
        name: FEATURE,
        scenarios: [{ steps: [{ text: 'something else entirely' }], examples: [] }],
      };
    }
  );

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the land is refused for unreachable step handler$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'unreachable-step-handler') {
      throw new Error(`expected unreachable-step-handler, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the refusal names the pattern or handler file$/, (ctx) => {
    const reason = (ctx.outcome && ctx.outcome.reason) || '';
    if (!/pattern|bl753FixtureSteps|dead|never matches/i.test(reason)) {
      throw new Error(`refusal did not name pattern/file: ${reason}`);
    }
  });

  scoped(registry, /^the land is completed$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== true) {
      throw new Error(`expected land completed, got ${JSON.stringify(ctx.outcome)}`);
    }
  });

  scoped(registry, /^the ticket yaml stays where it was$/, (ctx) => {
    if (ctx.yamlMoved || (ctx.calls && ctx.calls.move > 0)) {
      throw new Error('yaml moved on refused land');
    }
  });

  scoped(registry, /^no acceptance receipt is written$/, (ctx) => {
    if (ctx.writtenReceipt || (ctx.calls && ctx.calls.receipt > 0)) {
      throw new Error('receipt written on refused land');
    }
  });
}

module.exports = { registerSteps };
