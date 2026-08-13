'use strict';

// BL-767: step handlers driving the REAL bridge poll loop
// (telegramCursorBridgeLive.runCursorBridgePollOnce) end to end for "Queued
// bridge questions answer in the topic they were asked in" - no mocked
// topic-routing logic. Each scenario drives up to three real poll cycles:
//   1. queue the question (bridge already busy - Background)
//   2. post the selection poll once idle (real postQueueSelectionPoll)
//   3. answer that real poll, letting the (mocked-agent) run complete
// registered with defineScoped per the ticket's own scope note: "the
// answer is posted to the Cursor Remote topic" is generic enough to win
// for another feature under the global first-match registry (BL-425).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');

const { createMockCursorBridgeAgentSession } = require(path.join(EXT_OUT, 'bridge', 'cursorBridgeAgentSession'));
const {
  runCursorBridgePollOnce,
  writeJsonFile,
  loadJsonFile,
} = require(path.join(EXT_OUT, 'tools', 'telegramCursorBridgeLive'));
const telegramClient = require(path.join(EXT_OUT, 'notify', 'telegramClient'));

const FEATURE_NAME = 'Queued bridge questions answer in the topic they were asked in';

const CURSOR_TOPIC_ID = 100;
const BUBBLE_TOPIC_ID = 200;
const PRINCIPAL_ID = 42;
const CHAT_ID = '-100';

function topicIdFor(name) {
  return name === 'Bubble' ? BUBBLE_TOPIC_ID : CURSOR_TOPIC_ID;
}

function tmpOpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl767-acceptance-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return path.join(root, '.swarmforge', 'operator');
}

// Every liveness cue (Cursor Remote's, and BL-767's per-topic queued-work
// cue) is posted via the default sendMessage/editMessageText adapters,
// which extract a message_id from the response to know a post succeeded -
// an empty json (unlike a plain ok:true) reads as a failed post and the
// cue identity is silently never recorded, so this must hand back a real one.
let fakeMessageId = 1;
const NOOP_TELEGRAM_POST_FN = async () => ({
  ok: true,
  status: 200,
  json: { ok: true, result: { message_id: fakeMessageId++ } },
});

function baseDeps(ctx) {
  return {
    repoRoot: path.dirname(path.dirname(ctx.opDir)),
    botToken: 'token',
    chatId: CHAT_ID,
    principalUserId: String(PRINCIPAL_ID),
    opDir: ctx.opDir,
    statePath: ctx.statePath,
    topicMapPath: path.join(ctx.opDir, 'cursor-bridge-topic-map.json'),
    agentSession: ctx.session,
    telegramPostFn: NOOP_TELEGRAM_POST_FN,
  };
}

async function runCycle(ctx, overrides) {
  const state = loadJsonFile(ctx.statePath);
  const next = await runCursorBridgePollOnce(
    { ...baseDeps(ctx), post: async (_t, _c, topicId, text) => ctx.posts.push({ topicId, text }), ...overrides },
    state,
    overrides.busy ?? false,
    0
  );
  ctx.busy = next.busy;
  return next;
}

// Drains the queue for real: posts the selection poll (real
// postQueueSelectionPoll, telegramClient.sendTelegramPoll intercepted only
// to capture the pollId - never faked routing), then answers it, letting
// the queued item's real deferred-reply resolution run.
async function drainQueue(ctx) {
  const originalSendPoll = telegramClient.sendTelegramPoll;
  let capturedPollId;
  telegramClient.sendTelegramPoll = async (...args) => {
    capturedPollId = 'poll-bl767-acceptance';
    return { success: true, pollId: capturedPollId };
  };
  try {
    await runCycle(ctx, { busy: false, getUpdates: async () => ({ success: true, updates: [] }) });
  } finally {
    telegramClient.sendTelegramPoll = originalSendPoll;
  }
  assert.ok(capturedPollId, 'expected the real selection poll to be posted before it can be answered');

  await runCycle(ctx, {
    busy: false,
    getUpdates: async () => ({
      success: true,
      updates: [
        {
          update_id: 900,
          poll_answer: { poll_id: capturedPollId, option_ids: [0], user: { id: PRINCIPAL_ID } },
        },
      ],
    }),
  });
  // The prompt run completes in a detached async block (handlePromptInboundAction) -
  // let it settle before assertions.
  await new Promise((resolve) => setTimeout(resolve, 30));
}

