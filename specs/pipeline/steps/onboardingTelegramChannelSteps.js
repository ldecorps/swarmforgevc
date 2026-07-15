'use strict';

// BL-380: step handlers for "Onboarding provisions the target repo's own
// Telegram channel". Drives the REAL compiled modules in-process (mirrors
// standingOperatorTopicSteps.js's own pattern) - createNegotiationTopic and
// getUpdates are always FAKE adapters (never real Telegram network, same
// seam telegramClient.test.js itself uses), while the target-local and
// host-side stores are the REAL fs-backed implementations, exercised
// against tmp fixture roots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { provisionTelegramChannel } = require(path.join(EXT_DIR, 'out', 'onboarding', 'telegramChannelProvisioning'));
const { readTelegramChannel, writeTelegramChannel } = require(path.join(EXT_DIR, 'out', 'onboarding', 'telegramChannelStore'));
const { storeTelegramBotToken } = require(path.join(EXT_DIR, 'out', 'onboarding', 'telegramChannelSecretStore'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl380-acceptance-'));
}

function mkUpdate(chatId) {
  return { update_id: 1, message: { message_id: 1, chat: { id: chatId }, text: 'Bot was added to the group' } };
}

// Builds a fresh fake-adapters set wired to ctx's CURRENT target/host
// fixtures, using the REAL target-local and host-side stores (never a
// duplicate in-memory store) - only getUpdates/createNegotiationTopic are
// faked, standing in for the Telegram network.
function buildFakeAdapters(ctx) {
  const createTopicCalls = [];
  return {
    calls: { createTopicCalls },
    adapters: {
      // BL-380 bounce: getUpdates now reports success/error (never a bare
      // array) so a fetch failure can't collapse into "no updates yet" -
      // see backlog/evidence/BL-380-...-bounce-20260715.md.
      getUpdates: async () => ({ success: true, updates: ctx.fakeUpdates ?? [] }),
      createNegotiationTopic: async (chatId) => {
        createTopicCalls.push(chatId);
        ctx.nextTopicId = (ctx.nextTopicId || 900) + 1;
        return { success: true, messageThreadId: ctx.nextTopicId };
      },
      persistChannel: (chatId, negotiationTopicId) => writeTelegramChannel(ctx.targetRoot, { chatId, negotiationTopicId }),
      persistBotToken: () => storeTelegramBotToken(ctx.hostSecretsFile, ctx.targetRoot, ctx.botToken),
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a target repo is being onboarded$/, (ctx) => {
    ctx.targetRoot = mkTmp();
    ctx.hostSecretsFile = path.join(mkTmp(), 'telegram-bot-tokens.json');
    ctx.botToken = 'fake-bot-token-a';
    ctx.botUsername = 'sfvc_target_a_bot';
    ctx.fakeUpdates = []; // no chat detected yet, until a scenario's Given says otherwise
  });

  // ── onboarding-provisions-the-targets-channel-02/03 shared Given ───────
  registry.define(/^the human has created the target's group and added its bot$/, (ctx) => {
    ctx.expectedChatId = '555666777';
    ctx.fakeUpdates = [mkUpdate(555666777)];
  });

  // ── onboarding-provisions-the-targets-channel-04 ────────────────────────
  registry.define(/^the human has not finished creating the target's group$/, (ctx) => {
    ctx.fakeUpdates = [];
  });

  // ── onboarding-provisions-the-targets-channel-05 ────────────────────────
  registry.define(/^another target repo has already been onboarded with its own bot$/, async (ctx) => {
    // Provision "target A" fully (its own root, bot, and chat) against the
    // SAME host secrets file the second target below will also use - the
    // isolation this scenario proves only means something if both targets'
    // tokens land in the same store.
    ctx.otherTargetRoot = ctx.targetRoot;
    ctx.otherBotToken = ctx.botToken;
    ctx.fakeUpdates = [mkUpdate(111222333)];
    const { adapters } = buildFakeAdapters(ctx);
    ctx.otherOutcome = await provisionTelegramChannel(ctx.botUsername, adapters);
    assert.equal(ctx.otherOutcome.ready, true, 'expected the fixture setup for the OTHER target to itself succeed');

    // Now switch ctx to a SECOND, distinct target for the shared When below.
    ctx.targetRoot = mkTmp();
    ctx.botToken = 'fake-bot-token-b';
    ctx.botUsername = 'sfvc_target_b_bot';
    ctx.expectedChatId = '222333444';
    ctx.fakeUpdates = [mkUpdate(222333444)];
  });

  // ── shared When ──────────────────────────────────────────────────────
  registry.define(/^onboarding provisions the target's channel$/, async (ctx) => {
    const { adapters, calls } = buildFakeAdapters(ctx);
    ctx.outcome = await provisionTelegramChannel(ctx.botUsername, adapters);
    ctx.createTopicCalls = calls.createTopicCalls;
  });

  // ── onboarding-provisions-the-targets-channel-01 ────────────────────────
  registry.define(/^the human is given the steps to create the target's own bot and group$/, (ctx) => {
    const { steps } = ctx.outcome.instructions;
    assert.ok(steps.some((step) => /BotFather/.test(step)), `expected a bot-creation step, got: ${JSON.stringify(steps)}`);
    assert.ok(steps.some((step) => /group/i.test(step)), `expected a group-creation step, got: ${JSON.stringify(steps)}`);
  });

  registry.define(/^the human is given a link that adds that bot to a group$/, (ctx) => {
    assert.match(ctx.outcome.instructions.addToGroupLink, /^https:\/\/t\.me\/.+\?startgroup=true$/);
  });

  // ── onboarding-provisions-the-targets-channel-02 ────────────────────────
  registry.define(/^the group is remembered against the target repo$/, (ctx) => {
    const record = readTelegramChannel(ctx.targetRoot);
    assert.equal(record.chatId, ctx.expectedChatId, `expected the target's own record to carry the detected chat id, got: ${JSON.stringify(record)}`);
  });

  registry.define(/^the human is never asked to paste the group's identifier$/, (ctx) => {
    // Proven structurally, not just by this one assertion: neither
    // provisionTelegramChannel's signature (botUsername + adapters) nor any
    // step in this file ever accepts a chat id as input - the value below
    // came ONLY from decideChannelDetection reading the fake Telegram
    // reply, the same path a real getUpdates response would take.
    assert.equal(ctx.outcome.chatId, ctx.expectedChatId);
  });

  // ── onboarding-provisions-the-targets-channel-03 ────────────────────────
  registry.define(/^a contract negotiation topic is opened in the target's group$/, (ctx) => {
    assert.deepEqual(ctx.createTopicCalls, [ctx.expectedChatId], `expected exactly one topic opened in the detected chat, got: ${JSON.stringify(ctx.createTopicCalls)}`);
    assert.notEqual(ctx.outcome.negotiationTopicId, undefined);
    const record = readTelegramChannel(ctx.targetRoot);
    assert.equal(record.negotiationTopicId, ctx.outcome.negotiationTopicId);
  });

  // ── onboarding-provisions-the-targets-channel-04 ────────────────────────
  registry.define(/^the channel is reported as not ready$/, (ctx) => {
    assert.equal(ctx.outcome.ready, false);
  });

  registry.define(/^no contract negotiation topic is opened$/, (ctx) => {
    assert.equal(ctx.createTopicCalls.length, 0, `expected no negotiation topic call for a half-finished channel, got: ${JSON.stringify(ctx.createTopicCalls)}`);
    assert.equal(readTelegramChannel(ctx.targetRoot), undefined, 'expected no channel record to be persisted for a half-finished channel');
  });

  // ── onboarding-provisions-the-targets-channel-05 ────────────────────────
  registry.define(/^the target is given a bot of its own$/, (ctx) => {
    assert.equal(ctx.outcome.ready, true);
    assert.equal(ctx.outcome.chatId, ctx.expectedChatId);
    assert.notEqual(ctx.targetRoot, ctx.otherTargetRoot, 'expected the second target to be a genuinely different repo');
  });

  registry.define(/^the other target's bot is left untouched$/, (ctx) => {
    const stored = JSON.parse(fs.readFileSync(ctx.hostSecretsFile, 'utf8'));
    assert.equal(stored[ctx.otherTargetRoot], ctx.otherBotToken, `expected the first target's own stored token to be unchanged, got: ${JSON.stringify(stored)}`);
    assert.equal(stored[ctx.targetRoot], ctx.botToken, `expected the second target's own stored token to be recorded separately, got: ${JSON.stringify(stored)}`);
    assert.notEqual(stored[ctx.otherTargetRoot], stored[ctx.targetRoot], 'expected each target to have its own bot token');
  });
}

module.exports = { registerSteps };
