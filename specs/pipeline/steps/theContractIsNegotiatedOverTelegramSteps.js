'use strict';

// BL-381: step handlers for "The onboarding contract is negotiated with the
// human over Telegram" - the WIRING ticket joining BL-344's real negotiation
// rounds (negotiate-onboarding-contract.js's own runObject/runApprove,
// driven here via relay-onboarding-negotiation-telegram.js's runPostProposal/
// runPoll, never a second engine) to BL-380's provisioned channel. Only the
// Telegram NETWORK is faked (an injected postFn, the SAME seam
// telegramClient.test.js and onboardingTelegramChannelSteps.js already use) -
// the negotiation state itself is real: a real git target repo, a real
// contract.yaml, and a real negotiation log on disk, so "every round
// survives a restart" (scenario 03) is proven by reading those files back
// off disk, never from anything a runPoll call returned in memory.
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

// BL-381 scenario 02 is a Scenario Outline for exactly this reason: the
// round count is the parameter, never a special-cased "1 round" vs "2
// rounds" branch - bound through an explicit KNOWN_VALUES lookup (the
// engineering article's own rule for a Scenario Outline column) rather than
// a bare parseInt that would let a mutated example value through silently.
const KNOWN_ROUND_COUNTS = new Map([
  ['1', 1],
  ['2', 2],
]);

function knownRoundCount(value) {
  if (!KNOWN_ROUND_COUNTS.has(String(value))) {
    throw new Error(`the-contract-is-negotiated-over-telegram: unrecognized <rounds> example value "${value}"`);
  }
  return KNOWN_ROUND_COUNTS.get(String(value));
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A fake Telegram POST fn shared by every scenario in this file - never a
// real network call. Distinguishes getUpdates from sendMessage by the
// method suffix in the URL (mirrors relayOnboardingNegotiationTelegramCli.
// test.js's own fake), reading the "delivered" updates off ctx.fakeUpdates
// (scenario setup owns what is "waiting" for the swarm to answer) and
// recording every outbound send into ctx.postedMessages so a Then step can
// assert what actually reached the negotiation topic.
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

function mkUpdate(updateId, text) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: CHAT_ID }, from: { id: 111 }, message_thread_id: NEGOTIATION_TOPIC_ID, text } };
}