function registerSteps(registry) {
  registry.defineScoped(
    /^the Cursor Remote topic and the Bubble topic are both bridge-owned$/,
    (ctx) => {
      ctx.opDir = tmpOpDir();
      ctx.statePath = path.join(ctx.opDir, 'cursor-bridge-state.json');
      ctx.session = createMockCursorBridgeAgentSession(path.dirname(path.dirname(ctx.opDir)));
      ctx.posts = [];
      ctx.busy = false;
      writeJsonFile(ctx.statePath, {
        updateOffset: 0,
        cursorTopicId: CURSOR_TOPIC_ID,
        bubbleTopicId: BUBBLE_TOPIC_ID,
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge is already working a turn$/,
    (ctx) => {
      ctx.bridgeBusy = true;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the human posts a question in the (Cursor Remote|Bubble) topic$/,
    async (ctx, origin) => {
      const topicId = topicIdFor(origin);
      ctx.lastOriginTopicId = topicId;
      await runCycle(ctx, {
        busy: ctx.bridgeBusy === true,
        getUpdates: async () => ({
          success: true,
          updates: [
            {
              update_id: 800,
              message: {
                message_id: 10,
                text: `question from ${origin}`,
                from: { id: PRINCIPAL_ID },
                chat: { id: Number(CHAT_ID) },
                message_thread_id: topicId,
              },
            },
          ],
        }),
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a queued question was recorded without an origin topic$/,
    (ctx) => {
      const state = loadJsonFile(ctx.statePath);
      writeJsonFile(ctx.statePath, {
        ...state,
        // Deliberately no originTopicId - the exact shape of a state file
        // written before this ticket.
        pendingPrompts: [{ id: 'qp-legacy', text: 'legacy queued question', createdAtMs: Date.now() }],
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the queue acknowledgement is posted to the (Cursor Remote|Bubble) topic$/,
    (ctx, origin) => {
      const topicId = topicIdFor(origin);
      assert.ok(
        ctx.posts.some((p) => p.topicId === topicId && /queued/.test(p.text)),
        `expected a queue-ack post in the ${origin} topic; got ${JSON.stringify(ctx.posts)}`
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge finishes its turn and drains the queue$/,
    async (ctx) => {
      await drainQueue(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the answer is posted to the (Cursor Remote|Bubble) topic$/,
    (ctx, origin) => {
      const topicId = topicIdFor(origin);
      assert.ok(
        ctx.posts.some((p) => p.topicId === topicId && p.text.includes('Agent started')),
        `expected the drained answer to start in the ${origin} topic; got ${JSON.stringify(ctx.posts)}`
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no answer is posted to the Cursor Remote topic$/,
    (ctx) => {
      assert.ok(
        !ctx.posts.some((p) => p.topicId === CURSOR_TOPIC_ID && p.text.includes('Agent started')),
        `expected no answer in Cursor Remote; got ${JSON.stringify(ctx.posts)}`
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the busy cue in the Bubble topic reports (\d+) waiting$/,
    (ctx, countText) => {
      const state = loadJsonFile(ctx.statePath);
      const cue = state.queuedWorkLivenessStatus?.[String(BUBBLE_TOPIC_ID)];
      assert.ok(cue, `expected a queued-work cue recorded for the Bubble topic; state=${JSON.stringify(state)}`);
      assert.match(
        cue.renderedText,
        new RegExp(`${countText} waiting`),
        `expected the Bubble cue to report ${countText} waiting; got "${cue.renderedText}"`
      );
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
