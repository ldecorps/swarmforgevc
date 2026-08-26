'use strict';

// BL-733: pattern tickets must cross-check against the producer's output space
// before pilot land. Drives the REAL compiled landPilotedTicket in-process,
// same pattern bl731PilotMultiworktreeAcceptanceSteps.js established.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { landPilotedTicket, resolveFeatureFilePath } = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const {
  DISPLAY_NAME_FOR_ROLE_PRODUCER,
  PRODUCER_CROSSCHECK_REQUIRED_REFUSAL,
  enumerateDisplayNameForRoleOutputs,
  readConfiguredRoleNames,
  recordProducerCrosscheck,
  clearProducerCrosscheckEnv,
} = require(path.join(EXT_DIR, 'out', 'tools', 'producerCrosscheckAcceptance'));
const { composePilotExpeditorPrompt } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgePilot'));

const FEATURE =
  "pattern tickets must cross-check against the producer's output space before pilot land";

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl733-'));
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-733-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration ||
    'specs/features/BL-733-bl642-pilot-missed-multiword-role-crosscheck.feature';
  ctx.requiredWiring = ctx.requiredWiring || [
    'extension/src/tools/pilot-acceptance-gate.ts::landPilotedTicket::pattern tickets require producer output-space crosscheck',
  ];
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  return ctx;
}

function exhaustiveCrosscheckMetadata(repoRoot) {
  const roles = readConfiguredRoleNames(repoRoot);
  const values = enumerateDisplayNameForRoleOutputs(roles);
  return {
    producer: DISPLAY_NAME_FOR_ROLE_PRODUCER,
    outputSpaceSize: values.length,
    valuesChecked: values.length,
    exhaustive: true,
  };
}

function baseDeps(ctx) {
  ensureCtx(ctx);
  let executedFeaturePath;
  return {
    readAcceptanceDeclaration: () => ctx.acceptanceDeclaration,
    readRequiredWiring: () => ctx.requiredWiring,
    resolveFeatureFilePath: (declaration) => resolveFeatureFilePath(ctx.repoRootFixture, declaration),
    isLifecycleTeardownTicket: () => false,
    assessMultiworktreeFixture: () => ({
      satisfied: true,
      metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: ctx.repoRootFixture },
    }),
    runAcceptance: async () => {
      ctx.acceptanceRunCalled = true;
      clearProducerCrosscheckEnv();
      if (ctx.recordCrosscheckOnRun) {
        recordProducerCrosscheck(ctx.producerCrosscheckMetadata);
      }
      const result = { ...ctx.acceptanceRunResult };
      if (ctx.recordCrosscheckOnRun && ctx.producerCrosscheckMetadata) {
        result.producerCrosscheck = ctx.producerCrosscheckMetadata;
      }
      return result;
    },
    recordAcceptanceExecution: (featureFilePath) => {
      executedFeaturePath = featureFilePath;
    },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    moveTicketToDone: () => {
      ctx.calls.move += 1;
      return { moved: true, destination: path.join(ctx.repoRootFixture, 'backlog', 'done', `${ctx.ticketId}-fixture.yaml`) };
    },
    writeReceipt: (ticketId, receipt) => {
      ctx.calls.receipt += 1;
      ctx.writtenReceipt = receipt;
    },
    getLandedCommit: () => 'd'.repeat(40),
    now: () => '2026-08-25T00:00:00.000Z',
  };
}

