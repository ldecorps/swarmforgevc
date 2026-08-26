'use strict';

// BL-811: step handlers driving the REAL BL-810 hotfix end to end -
// runCursorBridgePollOnce (the poll-loop tick), the TTL sweep, and the
// front desk's poll_answer fan-out (telegramFrontDeskBotCore -> the
// cursorBridgeInboundQueue file -> the bridge's own drain), never a
// reimplementation of any of it. Same idiom as
// bl764FrontDeskEatsHostBridgeUpdatesSteps.js and bl807's real-fixture
// driving, adapted to this feature's pure in-process (no tmux) surface.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');

const { runCursorBridgePollOnce, writeJsonFile, loadJsonFile } = require(
  path.join(EXT_OUT, 'tools', 'telegramCursorBridgeLive')
);
const { parseCursorBridgeState } = require(path.join(EXT_OUT, 'tools', 'telegramCursorBridgeCore'));
const { createMockCursorBridgeAgentSession } = require(path.join(EXT_OUT, 'bridge', 'cursorBridgeAgentSession'));
const { pollAndForward } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));
const { appendCursorBridgeInboundUpdate } = require(path.join(EXT_OUT, 'tools', 'cursorBridgeInboundQueue'));

const FEATURE = 'the Host question queue is drained by poll, clear-all, or expiry';
const HOST_TOPIC_ID = 777;
const PRINCIPAL_ID = '42';
const HOUR_MS = 60 * 60 * 1000;
const SETTLE_MS = 30; // lets handlePromptInboundAction's fire-and-forget IIFE finish before assertions read disk

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl810-acceptance-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function ensureState(ctx) {
  if (!ctx.bl810) {
    const root = mkRoot();
    const opDir = path.join(root, '.swarmforge', 'operator');
    const statePath = path.join(opDir, 'cursor-bridge-state.json');
    // Baseline on disk carries no queue fields, mirroring mkPollDeps in the
    // unit suite - runCursorBridgePollOnce's diskHasQueue guard then leaves
    // the in-memory state (below) authoritative for every scenario here.
    writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: HOST_TOPIC_ID });
    ctx.bl810 = {
      root,
      opDir,
      statePath,
      deps: {
        repoRoot: root,
        botToken: 'token',
        chatId: '-100',
        principalUserId: PRINCIPAL_ID,
        opDir,
        statePath,
        topicMapPath: path.join(opDir, 'cursor-bridge-topic-map.json'),
        agentSession: createMockCursorBridgeAgentSession(root),
        telegramPostFn: async () => ({ ok: true, status: 200, json: {} }),
      },
      pendingPrompts: [],
      pendingPromptPoll: undefined,
      busy: false,
      posts: [],
      sentPolls: [],
      seq: 0,
      updateSeq: 100,
    };
  }
  return ctx.bl810;
}

function mkItem(st, text, ageMs = 0) {
  st.seq += 1;
  return { id: `qp-${st.seq}`, text, createdAtMs: Date.now() - ageMs };
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
  const disk = parseCursorBridgeState(loadJsonFile(st.statePath));
  st.pendingPrompts = disk.pendingPrompts ?? [];
  st.pendingPromptPoll = disk.pendingPromptPoll;
}

