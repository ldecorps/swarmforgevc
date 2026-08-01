'use strict';

// BL-727: step handlers for "a piloted ticket cannot land without executing
// its own acceptance contract". Drives the REAL compiled landPilotedTicket /
// resolveFeatureFilePath (extension/out/tools/pilotAcceptanceGate.js) - the
// gate's pure decision logic - in-process, same pattern
// onboardingContractSteps.js established: no live swarm, real repo checkout,
// or tmux socket needed for the DECISION logic itself. The one real-disk
// piece exercised here is resolveFeatureFilePath against a throwaway tmp
// repo (scenario outline 03), proving the fs-existence check for real
// rather than stubbing it away.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { landPilotedTicket, resolveFeatureFilePath } = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const { composePilotExpeditorPrompt } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgePilot'));

const FEATURE = 'A piloted ticket cannot land without executing its own acceptance contract';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// Fresh per-ticket temp dir so resolveFeatureFilePath's fs.statSync hits a
// real, isolated filesystem - never a shared/live path.
function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl727-'));
}

const CONTRACT_STATE_OUTPUT = {
  'has a step no step handler matches': 'Scenario "Renders the tile": no step handler matched "Given a fixture with no handler"\n',
  'has a scenario whose assertion fails': 'Scenario "Renders the tile" failed at step "Then it renders": expected green, got red\n',
};

const REFUSAL_NAME_FIELD = {
  'the unmatched step': 'unmatchedStep',
  'the failing scenario': 'failingScenario',
};

const ACCEPTANCE_DECLARATION_FIXTURES = {
  absent: () => undefined,
  'inline Gherkin text naming no feature file': () => 'Feature: inline\n  Scenario: works\n    Given a thing\n',
  'a feature file path that does not exist': () => 'specs/features/does-not-exist-BL-727.feature',
};

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-727-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  return ctx;
}

