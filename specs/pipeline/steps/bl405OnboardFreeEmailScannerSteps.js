'use strict';

// BL-405: step handlers for "onboarding negotiation is run against the
// free-email-scanner target" - the FIRST REAL RUN of the already-shipped
// onboarding-negotiation machinery (BL-262/BL-269/BL-344/BL-360/BL-380/
// BL-381/BL-382) against a concrete target. Per contractSurvey.ts's own
// header comment, SURVEYING a real repo (reading its languages/layout/
// README/backlog) is swarm/agent behavior, not this tooling's job - the
// tooling's job, and this ticket's testable surface, starts once survey
// facts exist. So these steps drive the REAL compiled propose/negotiate/
// gate CLIs and the REAL relay functions against a disposable git fixture
// standing in for the target repo, with only the Telegram NETWORK faked -
// the same real-CLI-plus-faked-network convention onboardingNegotiationSteps.js
// and theContractIsNegotiatedOverTelegramSteps.js already established. The
// actual live run against the real github.com/ldecorps/free-email-scanner
// URL and the real Telegram channel is the ticket's own separate E2E QA
// procedure, not a unit-level acceptance concern.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const TOOLS_DIR = path.join(EXT_DIR, 'out', 'tools');
const PROPOSE_CLI = path.join(TOOLS_DIR, 'propose-onboarding-contract.js');
const GATE_CLI = path.join(TOOLS_DIR, 'onboarding-contract-gate.js');
const { runPostProposal, runPoll } = require(path.join(TOOLS_DIR, 'relay-onboarding-negotiation-telegram'));
const { negotiationLogPath } = require(path.join(TOOLS_DIR, 'negotiate-onboarding-contract'));
const { writeTelegramChannel } = require(path.join(EXT_DIR, 'out', 'onboarding', 'telegramChannelStore'));
const { storeTelegramBotToken } = require(path.join(EXT_DIR, 'out', 'onboarding', 'telegramChannelSecretStore'));
const { parseContractYaml } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractView'));

// Standing in for a real survey of github.com/ldecorps/free-email-scanner -
// plausible facts for that target, never invented scope: only what
// proposeContractFromSurvey turns into scope/out-of-scope/boundaries.
const FREE_EMAIL_SCANNER_FACTS = {
  languages: ['JavaScript'],
  layoutSummary: 'src/ + lib/ + test/',
  readmeSummary: 'Scans a connected mailbox for known free-tier signup and breach patterns.',
  seedVision: 'Scan a connected mailbox and report the free-tier findings.',
  initialBacklogSummary: '3 tickets queued.',
  useCaseObservations: [],
};

const CHAT_ID = '-100405';
const NEGOTIATION_TOPIC_ID = 405;
const PRINCIPAL_ID = '405405';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initGitFixture() {
  const targetRepo = mkTmp('bl405-free-email-scanner-');
  execFileSync('git', ['init'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: targetRepo });
  return targetRepo;
}

function readContract(targetRepo) {
  return parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
}

function propose(targetRepo) {
  const surveyPath = path.join(targetRepo, 'survey.json');
  fs.writeFileSync(surveyPath, JSON.stringify(FREE_EMAIL_SCANNER_FACTS));
  execFileSync('node', [PROPOSE_CLI, targetRepo, surveyPath]);
}

function noopLaunchRelaySupervisor() {}

function mkUpdate(updateId, text) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: CHAT_ID }, from: { id: 405405 }, message_thread_id: NEGOTIATION_TOPIC_ID, text } };
}

function buildFakePostFn(ctx) {
  ctx.postedMessages = ctx.postedMessages || [];
  return async (url, body) => {
    if (url.endsWith('/getUpdates')) {
      return { ok: true, status: 200, json: { result: ctx.fakeUpdates ?? [] } };
    }
    const parsed = JSON.parse(body);
    ctx.postedMessages.push(parsed);
    return { ok: true, status: 200, json: { result: { message_id: ctx.postedMessages.length } } };
  };
}

function provisionChannel(ctx) {
  ctx.hostSecretsFile = path.join(mkTmp('bl405-secrets-'), 'telegram-bot-tokens.json');
  writeTelegramChannel(ctx.targetRepo, { chatId: CHAT_ID, negotiationTopicId: NEGOTIATION_TOPIC_ID });
  storeTelegramBotToken(ctx.hostSecretsFile, ctx.targetRepo, 'fake-bot-token');
  ctx.fakeUpdates = [];
  ctx.postedMessages = [];
}

