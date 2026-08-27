'use strict';

// BL-741: scoped CRAP gate on /pilot land — always runs on touched extension/*.ts,
// never skipped for mutation_cost low.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessPilotScopedCrap,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const {
  findCrossFileDuplication,
  MIN_DUPLICATION_BLOCK_LINES,
} = require(path.join(EXT_DIR, 'out', 'tools', 'crossFileDuplicationCheck'));

const HARDENDER = path.join(REPO_ROOT, 'swarmforge', 'roles', 'hardender.prompt');

const FEATURE =
  'pilot land gate always runs scoped CRAP separate from mutation_cost low';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl741-'));
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-741-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl741-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.touchedTsPaths = ctx.touchedTsPaths || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  ctx.mutationCostLow = ctx.mutationCostLow || false;
  return ctx;
}

function helpBlock() {
  const lines = [];
  for (let i = 1; i <= MIN_DUPLICATION_BLOCK_LINES; i += 1) {
    lines.push(`# duplicated help line ${i}`);
  }
  return lines.join('\n');
}

function crapOutcome(ctx) {
  ensureCtx(ctx);
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  if (ctx.forcedCrapOutcome) {
    return ctx.forcedCrapOutcome;
  }
  if (ctx.touchedTsPaths.length === 0) {
    return { checked: true, tsFilesScanned: 0, violations: [], scannedPaths: [] };
  }
  return assessPilotScopedCrap(ctx.repoRootFixture, ctx.touchedTsPaths);
}

