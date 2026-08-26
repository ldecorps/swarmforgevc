'use strict';

// BL-731: lifecycle/teardown tickets must run acceptance under a realistic
// multi-worktree fixture before the pilot land gate moves them to done/.
// Drives the REAL compiled landPilotedTicket (extension/out/tools/pilotAcceptanceGate.js)
// in-process with injected fixture assessment — same pattern
// bl727PilotAcceptanceGateSteps.js established.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { landPilotedTicket, resolveFeatureFilePath } = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { MULTIWORKTREE_REQUIRED_REFUSAL } = require(path.join(EXT_DIR, 'out', 'tools', 'multiworktreeAcceptanceFixture'));
const { composePilotExpeditorPrompt } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgePilot'));

const FEATURE = 'lifecycle teardown tickets must run acceptance under multi-worktree conditions';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl731-'));
}

function defaultFixtureMetadata(ctx) {
  return {
    worktreeCount: ctx.multiworktreeSatisfied ? 2 : 1,
    siblingHandoffdRoots: ctx.multiworktreeSatisfied ? [path.join(ctx.repoRootFixture, 'sibling-worktree')] : [],
    pilotRoot: ctx.repoRootFixture,
  };
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-731-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.lifecycleTicket = ctx.lifecycleTicket !== undefined ? ctx.lifecycleTicket : true;
  ctx.multiworktreeSatisfied = ctx.multiworktreeSatisfied !== undefined ? ctx.multiworktreeSatisfied : false;
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/BL-637-lifecycle-script-names-lie-about-scope.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.fixtureMetadata = defaultFixtureMetadata(ctx);
  return ctx;
}

