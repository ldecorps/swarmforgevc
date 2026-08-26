'use strict';

// BL-735: step handlers for pilot acceptance execution tracking and
// revert-then-reland note requirements. Drives the REAL compiled
// landPilotedTicket in-process, same pattern bl733PilotProducerCrosscheckSteps.js.
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
  ACCEPTANCE_NOT_EXECUTED_REFUSAL,
  RELAND_NOTES_REQUIRED_REFUSAL,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceExecution'));
const { composePilotExpeditorPrompt } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgePilot'));

const FEATURE =
  'a piloted ticket cannot land without its acceptance feature actually executing';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl735-'));
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-735-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl735-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  return ctx;
}

function baseDeps(ctx) {
  ensureCtx(ctx);
  let executedFeaturePath;
  return {
    readAcceptanceDeclaration: () => ctx.acceptanceDeclaration,
    readTicketNotes: () => ctx.ticketNotes,
    acceptanceReceiptExists: () => Boolean(ctx.acceptanceReceiptExists),
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
    recordAcceptanceExecution: ctx.suppressExecutionRecord
      ? () => {}
      : (featureFilePath) => {
          executedFeaturePath = featureFilePath;
        },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    moveTicketToDone: () => {
      ctx.calls.move += 1;
      return { moved: true, destination: path.join(ctx.repoRootFixture, 'backlog', 'done', `${ctx.ticketId}-fixture.yaml`) };
    },
    writeReceipt: (ticketId, receipt) => {
      ctx.calls.receipt += 1;
      ctx.writtenReceipt = receipt;
    },
    getLandedCommit: () => 'e'.repeat(40),
    now: () => '2026-08-25T00:00:00.000Z',
  };
}

