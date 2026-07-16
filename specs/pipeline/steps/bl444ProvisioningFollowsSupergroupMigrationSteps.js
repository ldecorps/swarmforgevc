'use strict';

// BL-444: step handlers for "Channel provisioning follows a
// group-to-supergroup migration instead of latching the dead id". Drives the
// REAL compiled telegramChannelProvisioning.js module with FAKE Telegram
// adapters (never real network - the same seam telegramChannelProvisioning.
// test.js and onboardingTelegramChannelSteps.js already use), reconstructing
// the exact live update queue from the ticket's own E2E procedure.
const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { decideChannelDetection, provisionTelegramChannel } = require(path.join(EXT_DIR, 'out', 'onboarding', 'telegramChannelProvisioning'));

const DEAD_CHAT_ID = -5274683022;
const LIVE_CHAT_ID = -1003886489685;

function msg(updateId, chatId, extra = {}) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: chatId }, text: '', ...extra } };
}

// The exact live queue from the ticket's E2E procedure: ids 143744666-669 in
// the dead pre-migration group, 143744670-671 already in the live
// supergroup, then 143744672 - the migrate_to_chat_id notice.
function migratedUpdateQueue() {
  return [
    msg(143744666, DEAD_CHAT_ID),
    msg(143744667, DEAD_CHAT_ID),
    msg(143744668, DEAD_CHAT_ID),
    msg(143744669, DEAD_CHAT_ID),
    msg(143744670, LIVE_CHAT_ID),
    msg(143744671, LIVE_CHAT_ID),
    msg(143744672, DEAD_CHAT_ID, { migrate_to_chat_id: LIVE_CHAT_ID }),
  ];
}

function buildAdapters(ctx) {
  const createTopicCalls = [];
  const persistedChannels = [];
  const confirmedOffsets = [];
  return {
    calls: { createTopicCalls, persistedChannels, confirmedOffsets },
    adapters: {
      getUpdates: async () => ({ success: true, updates: ctx.fakeUpdates ?? [] }),
      createNegotiationTopic: async (chatId) => {
        createTopicCalls.push(chatId);
        const response = (ctx.createTopicResponses ?? {})[chatId];
        if (response) {
          return response;
        }
        return { success: true, messageThreadId: 900 + createTopicCalls.length };
      },
      persistChannel: (chatId, negotiationTopicId) => persistedChannels.push({ chatId, negotiationTopicId }),
      persistBotToken: () => {},
      persistConfirmOffset: (offset) => confirmedOffsets.push(offset),
    },
  };
}