function duplicationOutcome(ctx) {
  if (!ctx.historyResolvable || !ctx.touchedScripts) {
    return { checked: true, filesScanned: 0 };
  }
  return findCrossFileDuplication(ctx.touchedScripts);
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
    runAcceptance: async () => {
      ctx.acceptanceRunCalled = true;
      return ctx.acceptanceRunResult;
    },
    recordAcceptanceExecution: (featureFilePath) => {
      executedFeaturePath = featureFilePath;
    },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkCrossFileDuplication: () => duplicationOutcome(ctx),
    checkScopedCrap: () => {
      ctx.crapCheckCalled = true;
      const outcome = crapOutcome(ctx);
      ctx.lastCrapOutcome = outcome;
      return outcome;
    },
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
      checkMultiBranchSiblingGating: () => ({ checked: true, dispatchesScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
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
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl741-fixture.feature'),
    'Feature: fixture\n',
    'utf8'
  );
  ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
}

function registerSteps(registry) {
  scoped(registry, /^a piloted ticket whose declared acceptance contract has just passed$/, (ctx) => {
    ensureCtx(ctx);
    ctx.acceptanceRunResult = { success: true, output: 'ok' };
  });

  scoped(registry, /^the ticket yaml declares mutation_cost low$/, (ctx) => {
    ensureCtx(ctx);
    ctx.mutationCostLow = true;
  });

  scoped(
    registry,
    /^the run's commits touched TypeScript files under extension\/$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/src/bl741Fixture.ts';
      const abs = path.join(ctx.repoRootFixture, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'export function lowCrapHelper(): number {\n  return 1;\n}\n', 'utf8');
      ctx.touchedTsPaths = [rel];
      ctx.forcedCrapOutcome = { checked: true, tsFilesScanned: 1, violations: [], scannedPaths: [rel] };
    }
  );

  scoped(
    registry,
    /^the run's commits added a function with CRAP greater than six on a touched file$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.forcedCrapOutcome = {
        checked: true,
        tsFilesScanned: 1,
        violations: [
          {
            file: 'extension/src/bl741HighCrap.ts',
            function: 'collectReferencedClaudeModels',
            crap: 10.89,
          },
        ],
        scannedPaths: ['extension/src/bl741HighCrap.ts'],
      };
      ctx.touchedTsPaths = ['extension/src/bl741HighCrap.ts'];
    }
  );

  scoped(
    registry,
    /^the run's commits touched files whose functions are all at CRAP six or below$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.forcedCrapOutcome = {
        checked: true,
        tsFilesScanned: 1,
        violations: [],
        scannedPaths: ['extension/src/bl741LowCrap.ts'],
      };
    }
  );

  scoped(registry, /^the run's commits touched a file with a CRAP violation$/, (ctx) => {
    ensureCtx(ctx);
    ctx.forcedCrapOutcome = {
      checked: true,
      tsFilesScanned: 1,
      violations: [
        { file: 'extension/src/bl741Violating.ts', function: 'flaggedFn', crap: 8.5 },
      ],
      scannedPaths: ['extension/src/bl741Violating.ts'],
    };
    ctx.touchedTsPaths = ['extension/src/bl741Violating.ts'];
  });

  scoped(registry, /^the hardener role prompt is read$/, (ctx) => {
    ctx.hardenderPrompt = fs.readFileSync(HARDENDER, 'utf8');
  });

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the CRAP gate runs scoped to those touched files$/, (ctx) => {
    if (!ctx.crapCheckCalled) {
      throw new Error('scoped CRAP check was not invoked');
    }
    const outcome = ctx.lastCrapOutcome || crapOutcome(ctx);
    if (!outcome.checked || outcome.tsFilesScanned < 1) {
      throw new Error(`expected scoped CRAP on touched TS, got ${JSON.stringify(outcome)}`);
    }
  });

  scoped(registry, /^mutation_cost low does not skip the CRAP gate$/, (ctx) => {
    if (!ctx.mutationCostLow) {
      throw new Error('expected mutation_cost low fixture flag');
    }
    if (!ctx.crapCheckCalled) {
      throw new Error('CRAP gate skipped despite mutation_cost low');
    }
  });

  scoped(registry, /^the land is refused for CRAP violation$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'crap-violation') {
      throw new Error(`expected crap-violation, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the refusal names the file and function$/, (ctx) => {
    const reason = (ctx.outcome && ctx.outcome.reason) || '';
    const file = ctx.outcome.crapFile || '';
    const fn = ctx.outcome.crapFunction || '';
    if (!file || !fn) {
      throw new Error(`missing crapFile/crapFunction on refusal: ${JSON.stringify(ctx.outcome)}`);
    }
    if (!reason.includes(file) || !reason.includes(fn)) {
      throw new Error(`refusal did not name file/function: ${reason}`);
    }
  });

  scoped(
    registry,
    /^it states CRAP is an always-run gate scoped to changed files$/,
    (ctx) => {
      const text = ctx.hardenderPrompt || '';
      if (!/always-run gate scoped/i.test(text)) {
        throw new Error('hardender.prompt missing always-run scoped CRAP guidance');
      }
    }
  );

  scoped(
    registry,
    /^it states mutation_cost low does not exempt CRAP from pilot or pipeline land$/,
    (ctx) => {
      const text = ctx.hardenderPrompt || '';
      if (!/mutation_cost:\s*low/i.test(text) || !/never exempts CRAP/i.test(text)) {
        throw new Error('hardender.prompt missing mutation_cost low CRAP separation');
      }
      if (!/pilot or pipeline land/i.test(text)) {
        throw new Error('hardender.prompt missing pilot/pipeline land CRAP rule');
      }
    }
  );

  scoped(registry, /^the CRAP gate completes without refusal$/, (ctx) => {
    if (!ctx.crapCheckCalled) {
      throw new Error('CRAP gate did not run');
    }
    if (ctx.outcome && ctx.outcome.reasonKind === 'crap-violation') {
      throw new Error('CRAP gate refused the land');
    }
  });

  scoped(
    registry,
    /^other landing gates may still refuse or complete independently$/,
    (ctx) => {
      if (!ctx.outcome) {
        throw new Error('landing gate did not run');
      }
      if (ctx.outcome.reasonKind === 'crap-violation') {
        throw new Error('CRAP refusal blocks independent other-gate outcome');
      }
    }
  );

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