function baseDeps(ctx) {
  ensureCtx(ctx);
  let executedFeaturePath;
  return {
    readAcceptanceDeclaration: () => ctx.acceptanceDeclaration,
    resolveFeatureFilePath: (declaration) => resolveFeatureFilePath(ctx.repoRootFixture, declaration),
    isLifecycleTeardownTicket: () => ctx.lifecycleTicket,
    assessMultiworktreeFixture: () => ({
      satisfied: ctx.multiworktreeSatisfied,
      metadata: ctx.fixtureMetadata,
    }),
    runAcceptance: async () => {
      ctx.acceptanceRunCalled = true;
      ctx.lastAcceptanceRun = {
        ...ctx.acceptanceRunResult,
        multiWorktreeFixture: ctx.multiworktreeSatisfied ? ctx.fixtureMetadata : undefined,
      };
      return ctx.lastAcceptanceRun;
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
    getLandedCommit: () => 'f'.repeat(40),
    now: () => '2026-08-25T00:00:00.000Z',
  };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  scoped(registry, /^the pilot acceptance gate is the only landing path$/, () => {
    const prompt = composePilotExpeditorPrompt('BL-731-FIXTURE');
    if (!/node extension\/out\/tools\/pilot-acceptance-gate\.js BL-731-FIXTURE/.test(prompt)) {
      throw new Error(
        'composePilotExpeditorPrompt output does not invoke the pilot-acceptance-gate CLI - it must land through the gate (required_wiring)'
      );
    }
  });

  scoped(registry, /^a lifecycle or teardown-script ticket declares an acceptance feature$/, (ctx) => {
    ensureCtx(ctx);
    ctx.lifecycleTicket = true;
    fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.repoRootFixture, 'specs', 'features', 'BL-637-lifecycle-script-names-lie-about-scope.feature'),
      'Feature: lifecycle fixture\n',
      'utf8'
    );
  });

  // ── lifecycle-ticket-requires-multi-worktree-fixture-01 ─────────────
  scoped(
    registry,
    /^a lifecycle teardown ticket whose acceptance has not been executed under multi-worktree conditions$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.multiworktreeSatisfied = false;
    }
  );

  scoped(registry, /^the pilot attempts to land the ticket$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the land is refused$/, (ctx) => {
    if (ctx.outcome.landed !== false) {
      throw new Error(`expected the land to be refused, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  scoped(registry, /^the refusal names single-worktree-only acceptance as insufficient$/, (ctx) => {
    if (ctx.outcome.reasonKind !== 'multiworktree-required') {
      throw new Error(`expected multiworktree-required refusal, got: ${JSON.stringify(ctx.outcome)}`);
    }
    if (!ctx.outcome.reason.includes(MULTIWORKTREE_REQUIRED_REFUSAL)) {
      throw new Error(`expected refusal to name single-worktree-only insufficiency, got: ${ctx.outcome.reason}`);
    }
  });

  // ── acceptance-runs-with-sibling-handoffd-02 ────────────────────────
  scoped(registry, /^at least two worktrees for this repo are active$/, (ctx) => {
    ensureCtx(ctx);
    ctx.multiworktreeSatisfied = true;
    ctx.fixtureMetadata = { ...defaultFixtureMetadata(ctx), worktreeCount: 2 };
  });

  scoped(registry, /^a sibling worktree has handoffd\.bb running for its own root$/, (ctx) => {
    ensureCtx(ctx);
    ctx.multiworktreeSatisfied = true;
    ctx.fixtureMetadata = defaultFixtureMetadata(ctx);
  });

  scoped(registry, /^the pilot runs the ticket's acceptance contract before land$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.acceptanceRunResult = { success: true, output: 'ok' };
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the acceptance pipeline executes under that multi-worktree fixture$/, (ctx) => {
    if (!ctx.acceptanceRunCalled) {
      throw new Error('expected the acceptance pipeline to run under the multi-worktree fixture');
    }
    if (!ctx.multiworktreeSatisfied) {
      throw new Error('expected the multi-worktree fixture to be satisfied before acceptance ran');
    }
  });

  scoped(registry, /^the run records multi-worktree environment metadata$/, (ctx) => {
    const metadata = ctx.lastAcceptanceRun?.multiWorktreeFixture;
    if (!metadata || metadata.worktreeCount < 2 || metadata.siblingHandoffdRoots.length < 1) {
      throw new Error(`expected multi-worktree metadata on the acceptance run, got: ${JSON.stringify(metadata)}`);
    }
  });

  // ── multi-worktree-green-lands-with-receipt-03 ──────────────────────
  scoped(
    registry,
    /^a lifecycle teardown ticket whose acceptance passes under multi-worktree conditions$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.multiworktreeSatisfied = true;
      ctx.fixtureMetadata = defaultFixtureMetadata(ctx);
      ctx.acceptanceRunResult = { success: true, output: 'ok' };
    }
  );

  scoped(registry, /^the pilot lands the ticket$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the ticket yaml is moved to backlog\/done\/$/, (ctx) => {
    if (ctx.outcome.landed !== true || ctx.calls.move !== 1) {
      throw new Error(`expected a successful move to backlog/done/, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  scoped(registry, /^the acceptance receipt records the multi-worktree fixture was used$/, (ctx) => {
    const fixture = ctx.writtenReceipt?.multiWorktreeFixture;
    if (!fixture || fixture.worktreeCount < 2 || fixture.siblingHandoffdRoots.length < 1) {
      throw new Error(`expected receipt multiWorktreeFixture metadata, got: ${JSON.stringify(ctx.writtenReceipt)}`);
    }
  });

  // ── multi-worktree-failure-refuses-inert-04 ─────────────────────────
  scoped(
    registry,
    /^a lifecycle teardown ticket whose acceptance fails under multi-worktree conditions$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.multiworktreeSatisfied = true;
      ctx.fixtureMetadata = defaultFixtureMetadata(ctx);
      ctx.acceptanceRunResult = {
        success: false,
        output: 'Scenario "fixture" failed at step "Then it passes": expected green, got red\n',
      };
    }
  );

  scoped(registry, /^the ticket yaml still sits in backlog\/active\/$/, (ctx) => {
    if (ctx.calls.move !== 0) {
      throw new Error(`expected no move to backlog/done/, got ${ctx.calls.move} move(s)`);
    }
  });

  scoped(registry, /^no acceptance receipt is written$/, (ctx) => {
    if (ctx.calls.receipt !== 0) {
      throw new Error(`expected no acceptance receipt to be written, got ${ctx.calls.receipt}`);
    }
  });
}

module.exports = { registerSteps };
