'use strict';

// BL-894: step handlers driving the REAL BL-894 hotfix (/queue reposting
// the Host queue selection poll) end to end via runCursorBridgePollOnce,
// never a reimplementation of its branching. Same idiom as
// bl810HostQueuePollClearAllTtlSteps.js, which already drives this same
// surface for BL-810/BL-811.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');

const {
  runCursorBridgePollOnce,
  writeJsonFile,
  loadJsonFile,
  ensureCursorTopic,
  TOPIC_MAP_FILE_NAME,
} = require(path.join(EXT_OUT, 'tools', 'telegramCursorBridgeLive'));
const { createMockCursorBridgeAgentSession } = require(path.join(EXT_OUT, 'bridge', 'cursorBridgeAgentSession'));

const FEATURE = '/queue reposts the Host queue selection poll';
const HOST_TOPIC_ID = 777;
// The one other topic the inbound gate ever lets a message through from
// when cursorTopicId isn't (yet) bound — isOwnedCursorBridgeTopic accepts
// cursorTopicId OR bubbleTopicId, nothing else. This is the Gherkin's
// topic "sidebar": a real, already-recognized topic, distinct from Host.
const SIDEBAR_TOPIC_ID = 888;
const PRINCIPAL_ID = '42';
const SETTLE_MS = 30; // lets handlePromptInboundAction's fire-and-forget IIFE finish before assertions read disk

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl894-acceptance-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function ensureState(ctx) {
  if (!ctx.bl894) {
    const root = mkRoot();
    const opDir = path.join(root, '.swarmforge', 'operator');
    const statePath = path.join(opDir, 'cursor-bridge-state.json');
    const topicMapPath = path.join(opDir, TOPIC_MAP_FILE_NAME);
    writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: HOST_TOPIC_ID });
    ctx.bl894 = {
      root,
      opDir,
      statePath,
      topicMapPath,
      deps: {
        repoRoot: root,
        botToken: 'token',
        chatId: '-100',
        principalUserId: PRINCIPAL_ID,
        opDir,
        statePath,
        topicMapPath,
        agentSession: createMockCursorBridgeAgentSession(root),
        telegramPostFn: async () => ({ ok: true, status: 200, json: {} }),
      },
      pendingPrompts: [],
      pendingPromptPoll: undefined,
      cursorTopicId: HOST_TOPIC_ID,
      bubbleTopicId: undefined,
      busy: false,
      posts: [],
      sentPolls: [],
      seq: 0,
      updateSeq: 100,
    };
  }
  return ctx.bl894;
}

function mkItem(st, text) {
  st.seq += 1;
  return { id: `qp-${st.seq}`, text, createdAtMs: Date.now() };
}

function nextUpdateId(st) {
  st.updateSeq += 1;
  return st.updateSeq;
}

async function withMockedSendPoll(st, fn) {
  const telegramClient = require(path.join(EXT_OUT, 'notify', 'telegramClient'));
  const original = telegramClient.sendTelegramPoll;
  telegramClient.sendTelegramPoll = async (_token, _chatId, question, options, topicId) => {
    st.sentPolls.push({ question, options, topicId });
    return { success: true, pollId: `poll-mock-${nextUpdateId(st)}` };
  };
  try {
    return await fn();
  } finally {
    telegramClient.sendTelegramPoll = original;
  }
}

function refreshFromDisk(st) {
  const disk = loadJsonFile(st.statePath);
  st.pendingPrompts = disk.pendingPrompts ?? [];
  st.pendingPromptPoll = disk.pendingPromptPoll;
  st.cursorTopicId = disk.cursorTopicId;
  st.supersededPromptPollIds = disk.supersededPromptPollIds;
}

function currentState(st) {
  return {
    updateOffset: 0,
    cursorTopicId: st.cursorTopicId,
    bubbleTopicId: st.bubbleTopicId,
    pendingPrompts: st.pendingPrompts,
    pendingPromptPoll: st.pendingPromptPoll,
    supersededPromptPollIds: st.supersededPromptPollIds,
  };
}

async function runCycle(ctx, updates) {
  const st = ensureState(ctx);
  const initialState = currentState(st);
  const result = await withMockedSendPoll(st, () =>
    runCursorBridgePollOnce(
      {
        ...st.deps,
        post: async (_t, _c, _topic, text) => {
          st.posts.push(text);
        },
        getUpdates: async () => ({ success: true, updates }),
      },
      initialState,
      st.busy,
      0
    )
  );
  st.busy = result.busy;
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  refreshFromDisk(st);
}

function queueMessageUpdate(st, topicId) {
  return {
    update_id: nextUpdateId(st),
    message: {
      message_id: nextUpdateId(st),
      text: '/queue',
      from: { id: Number(PRINCIPAL_ID) },
      chat: { id: -100 },
      message_thread_id: topicId,
    },
  };
}

