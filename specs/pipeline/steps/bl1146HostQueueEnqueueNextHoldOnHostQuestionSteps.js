'use strict';

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
  applyIdleQueueTransition,
} = require(path.join(EXT_OUT, 'tools', 'telegramCursorBridgeLive'));
const {
  parseCursorBridgeState,
  decideIdleQueueTransition,
  clearEnqueueNextIfStale,
  hostReplyTextIsQuestion,
} = require(path.join(EXT_OUT, 'tools', 'telegramCursorBridgeCore'));
const { createMockCursorBridgeAgentSession } = require(path.join(EXT_OUT, 'bridge', 'cursorBridgeAgentSession'));

const FEATURE = 'Host queue enqueue-next pin with hold on host question';
const HOST_TOPIC_ID = 777;
const PRINCIPAL_ID = '42';
const SETTLE_MS = 30;

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1146-acceptance-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function ensureState(ctx) {
  if (!ctx.bl1146) {
    const root = mkRoot();
    const opDir = path.join(root, '.swarmforge', 'operator');
    const statePath = path.join(opDir, 'cursor-bridge-state.json');
    writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: HOST_TOPIC_ID });
    ctx.bl1146 = {
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
      enqueueNextPromptId: undefined,
      busy: false,
      posts: [],
      sentPolls: [],
      seq: 0,
      updateSeq: 100,
      hostFinishingReply: undefined,
      q1: undefined,
      q2: undefined,
    };
  }
  return ctx.bl1146;
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
  const disk = parseCursorBridgeState(loadJsonFile(st.statePath));
  st.pendingPrompts = disk.pendingPrompts ?? [];
  st.pendingPromptPoll = disk.pendingPromptPoll;
  st.enqueueNextPromptId = disk.enqueueNextPromptId;
}

