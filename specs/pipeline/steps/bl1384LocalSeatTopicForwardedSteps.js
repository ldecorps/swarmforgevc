'use strict';

// BL-1384: step handlers for "The local seat's topic reaches the bridge
// through the front desk".
//
// Drives the REAL front-desk dispatch (runPollCycle -> processMessageUpdate
// -> attemptCursorBridgeTopicExclusion) for the forwarding half (scenarios
// 01, 03, 04), and the REAL bridge poll (runCursorBridgePollOnce ->
// processInboundUpdates) for the draining half (scenario 02) - the ticket's
// own point is that these are TWO separate processes joined only by the
// inbound-queue file, so nothing short of driving both sides for real (via
// the REAL appendCursorBridgeInboundUpdate/drainCursorBridgeInboundUpdates)
// proves the seam. Only the local model's own HTTP call is faked
// (readEndpoint/complete, the same injection seam BL-1235's own tests use).
//
// Fixture roots come from mkProcessTmpDir: the acceptance runner has no Vitest
// afterEach, so a root registered for that sweep would leak. Removal is
// registered on process exit instead.

const assert = require('node:assert/strict');
const path = require('node:path');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');
// BL-1658: paths only - telegramCursorBridgeLive.js itself eagerly requires
// cursorBridgeAgentSession, so a mere require() of this file must not pay
// for the whole heavy production graph (@cursor/sdk etc.) through that
// transitive edge. Required once, on first use, and cached.
let _lib = null;
function lib() {
  if (!_lib) {
    _lib = {
      ...require('../../../extension/out/tools/telegramFrontDeskBotCore'),
      ...require('../../../extension/out/tools/cursorBridgeInboundQueue'),
      ...require('../../../extension/out/tools/telegramCursorBridgeLive'),
      ...require('../../../extension/out/tools/localQwenSeatLive'),
      ...require('../../../extension/out/bridge/cursorBridgeAgentSession'),
    };
  }
  return _lib;
}
// BL-1680: the SAME id the faked catalogue below claims to hold, imported
// rather than retyped, so the two can never drift apart. Without this,
// runLocalSeatTurn resolves its model from the live process.env
// (SWARMFORGE_LOCAL_SEAT_MODEL), so this fixture was red on any host
// exporting that var to a model the fixture's catalogue does not hold.
// A lightweight, leaf module (no cursor-bridge dependency) - required
// directly at module scope, outside lib(), same as before BL-1658.
const { DEFAULT_LOCAL_SEAT_MODEL_ID } = require('../../../extension/out/tools/localQwenSeat');

const FEATURE = "BL-1384 The local seat's topic reaches the bridge through the front desk";

const PRINCIPAL_ID = 111;
const CHAT_ID = '-100';
const BACKOFF_CONFIG = {
  backoffBaseMs: 1000,
  backoffMaxMs: 8000,
  degradedThreshold: 3,
  sustainedOutageThresholdMs: 30 * 60_000,
};
const NO_OUTAGE = { escalated: false };
const LOCAL_SEAT_TOPIC = 4242;
const UNOWNED_TOPIC = 900;

function ensureCtx(ctx) {
  if (!ctx.bl1384) {
    const root = mkProcessTmpDir('aps-bl1384-');
    ctx.bl1384 = {
      root,
      opDir: path.join(root, '.swarmforge', 'operator'),
      qwenLocalSeatTopicId: LOCAL_SEAT_TOPIC,
      opened: [],
      forwarded: [],
      localReply: undefined,
      updateId: 500,
    };
  }
  return ctx.bl1384;
}

function mkUpdate(topicId, text, updateId) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: 1 },
      from: { id: PRINCIPAL_ID },
      message_thread_id: topicId,
      text,
    },
  };
}