function readContract(targetRepo) {
  return parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^the target repo has a contract negotiation topic$/, (ctx) => {
    ctx.targetRepo = mkTmp('bl381-negotiation-target-');
    execFileSync('git', ['init'], { cwd: ctx.targetRepo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: ctx.targetRepo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: ctx.targetRepo });
    ctx.hostSecretsFile = path.join(mkTmp('bl381-negotiation-secrets-'), 'telegram-bot-tokens.json');
    writeTelegramChannel(ctx.targetRepo, { chatId: CHAT_ID, negotiationTopicId: NEGOTIATION_TOPIC_ID });
    storeTelegramBotToken(ctx.hostSecretsFile, ctx.targetRepo, 'fake-bot-token');
    ctx.fakeUpdates = [];
    ctx.postedMessages = [];
  });

  registry.define(/^a contract has been proposed for the target$/, (ctx) => {
    const surveyPath = path.join(ctx.targetRepo, 'survey.json');
    fs.writeFileSync(surveyPath, JSON.stringify(VALID_FACTS));
    execFileSync('node', [PROPOSE_CLI, ctx.targetRepo, surveyPath]);
  });

  // ── the-contract-is-negotiated-over-telegram-01 ─────────────────────
  registry.define(/^the contract is proposed to the human$/, async (ctx) => {
    ctx.postProposalOutcome = await runPostProposal(ctx.targetRepo, ctx.hostSecretsFile, buildFakePostFn(ctx));
  });
  registry.define(/^the proposed contract appears in the target's negotiation topic$/, (ctx) => {
    assert.equal(ctx.postProposalOutcome.posted, true, `expected the proposal to be posted, got: ${JSON.stringify(ctx.postProposalOutcome)}`);
    assert.equal(ctx.postedMessages.length, 1, `expected exactly one message posted, got: ${JSON.stringify(ctx.postedMessages)}`);
    assert.equal(ctx.postedMessages[0].message_thread_id, NEGOTIATION_TOPIC_ID);
    assert.match(ctx.postedMessages[0].text, /Agreement: proposed/);
  });

  // ── the-contract-is-negotiated-over-telegram-02 (Outline) ───────────
  registry.define(/^the human has objected (\d+) times? in the negotiation topic$/, (ctx, roundsRaw) => {
    const rounds = knownRoundCount(roundsRaw);
    ctx.expectedRounds = rounds;
    // Every round's message arrives as one batch the swarm has not yet
    // answered - relayNegotiationUpdates processes each in fetch order
    // within a single poll cycle, exactly as it would if the swarm had
    // been offline while the human sent several objections in a row.
    ctx.fakeUpdates = Array.from({ length: rounds }, (_, i) => mkUpdate(i + 1, `also add feature ${i + 1}`));
  });
  registry.define(/^the swarm has answered every objection$/, async (ctx) => {
    ctx.pollResult = await runPoll(ctx.targetRepo, ctx.hostSecretsFile, PRINCIPAL_ID, buildFakePostFn(ctx));
  });
  registry.define(/^the negotiation topic carries (\d+) revised contracts?$/, (ctx, roundsRaw) => {
    const rounds = knownRoundCount(roundsRaw);
    assert.equal(ctx.pollResult.posted, rounds, `expected ${rounds} posted revision(s), got: ${JSON.stringify(ctx.pollResult)}`);
    assert.equal(ctx.postedMessages.length, rounds, `expected ${rounds} message(s) actually sent to the topic, got: ${JSON.stringify(ctx.postedMessages)}`);
    for (const message of ctx.postedMessages) {
      assert.equal(message.message_thread_id, NEGOTIATION_TOPIC_ID);
      assert.match(message.text, /Agreement: proposed/);
    }
  });

  // ── the-contract-is-negotiated-over-telegram-03 ─────────────────────
  // Distinct step text from the outline above ("objected once" vs "objected
  // <rounds> times") - same one-objection setup, worded for a single,
  // non-parameterized scenario. The When step reuses "the swarm has
  // answered every objection" registered above. Then reads the durable
  // files directly - never anything runPoll returned in memory - so this
  // genuinely proves the round SURVIVES, rather than merely that the call
  // succeeded.
  registry.define(/^the human has objected once in the negotiation topic$/, (ctx) => {
    ctx.fakeUpdates = [mkUpdate(1, 'also add feature 1')];
  });
  registry.define(/^the target's negotiation record carries both the objection and the revision$/, (ctx) => {
    const logContent = fs.readFileSync(negotiationLogPath(ctx.targetRepo), 'utf8');
    assert.match(logContent, /also add feature 1/, `expected the durable negotiation log to carry the objection, got: ${logContent}`);
    const contract = readContract(ctx.targetRepo);
    assert.ok(
      contract.scope.some((s) => s.includes('also add feature 1')),
      `expected the durable contract.yaml to carry the revision, got scope: ${JSON.stringify(contract.scope)}`
    );
  });

  // ── the-contract-is-negotiated-over-telegram-04 ─────────────────────
  registry.define(/^the human has agreed to the contract in the negotiation topic$/, (ctx) => {
    ctx.fakeUpdates = [mkUpdate(1, 'agree')];
  });
  registry.define(/^the swarm reads the human's answer$/, async (ctx) => {
    ctx.pollResult = await runPoll(ctx.targetRepo, ctx.hostSecretsFile, PRINCIPAL_ID, buildFakePostFn(ctx));
  });
  registry.define(/^the target's contract is marked as agreed$/, (ctx) => {
    assert.equal(ctx.pollResult.posted, 1, `expected the agreement to be acted on, got: ${JSON.stringify(ctx.pollResult)}`);
    const contract = readContract(ctx.targetRepo);
    assert.equal(contract.agreement, 'agreed', `expected the durable contract to be agreed, got: ${JSON.stringify(contract)}`);
  });
}

module.exports = { registerSteps };
