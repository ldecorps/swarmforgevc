'use strict';

// BL-509: step handlers for "the approval Amend button prompts the human for
// a steer, marks the ticket as amending, and queues that steer for delivery
// to the specifier" (slice 1). Drives the REAL pollAndForward
// (telegramFrontDeskBotCore.ts) + recordAmendReply/recordApprovalReply/
// recordRejectionReply (pendingApprovalReply.ts, real fs) for the tap/reply
// dispatch half, and the REAL runConciergeTick (topicRouter.ts via
// conciergeTick.ts) for the Background's own ApprovalRequested post - same
// "drive the real core, fake only the Telegram/network boundary" posture as
// bl409ApproveRejectAmendSteps.js/bl410ApprovalInlineKeyboardButtonsSteps.js.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));
const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { recordApprovalReply, recordRejectionReply, recordAmendReply } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));

const APPROVAL_TEXT_PATTERN = /needs your approval/;
const PRINCIPAL_ID = 111;
// The ticket's OWN per-ticket topic - where the human's follow-up steer
// reply lands (deliverOperatorContext's own dispatch path), distinct from
// APPROVALS_TOPIC_ID below, where the tappable card itself lives (BL-434).
const TOPIC_ID = 66;
const APPROVALS_TOPIC_ID = 750;
const BACKLOG_ID = 'BL-509-fixture';
const STEER_TEXT = 'tighten the acceptance criteria';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl509-'));
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

// Same shape as bl409/bl410's own buildConciergeAdapters - the Background's
// real concierge tick posts the REAL ApprovalRequested ask into the standing
// Approvals topic (BL-434), which this file then bridges into the poll
// loop's own readApprovalAskMessage fixture below (the two are genuinely
// separate adapter worlds - conciergeTick's routeAdapters vs the bot's own
// PollAdapters - bridged by the test author exactly as bl452/bl455's own
// board-fixture convention establishes for cross-module acceptance tests).
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
      sendMessage: async (topicId, text) => {
        const messageId = 1000 + ctx.sent.length;
        ctx.sent.push({ topicId, text, messageId });
        return true;
      },
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
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

function mkCallbackUpdate(callbackId, data, topicId) {
  return {
    update_id: 2,
    callback_query: { id: callbackId, data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 }, message_thread_id: topicId } },
  };
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
      ctx.effects.push({ kind: 'context', backlogId, text: ctxText });
      return true;
    },
    recordApprovalReply: (backlogId) => Promise.resolve(recordApprovalReply(ctx.targetPath, backlogId)),
    recordRejectionReply: (backlogId, reason) => Promise.resolve(recordRejectionReply(ctx.targetPath, backlogId, reason)),
    recordAmendReply: (backlogId) => Promise.resolve(recordAmendReply(ctx.targetPath, backlogId)),
    queueAmendSteerDirective: async (backlogId, text) => {
      ctx.directives.push({ backlogId, text });
      ctx.effects.push({ kind: 'directive', backlogId, text });
    },
    resetApprovalAskEmittedState: async (backlogId) => {
      ctx.resets.push(backlogId);
    },
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
    notifyApprovalsTopic: async (topicId, text) => {
      ctx.prompts.push({ topicId, text });
      return true;
    },
    readApprovalAskMessage: async (backlogId) => ctx.approvalAskMessages[backlogId],
    editApprovalAskMessage: async (topicId, messageId, text) => {
      ctx.editCalls.push({ topicId, messageId, text });
      return { success: true };
    },
  };
}

async function deliverReply(ctx, text) {
  return pollAndForward(0, String(PRINCIPAL_ID), {
    ...baseAdapters(ctx),
    getUpdates: async () => ({ success: true, updates: [mkMessageUpdate(text)] }),
  });
}

async function deliverCallback(ctx, callbackId, data, topicId) {
  return pollAndForward(0, String(PRINCIPAL_ID), {
    ...baseAdapters(ctx),
    getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(callbackId, data, topicId)] }),
  });
}

