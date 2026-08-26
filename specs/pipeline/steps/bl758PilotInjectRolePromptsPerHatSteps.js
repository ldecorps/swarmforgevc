'use strict';

// BL-758: per-hat role prompt reinject + land-gate evidence.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  assessPerHatRolePromptEvidence,
} = require(path.join(EXT_DIR, 'out', 'tools', 'pilotAcceptanceGate'));
const {
  composePilotExpeditorPrompt,
  composePilotStagePrompt,
} = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgePilot'));

const FEATURE =
  '/pilot injects each live role prompt at hat change with durable stage evidence';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl758-'));
}

function ensureCtx(ctx) {
  ctx.ticketId = ctx.ticketId || 'BL-758-FIXTURE';
  ctx.calls = ctx.calls || { move: 0, receipt: 0 };
  ctx.repoRootFixture = ctx.repoRootFixture || mkFixtureRoot();
  ctx.acceptanceDeclaration =
    ctx.acceptanceDeclaration || 'specs/features/bl758-fixture.feature';
  ctx.acceptanceRunResult = ctx.acceptanceRunResult || { success: true, output: 'ok' };
  ctx.verdicts = ctx.verdicts || [];
  ctx.historyResolvable = ctx.historyResolvable !== false;
  ctx.bounceRole = ctx.bounceRole || null;
  return ctx;
}

function perHatOutcome(ctx) {
  if (!ctx.historyResolvable) {
    return { checked: false };
  }
  return assessPerHatRolePromptEvidence({ verdicts: ctx.verdicts });
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
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => perHatOutcome(ctx),
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
    path.join(ctx.repoRootFixture, 'specs', 'features', 'bl758-fixture.feature'),
    'Feature: fixture\n',
    'utf8'
  );
  ctx.outcome = await landPilotedTicket(ctx.ticketId, baseDeps(ctx));
}

function completeVerdict(role) {
  return {
    verdictPath: `.swarmforge/expedite/BL-758/01-${role}/verdict.json`,
    role,
    role_prompt_path: `swarmforge/roles/${role}.prompt`,
    role_prompt_sha256: 'b'.repeat(64),
  };
}

function incompleteVerdict(role, fields) {
  return {
    verdictPath: `.swarmforge/expedite/BL-758/01-${role}/verdict.json`,
    role,
    ...fields,
  };
}

function readLiveRolePrompt(role) {
  return fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'roles', `${role}.prompt`), 'utf8');
}

function composeStageForRole(ctx, ticket, role) {
  const body = readLiveRolePrompt(role);
  ctx.stagePrompt = composePilotStagePrompt(ticket, role, { readRolePrompt: () => body });
  ctx.rolePromptBody = body;
}

function registerSteps(registry) {
  scoped(registry, /^the pilot expeditor prompt composer is available$/, () => {});

  scoped(
    registry,
    /^a pilot stage prompt is composed for ticket "([^"]+)" and role "([^"]+)"$/,
    (ctx, ticket, role) => {
      composeStageForRole(ctx, ticket, role);
    }
  );

  scoped(
    registry,
    /^the composed prompt includes the contents of swarmforge\/roles\/([^/\s]+)\.prompt$/,
    (ctx, roleFile) => {
      const body = ctx.rolePromptBody || readLiveRolePrompt(roleFile);
      const snippet = body.trim().slice(0, 80);
      if (!ctx.stagePrompt || !ctx.stagePrompt.includes(snippet)) {
        throw new Error(`stage prompt missing contents of ${roleFile}.prompt`);
      }
    }
  );

  scoped(registry, /^the composed prompt still carries the thin pilot isolation wrapper$/, (ctx) => {
    if (!/PILOT STAGE WRAPPER/i.test(ctx.stagePrompt || '')) {
      throw new Error('missing thin pilot isolation wrapper');
    }
  });

  scoped(registry, /^the offline expeditor prompt is composed for ticket "([^"]+)"$/, (ctx, ticket) => {
    ctx.pilotPrompt = composePilotExpeditorPrompt(ticket);
  });

  scoped(registry, /^the prompt requires injecting each role's real prompt at hat change$/, (ctx) => {
    if (!/PER-HAT REINJECT|composePilotStagePrompt/i.test(ctx.pilotPrompt || '')) {
      throw new Error('expected per-hat reinject instruction');
    }
  });

  scoped(
    registry,
    /^the prompt does not instruct wearing every pipeline hat from one mega-brief alone$/,
    (ctx) => {
      if (/YOU wear every pipeline hat in turn/i.test(ctx.pilotPrompt || '')) {
        throw new Error('mega-brief-alone instruction still present');
      }
      if (!/mega-brief alone/i.test(ctx.pilotPrompt || '')) {
        throw new Error('expected explicit rejection of mega-brief-alone');
      }
    }
  );

  scoped(registry, /^the run has a completed stage verdict for role "([^"]+)"$/, (ctx, role) => {
    ensureCtx(ctx);
    ctx.verdicts = [incompleteVerdict(role)];
  });

  scoped(registry, /^that verdict omits role_prompt_path or role_prompt_sha256$/, (ctx) => {
    ensureCtx(ctx);
    // already omitted via incompleteVerdict
  });

  scoped(
    registry,
    /^every completed stage verdict records role_prompt_path for that role under swarmforge\/roles\/$/,
    (ctx) => {
      ensureCtx(ctx);
      ctx.verdicts = [completeVerdict('coder'), completeVerdict('cleaner')];
    }
  );

  scoped(
    registry,
    /^each records a non-empty role_prompt_sha256 of the prompt bytes active for that stage$/,
    (ctx) => {
      ensureCtx(ctx);
      // already set in prior Given
    }
  );

  scoped(registry, /^a completed stage verdict lacks role_prompt_path or role_prompt_sha256$/, (ctx) => {
    ensureCtx(ctx);
    ctx.verdicts = [
      incompleteVerdict('coder', {
        role_prompt_path: 'swarmforge/roles/coder.prompt',
      }),
    ];
  });

  scoped(registry, /^the pilot has bounced back to role "([^"]+)"$/, (ctx, role) => {
    ensureCtx(ctx);
    ctx.bounceRole = role;
  });

  scoped(registry, /^the next stage prompt is composed for that bounce-back$/, (ctx) => {
    ensureCtx(ctx);
    composeStageForRole(ctx, 'BL-758', ctx.bounceRole || 'specifier');
  });

  scoped(registry, /^the pilot runs the landing gate$/, async (ctx) => {
    await runGate(ctx);
  });

  scoped(registry, /^the land is refused for missing per-hat role prompt evidence$/, (ctx) => {
    if (!ctx.outcome || ctx.outcome.landed !== false) {
      throw new Error(`expected refusal, got ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.outcome.reasonKind !== 'pilot-hat-prompt-missing') {
      throw new Error(`expected pilot-hat-prompt-missing, got ${ctx.outcome.reasonKind}`);
    }
  });

  scoped(registry, /^the refusal names the role or verdict path$/, (ctx) => {
    const reason = (ctx.outcome && ctx.outcome.reason) || '';
    if (!/coder|verdict|specifier|cleaner/i.test(reason)) {
      throw new Error(`refusal did not name role/path: ${reason}`);
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
