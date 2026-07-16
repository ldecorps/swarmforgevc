'use strict';

// BL-410: step handlers for the Approve/Amend/Reject inline-keyboard buttons
// extending BL-357/BL-408/BL-409's Telegram approval-reply chain with a
// one-tap alternative. Drives the REAL decideTopicAction/routeEvent
// (topicRouter.ts, via runConciergeTick) for the button-attachment half, and
// the REAL pollAndForward (telegramFrontDeskBotCore.ts) + recordApprovalReply/
// recordRejectionReply (pendingApprovalReply.ts, real fs) for the
// callback-dispatch half - same "drive the real core, fake only the
// Telegram/network boundary" posture as bl409ApproveRejectAmendSteps.js.
//
// KNOWN STEP-REGISTRY COLLISION (see engineering.prompt's Gherkin-step-
// registry note - a systemic, accepted behavior, not a bug to work around
// elsewhere): stepRegistry.js's resolve() dispatches a step's text to the
// FIRST matching pattern registered across the WHOLE suite, regardless of
// which feature file it came from. This feature's own text happens to be
// VERBATIM IDENTICAL, for three steps, to text already registered by
// bl409ApproveRejectAmendSteps.js (required before this file in
// steps/index.js) - so those three steps are deliberately NOT re-registered
// here; bl409's own handler runs instead. Its handler closures hardcode
// BACKLOG_ID='BL-409-fixture' (and, for the amend-note check, the literal
// note text 'tighten the acceptance criteria') - so THIS file's own
// BACKLOG_ID/ticket fixture matches those exact values, letting the
// hijacked handler resolve and flip THIS scenario's own ticket file
// (ctx.targetPath is still this scenario's own tmp dir) rather than one
// that doesn't exist here. The three colliding steps are marked below at
// their would-be registration point.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));
const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { recordApprovalReply, recordRejectionReply } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));

const APPROVAL_TEXT_PATTERN = /needs your approval/;
const PRINCIPAL_ID = 111;
const TOPIC_ID = 55;
// Must equal bl409ApproveRejectAmendSteps.js's own BACKLOG_ID - see the
// file-level comment above.
const BACKLOG_ID = 'BL-409-fixture';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl410-'));
}

function writeTicket(targetPath, folder, fileName, content) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

function ticketFilePath(ctx) {
  return path.join(ctx.targetPath, 'backlog', 'paused', `${BACKLOG_ID}.yaml`);
}

function readTicketContent(ctx) {
  return fs.readFileSync(ticketFilePath(ctx), 'utf8');
}

// Same shape as bl409ApproveRejectAmendSteps.js's buildConciergeAdapters -
// sendMessage additionally captures buttons (BL-410's own new payload) so
// the "carries Approve/Amend/Reject buttons" scenario can inspect them.
function buildConciergeAdapters(ctx) {
  return {
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => ctx.tickState,
    writeTickState: (next) => {
      ctx.tickState = next;
    },
    routeAdapters: {
      getTopicMap: () => ctx.topicMap,
      createTopic: async (name) => {
        ctx.created.push(name);
        return { success: true, topicId: 900 + ctx.created.length };
      },
      recordTopicId: (backlogId, topicId) => {
        ctx.topicMap[backlogId] = topicId;
      },
      sendMessage: async (topicId, text, buttons) => {
        ctx.sent.push({ topicId, text, buttons });
        return true;
      },
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => 750,
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  };
}

function mkMessageUpdate(text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: TOPIC_ID, text } };
}

function mkCallbackUpdate(callbackId, data) {
  return { update_id: 2, callback_query: { id: callbackId, data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 }, message_thread_id: TOPIC_ID } } };
}

function baseAdapters(ctx) {
  return {
    chatId: '1',
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === TOPIC_ID ? BACKLOG_ID : undefined),
    postOperatorContext: async (backlogId, ctxText) => {
      ctx.contexts.push({ backlogId, text: ctxText });
      return true;
    },
    recordApprovalReply: (backlogId) => Promise.resolve(recordApprovalReply(ctx.targetPath, backlogId)),
    recordRejectionReply: (backlogId, reason) => Promise.resolve(recordRejectionReply(ctx.targetPath, backlogId, reason)),
    getPendingButtonAction: async (backlogId) => ctx.pending[backlogId],
    setPendingButtonAction: async (backlogId, kind) => {
      ctx.pending[backlogId] = kind;
    },
    clearPendingButtonAction: async (backlogId) => {
      delete ctx.pending[backlogId];
    },
    answerCallbackQuery: async (callbackId) => {
      ctx.answeredCallbacks.push(callbackId);
    },
  };
}

async function deliverReply(ctx, text) {
  return pollAndForward(0, String(PRINCIPAL_ID), {
    ...baseAdapters(ctx),
    getUpdates: async () => ({ success: true, updates: [mkMessageUpdate(text)] }),
  });
}

