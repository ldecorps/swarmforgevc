'use strict';

// BL-745: durable scoped CRAP evidence on pilot land receipts for extension/src touches.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessPilotScopedCrap,
  PILOT_CRAP_EVIDENCE_MISSING_REFUSAL,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));

const FEATURE =
  'pilot land records durable CRAP evidence for every touched extension src file';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl745-'));
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-745-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl745-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.touchedPaths = ctx.touchedPaths || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  return ctx;
}

function crapOutcome(ctx) {
  ensureCtx(ctx);
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  if (ctx.omitCrapEvidence && ctx.touchedSrcPaths && ctx.touchedSrcPaths.length > 0) {
    return {
      checked: true,
      tsFilesScanned: ctx.touchedSrcPaths.length,
      violations: [],
      scannedPaths: [],
      srcPathsInScope: ctx.touchedSrcPaths,
    };
  }
  if (ctx.forcedCrapOutcome) {
    return ctx.forcedCrapOutcome;
  }
  if (ctx.touchedPaths.length === 0) {
    return { checked: true, tsFilesScanned: 0, violations: [], scannedPaths: [] };
  }
  return assessPilotScopedCrap(ctx.repoRootFixture, ctx.touchedPaths);
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
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => {
      ctx.crapCheckCalled = true;
      const outcome = crapOutcome(ctx);
      ctx.lastCrapOutcome = outcome;
      return outcome;
    },
    checkMkdtempConvention: () => ({
      checked: true,
      testFilesScanned: 0,
      violations: [],
      scannedPaths: [],
    }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
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
    getLandedCommit: () => 'f'.repeat(40),
    now: () => '2026-08-27T00:00:00.000Z',
  };
}

async function runGate(ctx) {
  ensureCtx(ctx);
  fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl745-fixture.feature'),
    'Feature: fixture\n',
    'utf8'
  );
  ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
}

function writeSrcFixture(ctx, rel) {
  const abs = path.join(ctx.repoRootFixture, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'export function bl745Fixture(): number {\n  return 1;\n}\n', 'utf8');
}

