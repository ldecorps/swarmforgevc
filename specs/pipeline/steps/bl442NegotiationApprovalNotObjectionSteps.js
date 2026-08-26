'use strict';

// BL-442: step handlers for "A natural-language approval ends the
// negotiation and never mutates the contract" - a correctness fix to
// negotiationTelegramRouting.ts's classification and
// contractNegotiation.ts's revision step. Reuses the exact real-CLI/fake-
// Telegram-network seam theContractIsNegotiatedOverTelegramSteps.js already
// established for BL-381: a real target repo, a real contract.yaml, a real
// negotiation log - only the Telegram network is faked.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const TOOLS_DIR = path.join(EXT_DIR, 'out', 'tools');
const PROPOSE_CLI = path.join(TOOLS_DIR, 'propose-onboarding-contract.js');
const { runPostProposal, runPoll } = require(path.join(TOOLS_DIR, 'relay-onboarding-negotiation-telegram'));
const { negotiationLogPath } = require(path.join(TOOLS_DIR, 'negotiate-onboarding-contract'));
const { writeTelegramChannel } = require(path.join(EXT_DIR, 'out', 'onboarding', 'telegramChannelStore'));
const { storeTelegramBotToken } = require(path.join(EXT_DIR, 'out', 'onboarding', 'telegramChannelSecretStore'));
const { parseContractYaml } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractView'));
const {
  CONTRACT_AGREED_MESSAGE,
  CLARIFY_INTENT_MESSAGE,
  COULD_NOT_DERIVE_CHANGE_MESSAGE,
} = require(path.join(EXT_DIR, 'out', 'onboarding', 'negotiationTelegramRelay'));

const VALID_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/ + test/',
  readmeSummary: 'A CLI tool.',
  seedVision: 'Ship the MVP.',
  initialBacklogSummary: '5 tickets queued.',
  useCaseObservations: [],
};

const CHAT_ID = '-100123';
const NEGOTIATION_TOPIC_ID = 42;
const PRINCIPAL_ID = '111';

// BL-442 negotiation-approval-not-objection-03: "an objection ... from which
// no concrete contract change can be derived" - real objection content (not
// approval, not one of the small explicit ambiguous phrases), but matching
// neither the removal nor addition keyword families reviseContractFromObjection
// understands.
const UNDERIVABLE_OBJECTION_TEXT = 'I am wary of this direction';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Same fake Telegram POST fn shape as theContractIsNegotiatedOverTelegramSteps.js:
// never a real network call, distinguishes getUpdates from sendMessage by URL
// suffix, records every outbound send for a Then step to inspect.
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

function noopLaunchRelaySupervisor() {}

function mkUpdate(updateId, text) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: CHAT_ID }, from: { id: 111 }, message_thread_id: NEGOTIATION_TOPIC_ID, text } };
}

function readContract(targetRepo) {
  return parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
}

