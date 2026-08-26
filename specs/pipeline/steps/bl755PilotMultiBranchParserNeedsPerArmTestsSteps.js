'use strict';

// BL-755: multi-branch parser per-arm coverage on /pilot land + hardener rule.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessMultiBranchParserCoverage,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { composePilotExpeditorPrompt } = require(path.join(
  EXT_DIR,
  'out',
  'tools',
  'telegramCursorBridgePilot'
));

const HARDENDER = path.join(REPO_ROOT, 'swarmforge', 'roles', 'hardender.prompt');
const FEATURE =
  'Multi-branch parsers need one test per arm on /pilot land and in hardener guidance';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl755-'));
}

function threeArms() {
  return [
    { label: 'double-quoted', marker: 'double-quoted' },
    { label: 'single-quoted', marker: 'single-quoted' },
    { label: 'unquoted', marker: 'unquoted' },
  ];
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-755-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl755-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.parsers = ctx.parsers || [];
  ctx.testTexts = ctx.testTexts || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  return ctx;
}

function multiBranchOutcome(ctx) {
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  return assessMultiBranchParserCoverage({
    parsers: ctx.parsers,
    testTexts: ctx.testTexts,
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
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => multiBranchOutcome(ctx),
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
    now: () => '2026-08-26T00:00:00.000Z',
  };
}

async function runGate(ctx) {
  ensureCtx(ctx);
  fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl755-fixture.feature'),
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
    /^it requires at least one distinct test per arm of a multi-branch parser$/,
    (ctx) => {
      const text = (ctx.hardenderPrompt || ctx.pilotPrompt || '').toLowerCase();
      if (!/multi-branch|multi-arm|per (arm|branch)/.test(text) && !/one distinct test per/.test(text)) {
        throw new Error('expected per-arm / multi-branch parser language');
      }
      if (!/test/.test(text)) {
        throw new Error('expected test-per-arm language');
      }
    }
  );

  scoped(registry, /^the offline expeditor prompt is composed for ticket "([^"]+)"$/, (ctx, ticket) => {
    ctx.pilotPrompt = composePilotExpeditorPrompt(ticket);
  });

  scoped(registry, /^the prompt requires at least one distinct test per arm of a multi-branch parser$/, (ctx) => {
    const text = ctx.pilotPrompt || '';
    if (!/distinct test per arm/i.test(text) || !/multi-branch parser/i.test(text)) {
      throw new Error(`expected BL-755 per-arm rule in /pilot prompt:\n${text}`);
    }
  });

  scoped(registry, /^the run's commits touched a function with three cond or case arms$/, (ctx) => {
    ensureCtx(ctx);
    ctx.parsers = [
      {
        functionName: 'take-flow-reason',
        sourcePath: 'swarmforge/scripts/lib.bb',
        arms: threeArms(),
      },
    ];
  });

  scoped(registry, /^only one of those arms is exercised by the run's tests$/, (ctx) => {
    ensureCtx(ctx);
    ctx.testTexts = ['covers double-quoted hazard'];
  });

  scoped(registry, /^each arm is exercised by at least one distinct test$/, (ctx) => {
    ensureCtx(ctx);
    ctx.testTexts = ['double-quoted', 'single-quoted', 'unquoted'];
  });

  scoped(registry, /^the run's commits touched a multi-arm parser with an untested arm$/, (ctx) => {
    ensureCtx(ctx);
    ctx.parsers = [
      {
        functionName: 'take-flow-reason',
        sourcePath: 'swarmforge/scripts/lib.bb',
        arms: threeArms(),
      },
    ];
    ctx.testTexts = ['double-quoted only'];
  });

  scoped(registry, /^the run's commits touched no function with three or more cond or case arms$/, (ctx) => {
    ensureCtx(ctx);
    ctx.parsers = [];
    ctx.testTexts = [];
  });

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the land is refused for untested parser branch$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'untested-parser-branch') {
      throw new Error(`expected untested-parser-branch, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the refusal names an untested arm$/, (ctx) => {
    const reason = (ctx.outcome && ctx.outcome.reason) || '';
    if (!/single-quoted|unquoted|arm/i.test(reason)) {
      throw new Error(`refusal did not name an untested arm: ${reason}`);
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