function pollAnswerUpdate(pollId, optionIndex) {
  return {
    update_id: 0, // overwritten by caller via nextUpdateId
    poll_answer: {
      poll_id: pollId,
      option_ids: [optionIndex],
      user: { id: Number(PRINCIPAL_ID) },
    },
  };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(/^a Host bridge whose Telegram topic is known$/, (ctx) => {
    ensureState(ctx);
  }, FEATURE);

  registry.defineScoped(/^the bridge is idle$/, (ctx) => {
    ensureState(ctx).busy = false;
  }, FEATURE);

  // ── Given: queue contents ───────────────────────────────────────────
  registry.defineScoped(/^(\d+) questions? (?:is|are) queued$/, (ctx, count) => {
    const st = ensureState(ctx);
    const n = Number(count);
    st.pendingPrompts = Array.from({ length: n }, (_, idx) => mkItem(st, `question ${idx + 1}`));
  }, FEATURE);

  // ── Given: an outstanding poll matching the current queue (scenario 03) ─
  registry.defineScoped(/^a selection poll is already outstanding$/, (ctx) => {
    const st = ensureState(ctx);
    st.pendingPromptPoll = {
      pollId: 'poll-original',
      itemIds: st.pendingPrompts.map((item) => item.id),
      clearAllOptionIndex: st.pendingPrompts.length,
    };
    writeJsonFile(st.statePath, { ...currentState(st) });
  }, FEATURE);

  // ── When/Given: the human sends /queue from the Host topic ──────────
  registry.defineScoped(/^the human (?:sends|has sent) "\/queue"$/, async (ctx) => {
    const st = ensureState(ctx);
    await runCycle(ctx, [queueMessageUpdate(st, st.cursorTopicId ?? SIDEBAR_TOPIC_ID)]);
  }, FEATURE);

  // ── Given: scenario 03's second repost, confirmed already posted ────
  // (The FIRST poll was seeded directly into state by "a selection poll is
  // already outstanding", never sent through the mock — so exactly one
  // real send is expected here, and it must have superseded the original.)
  registry.defineScoped(/^a second selection poll has been posted$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 1, `expected exactly one repost sent; got ${st.sentPolls.length}`);
    assert.ok(
      st.pendingPromptPoll && st.pendingPromptPoll.pollId !== 'poll-original',
      'expected the repost to supersede the original outstanding poll'
    );
    st.secondPollId = st.pendingPromptPoll.pollId;
  }, FEATURE);

  // ── Given: scenario 03b's third repost — the ORIGINAL poll is now
  // superseded by two generations, not just one (BL-894 D1) ──────────────
  registry.defineScoped(/^a third selection poll has been posted$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 2, `expected exactly two reposts sent; got ${st.sentPolls.length}`);
    assert.ok(
      st.pendingPromptPoll &&
        st.pendingPromptPoll.pollId !== 'poll-original' &&
        st.pendingPromptPoll.pollId !== st.secondPollId,
      'expected the second repost to supersede the first repost, not just the original'
    );
  }, FEATURE);

  // ── When: a vote on the superseded (first) poll ──────────────────────
  registry.defineScoped(/^the human votes on the superseded poll$/, async (ctx) => {
    const st = ensureState(ctx);
    const update = pollAnswerUpdate('poll-original', st.pendingPrompts.length);
    update.update_id = nextUpdateId(st);
    await runCycle(ctx, [update]);
  }, FEATURE);

  // ── When: a vote for a specific question on the newest poll (scenario 04) ─
  registry.defineScoped(/^the human votes for question (\d+) on the newest poll$/, async (ctx, position) => {
    const st = ensureState(ctx);
    const idx = Number(position) - 1;
    const update = pollAnswerUpdate(st.pendingPromptPoll.pollId, idx);
    update.update_id = nextUpdateId(st);
    await runCycle(ctx, [update]);
  }, FEATURE);

  // ── Then: scenario 01 ────────────────────────────────────────────────
  registry.defineScoped(/^a selection poll is posted to the Host topic$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 1, `expected exactly one poll sent; got ${st.sentPolls.length}`);
    assert.equal(st.sentPolls[0].topicId, HOST_TOPIC_ID);
  }, FEATURE);

  registry.defineScoped(/^the poll offers one option per queued question plus clear-all$/, (ctx) => {
    const st = ensureState(ctx);
    const { options } = st.sentPolls[0];
    assert.equal(options.length, st.pendingPrompts.length + 1);
    assert.ok(/clear.?all/i.test(options[options.length - 1]), `expected a clear-all option; got:\n${options.join('\n')}`);
  }, FEATURE);

  registry.defineScoped(/^no truncated text listing of the queue is posted$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(
      !st.posts.some((t) => /^Queued questions:/.test(t)),
      `expected no text-list post; posts:\n${st.posts.join('\n---\n')}`
    );
  }, FEATURE);

  // ── Then: scenario 02 ────────────────────────────────────────────────
  registry.defineScoped(/^the bridge replies "([^"]+)"$/, (ctx, expected) => {
    const st = ensureState(ctx);
    assert.ok(st.posts.includes(expected), `expected a reply of "${expected}"; posts:\n${st.posts.join('\n---\n')}`);
  }, FEATURE);

  registry.defineScoped(/^no selection poll is posted$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 0, `expected no poll sent; got:\n${JSON.stringify(st.sentPolls)}`);
  }, FEATURE);

  // ── Then: scenario 03 ────────────────────────────────────────────────
  registry.defineScoped(/^the human is told that poll is no longer live$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(
      st.posts.some((t) => /no longer live/i.test(t)),
      `expected a reply telling the human the poll is stale; posts:\n${st.posts.join('\n---\n')}`
    );
  }, FEATURE);

  registry.defineScoped(/^the queue still holds (\d+) questions$/, (ctx, count) => {
    const st = ensureState(ctx);
    assert.equal(st.pendingPrompts.length, Number(count));
  }, FEATURE);

  // ── Then: scenario 04 ────────────────────────────────────────────────
  registry.defineScoped(/^question (\d+) runs as the bridge's next turn$/, (ctx, position) => {
    const st = ensureState(ctx);
    assert.ok(
      st.posts.some((t) => t.includes(`question ${position}`)),
      `expected question ${position}'s text to reach the Host agent; posts:\n${st.posts.join('\n---\n')}`
    );
  }, FEATURE);

  registry.defineScoped(/^question (\d+) leaves the queue$/, (ctx, position) => {
    const st = ensureState(ctx);
    assert.ok(!st.pendingPrompts.some((item) => item.text === `question ${position}`));
  }, FEATURE);

  // ── Given/When/Then: scenario 05 (outline) ───────────────────────────
  registry.defineScoped(/^the bridge has "([^"]+)" recorded as its Host topic$/, (ctx, topicLabel) => {
    const st = ensureState(ctx);
    assert.equal(topicLabel, 'host');
    st.cursorTopicId = HOST_TOPIC_ID;
    st.bubbleTopicId = SIDEBAR_TOPIC_ID;
    st.pendingPrompts = [mkItem(st, 'a queued question')];
    writeJsonFile(st.statePath, currentState(st));
  }, FEATURE);

  registry.defineScoped(/^the bridge has no topic recorded as its Host topic$/, (ctx) => {
    const st = ensureState(ctx);
    st.cursorTopicId = undefined;
    st.bubbleTopicId = SIDEBAR_TOPIC_ID;
    st.pendingPrompts = [mkItem(st, 'a queued question')];
    writeJsonFile(st.statePath, currentState(st));
  }, FEATURE);

  registry.defineScoped(/^the human sends "\/queue" from topic "sidebar"$/, async (ctx) => {
    const st = ensureState(ctx);
    await runCycle(ctx, [queueMessageUpdate(st, st.bubbleTopicId)]);
  }, FEATURE);

  // A later auto-present is the bridge's own canonical topic binding
  // (ensureCursorTopic — the ONLY thing ever allowed to set cursorTopicId)
  // legitimately (re-)running, e.g. on the next process bootstrap — never
  // the earlier /queue arrival topic. Idempotent when cursorTopicId is
  // already bound (ensureCursorTopic's own early return).
  registry.defineScoped(/^a later auto-present posts a selection poll$/, async (ctx) => {
    const st = ensureState(ctx);
    const bound = await ensureCursorTopic(
      st.deps.botToken,
      st.deps.chatId,
      st.topicMapPath,
      currentState(st),
      async () => ({ success: true, messageThreadId: HOST_TOPIC_ID })
    );
    st.cursorTopicId = bound.cursorTopicId;
    writeJsonFile(st.statePath, { ...currentState(st), cursorTopicId: st.cursorTopicId });
    await runCycle(ctx, []);
  }, FEATURE);

  registry.defineScoped(/^that poll is posted to topic "([^"]+)"$/, (ctx, topicLabel) => {
    const st = ensureState(ctx);
    assert.equal(topicLabel, 'host');
    assert.ok(st.sentPolls.length > 0, 'expected the later auto-present to send a poll');
    assert.equal(st.sentPolls[st.sentPolls.length - 1].topicId, HOST_TOPIC_ID);
  }, FEATURE);
}

module.exports = { registerSteps };
