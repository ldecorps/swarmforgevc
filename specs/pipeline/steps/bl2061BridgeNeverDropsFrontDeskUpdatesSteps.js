'use strict';

// BL-2061: step handlers for "An update the cursor bridge reads for the
// front desk is never dropped". Drives the bridge's REAL per-update
// dispatch (telegramCursorBridgeLive's runCursorBridgePollOnce, the exact
// function that reads getUpdates and loops over updates) and the front
// desk's REAL poll cycle (telegramFrontDeskBotCore's pollAndForward) -
// never a restatement of either. The hand-over queue itself
// (cursorBridgeHandoverQueue.ts) is exercised through the bridge's append
// and the front desk's drain, never duplicated here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out');
const FIXTURE_PREFIX = 'bl2061-';

let _lib = null;
function lib() {
  if (!_lib) {
    _lib = {
      bridge: require(path.join(OUT, 'tools', 'telegramCursorBridgeLive')),
      agentSession: require(path.join(OUT, 'bridge', 'cursorBridgeAgentSession')),
      handover: require(path.join(OUT, 'tools', 'cursorBridgeHandoverQueue')),
      botCore: require(path.join(OUT, 'tools', 'telegramFrontDeskBotCore')),
    };
  }
  return _lib;
}

const FEATURE = 'An update the cursor bridge reads for the front desk is never dropped';
const TICKET = 'BL-9061';
const PRINCIPAL_ID = '42';
const CHAT_ID = '-100';
const CURSOR_TOPIC_ID = 55;
const APPROVALS_TOPIC_ID = 777;
const APPROVALS_ASK_MESSAGE_ID = 900;
// BL-410: a Reject tap's follow-up reason text is read in the TICKET'S OWN
// bound topic (classifyWithPendingButton's "the next reply in that
// ticket's topic"), never the shared Approvals topic.
const TICKET_TOPIC_ID = 888;