async function postProposal(ctx) {
  ctx.postProposalOutcome = await runPostProposal(ctx.targetRepo, ctx.hostSecretsFile, buildFakePostFn(ctx), noopLaunchRelaySupervisor);
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^the existing onboarding-negotiation machinery$/, () => {
    // Narrative only - the machinery is already shipped (BL-269/BL-344/
    // BL-360/BL-382); each scenario below drives it via its real compiled
    // CLIs/functions, required above.
  });

  registry.define(/^the target repository https:\/\/github\.com\/ldecorps\/free-email-scanner$/, (ctx) => {
    ctx.targetUrl = 'https://github.com/ldecorps/free-email-scanner';
    ctx.targetRepo = initGitFixture();
  });

  // ── onboard-free-email-scanner-01 ─────────────────────────────────────
  registry.define(/^the target repo has been surveyed$/, (ctx) => {
    ctx.surveyFacts = FREE_EMAIL_SCANNER_FACTS;
  });

  registry.define(/^the onboarding proposal tooling runs$/, (ctx) => {
    propose(ctx.targetRepo);
  });

  registry.define(/^a proposed scope contract naming the target's edges is produced$/, (ctx) => {
    const contract = readContract(ctx.targetRepo);
    assert.equal(contract.agreement, 'proposed', `expected a freshly proposed contract, got: ${JSON.stringify(contract)}`);
    assert.ok(contract.scope.length > 0, 'expected the proposed contract to name at least one scope edge');
    assert.ok(
      contract.scope.some((s) => s.includes(FREE_EMAIL_SCANNER_FACTS.seedVision)),
      `expected the scope to name the surveyed seed vision, got: ${JSON.stringify(contract.scope)}`
    );
  });

  // ── onboard-free-email-scanner-02 ─────────────────────────────────────
  registry.define(/^a proposed scope contract for the target$/, (ctx) => {
    propose(ctx.targetRepo);
    provisionChannel(ctx);
  });

  registry.define(/^onboarding negotiation runs$/, async (ctx) => {
    await postProposal(ctx);
  });

  registry.define(/^the contract is delivered through the iterative negotiation loop$/, (ctx) => {
    assert.equal(ctx.postProposalOutcome.posted, true, `expected the proposal to be posted, got: ${JSON.stringify(ctx.postProposalOutcome)}`);
    assert.equal(ctx.postedMessages.length, 1, `expected exactly one message posted, got: ${JSON.stringify(ctx.postedMessages)}`);
    assert.equal(ctx.postedMessages[0].message_thread_id, NEGOTIATION_TOPIC_ID);
    assert.match(ctx.postedMessages[0].text, /Agreement: proposed/);
  });

  // ── onboard-free-email-scanner-03 ──────────────────────────────────────
  registry.define(/^a delivered proposed contract awaiting the human's response$/, async (ctx) => {
    propose(ctx.targetRepo);
    provisionChannel(ctx);
    await postProposal(ctx);
  });

  registry.define(/^the human replies through the negotiation Telegram relay$/, async (ctx) => {
    ctx.fakeUpdates = [mkUpdate(1, 'also add rate-limit handling for the mailbox API')];
    ctx.pollResult = await runPoll(ctx.targetRepo, ctx.hostSecretsFile, PRINCIPAL_ID, buildFakePostFn(ctx));
  });

  registry.define(/^the reply is applied as an approval or an amendment to the contract$/, (ctx) => {
    assert.equal(ctx.pollResult.posted, 1, `expected the reply to be acted on, got: ${JSON.stringify(ctx.pollResult)}`);
    const contract = readContract(ctx.targetRepo);
    assert.ok(
      contract.scope.some((s) => s.includes('also add rate-limit handling for the mailbox API')),
      `expected the objection to be applied as a contract amendment, got scope: ${JSON.stringify(contract.scope)}`
    );
    const logContent = fs.readFileSync(negotiationLogPath(ctx.targetRepo), 'utf8');
    assert.match(logContent, /also add rate-limit handling for the mailbox API/, 'expected the negotiation log to durably record the reply');
  });

  // ── onboard-free-email-scanner-04 ──────────────────────────────────────
  registry.define(/^a proposed contract that has been amended but not yet confirmed$/, async (ctx) => {
    propose(ctx.targetRepo);
    provisionChannel(ctx);
    await postProposal(ctx);
    ctx.fakeUpdates = [mkUpdate(1, 'also add rate-limit handling for the mailbox API')];
    await runPoll(ctx.targetRepo, ctx.hostSecretsFile, PRINCIPAL_ID, buildFakePostFn(ctx));
  });

  registry.define(/^onboarding checks the contract's approval state$/, (ctx) => {
    ctx.gateResult = JSON.parse(execFileSync('node', [GATE_CLI, ctx.targetRepo], { encoding: 'utf8' }));
  });

  registry.define(/^it is not treated as approved$/, (ctx) => {
    assert.equal(ctx.gateResult.decision, 'hold', `expected the build-start gate to hold an amended-but-unconfirmed contract, got: ${JSON.stringify(ctx.gateResult)}`);
  });
}

module.exports = { registerSteps };