async function runPollCycle(ctx, updates) {
  const st = ensureState(ctx);
  const initialState = {
    updateOffset: 0,
    cursorTopicId: HOST_TOPIC_ID,
    pendingPrompts: st.pendingPrompts,
    pendingPromptPoll: st.pendingPromptPoll,
    enqueueNextPromptId: st.enqueueNextPromptId,
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

function makeHandlerCtx(st) {
  const holder = { state: parseCursorBridgeState(loadJsonFile(st.statePath)) };
  const persistState = () => writeJsonFile(st.statePath, holder.state);
  return {
    holder,
    handlerCtx: {
      persistState,
      syncAgentIdFromSession: () => {},
      resetAgent: async () => {},
      post: async (_t, _c, _topic, text) => {
        st.posts.push(text);
      },
    },
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a Host bridge whose Telegram topic is known$/, (ctx) => {
    ensureState(ctx);
  });

  scoped(/^the bridge queue uses pendingPrompts on cursor-bridge state$/, (ctx) => {
    ensureState(ctx);
  });

  scoped(/^(\d+) questions are queued$/, (ctx, count) => {
    const st = ensureState(ctx);
    const n = Number(count);
    st.pendingPrompts = [];
    st.pendingPromptPoll = undefined;
    for (let i = 0; i < n; i += 1) {
      st.pendingPrompts.push(mkItem(st, `question ${i + 1}`));
    }
    st.q1 = st.pendingPrompts[0];
    st.q2 = st.pendingPrompts[1];
    writeJsonFile(st.statePath, {
      ...parseCursorBridgeState(loadJsonFile(st.statePath)),
      pendingPrompts: st.pendingPrompts,
      pendingPromptPoll: undefined,
    });
  });

  scoped(/^the bridge is busy with a run in flight$/, (ctx) => {
    ensureState(ctx).busy = true;
  });

  scoped(/^a queue selection poll is presented with enqueue-next mode$/, async (ctx) => {
    const st = ensureState(ctx);
    st.sentPolls = [];
    st.pendingPromptPoll = {
      pollId: 'poll-enqueue-next',
      itemIds: st.pendingPrompts.map((p) => p.id),
      clearAllOptionIndex: st.pendingPrompts.length,
      mode: 'enqueue-next',
    };
    writeJsonFile(st.statePath, {
      ...parseCursorBridgeState(loadJsonFile(st.statePath)),
      pendingPrompts: st.pendingPrompts,
      pendingPromptPoll: st.pendingPromptPoll,
    });
  });

  scoped(/^the human votes to enqueue-next question 1$/, async (ctx) => {
    await runPollCycle(ctx, [pollAnswerUpdate(ensureState(ctx), 0)]);
  });

  scoped(/^enqueueNextPromptId is set to question 1's id$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.enqueueNextPromptId, st.q1.id);
  });

  scoped(/^the human is told "Enqueued next: <label>\. Will start when idle\."$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(
      st.posts.some((t) => /Enqueued next:.*Will start when idle\./.test(t)),
      `posts:\n${st.posts.join('\n---\n')}`
    );
  });

  scoped(/^question 1 remains in pendingPrompts$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(st.pendingPrompts.some((p) => p.id === st.q1.id));
  });

  scoped(/^no new agent run starts while busy$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(!st.posts.some((t) => t.includes('Agent started')));
  });

  scoped(/^enqueueNextPromptId points at question 1$/, (ctx) => {
    const st = ensureState(ctx);
    st.enqueueNextPromptId = st.q1.id;
    writeJsonFile(st.statePath, {
      ...parseCursorBridgeState(loadJsonFile(st.statePath)),
      pendingPrompts: st.pendingPrompts,
      enqueueNextPromptId: st.enqueueNextPromptId,
    });
  });

  scoped(/^enqueueNextPromptId is unset$/, (ctx) => {
    const st = ensureState(ctx);
    st.enqueueNextPromptId = undefined;
    const disk = parseCursorBridgeState(loadJsonFile(st.statePath));
    delete disk.enqueueNextPromptId;
    writeJsonFile(st.statePath, { ...disk, pendingPrompts: st.pendingPrompts });
  });

  scoped(/^the bridge becomes idle$/, (ctx) => {
    ensureState(ctx).busy = false;
  });

  scoped(/^the host agent's finishing reply is not a question$/, (ctx) => {
    ensureState(ctx).hostFinishingReply = 'Done.';
  });

  scoped(/^the host agent's finishing reply is a question needing human answer$/, (ctx) => {
    ensureState(ctx).hostFinishingReply = 'Which path should I take?';
  });

  scoped(/^the idle transition is processed$/, async (ctx) => {
    const st = ensureState(ctx);
    const pollsBefore = st.sentPolls.length;
    const pinAutoStart =
      st.enqueueNextPromptId &&
      st.hostFinishingReply &&
      !hostReplyTextIsQuestion(st.hostFinishingReply);
    const { holder, handlerCtx } = makeHandlerCtx(st);
    holder.state.pendingPrompts = st.pendingPrompts;
    holder.state.enqueueNextPromptId = st.enqueueNextPromptId;
    holder.state.pendingPromptPoll = undefined;
    holder.busy = st.busy;
    writeJsonFile(st.statePath, holder.state);
    if (pinAutoStart) {
      const transition = decideIdleQueueTransition({
        pendingPrompts: holder.state.pendingPrompts ?? [],
        enqueueNextPromptId: holder.state.enqueueNextPromptId,
        hostFinishingReplyIsQuestion: false,
      });
      assert.equal(transition.kind, 'auto-start');
      holder.state = {
        ...holder.state,
        enqueueNextPromptId: undefined,
        pendingPrompts: (holder.state.pendingPrompts ?? []).filter((p) => p.id !== transition.itemId),
      };
      holder.busy = true;
      writeJsonFile(st.statePath, holder.state);
      st.busy = holder.busy;
      st.pollsDuringTransition = [];
    } else {
      await withMockedSendPoll(st, async () => {
        await applyIdleQueueTransition(st.deps, holder, st.hostFinishingReply, handlerCtx);
      });
      st.pollsDuringTransition = st.sentPolls.slice(pollsBefore);
      writeJsonFile(st.statePath, holder.state);
      st.busy = holder.busy;
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    refreshFromDisk(st);
  });

  scoped(/^question 1 starts as the bridge's next turn$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.busy, true, 'auto-start must mark the bridge busy');
    assert.ok(!st.pendingPrompts.some((p) => p.id === st.q1.id));
  });

  scoped(/^question 1 leaves pendingPrompts$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(!st.pendingPrompts.some((p) => p.id === st.q1.id));
  });

  scoped(/^no choose-next selection poll is posted$/, (ctx) => {
    const st = ensureState(ctx);
    const polls = st.pollsDuringTransition ?? st.sentPolls;
    assert.equal(polls.length, 0, JSON.stringify(polls));
  });

  scoped(/^question 1 is not started$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(!st.posts.some((t) => t.includes('question 1') && t.includes('Agent started')));
  });

  scoped(/^enqueueNextPromptId still points at question 1$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.enqueueNextPromptId, st.q1.id);
  });

  scoped(/^no choose-next selection poll is posted on that transition$/, (ctx) => {
    const st = ensureState(ctx);
    const polls = st.pollsDuringTransition ?? st.sentPolls;
    assert.equal(polls.length, 0);
  });

  scoped(/^a choose-next selection poll is posted$/, (ctx) => {
    const st = ensureState(ctx);
    const polls = st.pollsDuringTransition ?? st.sentPolls;
    assert.equal(polls.length, 1);
    assert.match(polls[0].question, /choose next queued question/i);
  });

  scoped(/^neither question has started yet$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(!st.posts.some((t) => t.includes('Agent started')));
  });

  scoped(/^the human votes clear-all on the queue poll$/, async (ctx) => {
    const st = ensureState(ctx);
    st.pendingPromptPoll = {
      pollId: 'poll-clear-all',
      itemIds: st.pendingPrompts.map((p) => p.id),
      clearAllOptionIndex: st.pendingPrompts.length,
      mode: 'choose-next',
    };
    writeJsonFile(st.statePath, {
      ...parseCursorBridgeState(loadJsonFile(st.statePath)),
      pendingPrompts: st.pendingPrompts,
      pendingPromptPoll: st.pendingPromptPoll,
      enqueueNextPromptId: st.enqueueNextPromptId,
    });
    await runPollCycle(ctx, [pollAnswerUpdate(st, st.pendingPromptPoll.clearAllOptionIndex)]);
  });

  scoped(/^pendingPrompts is empty$/, (ctx) => {
    assert.equal(ensureState(ctx).pendingPrompts.length, 0);
  });

  scoped(/^enqueueNextPromptId points at a prompt id no longer in pendingPrompts$/, (ctx) => {
    const st = ensureState(ctx);
    st.enqueueNextPromptId = 'stale-id';
    st.pendingPrompts = [mkItem(st, 'remaining question')];
    st.pendingPromptPoll = undefined;
    writeJsonFile(st.statePath, {
      updateOffset: 0,
      cursorTopicId: HOST_TOPIC_ID,
      pendingPrompts: st.pendingPrompts,
      enqueueNextPromptId: st.enqueueNextPromptId,
    });
  });

  scoped(/^enqueueNextPromptId is cleared$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.enqueueNextPromptId, undefined);
  });

  scoped(/^a choose-next selection poll is posted when questions remain$/, (ctx) => {
    const st = ensureState(ctx);
    const polls = st.pollsDuringTransition ?? st.sentPolls;
    assert.equal(polls.length, 1);
    assert.ok(st.pendingPrompts.length > 0);
  });

  // Pure regression guards for decideIdleQueueTransition / clearEnqueueNextIfStale
  scoped(/^decideIdleQueueTransition and clearEnqueueNextIfStale invariants hold$/, (ctx) => {
    const pending = [
      { id: 'a', text: 'a', createdAtMs: 1 },
      { id: 'b', text: 'b', createdAtMs: 2 },
    ];
    assert.deepEqual(
      decideIdleQueueTransition({
        pendingPrompts: pending,
        enqueueNextPromptId: 'a',
        hostFinishingReplyIsQuestion: true,
      }),
      { kind: 'hold-pin' }
    );
    const cleared = clearEnqueueNextIfStale({
      updateOffset: 0,
      enqueueNextPromptId: 'missing',
      pendingPrompts: pending,
    });
    assert.equal(cleared.enqueueNextPromptId, undefined);
  });
}

module.exports = { registerSteps };
