'use strict';

// BL-743: mkTmpDir convention gate on /pilot land for touched extension/test files.
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessPilotMkdtempConvention,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { mkTmpDir } = require(path.join(EXT_DIR, 'test', 'helpers', 'tmpDir'));

const HARDENDER = path.join(REPO_ROOT, 'swarmforge', 'roles', 'hardender.prompt');

const FEATURE = 'pilot land gate checks new tests against the shared mkTmpDir convention';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function ensureMkdtempGuardTree(ctx) {
  const guardDir = path.join(ctx.repoRootFixture, 'extension', 'test', 'helpers');
  fs.mkdirSync(guardDir, { recursive: true });
  fs.copyFileSync(
    path.join(EXT_DIR, 'test', 'helpers', 'rawMkdtempGuard.js'),
    path.join(guardDir, 'rawMkdtempGuard.js')
  );
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-743-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkTmpDir('aps-bl743-');
  ensureMkdtempGuardTree(ctx);
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl743-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.touchedTestPaths = ctx.touchedTestPaths || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  return ctx;
}

function mkdtempOutcome(ctx) {
  ensureCtx(ctx);
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  if (ctx.forcedMkdtempOutcome) {
    return ctx.forcedMkdtempOutcome;
  }
  if (ctx.touchedTestPaths.length === 0) {
    return { checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] };
  }
  return assessPilotMkdtempConvention(ctx.repoRootFixture, ctx.touchedTestPaths);
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
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => {
      ctx.mkdtempCheckCalled = true;
      const outcome = mkdtempOutcome(ctx);
      ctx.lastMkdtempOutcome = outcome;
      return outcome;
    },
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
    getLandedCommit: () => 'e'.repeat(40),
    now: () => '2026-08-26T00:00:00.000Z',
  };
}

async function runGate(ctx) {
  ensureCtx(ctx);
  fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl743-fixture.feature'),
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

  scoped(registry, /^the run's commits touched extension\/test files$/, (ctx) => {
    ensureCtx(ctx);
    const rel = 'extension/test/bl743Fixture.test.js';
    const abs = path.join(ctx.repoRootFixture, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "const { mkTmpDir } = require('./helpers/tmpDir');\n", 'utf8');
    ctx.touchedTestPaths = [rel];
  });

  scoped(
    registry,
    /^the run's commits added a test that calls fs\.mkdtempSync directly$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/test/bl743RawMkdtemp.test.js';
      const abs = path.join(ctx.repoRootFixture, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(
        abs,
        "const fs = require('fs'); const os = require('os'); const path = require('path');\n" +
          "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-'));\n",
        'utf8'
      );
      ctx.touchedTestPaths = [rel];
    }
  );

  scoped(
    registry,
    /^the run's commits touched a test file that allocates temp dirs only via mkTmpDir$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/test/bl743MkTmpDirOnly.test.js';
      const abs = path.join(ctx.repoRootFixture, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(
        abs,
        "const { mkTmpDir } = require('./helpers/tmpDir');\nconst dir = mkTmpDir('ok-');\n",
        'utf8'
      );
      ctx.touchedTestPaths = [rel];
    }
  );

  scoped(
    registry,
    /^the run's commits touched a test with raw mkdtempSync outside the shared helper$/,
    (ctx) => {
      ensureCtx(ctx);
      const rel = 'extension/test/bl743Violating.test.js';
      const abs = path.join(ctx.repoRootFixture, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(
        abs,
        "const fs = require('fs'); const os = require('os'); const path = require('path');\n" +
          "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-'));\n",
        'utf8'
      );
      ctx.touchedTestPaths = [rel];
    }
  );

  scoped(registry, /^the hardener role prompt is read$/, (ctx) => {
    ctx.hardenderPrompt = fs.readFileSync(HARDENDER, 'utf8');
  });

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(
    registry,
    /^the gate scans those touched paths for raw mkdtempSync call sites outside helpers\/tmpDir\.js$/,
    (ctx) => {
      if (!ctx.mkdtempCheckCalled) {
        throw new Error('mkdtemp convention check was not invoked');
      }
      const outcome = ctx.lastMkdtempOutcome || mkdtempOutcome(ctx);
      if (!outcome.checked || outcome.testFilesScanned < 1) {
        throw new Error(`expected scanned test files, got ${JSON.stringify(outcome)}`);
      }
    }
  );

  scoped(registry, /^the land is refused for raw mkdtemp outside the shared helper$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'raw-mkdtemp-outside-helper') {
      throw new Error(`expected raw-mkdtemp-outside-helper, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the refusal names the offending test file$/, (ctx) => {
    const file = ctx.outcome.mkdtempFile || '';
    const reason = ctx.outcome.reason || '';
    if (!file || !reason.includes(file)) {
      throw new Error(`refusal did not name test file: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  scoped(
    registry,
    /^the mkdtemp convention check completes without refusal for that file$/,
    (ctx) => {
      if (!ctx.mkdtempCheckCalled) {
        throw new Error('mkdtemp check did not run');
      }
      if (ctx.outcome && ctx.outcome.reasonKind === 'raw-mkdtemp-outside-helper') {
        throw new Error('mkdtemp convention refused the land');
      }
    }
  );

  scoped(
    registry,
    /^it requires new or touched tests using os\.tmpdir to use mkTmpDir not raw mkdtempSync$/,
    (ctx) => {
      const text = ctx.hardenderPrompt || '';
      if (!/mkTmpDir/i.test(text) || !/mkdtempSync/i.test(text)) {
        throw new Error('hardender.prompt missing mkTmpDir vs mkdtempSync guidance');
      }
    }
  );

  scoped(
    registry,
    /^it states this check runs at pilot or pipeline land not only in a later repo-wide sweep$/,
    (ctx) => {
      const text = ctx.hardenderPrompt || '';
      if (!/pilot or pipeline land/i.test(text) || !/tmpDirMigrationGuard/i.test(text)) {
        throw new Error('hardender.prompt missing pre-land vs sweep guidance');
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