function baseDeps(ctx) {
  return {
    readAcceptanceDeclaration: () => ctx.acceptanceDeclaration,
    resolveFeatureFilePath: (declaration) =>
      ctx.resolveOverride ? ctx.resolveOverride(declaration) : resolveFeatureFilePath(ctx.repoRootFixture, declaration),
    runAcceptance: async () => ctx.acceptanceRunResult,
    // BL-729 added a second refusal reason to this same landing path; this
    // feature is about the FIRST one (acceptance-contract execution), so
    // every claim here is unconditionally supported - never the axis under
    // test in bl727PilotAcceptanceGateSteps.js.
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    moveTicketToDone: () => {
      ctx.calls.move += 1;
      return { moved: true, destination: path.join(ctx.repoRootFixture, 'backlog', 'done', `${ctx.ticketId}-fixture.yaml`) };
    },
    writeReceipt: (ticketId, receipt) => {
      ctx.calls.receipt += 1;
      ctx.writtenReceipt = receipt;
    },
    getLandedCommit: () => 'a'.repeat(40),
    now: () => '2026-07-31T00:00:00.000Z',
  };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  scoped(registry, /^a piloted ticket whose yaml sits in backlog\/active\/$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(registry, /^the acceptance-contract gate is the pilot's only landing path$/, () => {
    const prompt = composePilotExpeditorPrompt('BL-727-FIXTURE');
    if (!/node extension\/out\/tools\/pilot-acceptance-gate\.js BL-727-FIXTURE/.test(prompt)) {
      throw new Error(
        'composePilotExpeditorPrompt output does not invoke the pilot-acceptance-gate CLI - it must land through the gate, not a bare git mv (required_wiring)'
      );
    }
    if (/land it by running `git mv`/.test(prompt)) {
      throw new Error('composePilotExpeditorPrompt output still instructs a bare "git mv" landing path');
    }
  });

  // ── pilot-acceptance-gate-01: a failing contract refuses the land ───
  scoped(registry, /^the ticket declares a feature file that (.+)$/, (ctx, contractState) => {
    ensureCtx(ctx);
    if (!(contractState in CONTRACT_STATE_OUTPUT)) {
      throw new Error(`unknown contract state example value: "${contractState}" (known: ${Object.keys(CONTRACT_STATE_OUTPUT).join(', ')})`);
    }
    ctx.acceptanceDeclaration = 'specs/features/bl727-fixture.feature';
    fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
    fs.writeFileSync(path.join(ctx.repoRootFixture, 'specs', 'features', 'bl727-fixture.feature'), 'Feature: fixture\n', 'utf8');
    ctx.acceptanceRunResult = { success: false, output: CONTRACT_STATE_OUTPUT[contractState] };
  });

  scoped(registry, /^the pilot lands the ticket$/, async (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
  });

  scoped(registry, /^the land is refused$/, (ctx) => {
    if (ctx.outcome.landed !== false) {
      throw new Error(`expected the land to be refused, got landed=${ctx.outcome.landed}`);
    }
  });

  scoped(registry, /^the refusal names (.+)$/, (ctx, namedIn) => {
    if (!(namedIn in REFUSAL_NAME_FIELD)) {
      throw new Error(`unknown "named in refusal" example value: "${namedIn}" (known: ${Object.keys(REFUSAL_NAME_FIELD).join(', ')})`);
    }
    const field = REFUSAL_NAME_FIELD[namedIn];
    const value = ctx.outcome[field];
    if (!value) {
      throw new Error(`expected refusal to name ${namedIn} (outcome.${field}), got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  // ── pilot-acceptance-gate-02: a passing contract lands with a receipt ─
  scoped(registry, /^the ticket declares a feature file whose every scenario passes$/, (ctx) => {
    ensureCtx(ctx);
    ctx.acceptanceDeclaration = 'specs/features/bl727-fixture.feature';
    fs.mkdirSync(path.join(ctx.repoRootFixture, 'specs', 'features'), { recursive: true });
    fs.writeFileSync(path.join(ctx.repoRootFixture, 'specs', 'features', 'bl727-fixture.feature'), 'Feature: fixture\n', 'utf8');
    ctx.acceptanceRunResult = { success: true, output: 'ok' };
  });

  scoped(registry, /^the ticket yaml is moved to backlog\/done\/$/, (ctx) => {
    if (ctx.outcome.landed !== true) {
      throw new Error(`expected the land to succeed, got: ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.calls.move !== 1 || !ctx.outcome.destination) {
      throw new Error(`expected exactly one move to backlog/done/, got ${ctx.calls.move} move(s), destination=${ctx.outcome.destination}`);
    }
  });

  scoped(
    registry,
    /^an acceptance receipt records the feature file, the landed commit, and the passing result$/,
    (ctx) => {
      if (ctx.calls.receipt !== 1 || !ctx.writtenReceipt) {
        throw new Error('expected exactly one acceptance receipt to be written');
      }
      const { featureFile, landedCommit, result } = ctx.writtenReceipt;
      if (!featureFile || !landedCommit || result !== 'passed') {
        throw new Error(`receipt missing required fields: ${JSON.stringify(ctx.writtenReceipt)}`);
      }
    }
  );

  // ── pilot-acceptance-gate-03: no executable contract fails closed ───
  scoped(registry, /^the ticket's acceptance declaration is (.+)$/, (ctx, acceptanceDeclarationExample) => {
    ensureCtx(ctx);
    if (!(acceptanceDeclarationExample in ACCEPTANCE_DECLARATION_FIXTURES)) {
      throw new Error(
        `unknown acceptance declaration example value: "${acceptanceDeclarationExample}" (known: ${Object.keys(ACCEPTANCE_DECLARATION_FIXTURES).join(', ')})`
      );
    }
    ctx.acceptanceDeclaration = ACCEPTANCE_DECLARATION_FIXTURES[acceptanceDeclarationExample]();
    // Never reached for a no-contract refusal, but keep it well-formed.
    ctx.acceptanceRunResult = { success: false, output: 'acceptance pipeline must not run for a non-executable contract' };
  });

  scoped(registry, /^the land is refused for having no executable acceptance contract$/, (ctx) => {
    if (ctx.outcome.landed !== false || ctx.outcome.reasonKind !== 'no-contract') {
      throw new Error(`expected a no-contract refusal, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  // ── pilot-acceptance-gate-04: a refused land changes nothing on disk ─
  scoped(registry, /^the ticket yaml still sits in backlog\/active\/$/, (ctx) => {
    if (ctx.calls.move !== 0) {
      throw new Error(`expected no move to backlog/done/, got ${ctx.calls.move} move(s)`);
    }
  });

  scoped(registry, /^no acceptance receipt is written for the ticket$/, (ctx) => {
    if (ctx.calls.receipt !== 0) {
      throw new Error(`expected no acceptance receipt to be written, got ${ctx.calls.receipt}`);
    }
  });
}

module.exports = { registerSteps };