function writePendingTicket(root) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${TICKET}-fixture.yaml`);
  fs.writeFileSync(file, `id: ${TICKET}\ntitle: t\nhuman_approval: pending\ndepends_on: []\n`);
  return file;
}

function readApproval(file) {
  const match = fs.readFileSync(file, 'utf8').match(/human_approval:\s*(\S+)/);
  return match ? match[1] : undefined;
}

function recordApproval(file, value) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/human_approval:.*/m, `human_approval: ${value}`));
}

function makeFixture(ctx) {
  const root = trackedTmpRoot(FIXTURE_PREFIX);
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  fs.writeFileSync(statePath, JSON.stringify({ updateOffset: 0, cursorTopicId: CURSOR_TOPIC_ID }), 'utf8');
  const ticketFile = writePendingTicket(root);
  const bridgePosts = [];
  const applyCalls = [];
  const pendingButtonActions = new Map();
  ctx.bl2061 = {
    root,
    opDir,
    statePath,
    ticketFile,
    nextUpdateId: 5000,
    bridgePosts,
    applyCalls,
    pendingButtonActions,
    bridgeDeps: {
      repoRoot: root,
      botToken: 'token',
      chatId: CHAT_ID,
      principalUserId: PRINCIPAL_ID,
      opDir,
      statePath,
      topicMapPath: path.join(opDir, 'cursor-bridge-topic-map.json'),
      agentSession: lib().agentSession.createMockCursorBridgeAgentSession(root),
      post: async (botToken, chatId, topicId, message, replyToMessageId) => {
        bridgePosts.push({ topicId, message, replyToMessageId });
      },
      // Fixtures only - never a live Telegram call (the ticket's own
      // constraint). answerCallbackQuery's call site for a handed-over
      // callback uses this seam.
      telegramPostFn: async () => ({ ok: true, status: 200, json: { ok: true, result: {} } }),
      inboundQueueIdleMs: 1,
      // The dead-feeder fallback this ticket's window opens in: the
      // bridge calls getUpdates itself, never the forward queue.
      useInboundQueue: false,
      getUpdates: async () => ({ success: true, updates: ctx.bl2061.pendingUpdates }),
    },
  };
  return ctx.bl2061;
}

function mkCallbackUpdate(id, data) {
  return {
    update_id: id,
    callback_query: {
      id: `cbq-${id}`,
      data,
      from: { id: PRINCIPAL_ID },
      message: {
        message_id: APPROVALS_ASK_MESSAGE_ID,
        chat: { id: CHAT_ID },
        message_thread_id: APPROVALS_TOPIC_ID,
      },
    },
  };
}

function mkTextUpdate(id, text, topicId = APPROVALS_TOPIC_ID) {
  return {
    update_id: id,
    message: {
      message_id: id,
      chat: { id: CHAT_ID },
      message_thread_id: topicId,
      from: { id: PRINCIPAL_ID },
      text,
    },
  };
}

function mkCursorTopicUpdate(id, text) {
  return {
    update_id: id,
    message: {
      message_id: id,
      chat: { id: CHAT_ID },
      message_thread_id: CURSOR_TOPIC_ID,
      from: { id: PRINCIPAL_ID },
      text,
    },
  };
}

async function runBridgePollWithUpdates(ctx, updates) {
  const st = ctx.bl2061;
  st.pendingUpdates = updates;
  const state = JSON.parse(fs.readFileSync(st.statePath, 'utf8'));
  await lib().bridge.runCursorBridgePollOnce(st.bridgeDeps, state, false, 0);
}

function frontDeskAdapters(ctx) {
  const st = ctx.bl2061;
  return {
    chatId: CHAT_ID,
    getUpdates: async () => ({ success: true, updates: [] }),
    postToBridge: async () => true,
    subjectForTopic: (topicId) => (topicId === APPROVALS_TOPIC_ID ? 'APPROVALS' : undefined),
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called - every hand-over here is an approve/reject tap or verb on an already-known ticket');
    },
    backlogForTopic: (topicId) => (topicId === TICKET_TOPIC_ID ? TICKET : undefined),
    postOperatorContext: async () => true,
    answerCallbackQuery: async () => {},
    setPendingButtonAction: async (backlogId, kind) => {
      st.pendingButtonActions.set(backlogId, kind);
    },
    getPendingButtonAction: async (backlogId) => st.pendingButtonActions.get(backlogId),
    clearPendingButtonAction: async (backlogId) => {
      st.pendingButtonActions.delete(backlogId);
    },
    notifyApprovalsTopic: async () => true,
    recordApprovalReply: async () => {
      st.applyCalls.push('approve');
      recordApproval(st.ticketFile, 'approved');
      return true;
    },
    recordRejectionReply: async (_backlogId, _reason) => {
      st.applyCalls.push('reject');
      recordApproval(st.ticketFile, 'rejected');
      return true;
    },
    recordAmendReply: async () => true,
    drainHandoverUpdates: async () => lib().handover.drainCursorBridgeHandoverUpdates(st.opDir),
    isHandoverApplied: (updateId) => lib().handover.isHandoverUpdateApplied(st.opDir, updateId),
    recordHandoverApplied: (updateId) => lib().handover.recordAppliedHandoverId(st.opDir, updateId),
  };
}

async function pollFrontDeskAgain(ctx) {
  await lib().botCore.pollAndForward(0, PRINCIPAL_ID, frontDeskAdapters(ctx));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front desk's poll heartbeat is older than 90 seconds, so the cursor bridge holds getUpdates$/, (ctx) => {
    makeFixture(ctx);
  });

  scoped(/^ticket BL-9061 is pending approval$/, (ctx) => {
    assert.equal(readApproval(ctx.bl2061.ticketFile), 'pending');
  });

  scoped(/^the human sends (an Approve tap on BL-9061's ask|a Reject tap on BL-9061's ask|the text approve BL-9061 in the Approvals topic) while the bridge holds getUpdates$/, async (ctx, update) => {
    const st = ctx.bl2061;
    if (update === "an Approve tap on BL-9061's ask") {
      await runBridgePollWithUpdates(ctx, [mkCallbackUpdate(st.nextUpdateId++, `approve:${TICKET}`)]);
    } else if (update === "a Reject tap on BL-9061's ask") {
      // BL-410: a Reject tap alone only ever opens an "awaiting a reason"
      // window - it carries no reason/note text of its own. The human's
      // real next action (typing one) is the second raw update the bridge
      // reads in the SAME batch while still holding getUpdates.
      await runBridgePollWithUpdates(ctx, [
        mkCallbackUpdate(st.nextUpdateId++, `reject:${TICKET}`),
        mkTextUpdate(st.nextUpdateId++, 'not ready yet', TICKET_TOPIC_ID),
      ]);
    } else {
      await runBridgePollWithUpdates(ctx, [mkTextUpdate(st.nextUpdateId++, `approve ${TICKET}`)]);
    }
  });

  scoped(/^the front desk polls again$/, async (ctx) => {
    await pollFrontDeskAgain(ctx);
  });

  scoped(/^BL-9061's human_approval reads (approved|rejected)$/, (ctx, outcome) => {
    assert.equal(readApproval(ctx.bl2061.ticketFile), outcome);
    fs.rmSync(ctx.bl2061.root, { recursive: true, force: true });
  });

  scoped(/^the human sends a message in the cursor topic while the bridge holds getUpdates$/, async (ctx) => {
    const st = ctx.bl2061;
    const id = st.nextUpdateId++;
    await runBridgePollWithUpdates(ctx, [mkCursorTopicUpdate(id, 'hello cursor')]);
  });

  scoped(/^the bridge handles the message$/, (ctx) => {
    assert.ok(ctx.bl2061.bridgePosts.length > 0, 'the bridge posted no reply - the cursor-topic message was not handled');
  });

  scoped(/^nothing is handed to the front desk$/, (ctx) => {
    assert.equal(
      fs.existsSync(lib().handover.cursorBridgeHandoverQueuePath(ctx.bl2061.opDir)),
      false,
      'a bridge-owned update was handed over to the front desk'
    );
    fs.rmSync(ctx.bl2061.root, { recursive: true, force: true });
  });

  scoped(/^the bridge hands the same Approve tap on BL-9061's ask to the front desk twice$/, (ctx) => {
    const st = ctx.bl2061;
    const update = mkCallbackUpdate(st.nextUpdateId++, `approve:${TICKET}`);
    lib().handover.appendCursorBridgeHandoverUpdate(st.opDir, update);
    lib().handover.appendCursorBridgeHandoverUpdate(st.opDir, update);
  });

  scoped(/^BL-9061's approval is recorded once$/, (ctx) => {
    const count = ctx.bl2061.applyCalls.filter((a) => a === 'approve').length;
    assert.equal(count, 1, `expected the approval to be recorded exactly once, got ${count}`);
    fs.rmSync(ctx.bl2061.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