function registerSteps(registry) {
  scoped(registry, /^a piloted ticket whose declared acceptance contract has just passed$/, (ctx) => {
    ensureCtx(ctx);
    ctx.acceptanceRunResult = { success: true, output: 'ok' };
  });

  scoped(registry, /^the BL-741 scoped CRAP land gate is already wired$/, (ctx) => {
    ensureCtx(ctx);
    ctx.bl741Wired = true;
  });

  scoped(
    registry,
    /^the run's commits touched TypeScript under extension\/src$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/src/bl745Fixture.ts';
      writeSrcFixture(ctx, rel);
      ctx.touchedSrcPaths = [rel];
      ctx.touchedPaths = [rel];
      ctx.forcedCrapOutcome = {
        checked: true,
        tsFilesScanned: 1,
        violations: [],
        scannedPaths: [rel],
      };
    }
  );

  scoped(
    registry,
    /^the run's commits touched no TypeScript under extension\/src$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/scripts/bl745NonSrc.ts';
      const abs = path.join(ctx.repoRootFixture, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'export function nonSrc(): void {}\n', 'utf8');
      ctx.touchedPaths = [rel];
      ctx.touchedSrcPaths = [];
      ctx.forcedCrapOutcome = {
        checked: true,
        tsFilesScanned: 1,
        violations: [],
        scannedPaths: [rel],
      };
    }
  );

  scoped(
    registry,
    /^the landing path would omit CRAP evidence from the acceptance receipt$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.omitCrapEvidence = true;
    }
  );

  scoped(registry, /^the pilot lands the ticket$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(
    registry,
    /^the acceptance receipt records that a scoped CRAP pass ran$/,
    (ctx) => {
      const receipt = ctx.writtenReceipt;
      if (!receipt || !receipt.scopedCrap) {
        throw new Error(`expected scopedCrap on receipt, got ${JSON.stringify(receipt)}`);
      }
      if (receipt.scopedCrap.outcome !== 'passed') {
        throw new Error(`expected CRAP outcome passed, got ${receipt.scopedCrap.outcome}`);
      }
    }
  );

  scoped(
    registry,
    /^the evidence names the touched extension src paths that were scanned$/,
    (ctx) => {
      const receipt = ctx.writtenReceipt;
      const expected = ctx.touchedSrcPaths || [];
      const named = (receipt && receipt.scopedCrap && receipt.scopedCrap.scannedPaths) || [];
      for (const rel of expected) {
        if (!named.includes(rel)) {
          throw new Error(`receipt missing scanned src path ${rel}; got ${JSON.stringify(named)}`);
        }
      }
    }
  );

  scoped(registry, /^the land is refused for missing CRAP evidence$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'crap-evidence-missing') {
      throw new Error(`expected crap-evidence-missing, got ${ctx.outcome.reasonKind}`);
    }
    if (!ctx.outcome.reason.includes(PILOT_CRAP_EVIDENCE_MISSING_REFUSAL)) {
      throw new Error(`refusal missing CRAP evidence message: ${ctx.outcome.reason}`);
    }
  });

  scoped(
    registry,
    /^a ticket that touched extension\/src TypeScript has landed$/,
    async (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/src/bl745Landed.ts';
      writeSrcFixture(ctx, rel);
      ctx.touchedSrcPaths = [rel];
      ctx.touchedPaths = [rel];
      ctx.forcedCrapOutcome = {
        checked: true,
        tsFilesScanned: 1,
        violations: [],
        scannedPaths: [rel],
      };
      await runGate(ctx);
      if (!ctx.writtenReceipt) {
        throw new Error('expected prior land to write a receipt');
      }
      ctx.priorReceipt = ctx.writtenReceipt;
    }
  );

  scoped(registry, /^a reviewer reads the acceptance receipt$/, (ctx) => {
    ctx.reviewedReceipt = ctx.priorReceipt || ctx.writtenReceipt;
    if (!ctx.reviewedReceipt) {
      throw new Error('no acceptance receipt to review');
    }
  });

  scoped(
    registry,
    /^the receipt shows CRAP was checked and which src paths were in scope$/,
    (ctx) => {
      const receipt = ctx.reviewedReceipt;
      const scopedCrap = receipt && receipt.scopedCrap;
      if (!scopedCrap || scopedCrap.outcome !== 'passed') {
        throw new Error(`receipt missing CRAP pass evidence: ${JSON.stringify(scopedCrap)}`);
      }
      const srcNamed = (scopedCrap.scannedPaths || []).filter((p) => p.startsWith('extension/src/'));
      if (srcNamed.length < 1) {
        throw new Error(`receipt did not name src paths: ${JSON.stringify(scopedCrap)}`);
      }
    }
  );

  scoped(
    registry,
    /^the reviewer does not need to rediscover the check from scratch$/,
    (ctx) => {
      const receipt = ctx.reviewedReceipt;
      const scopedCrap = receipt && receipt.scopedCrap;
      if (!scopedCrap || !Array.isArray(scopedCrap.scannedPaths) || scopedCrap.scannedPaths.length === 0) {
        throw new Error('receipt lacks path-scoped CRAP evidence for audit without re-run');
      }
      if (typeof scopedCrap.tsFilesScanned !== 'number') {
        throw new Error('receipt lacks tsFilesScanned count alongside path evidence');
      }
    }
  );

  scoped(
    registry,
    /^missing extension-src CRAP evidence does not by itself refuse the land$/,
    (ctx) => {
      if (!ctx.outcome) {
        throw new Error('landing gate did not run');
      }
      if (ctx.outcome.reasonKind === 'crap-evidence-missing') {
        throw new Error('land refused solely for missing extension-src CRAP evidence');
      }
    }
  );

  scoped(
    registry,
    /^other landing gates may still refuse or complete independently$/,
    (ctx) => {
      if (!ctx.outcome) {
        throw new Error('landing gate did not run');
      }
      if (ctx.outcome.reasonKind === 'crap-evidence-missing') {
        throw new Error('CRAP evidence refusal blocks independent other-gate outcome');
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