async function deliverCallback(ctx, callbackId, data) {
  return pollAndForward(0, String(PRINCIPAL_ID), {
    ...baseAdapters(ctx),
    getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(callbackId, data)] }),
  });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a pending-review ticket with an ApprovalRequested message posted in its topic$/, async (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.contexts = [];
    ctx.pending = {};
    ctx.answeredCallbacks = [];
    ctx.tickState = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [{ id: BACKLOG_ID, title: 'awaiting review', humanApproval: 'pending' }], done: [] };
    ctx.adapters = buildConciergeAdapters(ctx);
    writeTicket(ctx.targetPath, 'paused', `${BACKLOG_ID}.yaml`, `id: ${BACKLOG_ID}\ntitle: awaiting review\nhuman_approval: pending\n`);
    await runConciergeTick(ctx.adapters);
    ctx.approvalMessage = ctx.sent.find((m) => APPROVAL_TEXT_PATTERN.test(m.text));
    if (!ctx.approvalMessage) {
      throw new Error(`setup: expected an ApprovalRequested post; got ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── inline-keyboard-01: the buttons themselves ──────────────────────────
  registry.define(/^the ApprovalRequested message has just been posted$/, () => {});

  registry.define(/^its Telegram payload is inspected$/, (ctx) => {
    ctx.inspectedMessage = ctx.approvalMessage;
  });

  registry.define(/^it includes an inline keyboard with Approve, Amend, and Reject buttons$/, (ctx) => {
    const buttons = ctx.inspectedMessage.buttons;
    if (!buttons) {
      throw new Error('expected the ApprovalRequested message to carry inline-keyboard buttons, got none');
    }
    const flat = buttons.flat();
    const labels = flat.map((b) => b.text);
    if (labels.join(',') !== 'Approve,Amend,Reject') {
      throw new Error(`expected Approve/Amend/Reject buttons in that order, got: ${JSON.stringify(labels)}`);
    }
    for (const button of flat) {
      if (button.callbackData !== `${button.text.toLowerCase()}:${BACKLOG_ID}`) {
        throw new Error(`unexpected callback data for ${button.text}: ${button.callbackData}`);
      }
    }
  });

  // ── inline-keyboard-02: tapping Approve ─────────────────────────────────
  registry.define(/^a callback_query for the Approve button on that message$/, (ctx) => {
    ctx.callbackId = 'cbq-approve-1';
    ctx.callbackData = `approve:${BACKLOG_ID}`;
  });

  registry.define(/^the bot processes the callback$/, async (ctx) => {
    ctx.deliverResult = await deliverCallback(ctx, ctx.callbackId, ctx.callbackData);
  });

  registry.define(/^the ticket's backlog file human_approval line becomes approved$/, (ctx) => {
    const content = readTicketContent(ctx);
    if (!/^human_approval: approved$/m.test(content)) {
      throw new Error(`expected human_approval: approved, got:\n${content}`);
    }
  });

  // ── inline-keyboard-03: tapping Reject ──────────────────────────────────
  registry.define(/^a callback_query for the Reject button followed by a reason reply$/, (ctx) => {
    ctx.callbackId = 'cbq-reject-1';
    ctx.callbackData = `reject:${BACKLOG_ID}`;
    ctx.followupText = 'not the right scope';
  });

  registry.define(/^the bot processes the callback and the reason$/, async (ctx) => {
    await deliverCallback(ctx, ctx.callbackId, ctx.callbackData);
    ctx.deliverResult = await deliverReply(ctx, ctx.followupText);
  });

  registry.define(/^the ticket's backlog file human_approval line becomes rejected with that reason$/, (ctx) => {
    const content = readTicketContent(ctx);
    const expected = new RegExp(`^human_approval: rejected {2}# ${ctx.followupText}$`, 'm');
    if (!expected.test(content)) {
      throw new Error(`expected human_approval: rejected  # ${ctx.followupText}, got:\n${content}`);
    }
  });

  // ── inline-keyboard-04: tapping Amend ───────────────────────────────────
  registry.define(/^a callback_query for the Amend button followed by a note reply$/, (ctx) => {
    ctx.callbackId = 'cbq-amend-1';
    ctx.callbackData = `amend:${BACKLOG_ID}`;
    // Must equal bl409's own hardcoded expectation for this shared Then step
    // (see the file-level comment) - not a real behavioral requirement of
    // BL-410 itself.
    ctx.followupText = 'tighten the acceptance criteria';
  });

  registry.define(/^the bot processes the callback and the note$/, async (ctx) => {
    await deliverCallback(ctx, ctx.callbackId, ctx.callbackData);
    ctx.deliverResult = await deliverReply(ctx, ctx.followupText);
  });

  // "the note is posted as operator context on the ticket" and "the
  // ticket's human_approval value is unchanged" are NOT registered here -
  // both are verbatim identical to bl409ApproveRejectAmendSteps.js's own
  // steps; see the file-level comment.

  // ── inline-keyboard-05: typed replies unaffected ────────────────────────
  registry.define(/^a topic reply of "([^"]*)" sent instead of tapping a button$/, (ctx, replyText) => {
    ctx.replyText = replyText;
  });

  // "the reply is recorded against the ticket" is NOT registered here - see
  // the file-level comment.

  // ── inline-keyboard-06: every tap clears its spinner ────────────────────
  registry.define(/^any callback_query received for one of the three buttons$/, (ctx) => {
    ctx.callbackId = 'cbq-unknown-1';
    ctx.callbackData = `amend:${BACKLOG_ID}`;
  });

  registry.define(/^the bot processes it$/, async (ctx) => {
    ctx.deliverResult = await deliverCallback(ctx, ctx.callbackId, ctx.callbackData);
  });

  registry.define(/^it sends an answerCallbackQuery response for that callback$/, (ctx) => {
    if (!ctx.answeredCallbacks.includes(ctx.callbackId)) {
      throw new Error(`expected answerCallbackQuery to have been called for ${ctx.callbackId}, got ${JSON.stringify(ctx.answeredCallbacks)}`);
    }
  });
}

module.exports = { registerSteps };