async function runPollCycle(ctx, updates) {
  const st = ensureState(ctx);
  const initialState = {
    updateOffset: 0,
    cursorTopicId: HOST_TOPIC_ID,
    pendingPrompts: st.pendingPrompts,
    pendingPromptPoll: st.pendingPromptPoll,
  };
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

function pollAnswerUpdate(st, optionIndex) {
  return {
    update_id: nextUpdateId(st),
    poll_answer: {
      poll_id: st.pendingPromptPoll.pollId,
      option_ids: [optionIndex],
      user: { id: Number(PRINCIPAL_ID) },
    },
  };
}

// Front desk adapters for the fan-out scenario: every SUP/Operator route
// throws so reaching an assertion afterwards already proves this vote never
// took a routing path other than the Cursor Remote bridge exclusion -
// mirrors bl764's cursorBridgePollAdapters exactly.
function frontDeskAdapters(st, update) {
  return {
    chatId: st.deps.chatId,
    cursorBridgeTopicId: async () => HOST_TOPIC_ID,
    postToBridge: async () => {
      throw new Error('postToBridge (SUP/Operator route) must never be called for a bridge poll_answer');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord (SUP/Operator route) must never be called for a bridge poll_answer');
    },
    postOperatorContext: async () => {
      throw new Error('postOperatorContext (SUP/Operator route) must never be called for a bridge poll_answer');
    },
    forwardCursorBridgeUpdate: async (u) => {
      appendCursorBridgeInboundUpdate(st.opDir, u);
      return true;
    },
    getUpdates: async () => ({ success: true, updates: [update] }),
  };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(/^a Host bridge with queued questions and a known Host topic$/, (ctx) => {
    ensureState(ctx);
  }, FEATURE);

  // ── Given/And: bridge busy state ───────────────────────────────────
  registry.defineScoped(/^the Host bridge has just finished working$/, (ctx) => {
    ensureState(ctx).busy = false;
  }, FEATURE);

  registry.defineScoped(/^the Host bridge is (still working|just finished working)$/, (ctx, state) => {
    ensureState(ctx).busy = state === 'still working';
  }, FEATURE);

  // ── Given/And: queue contents (shared by outline-02 and scenarios 01/06) ─
  registry.defineScoped(/^the queue is (not empty|empty)$/, (ctx, state) => {
    const st = ensureState(ctx);
    if (state === 'empty') {
      st.pendingPrompts = [];
    } else if (st.pendingPrompts.length === 0) {
      st.pendingPrompts = [mkItem(st, 'queued question')];
    }
  }, FEATURE);

  // ── Given: an outstanding poll already matching the current queue ──────
  registry.defineScoped(/^a queue selection poll is already outstanding for the current queue$/, (ctx) => {
    const st = ensureState(ctx);
    const items = [mkItem(st, 'first outstanding'), mkItem(st, 'second outstanding')];
    st.pendingPrompts = items;
    st.pendingPromptPoll = {
      pollId: 'poll-outstanding',
      itemIds: items.map((i) => i.id),
      clearAllOptionIndex: items.length,
    };
  }, FEATURE);

  // ── Given: a poll listing three queued questions (scenarios 04/05) ─────
  registry.defineScoped(/^a queue selection poll listing three queued questions$/, (ctx) => {
    const st = ensureState(ctx);
    const items = [mkItem(st, 'first question'), mkItem(st, 'second question'), mkItem(st, 'third question')];
    st.pendingPrompts = items;
    st.pendingPromptPoll = {
      pollId: 'poll-preexisting',
      itemIds: items.map((i) => i.id),
      clearAllOptionIndex: items.length,
    };
  }, FEATURE);

  // ── When: votes ──────────────────────────────────────────────────────
  registry.defineScoped(/^the human votes for the second question$/, async (ctx) => {
    const st = ensureState(ctx);
    await runPollCycle(ctx, [pollAnswerUpdate(st, 1)]);
  }, FEATURE);

  registry.defineScoped(/^the human votes for the clear-all option$/, async (ctx) => {
    const st = ensureState(ctx);
    await runPollCycle(ctx, [pollAnswerUpdate(st, st.pendingPromptPoll.clearAllOptionIndex)]);
  }, FEATURE);

  // ── When: the poll-loop tick / a fresh poll post ────────────────────────
  registry.defineScoped(/^the bridge poll loop next runs$/, async (ctx) => {
    await runPollCycle(ctx, []);
  }, FEATURE);

  registry.defineScoped(/^a queue selection poll is posted$/, async (ctx) => {
    await runPollCycle(ctx, []);
  }, FEATURE);

  registry.defineScoped(/^the expiry sweep runs$/, async (ctx) => {
    await runPollCycle(ctx, []);
  }, FEATURE);

  // ── Then: scenario 01 ────────────────────────────────────────────────
  registry.defineScoped(/^a queue selection poll is posted to the Host topic$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 1, `expected exactly one poll sent; got ${st.sentPolls.length}`);
    assert.equal(st.sentPolls[0].topicId, HOST_TOPIC_ID);
  }, FEATURE);

  registry.defineScoped(/^the human is not required to send \/queue first$/, (ctx) => {
    const st = ensureState(ctx);
    // The poll fired purely off the poll-loop tick in the previous step - no
    // /queue command update was ever fed into getUpdates for this scenario,
    // and a poll was already confirmed sent by the previous assertion.
    assert.ok(st.sentPolls.length > 0);
  }, FEATURE);

  // ── Then: scenario 02 (outline) ─────────────────────────────────────
  registry.defineScoped(/^no queue selection poll is posted$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 0, `expected no poll sent; got:\n${JSON.stringify(st.sentPolls)}`);
  }, FEATURE);

  // ── Then: scenario 03 ────────────────────────────────────────────────
  registry.defineScoped(/^no second queue selection poll is posted$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 0, `expected no additional poll sent; got:\n${JSON.stringify(st.sentPolls)}`);
  }, FEATURE);

  // ── Then: scenario 04 ────────────────────────────────────────────────
  registry.defineScoped(/^that question is sent to the Host agent as the next turn$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(
      st.posts.some((t) => t.includes('second question')),
      `expected the selected question's text to reach the Host agent; posts:\n${st.posts.join('\n---\n')}`
    );
  }, FEATURE);

  registry.defineScoped(/^that question is removed from the queue$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(!st.pendingPrompts.some((p) => p.text === 'second question'));
  }, FEATURE);

  registry.defineScoped(/^the other two questions remain queued$/, (ctx) => {
    const st = ensureState(ctx);
    const texts = st.pendingPrompts.map((p) => p.text).sort();
    assert.deepEqual(texts, ['first question', 'third question']);
  }, FEATURE);

  // ── Then: scenario 05 ────────────────────────────────────────────────
  registry.defineScoped(/^every queued question is removed$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.pendingPrompts.length, 0);
  }, FEATURE);

  registry.defineScoped(/^no question is sent to the Host agent$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(!st.posts.some((t) => t.includes('Agent started')));
  }, FEATURE);

  registry.defineScoped(/^a receipt naming what was cleared is posted$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(
      st.posts.some((t) => /Cleared 3 queued questions/.test(t)),
      `posts:\n${st.posts.join('\n---\n')}`
    );
  }, FEATURE);

  // ── Then: scenario 06 ────────────────────────────────────────────────
  registry.defineScoped(/^the poll offers a clear-all option alongside the queued questions$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 1);
    const { options } = st.sentPolls[0];
    assert.equal(options[options.length - 1], 'Clear all queued questions');
    assert.equal(
      options.length,
      st.pendingPrompts.length + 1,
      `expected one clear-all option beyond the ${st.pendingPrompts.length} queued questions; got ${options.length}`
    );
  }, FEATURE);

  // ── Given/Then: scenario 07 (outline) ───────────────────────────────
  registry.defineScoped(/^a queued question whose age is (\d+) hours$/, (ctx, hours) => {
    const st = ensureState(ctx);
    st.pendingPrompts = [mkItem(st, 'agey question', Number(hours) * HOUR_MS)];
  }, FEATURE);

  registry.defineScoped(/^the question is (kept|dropped)$/, (ctx, disposition) => {
    const st = ensureState(ctx);
    const present = st.pendingPrompts.some((p) => p.text === 'agey question');
    if (disposition === 'kept') {
      assert.ok(present, 'expected the question to survive the sweep');
    } else {
      assert.ok(!present, 'expected the question to be dropped by the sweep');
    }
  }, FEATURE);

  registry.defineScoped(/^it is never sent to the Host agent as a result of the sweep$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(!st.posts.some((t) => t.includes('Agent started')));
  }, FEATURE);

  // ── Given/Then: scenario 08 ──────────────────────────────────────────
  registry.defineScoped(/^two queued questions older than the retention window$/, (ctx) => {
    const st = ensureState(ctx);
    st.pendingPrompts = [
      mkItem(st, 'old question one', 73 * HOUR_MS),
      mkItem(st, 'old question two', 80 * HOUR_MS),
    ];
  }, FEATURE);

  registry.defineScoped(/^a receipt naming how many were dropped and their age span is posted$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(
      st.posts.some((t) => /Dropped 2 queued questions older than 72h \(age \d+-\d+h\)/.test(t)),
      `posts:\n${st.posts.join('\n---\n')}`
    );
  }, FEATURE);

  // ── Given/Then: scenario 09 ──────────────────────────────────────────
  registry.defineScoped(/^one queued question older than the retention window$/, (ctx) => {
    const st = ensureState(ctx);
    st.pendingPrompts = [...st.pendingPrompts, mkItem(st, 'stale question', 90 * HOUR_MS)];
  }, FEATURE);

  registry.defineScoped(/^one queued question within the retention window$/, (ctx) => {
    const st = ensureState(ctx);
    st.pendingPrompts = [...st.pendingPrompts, mkItem(st, 'fresh question', HOUR_MS)];
  }, FEATURE);

  registry.defineScoped(/^the queue selection poll offers only the question within the window$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.sentPolls.length, 1);
    const { options } = st.sentPolls[0];
    assert.ok(options.some((o) => o.includes('fresh question')), `options:\n${options.join('\n')}`);
    assert.ok(!options.some((o) => o.includes('stale question')), `options:\n${options.join('\n')}`);
    assert.equal(options.length, 2, 'expected exactly the fresh question plus the clear-all option');
  }, FEATURE);

  // ── Given/When/Then: scenario 10 (front-desk fan-out) ───────────────────
  registry.defineScoped(/^a queue selection poll is outstanding$/, (ctx) => {
    const st = ensureState(ctx);
    const item = mkItem(st, 'fan-out question');
    st.pendingPrompts = [item];
    st.pendingPromptPoll = { pollId: 'poll-fanout', itemIds: [item.id], clearAllOptionIndex: 1 };
  }, FEATURE);

  registry.defineScoped(/^the human's vote is delivered by the front desk poll_answer fan-out$/, async (ctx) => {
    const st = ensureState(ctx);
    const update = pollAnswerUpdate(st, 0);
    const pollResult = await pollAndForward(0, PRINCIPAL_ID, frontDeskAdapters(st, update));
    // Never a delivery FAILURE - the bridge exclusion always forwards a
    // poll_answer (see attemptCursorBridgePollAnswerForward), and front
    // desk's own choice-poll registry legitimately doesn't know this poll id
    // (that's the front-desk-local 'dropped' outcome, not a bridge miss).
    assert.equal(pollResult.failed, 0, `front desk poll cycle reported a failure: ${JSON.stringify(pollResult)}`);
    const initialState = {
      updateOffset: 0,
      cursorTopicId: HOST_TOPIC_ID,
      pendingPrompts: st.pendingPrompts,
      pendingPromptPoll: st.pendingPromptPoll,
    };
    const result = await runCursorBridgePollOnce(
      {
        ...st.deps,
        useInboundQueue: true,
        inboundQueueIdleMs: 0,
        post: async (_t, _c, _topic, text) => {
          st.posts.push(text);
        },
      },
      initialState,
      st.busy,
      0
    );
    st.busy = result.busy;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    refreshFromDisk(st);
  }, FEATURE);

  registry.defineScoped(/^the bridge acts on that vote$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(
      st.posts.some((t) => t.includes('fan-out question')),
      `expected the bridge to act on the fanned-out vote; posts:\n${st.posts.join('\n---\n')}`
    );
    assert.equal(st.pendingPrompts.length, 0, 'expected the selected item to be dequeued');
  }, FEATURE);
}

module.exports = { registerSteps };
