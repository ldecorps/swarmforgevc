'use strict';

// BL-751: sibling-branch gating asymmetry on /pilot land + hardener rule.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessMultiBranchSiblingGating,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { composePilotExpeditorPrompt } = require(path.join(
  EXT_DIR,
  'out',
  'tools',
  'telegramCursorBridgePilot'
));

const HARDENDER = path.join(REPO_ROOT, 'swarmforge', 'roles', 'hardender.prompt');
const FEATURE =
  'sibling-branch gating asymmetry is caught on /pilot land and in hardener guidance';

const ASYMMETRIC_DISPATCH = {
  functionName: 'assess-one-claim',
  sourcePath: 'swarmforge/scripts/babysitter_assess_lib.bb',
  arms: [
    { label: 'halt-imminent', guards: ['(>= reclaims (:halt-threshold cfg))'] },
    { label: 'critical', guards: ['(>= reclaims (:bounce-threshold cfg))'] },
    { label: 'warn', guards: ['(>= reclaims default-warn-reclaims)'] },
    { label: 'warn-fixture-droppings', guards: ['head-unchanged?', 'fixture-droppings?'] },
    {
      label: 'warn-uncommitted',
      guards: ['head-unchanged?', '(>= elapsed-pct 0.75)', '(pos? untracked)'],
    },
    { label: 'watch', guards: ['head-unchanged?', '(>= elapsed-pct 0.75)'] },
  ],
};

const ALIGNED_DISPATCH = {
  functionName: 'assess-one-claim',
  sourcePath: 'swarmforge/scripts/babysitter_assess_lib.bb',
  arms: [
    { label: 'warn-fixture-droppings', guards: ['head-unchanged?', '(>= elapsed-pct 0.75)', 'fixture-droppings?'] },
    {
      label: 'warn-uncommitted',
      guards: ['head-unchanged?', '(>= elapsed-pct 0.75)', '(pos? untracked)'],
    },
    { label: 'watch', guards: ['head-unchanged?', '(>= elapsed-pct 0.75)'] },
  ],
};

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl751-'));
}

function assertSiblingGatingGuidance(text, label) {
  const lower = (text || '').toLowerCase();
  if (!/multi-branch|multi-arm|sibling|guard pattern|grace period|gating asymmetry/.test(lower)) {
    throw new Error(`${label}: expected sibling-branch gating language`);
  }
  if (!/compare|comparison|diff|against/.test(lower)) {
    throw new Error(`${label}: expected explicit sibling comparison language`);
  }
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-751-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl751-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.dispatches = ctx.dispatches || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  return ctx;
}

function siblingGatingOutcome(ctx) {
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  return assessMultiBranchSiblingGating({ dispatches: ctx.dispatches });
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
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkMultiBranchSiblingGating: () => siblingGatingOutcome(ctx),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      ctx.calls.move += 1;
      ctx.yamlMoved = true;
      return {
        moved: true,
        destination: path.join(ctx.repoRootFixture, 'backlog', 'done', `${ctx.ticketId}.yaml`),
      };
    },
    writeReceipt: (_id, receipt) => {
      ctx.calls.receipt += 1;
      ctx.writtenReceipt = receipt;
    },
    getLandedCommit: () => 'e'.repeat(40),
    now: () => '2026-08-27T00:00:00.000Z',
  };
}

async function runGate(ctx) {
  ensureCtx(ctx);
  fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl751-fixture.feature'),
    'Feature: fixture\n',
    'utf8'
  );
  ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
}

function registerSteps(registry) {
  scoped(registry, /^the pilot expeditor prompt composer is available$/, () => {});

  scoped(registry, /^the hardener role prompt is read$/, (ctx) => {
    ctx.hardenderPrompt = fs.readFileSync(HARDENDER, 'utf8');
  });

  scoped(
    registry,
    /^it requires comparing new multi-branch arms against sibling guard patterns$/,
    (ctx) => {
      assertSiblingGatingGuidance(ctx.hardenderPrompt || ctx.pilotPrompt, 'hardener/pilot guidance');
    }
  );

  scoped(registry, /^the offline expeditor prompt is composed for ticket "([^"]+)"$/, (ctx, ticket) => {
    ctx.pilotPrompt = composePilotExpeditorPrompt(ticket);
  });

  scoped(
    registry,
    /^the prompt requires comparing new multi-branch arms against sibling guard patterns$/,
    (ctx) => {
      assertSiblingGatingGuidance(ctx.pilotPrompt, '/pilot prompt');
      if (!/BL-751|sibling-branch gating|gating asymmetry/i.test(ctx.pilotPrompt || '')) {
        throw new Error(`expected BL-751 sibling gating phrasing:\n${ctx.pilotPrompt}`);
      }
    }
  );

  scoped(
    registry,
    /^the run's commits touched a multi-arm cond with sibling gating asymmetry$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.dispatches = [ASYMMETRIC_DISPATCH];
    }
  );

  scoped(
    registry,
    /^the run's commits touched a multi-arm cond with aligned sibling guards$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.dispatches = [ALIGNED_DISPATCH];
    }
  );

  scoped(
    registry,
    /^the run's commits touched no multi-arm cond with three or more predicate arms$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.dispatches = [];
    }
  );

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the land is refused for sibling-branch gating asymmetry$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'sibling-branch-gating-asymmetry') {
      throw new Error(`expected sibling-branch-gating-asymmetry, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the refusal names the arm missing the shared guard$/, (ctx) => {
    const reason = (ctx.outcome && ctx.outcome.reason) || '';
    if (!/warn-fixture-droppings|missing/i.test(reason)) {
      throw new Error(`refusal did not name the asymmetric arm: ${reason}`);
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