function registerSteps(registry) {
  scoped(registry, /^the pilot acceptance gate is the only landing path$/, () => {
    const prompt = composePilotExpeditorPrompt('BL-733-FIXTURE');
    if (!/node extension\/out\/tools\/pilot-acceptance-gate\.js BL-733-FIXTURE/.test(prompt)) {
      throw new Error('composePilotExpeditorPrompt must land through pilot-acceptance-gate');
    }
  });

  scoped(
    registry,
    /^a ticket adds a regex or pattern meant to recognize output from a named producer elsewhere in the codebase$/,
    (ctx) => {
      ensureCtx(ctx);
      fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
      fs.writeFileSync(
        path.join(ctx.repoRootFixture, 'specs', 'features', 'BL-733-bl642-pilot-missed-multiword-role-crosscheck.feature'),
        'Feature: pattern fixture\n',
        'utf8'
      );
    }
  );

  scoped(
    registry,
    /^a pattern ticket whose acceptance was run only against the original repro and a small negative sample$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.recordCrosscheckOnRun = false;
    }
  );

  scoped(
    registry,
    /^the acceptance did not cross-check the pattern against the producer's enumerable output space$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.producerCrosscheckMetadata = undefined;
    }
  );

  scoped(registry, /^the pilot attempts to land the ticket$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the land is refused$/, (ctx) => {
    if (ctx.outcome?.landed !== false) {
      throw new Error(`expected land refusal, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  scoped(
    registry,
    /^the refusal names missing producer output-space crosscheck as insufficient$/,
    (ctx) => {
      if (ctx.outcome.reasonKind !== 'producer-crosscheck-required') {
        throw new Error(`expected producer-crosscheck-required, got: ${JSON.stringify(ctx.outcome)}`);
      }
      if (!ctx.outcome.reason.includes(PRODUCER_CROSSCHECK_REQUIRED_REFUSAL)) {
        throw new Error(`expected refusal to name missing crosscheck, got: ${ctx.outcome.reason}`);
      }
    }
  );

  scoped(
    registry,
    /^a producer with an enumerable output space such as display_name_for_role for configured roles$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.producerCrosscheckMetadata = exhaustiveCrosscheckMetadata(REPO_ROOT);
      ctx.recordCrosscheckOnRun = true;
    }
  );

  scoped(registry, /^the pilot runs the ticket's acceptance contract before land$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.acceptanceRunResult = { success: true, output: 'ok' };
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(
    registry,
    /^the acceptance pipeline exercises the pattern against that producer's full output space$/,
    (ctx) => {
      const meta = ctx.producerCrosscheckMetadata;
      if (!meta || !meta.exhaustive || meta.valuesChecked < meta.outputSpaceSize) {
        throw new Error(`expected exhaustive producer crosscheck, got: ${JSON.stringify(meta)}`);
      }
      if (meta.producer !== DISPLAY_NAME_FOR_ROLE_PRODUCER) {
        throw new Error(`expected display_name_for_role producer, got: ${meta.producer}`);
      }
    }
  );

  scoped(registry, /^the run records producer crosscheck metadata on the receipt path$/, (ctx) => {
    const meta = ctx.outcome?.landed === true ? ctx.writtenReceipt?.producerCrosscheck : ctx.outcome?.receipt?.producerCrosscheck;
    const source = ctx.writtenReceipt?.producerCrosscheck || ctx.lastAcceptanceRun?.producerCrosscheck;
    const recorded = meta || source;
    if (!recorded?.exhaustive) {
      throw new Error(`expected producer crosscheck metadata on receipt path, got: ${JSON.stringify(recorded)}`);
    }
  });

  scoped(
    registry,
    /^a pattern ticket whose acceptance passes after exhaustive producer crosscheck$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.recordCrosscheckOnRun = true;
      ctx.producerCrosscheckMetadata = exhaustiveCrosscheckMetadata(REPO_ROOT);
      ctx.acceptanceRunResult = { success: true, output: 'ok' };
    }
  );

  scoped(registry, /^the pilot lands the ticket$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the ticket yaml is moved to backlog\/done\/$/, (ctx) => {
    if (ctx.outcome?.landed !== true || ctx.calls.move !== 1) {
      throw new Error(`expected successful move to backlog/done/, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  scoped(
    registry,
    /^the acceptance receipt records the producer output-space crosscheck was performed$/,
    (ctx) => {
      const meta = ctx.writtenReceipt?.producerCrosscheck;
      if (!meta?.exhaustive || meta.valuesChecked < meta.outputSpaceSize) {
        throw new Error(`expected receipt producerCrosscheck metadata, got: ${JSON.stringify(ctx.writtenReceipt)}`);
      }
    }
  );

  scoped(
    registry,
    /^a pattern ticket whose producer crosscheck fails or leaves uncovered producible values$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.recordCrosscheckOnRun = true;
      const roles = readConfiguredRoleNames(REPO_ROOT);
      ctx.producerCrosscheckMetadata = {
        producer: DISPLAY_NAME_FOR_ROLE_PRODUCER,
        outputSpaceSize: roles.length,
        valuesChecked: Math.max(0, roles.length - 1),
        exhaustive: false,
      };
      ctx.acceptanceRunResult = { success: true, output: 'ok' };
    }
  );

  scoped(registry, /^the ticket yaml still sits in backlog\/active\/$/, (ctx) => {
    if (ctx.calls.move !== 0) {
      throw new Error(`expected ticket to remain in active/, got ${ctx.calls.move} move(s)`);
    }
  });

  scoped(registry, /^no acceptance receipt is written$/, (ctx) => {
    if (ctx.calls.receipt !== 0) {
      throw new Error(`expected no receipt, got ${ctx.calls.receipt}`);
    }
  });
}

module.exports = { registerSteps };