function registerSteps(registry) {
  // ── Given: a contract is out for negotiation in the topic ────────────
  registry.define(/^a contract is out for negotiation in the topic$/, async (ctx) => {
    ctx.targetRepo = mkTmp('bl442-negotiation-target-');
    execFileSync('git', ['init'], { cwd: ctx.targetRepo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: ctx.targetRepo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: ctx.targetRepo });
    ctx.hostSecretsFile = path.join(mkTmp('bl442-negotiation-secrets-'), 'telegram-bot-tokens.json');
    writeTelegramChannel(ctx.targetRepo, { chatId: CHAT_ID, negotiationTopicId: NEGOTIATION_TOPIC_ID });
    storeTelegramBotToken(ctx.hostSecretsFile, ctx.targetRepo, 'fake-bot-token');
    ctx.fakeUpdates = [];
    ctx.postedMessages = [];

    const surveyPath = path.join(ctx.targetRepo, 'survey.json');
    fs.writeFileSync(surveyPath, JSON.stringify(VALID_FACTS));
    execFileSync('node', [PROPOSE_CLI, ctx.targetRepo, surveyPath]);
    await runPostProposal(ctx.targetRepo, ctx.hostSecretsFile, buildFakePostFn(ctx), noopLaunchRelaySupervisor);
    ctx.postedMessages = []; // the proposal post itself is not part of any scenario's assertions
    ctx.contractBefore = readContract(ctx.targetRepo);
  });

  async function poll(ctx) {
    ctx.pollResult = await runPoll(ctx.targetRepo, ctx.hostSecretsFile, PRINCIPAL_ID, buildFakePostFn(ctx));
  }

  // ── negotiation-approval-not-objection-01 (Outline) ───────────────────
  registry.define(/^the authorized human replies "([^"]*)"$/, async (ctx, reply) => {
    ctx.fakeUpdates = [mkUpdate(1, reply)];
    await poll(ctx);
  });
  registry.define(/^the reply is classified as approval$/, (ctx) => {
    assert.equal(ctx.pollResult.posted, 1, `expected the reply to be acted on, got: ${JSON.stringify(ctx.pollResult)}`);
    assert.equal(ctx.postedMessages.length, 1, `expected exactly one message posted, got: ${JSON.stringify(ctx.postedMessages)}`);
    assert.equal(ctx.postedMessages[0].text, CONTRACT_AGREED_MESSAGE, `expected the approval confirmation, got: ${JSON.stringify(ctx.postedMessages)}`);
    assert.equal(ctx.postedMessages[0].message_thread_id, NEGOTIATION_TOPIC_ID);
  });
  registry.define(/^no revision round runs$/, (ctx) => {
    assert.equal(fs.existsSync(negotiationLogPath(ctx.targetRepo)), false, 'expected no negotiation round to have been logged');
  });
  // "Left unchanged" is scoped to the contract's substantive content (scope/
  // outOfScope/boundaries/initialBacklogSummary) - approval's own job is to
  // legitimately flip `agreement` to 'agreed' (BL-344, unaffected by this
  // ticket), so the agreement field is deliberately excluded from this
  // comparison; scenario 03's not-derived path leaves agreement untouched
  // too, so the comparison is still meaningful there.
  registry.define(/^the contract is left unchanged$/, (ctx) => {
    const before = ctx.contractBefore;
    const after = readContract(ctx.targetRepo);
    assert.deepEqual(
      { scope: after.scope, outOfScope: after.outOfScope, boundaries: after.boundaries, initialBacklogSummary: after.initialBacklogSummary },
      { scope: before.scope, outOfScope: before.outOfScope, boundaries: before.boundaries, initialBacklogSummary: before.initialBacklogSummary },
      'expected the contract\'s substantive content to be unchanged by the reply'
    );
  });

  // ── negotiation-approval-not-objection-02 ─────────────────────────────
  registry.define(/^the authorized human sends a reply whose intent cannot be confidently classified$/, async (ctx) => {
    ctx.fakeUpdates = [mkUpdate(1, 'not sure')];
    await poll(ctx);
  });
  registry.define(/^a clarifying question is posted back in the topic$/, (ctx) => {
    assert.equal(ctx.pollResult.posted, 1, `expected the ambiguous reply to be acted on, got: ${JSON.stringify(ctx.pollResult)}`);
    assert.ok(
      ctx.postedMessages.some((m) => m.text === CLARIFY_INTENT_MESSAGE),
      `expected a clarifying question, got: ${JSON.stringify(ctx.postedMessages)}`
    );
  });

  // ── negotiation-approval-not-objection-03 ─────────────────────────────
  registry.define(/^an objection arrives from which no concrete contract change can be derived$/, async (ctx) => {
    ctx.objectionText = UNDERIVABLE_OBJECTION_TEXT;
    ctx.fakeUpdates = [mkUpdate(1, ctx.objectionText)];
    await poll(ctx);
  });
  registry.define(/^the topic is told the change could not be derived and asked to rephrase$/, (ctx) => {
    assert.equal(ctx.pollResult.posted, 1, `expected the objection to be acted on, got: ${JSON.stringify(ctx.pollResult)}`);
    assert.ok(
      ctx.postedMessages.some((m) => m.text === COULD_NOT_DERIVE_CHANGE_MESSAGE),
      `expected the "couldn't derive a change" notice, got: ${JSON.stringify(ctx.postedMessages)}`
    );
  });
  registry.define(/^no line containing the raw objection text is appended to the contract$/, (ctx) => {
    const contract = readContract(ctx.targetRepo);
    const allLines = [...contract.scope, ...contract.outOfScope, ...contract.boundaries];
    assert.ok(
      !allLines.some((line) => line.includes(ctx.objectionText)),
      `expected no contract line to contain the raw objection text, got: ${JSON.stringify(allLines)}`
    );
  });

  // ── negotiation-approval-not-objection-04 ─────────────────────────────
  registry.define(/^any objection is processed into a revision$/, async (ctx) => {
    ctx.objectionText = 'also add analytics dashboards';
    ctx.fakeUpdates = [mkUpdate(1, ctx.objectionText)];
    await poll(ctx);
  });
  registry.define(/^no contract boundary or clause is the verbatim objection text$/, (ctx) => {
    assert.equal(ctx.pollResult.posted, 1, `expected the objection to be acted on, got: ${JSON.stringify(ctx.pollResult)}`);
    const contract = readContract(ctx.targetRepo);
    assert.ok(
      !contract.boundaries.some((b) => b === ctx.objectionText || b.includes(ctx.objectionText)),
      `expected no boundary to carry the raw objection text, got: ${JSON.stringify(contract.boundaries)}`
    );
  });
}

module.exports = { registerSteps };
