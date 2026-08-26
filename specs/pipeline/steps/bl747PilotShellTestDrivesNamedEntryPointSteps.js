'use strict';

// BL-747: shell entry-point drive gate on /pilot land. Drives REAL landPilotedTicket.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { assessShellEntryPointDrive } = require(path.join(
  EXT_DIR,
  'out',
  'tools',
  'shellEntryPointDriveCheck'
));

const FEATURE =
  'Pilot land gate refuses shell tests that name an entry-point but never invoke it';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl747-'));
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-747-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl747-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.ticketYaml = ctx.ticketYaml || '';
  ctx.shellTests = ctx.shellTests || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  return ctx;
}

function shellDriveOutcome(ctx) {
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  return assessShellEntryPointDrive({
    ticketYaml: ctx.ticketYaml,
    shellTests: ctx.shellTests,
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
    checkShellEntryPointDrive: () => shellDriveOutcome(ctx),
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
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl747-fixture.feature'),
    'Feature: fixture\n',
    'utf8'
  );
  ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
}

function setNamedStopSwarm(ctx) {
  ensureCtx(ctx);
  ctx.ticketYaml = 'description: |\n  verifies stop-swarm.sh refuse-gate behaviour\n';
}

function setHelperOnlyTest(ctx) {
  ensureCtx(ctx);
  ctx.shellTests = [
    {
      path: 'swarmforge/scripts/test/test_lifecycle_script_scope.sh',
      text: 'source "$ROOT/swarmforge/scripts/lib/stack_survivor_scan.sh"\necho "full stack SUCCESS — clean slate"\n',
    },
  ];
}

function setInvokingTest(ctx) {
  ensureCtx(ctx);
  ctx.shellTests = [
    {
      path: 'swarmforge/scripts/test/test_lifecycle_script_scope.sh',
      text: 'bash "$ROOT/swarmforge/scripts/stop-swarm.sh" --full-stack\n',
    },
  ];
}

function registerSteps(registry) {
  scoped(registry, /^a piloted ticket whose declared acceptance contract has just passed$/, (ctx) => {
    ensureCtx(ctx);
    ctx.acceptanceRunResult = { success: true, output: 'ok' };
  });

  scoped(registry, /^the ticket names stop-swarm\.sh as an entry-point under test$/, (ctx) => {
    setNamedStopSwarm(ctx);
  });

  scoped(registry, /^the ticket names no non-test shell entry-point under test$/, (ctx) => {
    ensureCtx(ctx);
    ctx.ticketYaml = 'description: helper-only coverage, no production script named\n';
  });

  scoped(
    registry,
    /^the run's commits touched a shell test that sources stack_survivor_scan\.sh$/,
    (ctx) => {
      setHelperOnlyTest(ctx);
    }
  );

  scoped(registry, /^that shell test never invokes stop-swarm\.sh$/, (ctx) => {
    ensureCtx(ctx);
    if (!ctx.shellTests.length) setHelperOnlyTest(ctx);
  });

  scoped(
    registry,
    /^the run's commits touched a shell test that sources a helper without invoking stop-swarm\.sh$/,
    (ctx) => {
      setHelperOnlyTest(ctx);
    }
  );

  scoped(registry, /^the run's commits touched a shell test that invokes stop-swarm\.sh$/, (ctx) => {
    setInvokingTest(ctx);
  });

  scoped(registry, /^the run's commits touched no shell test files$/, (ctx) => {
    ensureCtx(ctx);
    ctx.shellTests = [];
  });

  scoped(
    registry,
    /^the run's commits touched a shell test that only sources a helper$/,
    (ctx) => {
      setHelperOnlyTest(ctx);
    }
  );

  scoped(
    registry,
    /^the gate cannot resolve the ticket yaml or which shell tests the run touched$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.historyResolvable = false;
    }
  );

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the land is refused for parallel shell reimplementation$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'parallel-shell-reimplementation') {
      throw new Error(`expected parallel-shell-reimplementation, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the refusal names the entry-point and the test file$/, (ctx) => {
    if (!ctx.outcome.shellEntryPoint || !ctx.outcome.shellTestPath) {
      throw new Error(`missing shellEntryPoint/shellTestPath on ${JSON.stringify(ctx.outcome)}`);
    }
    if (!ctx.outcome.reason.includes(ctx.outcome.shellEntryPoint)) {
      throw new Error(`reason missing entry-point: ${ctx.outcome.reason}`);
    }
    if (!ctx.outcome.reason.includes(path.basename(ctx.outcome.shellTestPath))) {
      throw new Error(`reason missing test basename: ${ctx.outcome.reason}`);
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
    /^the outcome warns that shell entry-point drive was not checked$/,
    (ctx) => {
      const warnings = ctx.outcome.warnings || [];
      if (!warnings.some((w) => /shell entry-point drive was not checked/.test(w))) {
        throw new Error(`expected shell-drive warning, got ${JSON.stringify(warnings)}`);
      }
    }
  );
}

module.exports = { registerSteps };