async function routeThroughFrontDesk(state, update) {
  await lib().runPollCycle(
    { offset: 0, consecutiveFailures: 0, sustainedOutage: NO_OUTAGE },
    PRINCIPAL_ID,
    {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [update] }),
      postToBridge: async () => true,
      subjectForTopic: () => undefined,
      openSubjectAndRecord: async (topicId) => {
        state.opened.push(topicId);
        return 'SUP-1';
      },
      qwenLocalSeatTopicId: async () => state.qwenLocalSeatTopicId,
      forwardCursorBridgeUpdate: async (u) => {
        state.forwarded.push(u);
        lib().appendCursorBridgeInboundUpdate(state.opDir, u);
        return true;
      },
    },
    BACKOFF_CONFIG,
    0
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a front desk fixture feeding the cursor bridge inbound queue$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^the local seat topic map binds the local seat to topic (\d+)$/, (ctx, topicId) => {
    ensureCtx(ctx).qwenLocalSeatTopicId = Number(topicId);
  });

  scoped(/^the local seat topic map is absent$/, (ctx) => {
    ensureCtx(ctx).qwenLocalSeatTopicId = undefined;
  });

  scoped(/^a message "([^"]*)" arrives in topic (\d+)$/, async (ctx, text, topicId) => {
    const state = ensureCtx(ctx);
    state.updateId += 1;
    await routeThroughFrontDesk(state, mkUpdate(Number(topicId), text, state.updateId));
  });

  scoped(/^a message "([^"]*)" in topic (\d+) is waiting in the bridge inbound queue$/, (ctx, text, topicId) => {
    const state = ensureCtx(ctx);
    state.updateId += 1;
    lib().appendCursorBridgeInboundUpdate(state.opDir, mkUpdate(Number(topicId), text, state.updateId));
  });

  scoped(/^the local endpoint answers "([^"]*)"$/, (ctx, reply) => {
    ensureCtx(ctx).localReply = reply;
  });

  scoped(/^the update is appended to the bridge inbound queue$/, (ctx) => {
    const state = ensureCtx(ctx);
    const drained = lib().drainCursorBridgeInboundUpdates(state.opDir);
    assert.equal(drained.length, 1, `expected exactly one queued update: ${JSON.stringify(drained)}`);
    assert.equal(drained[0].update_id, state.updateId);
  });

  scoped(/^the update is not appended to the bridge inbound queue$/, (ctx) => {
    const state = ensureCtx(ctx);
    const drained = lib().drainCursorBridgeInboundUpdates(state.opDir);
    assert.deepEqual(drained, [], `no update should have been queued: ${JSON.stringify(drained)}`);
  });

  scoped(/^no support subject is opened for topic (\d+)$/, (ctx, topicId) => {
    const state = ensureCtx(ctx);
    assert.ok(!state.opened.includes(Number(topicId)), `a support subject was opened for topic ${topicId}: ${JSON.stringify(state.opened)}`);
  });

  scoped(/^a support subject is opened for topic (\d+)$/, (ctx, topicId) => {
    const state = ensureCtx(ctx);
    assert.ok(state.opened.includes(Number(topicId)), `topic ${topicId} did not follow today's flow: ${JSON.stringify(state.opened)}`);
  });

  scoped(/^the bridge drains the inbound queue$/, async (ctx) => {
    const state = ensureCtx(ctx);
    const statePath = path.join(state.opDir, 'cursor-bridge-state.json');
    const topicMapPath = path.join(state.opDir, 'cursor-bridge-topic-map.json');
    state.posts = [];
    await lib().runCursorBridgePollOnce(
      {
        repoRoot: state.root,
        botToken: 'fixture-token',
        chatId: CHAT_ID,
        principalUserId: String(PRINCIPAL_ID),
        opDir: state.opDir,
        statePath,
        topicMapPath,
        agentSession: lib().createMockCursorBridgeAgentSession(state.root),
        useInboundQueue: true,
        qwenLocalTopicId: state.qwenLocalSeatTopicId,
        // Wraps the REAL runLocalSeatTurn (BL-1235's own decision/turn logic)
        // with only the local model's HTTP call faked - proves the seam
        // between the forwarded update and the seat actually answering.
        runLocalSeatTurnFn: (input) =>
          lib().runLocalSeatTurn({
            ...input,
            // BL-1680: pinned beside the faked catalogue below - never
            // left to resolve from the live process.env.
            modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
            readEndpoint: async () => ({
              probe: { endpointStatus: 'healthy', endpointUrl: 'http://fixture.invalid' },
              catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
            }),
            complete: async () => state.localReply ?? '',
          }),
        post: async (_botToken, _chatId, topicId, message) => {
          state.posts.push({ topicId, message });
        },
        getUpdates: async () => ({ success: true, updates: [] }),
      },
      { updateOffset: 0, cursorTopicId: undefined },
      false,
      0
    );
  });

  scoped(/^"([^"]*)" is posted in topic (\d+)$/, (ctx, message, topicId) => {
    const state = ensureCtx(ctx);
    assert.ok(
      state.posts.some((p) => p.topicId === Number(topicId) && p.message === message),
      `expected "${message}" posted in topic ${topicId}: ${JSON.stringify(state.posts)}`
    );
  });
}

module.exports = { registerSteps };