function registerSteps(registry) {
  scoped(registry, /^the pilot acceptance gate is the only landing path$/, () => {
    const prompt = composePilotExpeditorPrompt('BL-735-FIXTURE');
    if (!/node extension\/out\/tools\/pilot-acceptance-gate\.js BL-735-FIXTURE/.test(prompt)) {
      throw new Error('composePilotExpeditorPrompt must land through pilot-acceptance-gate');
    }
  });

  scoped(registry, /^a piloted ticket in backlog\/active declares an acceptance feature file$/, (ctx) => {
    ensureCtx(ctx);
    ctx.acceptanceDeclaration = 'specs/features/bl735-fixture.feature';
  });

  scoped(registry, /^the ticket's acceptance feature file exists on disk$/, (ctx) => {
    ensureCtx(ctx);
    fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.repoRootFixture, 'specs', 'features', 'bl735-fixture.feature'),
      'Feature: fixture\n',
      'utf8'
    );
  });

  scoped(
    registry,
    /^the acceptance pipeline has not been run for this ticket at this landing attempt$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.suppressExecutionRecord = true;
    }
  );

  scoped(registry, /^the ticket's acceptance feature file passes through the acceptance pipeline$/, (ctx) => {
    ensureCtx(ctx);
    fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.repoRootFixture, 'specs', 'features', 'bl735-fixture.feature'),
      'Feature: fixture\n',
      'utf8'
    );
    ctx.acceptanceRunResult = { success: true, output: 'ok' };
  });

  scoped(registry, /^the ticket's acceptance feature file fails in the acceptance pipeline$/, (ctx) => {
    ensureCtx(ctx);
    fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.repoRootFixture, 'specs', 'features', 'bl735-fixture.feature'),
      'Feature: fixture\n',
      'utf8'
    );
    ctx.acceptanceRunResult = {
      success: false,
      output: 'Scenario "fixture" failed at step "Then it passes": expected green, got red\n',
    };
  });

  scoped(
    registry,
    /^a ticket that was previously landed to backlog\/done and then reverted to backlog\/active$/,
    (ctx) => {
      ensureCtx(ctx);
      fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
      fs.writeFileSync(
        path.join(ctx.repoRootFixture, 'specs', 'features', 'bl735-fixture.feature'),
        'Feature: fixture\n',
        'utf8'
      );
      ctx.acceptanceDeclaration = 'specs/features/bl735-fixture.feature';
      ctx.acceptanceRunResult = { success: true, output: 'ok' };
      ctx.ticketNotes =
        'First landing reverted because acceptance never ran. Re-land is warranted because the pilot gate now executes acceptance.';
    }
  );

  scoped(
    registry,
    /^a ticket that was once landed to backlog\/done without an acceptance receipt$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.ticketNotes =
        'Previously landed to backlog/done without an acceptance receipt; reverted to active.';
      ctx.acceptanceReceiptExists = false;
      ctx.suppressExecutionRecord = true;
    }
  );

  scoped(registry, /^the ticket was reverted and sits in backlog\/active again$/, (ctx) => {
    ensureCtx(ctx);
    if (!ctx.ticketNotes) {
      ctx.ticketNotes =
        'Previously landed to backlog/done without an acceptance receipt; reverted to active.';
    }
    ctx.acceptanceReceiptExists = false;
  });

  scoped(registry, /^neither landing attempt executed the acceptance feature$/, (ctx) => {
    ensureCtx(ctx);
    ctx.suppressExecutionRecord = true;
  });

  scoped(registry, /^the pilot attempts to land the ticket$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the pilot lands the ticket$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the pilot lands the ticket again$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the land is refused$/, (ctx) => {
    if (ctx.outcome.landed !== false) {
      throw new Error(`expected the land to be refused, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  scoped(registry, /^the refusal names that acceptance was declared but not executed$/, (ctx) => {
    if (!ctx.outcome.reason.includes(ACCEPTANCE_NOT_EXECUTED_REFUSAL)) {
      throw new Error(`expected refusal to name acceptance-not-executed, got: ${ctx.outcome.reason}`);
    }
    if (ctx.outcome.reasonKind !== 'acceptance-not-executed') {
      throw new Error(`expected reasonKind acceptance-not-executed, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the acceptance pipeline executed before the yaml moved$/, (ctx) => {
    if (!ctx.acceptanceRunCalled) {
      throw new Error('expected runAcceptance to have been called before the yaml move');
    }
    if (ctx.calls.move !== 1) {
      throw new Error(`expected exactly one move after acceptance ran, got ${ctx.calls.move}`);
    }
  });

  scoped(registry, /^the ticket yaml is moved to backlog\/done\/$/, (ctx) => {
    if (ctx.outcome.landed !== true) {
      throw new Error(`expected landed=true, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.calls.move !== 1) {
      throw new Error(`expected one move, got ${ctx.calls.move}`);
    }
  });

  scoped(
    registry,
    /^an acceptance receipt records the feature file path and passing result$/,
    (ctx) => {
      if (ctx.calls.receipt !== 1 || !ctx.writtenReceipt) {
        throw new Error('expected exactly one acceptance receipt');
      }
      if (!ctx.writtenReceipt.featureFile || ctx.writtenReceipt.result !== 'passed') {
        throw new Error(`receipt missing fields: ${JSON.stringify(ctx.writtenReceipt)}`);
      }
    }
  );

  scoped(registry, /^the ticket yaml notes explain why the first landing was reverted$/, (ctx) => {
    const notes = ctx.ticketNotes || '';
    if (!/\brevert/i.test(notes) || !/\bbecause\b/i.test(notes)) {
      throw new Error(`notes do not explain the revert: ${notes}`);
    }
  });

  scoped(registry, /^the notes explain why the reland is warranted$/, (ctx) => {
    const notes = ctx.ticketNotes || '';
    if (!(/\bre-?land/i.test(notes) || /\bwarrant/i.test(notes))) {
      throw new Error(`notes do not explain why the reland is warranted: ${notes}`);
    }
  });

  scoped(registry, /^the ticket yaml still sits in backlog\/active\/$/, (ctx) => {
    if (ctx.calls.move !== 0) {
      throw new Error(`expected no move to backlog/done/, got ${ctx.calls.move}`);
    }
  });

  scoped(registry, /^no acceptance receipt is written$/, (ctx) => {
    if (ctx.calls.receipt !== 0) {
      throw new Error(`expected no receipt, got ${ctx.calls.receipt}`);
    }
  });
}

module.exports = { registerSteps };