function registerSteps(registry) {
  // ── negotiation-approval-not-objection-01 style Background substitute ──
  // (no shared Background in this feature - each scenario sets up its own
  // Given from scratch)

  // ── provisioning-follows-supergroup-migration-01 ──────────────────────
  registry.define(/^the update queue contains a basic group's updates followed by its migration to a supergroup$/, (ctx) => {
    ctx.updates = migratedUpdateQueue();
  });
  registry.define(/^channel detection runs$/, (ctx) => {
    ctx.detection = decideChannelDetection(ctx.updates);
  });
  registry.define(/^the detected chat id is the migrated-to supergroup id$/, (ctx) => {
    assert.equal(ctx.detection.ready, true);
    assert.equal(ctx.detection.chatId, String(LIVE_CHAT_ID), `expected the live supergroup id, got: ${JSON.stringify(ctx.detection)}`);
  });
  registry.define(/^not the pre-migration group id$/, (ctx) => {
    assert.notEqual(ctx.detection.chatId, String(DEAD_CHAT_ID));
  });

  // ── provisioning-follows-supergroup-migration-02 ──────────────────────
  registry.define(/^creating the forum topic returns "group chat was upgraded to a supergroup chat" with a migrate-to id$/, (ctx) => {
    ctx.fakeUpdates = [msg(1, DEAD_CHAT_ID)];
    ctx.createTopicResponses = {
      [String(DEAD_CHAT_ID)]: {
        success: false,
        error: 'Telegram API responded with status 400: group chat was upgraded to a supergroup chat',
        migrateToChatId: String(LIVE_CHAT_ID),
      },
      [String(LIVE_CHAT_ID)]: { success: true, messageThreadId: 42 },
    };
  });
  registry.define(/^provisioning handles that error$/, async (ctx) => {
    const { adapters, calls } = buildAdapters(ctx);
    ctx.outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);
    ctx.calls = calls;
  });
  registry.define(/^it retargets the new supergroup id$/, (ctx) => {
    assert.equal(ctx.outcome.chatId, String(LIVE_CHAT_ID), `expected the redirected id, got: ${JSON.stringify(ctx.outcome)}`);
    assert.deepEqual(ctx.calls.createTopicCalls, [String(DEAD_CHAT_ID), String(LIVE_CHAT_ID)], 'expected exactly one retry, against the redirected id');
  });
  registry.define(/^it does not treat the upgrade as a terminal failure$/, (ctx) => {
    assert.equal(ctx.outcome.ready, true);
    assert.equal(ctx.outcome.negotiationTopicId, 42);
    assert.equal(ctx.outcome.error, undefined);
  });

  // ── provisioning-follows-supergroup-migration-03 ──────────────────────
  registry.define(/^provisioning has succeeded against the migrated supergroup$/, async (ctx) => {
    ctx.fakeUpdates = migratedUpdateQueue();
    const { adapters, calls } = buildAdapters(ctx);
    ctx.outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);
    ctx.calls = calls;
    assert.equal(ctx.outcome.ready, true, `expected the fixture setup to itself succeed, got: ${JSON.stringify(ctx.outcome)}`);
    assert.notEqual(ctx.outcome.negotiationTopicId, undefined);
  });
  registry.define(/^the confirm offset is persisted$/, () => {
    // The persistConfirmOffset call already happened synchronously inside
    // provisionTelegramChannel above (the "Given" step) - this is a
    // narrative-only step; the Then steps below inspect what was recorded.
  });
  registry.define(/^it is advanced past the updates already consumed$/, (ctx) => {
    assert.deepEqual(ctx.calls.confirmedOffsets, [143744673], `expected the offset to advance past the highest update_id (143744672 + 1), got: ${JSON.stringify(ctx.calls.confirmedOffsets)}`);
  });
  registry.define(/^a later re-run does not re-observe the stale pre-migration updates$/, (ctx) => {
    // Proven structurally: a real getUpdates(offset) call passing the
    // confirmed offset above would never return update_ids <= 143744672
    // again - Telegram's own offset semantics, not something this fixture
    // re-simulates. The confirmed value itself is the proof.
    assert.equal(ctx.calls.confirmedOffsets[0] > 143744672, true);
  });

  // ── provisioning-follows-supergroup-migration-04 ──────────────────────
  registry.define(/^a prior run already detected the migrated supergroup$/, async (ctx) => {
    ctx.fakeUpdates = migratedUpdateQueue();
    const { adapters } = buildAdapters(ctx);
    ctx.firstOutcome = await provisionTelegramChannel('sfvc_target_bot', adapters);
    assert.equal(ctx.firstOutcome.chatId, String(LIVE_CHAT_ID));
  });
  registry.define(/^provisioning runs again$/, async (ctx) => {
    // Re-runs over the SAME update batch (idempotence/determinism of the
    // migration-aware detection itself - a real re-run would see an
    // empty/different batch once the offset from scenario 03 excludes the
    // consumed updates, which is exactly why this must never regress).
    const { adapters } = buildAdapters(ctx);
    ctx.outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);
  });
  registry.define(/^it detects the same live supergroup id$/, (ctx) => {
    assert.equal(ctx.outcome.chatId, String(LIVE_CHAT_ID));
    assert.equal(ctx.outcome.chatId, ctx.firstOutcome.chatId);
  });
  registry.define(/^it does not fail on the pre-migration group id$/, (ctx) => {
    assert.equal(ctx.outcome.ready, true);
    assert.notEqual(ctx.outcome.chatId, String(DEAD_CHAT_ID));
    assert.equal(ctx.outcome.error, undefined);
  });
}

module.exports = { registerSteps };
