'use strict';

// BL-737: step handlers for cross-file duplication gate on /pilot land.
// Drives the REAL compiled landPilotedTicket in-process.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const {
  findCrossFileDuplication,
  MIN_DUPLICATION_BLOCK_LINES,
} = require(path.join(EXT_DIR, 'out', 'tools', 'crossFileDuplicationCheck'));

const FEATURE =
  'Pilot land gate refuses cross-file mechanical duplication in the run\'s own touched files';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl737-'));
}

function helpBlock() {
  const lines = [];
  for (let i = 1; i <= MIN_DUPLICATION_BLOCK_LINES; i += 1) {
    lines.push(`# duplicated help line ${i}`);
  }
  return lines.join('\n');
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-737-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl737-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.touchedScripts = ctx.touchedScripts || [];
  ctx.untouchedOutside = ctx.untouchedOutside || null;
  ctx.historyResolvable = ctx.historyResolvable !== false;
  return ctx;
}

function writeTouchedScripts(ctx, count, sharedBlock) {
  ensureCtx(ctx);
  ctx.touchedScripts = [];
  for (let i = 0; i < count; i += 1) {
    const rel = `scripts/touched-${i}.sh`;
    const abs = path.join(ctx.repoRootFixture, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `#!/bin/sh\n${sharedBlock}\necho ${i}\n`, 'utf8');
    ctx.touchedScripts.push({ path: rel, text: fs.readFileSync(abs, 'utf8') });
  }
}

function duplicationOutcome(ctx) {
  if (!ctx.historyResolvable) {
    return { checked: false };
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
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    moveTicketToDone: () => {
      ctx.calls.move += 1;
      ctx.yamlMoved = true;
      return {
        moved: true,
        destination: path.join(ctx.repoRootFixture, 'backlog', 'done', `${ctx.ticketId}-fixture.yaml`),
      };
    },
    writeReceipt: (ticketId, receipt) => {
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
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl737-fixture.feature'),
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

  scoped(registry, /^the run's commits touched three shell scripts$/, (ctx) => {
    writeTouchedScripts(ctx, 3, helpBlock());
  });

  scoped(registry, /^the run's commits touched two shell scripts$/, (ctx) => {
    writeTouchedScripts(ctx, 2, helpBlock());
  });

  scoped(
    registry,
    /^the same twelve-line help block appears verbatim in each of those three files$/,
    (ctx) => {
      ensureCtx(ctx);
      if (ctx.touchedScripts.length !== 3) {
        writeTouchedScripts(ctx, 3, helpBlock());
      }
    }
  );

  scoped(
    registry,
    /^the same twelve-line help block appears verbatim in each of those two files$/,
    (ctx) => {
      ensureCtx(ctx);
      if (ctx.touchedScripts.length !== 2) {
        writeTouchedScripts(ctx, 2, helpBlock());
      }
    }
  );

  scoped(
    registry,
    /^the run's commits touched three shell scripts with a shared duplicated block$/,
    (ctx) => {
      writeTouchedScripts(ctx, 3, helpBlock());
    }
  );

  scoped(
    registry,
    /^an identical help block already exists in an untouched script outside the run$/,
    (ctx) => {
      ensureCtx(ctx);
      const block = helpBlock();
      const rel = 'scripts/untouched-outside.sh';
      const abs = path.join(ctx.repoRootFixture, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `#!/bin/sh\n${block}\n`, 'utf8');
      ctx.untouchedOutside = rel;
      ctx.outsideBlock = block;
    }
  );

  scoped(
    registry,
    /^the run's commits touched two scripts that share a new duplicated block$/,
    (ctx) => {
      ensureCtx(ctx);
      const block = ctx.outsideBlock || helpBlock();
      writeTouchedScripts(ctx, 2, block);
    }
  );

  scoped(registry, /^the gate cannot resolve which files the run's commits touched$/, (ctx) => {
    ensureCtx(ctx);
    ctx.historyResolvable = false;
  });

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the land is refused for cross-file duplication$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'cross-file-duplication') {
      throw new Error(`expected cross-file-duplication, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the refusal names at least two of the affected files$/, (ctx) => {
    const paths = ctx.outcome.duplicationPaths || [];
    if (paths.length < 2) {
      throw new Error(`expected >=2 duplication paths, got ${JSON.stringify(paths)}`);
    }
    const named = paths.filter((p) => ctx.outcome.reason.includes(p));
    if (named.length < 2) {
      throw new Error(`reason did not name two paths: ${ctx.outcome.reason}`);
    }
  });

  scoped(registry, /^the land is completed$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== true) {
      throw new Error(`expected land completed, got ${JSON.stringify(ctx.outcome)}`);
    }
  });

  scoped(registry, /^the ticket yaml stays where it was$/, (ctx) => {
    if (ctx.calls.move !== 0 || ctx.yamlMoved) {
      throw new Error('yaml was moved on a refused land');
    }
  });

  scoped(registry, /^no acceptance receipt is written$/, (ctx) => {
    if (ctx.calls.receipt !== 0 || ctx.writtenReceipt) {
      throw new Error('receipt was written on a refused land');
    }
  });

  scoped(
    registry,
    /^the outcome warns that cross-file duplication was not checked$/,
    (ctx) => {
      const warnings = ctx.outcome.warnings || [];
      if (!warnings.some((w) => /cross-file duplication was not checked/.test(w))) {
        throw new Error(`expected duplication-not-checked warning, got ${JSON.stringify(warnings)}`);
      }
    }
  );
}

module.exports = { registerSteps };