// Shared by the "the human taps Amend" When (scenario 01) and the "the human
// has tapped Amend" Given (scenarios 02/03) - the same tap action, just a
// different grammatical position in each scenario. The card itself lives in
// the standing Approvals topic (BL-434), so the tap's own callback_query
// carries THAT topic id, not the ticket's own per-ticket topic.
async function tapAmend(ctx) {
  await deliverCallback(ctx, 'cbq-amend-1', `amend:${BACKLOG_ID}`, APPROVALS_TOPIC_ID);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a ticket is awaiting approval in its Telegram topic$/, async (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.topicMap = { [BACKLOG_ID]: TOPIC_ID };
    ctx.created = [];
    ctx.sent = [];
    ctx.contexts = [];
    ctx.directives = [];
    ctx.resets = [];
    ctx.effects = [];
    ctx.pending = {};
    ctx.answeredCallbacks = [];
    ctx.prompts = [];
    ctx.editCalls = [];
    ctx.tickState = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [{ id: BACKLOG_ID, title: 'awaiting review', humanApproval: 'pending' }], done: [] };
    ctx.adapters = buildConciergeAdapters(ctx);
    writeTicket(ctx.targetPath, 'paused', `${BACKLOG_ID}.yaml`, `id: ${BACKLOG_ID}\ntitle: awaiting review\nhuman_approval: pending\n`);
    await runConciergeTick(ctx.adapters);
    const approvalMessage = ctx.sent.find((m) => APPROVAL_TEXT_PATTERN.test(m.text) && m.topicId === APPROVALS_TOPIC_ID);
    if (!approvalMessage) {
      throw new Error(`setup: expected an ApprovalRequested post in the Approvals topic; got ${JSON.stringify(ctx.sent)}`);
    }
    // Bridges the conciergeTick's own posted-message record into the poll
    // loop's readApprovalAskMessage fixture (see buildConciergeAdapters'
    // own comment) - so the close routine this feature exercises has a
    // real persisted {topicId, messageId, text} to edit.
    ctx.approvalAskMessages = {
      [BACKLOG_ID]: { topicId: approvalMessage.topicId, messageId: approvalMessage.messageId, text: approvalMessage.text },
    };
  });

  // ── amend-steers-ticket-01 ───────────────────────────────────────────────
  registry.define(/^the human taps Amend on the ticket$/, async (ctx) => {
    await tapAmend(ctx);
  });

  registry.define(/^the bot asks the human what to change on the ticket$/, (ctx) => {
    if (ctx.prompts.length !== 1) {
      throw new Error(`expected exactly one prompt sent on the Amend tap, got ${JSON.stringify(ctx.prompts)}`);
    }
    if (!ctx.prompts[0].text.includes(BACKLOG_ID) || !/change/i.test(ctx.prompts[0].text)) {
      throw new Error(`expected the prompt to ask what to change on ${BACKLOG_ID}, got: ${JSON.stringify(ctx.prompts[0])}`);
    }
  });

  registry.define(/^the ticket's approval state is still pending$/, (ctx) => {
    const content = readTicketContent(ctx);
    if (!/^human_approval: pending$/m.test(content)) {
      throw new Error(`expected human_approval to remain 'pending' right after the tap, got:\n${content}`);
    }
  });

  // ── amend-steers-ticket-02/03: shared Given/When ────────────────────────
  registry.define(/^the human has tapped Amend on the ticket$/, async (ctx) => {
    await tapAmend(ctx);
  });

  registry.define(/^the human replies with steering text$/, async (ctx) => {
    ctx.deliverResult = await deliverReply(ctx, STEER_TEXT);
  });

  // ── amend-steers-ticket-02 ───────────────────────────────────────────────
  registry.define(/^the ticket's human_approval becomes "amending"$/, (ctx) => {
    const content = readTicketContent(ctx);
    if (!/^human_approval: amending$/m.test(content)) {
      throw new Error(`expected human_approval: amending, got:\n${content}`);
    }
  });

  registry.define(/^the approval ask for the ticket is closed$/, (ctx) => {
    if (ctx.editCalls.length !== 1) {
      throw new Error(`expected exactly one ask-close edit, got ${JSON.stringify(ctx.editCalls)}`);
    }
    if (!ctx.editCalls[0].text.includes('-- Amending')) {
      throw new Error(`expected the closed ask to carry an Amending decision line, got: ${JSON.stringify(ctx.editCalls[0])}`);
    }
  });

  registry.define(/^the steering text is recorded on the ticket's topic record$/, (ctx) => {
    const posted = ctx.contexts.find((c) => c.backlogId === BACKLOG_ID);
    if (!posted || posted.text !== STEER_TEXT) {
      throw new Error(`expected the steering text recorded as topic context, got ${JSON.stringify(ctx.contexts)}`);
    }
  });

  // ── amend-steers-ticket-03 ───────────────────────────────────────────────
  registry.define(/^an amend-steer directive carrying the ticket id and the steering text is queued$/, (ctx) => {
    const directive = ctx.directives.find((d) => d.backlogId === BACKLOG_ID);
    if (!directive || directive.text !== STEER_TEXT) {
      throw new Error(`expected an amend-steer directive for ${BACKLOG_ID} carrying "${STEER_TEXT}", got ${JSON.stringify(ctx.directives)}`);
    }
  });

  registry.define(/^the directive is distinguishable from a plain approval-answer event$/, (ctx) => {
    // The amend-steer directive (queueAmendSteerDirective) and the plain
    // approval-answer/context post (postOperatorContext, the real
    // TELEGRAM_BL_TOPIC_MESSAGE the existing operator_runtime.bb sweep
    // consumes) are two SEPARATE adapter calls, never merged into one -
    // ctx.effects records each call's own distinct `kind`, proving neither
    // one masquerades as the other.
    const contextEffect = ctx.effects.find((e) => e.kind === 'context');
    const directiveEffect = ctx.effects.find((e) => e.kind === 'directive');
    if (!contextEffect || !directiveEffect) {
      throw new Error(`expected both a context effect and a directive effect, got ${JSON.stringify(ctx.effects)}`);
    }
    if (contextEffect.kind === directiveEffect.kind) {
      throw new Error('expected the directive to be a distinct effect kind from the plain context/approval-answer post');
    }
  });
}

module.exports = { registerSteps };
