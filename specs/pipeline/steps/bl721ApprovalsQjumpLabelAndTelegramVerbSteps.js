'use strict';

// BL-721: step handlers for "Approvals queue-jump is labeled Q jump and
// reachable by a /qjump front-desk verb". Drives REAL compiled production
// code (decideTopicAction/topicRouter.ts for the button half,
// pollAndForward/telegramFrontDeskBotCore.ts for both the tap-dispatch and
// typed-verb-dispatch halves, recordApprovalReply/pendingApprovalReply.ts +
// promoteToActive/backlogWriter.ts for the real fs-backed writers, and
// parseExpediteTicket/telegramCursorBridgeExpedite.ts for the offline
// expeditor's own separate parser) against fake Telegram/dispatch adapters -
// never a hand-rolled reimplementation of the queue-jump rules.
//
// KNOWN STEP-REGISTRY COLLISION (2026-08-13 spec amendment dc8fa3296): this
// feature's Background and several step texts are VERBATIM IDENTICAL to
// text bl490ExpediteApprovalButtonSteps.js and bl484DecidedAskClosesItselfSteps.js
// already register unscoped ("an approval ask was posted in a ticket's
// Telegram topic", "the posted ask is the BL-410 inline-keyboard approval
// ask", "the approval ask's buttons are rendered for a ticket", "the ticket
// is still pending review", "the posted ask's inline keyboard is removed",
// "the ticket is in the paused backlog", "the ticket's human_approval is
// recorded as approved", "the ticket is moved into the active backlog", "a
// routing handoff is injected to start the build immediately"). Every step
// in this file is registered with registry.defineScoped(..., FEATURE)
// (BL-425) rather than registry.define(...), so this feature's own fixture
// (TICKET_ID='BL-721') resolves first for its own Feature name instead of
// silently falling through to another feature's earlier-registered,
// differently-fixtured handler.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { decideTopicAction } = require(path.join(EXT_DIR, 'out', 'concierge', 'topicRouter'));
const { pollAndForward, APPROVALS_SUBJECT_ID } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { recordApprovalReply } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));
const { promoteToActive } = require(path.join(EXT_DIR, 'out', 'panel', 'backlogWriter'));
const { parseExpediteTicket } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgeExpedite'));

const FEATURE = 'Approvals queue-jump is labeled Q jump and reachable by a /qjump front-desk verb';

const PRINCIPAL_ID = 111;
const TICKET_ID = 'BL-721';
const APPROVALS_TOPIC_ID = 750;
const ASK_TOPIC_ID = 800;
const ASK_MESSAGE_ID = 42;
const ORIGINAL_ASK_TEXT = `${TICKET_ID} needs your approval before it can proceed. Reply here with "approve ${TICKET_ID}" (or "reject ${TICKET_ID} <reason>") to act.`;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl721-'));
}

function writeTicket(targetPath, folder, yaml) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${TICKET_ID}-fixture.yaml`), yaml);
}

function ticketPath(targetPath, folder) {
  return path.join(targetPath, 'backlog', folder, `${TICKET_ID}-fixture.yaml`);
}

function mkCallbackUpdate(data) {
  return { update_id: 1, callback_query: { id: 'cbq-1', data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 } } } };
}

// The button-tap half - mirrors bl490ExpediteApprovalButtonSteps.js's own
// tapExpedite shape (same callback_data namespace, same adapter set), a
// deliberate small duplication rather than a cross-file import of another
// feature's private helper.
function tapQjump(ctx) {
  return pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(`expedite:${TICKET_ID}`)] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a callback_query');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a callback_query');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for a bare callback_query');
    },
    recordApprovalReply: (backlogId) => {
      ctx.approvals.push(backlogId);
      return Promise.resolve(recordApprovalReply(ctx.targetPath, backlogId));
    },
    recordRejectionReply: async () => true,
    setPendingButtonAction: async () => {},
    answerCallbackQuery: async (id, text) => {
      ctx.answered.push({ id, text });
    },
    readApprovalAskMessage: async () => ({ topicId: ASK_TOPIC_ID, messageId: ASK_MESSAGE_ID, text: ORIGINAL_ASK_TEXT }),
    editApprovalAskMessage: async (topicId, messageId, text) => {
      ctx.editCalls.push({ topicId, messageId, text });
      return { success: true };
    },
    readRecordedApprovalVerdict: async () => ctx.recordedVerdict,
    promoteTicketIfPaused: (backlogId) => {
      const result = promoteToActive(ctx.targetPath, backlogId);
      if (result.moved) {
        ctx.promotions.push(backlogId);
      }
      return Promise.resolve(result.moved);
    },
    checkExpediteFileCollision: async (backlogId) => (backlogId === TICKET_ID ? ctx.collision : undefined),
    dispatchExpediteBuild: async (backlogId) => {
      ctx.dispatches.push(backlogId);
      return true;
    },
  });
}

// The typed-verb half - drives the SAME production Approvals-topic reply
// dispatch a real "/qjump <id>" reply goes through (decideApprovalsTopicReplyAction
// -> deliverApprovalsTopicQjump in telegramFrontDeskBotCore.ts), wired with
// the same effect adapters as tapQjump above so scenario 03's "same effect
// path" claim is checked against real, shared production code. Also tracks
// forwardCursorBridgeUpdate calls (the offline expeditor's own delivery
// path) - scenario 04 asserts this never fires for a /qjump message.
function sendApprovalsTopicText(ctx, text) {
  return pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [{ update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: APPROVALS_TOPIC_ID, text } }],
    }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an Approvals-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an Approvals-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === APPROVALS_TOPIC_ID ? APPROVALS_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Approvals-topic reply');
    },
    recordApprovalReply: (backlogId) => {
      ctx.approvals.push(backlogId);
      return Promise.resolve(recordApprovalReply(ctx.targetPath, backlogId));
    },
    recordRejectionReply: async () => true,
    promoteTicketIfPaused: (backlogId) => {
      const result = promoteToActive(ctx.targetPath, backlogId);
      if (result.moved) {
        ctx.promotions.push(backlogId);
      }
      return Promise.resolve(result.moved);
    },
    checkExpediteFileCollision: async (backlogId) => (backlogId === TICKET_ID ? ctx.collision : undefined),
    dispatchExpediteBuild: async (backlogId) => {
      ctx.dispatches.push(backlogId);
      return true;
    },
    notifyApprovalsTopic: async (topicId, text2) => {
      ctx.notified.push({ topicId, text: text2 });
      return true;
    },
    forwardCursorBridgeUpdate: async () => {
      ctx.cursorBridgeForwards.push(1);
      return true;
    },
  });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(/^an approval ask was posted in a ticket's Telegram topic$/, (ctx) => {
    ctx.targetPath = mkTmp();
    writeTicket(ctx.targetPath, 'active', `id: ${TICKET_ID}\ntitle: qjump fixture\nhuman_approval: pending\n`);
    ctx.approvals = [];
    ctx.promotions = [];
    ctx.dispatches = [];
    ctx.editCalls = [];
    ctx.answered = [];
    ctx.notified = [];
    ctx.cursorBridgeForwards = [];
    ctx.recordedVerdict = undefined;
    ctx.collision = undefined;
  }, FEATURE);

  registry.defineScoped(/^the posted ask is the BL-410 inline-keyboard approval ask$/, () => {
    // Documented by the Background text itself - approvalRequestedButtons
    // (topicRouter.ts) is the real production source of the BL-410 buttons,
    // separately unit/acceptance-tested by BL-410's own feature. Nothing
    // further to arrange here.
  }, FEATURE);

  // ── q-jump-approvals-01: the button label itself (pure, topicRouter) ───
  registry.defineScoped(/^the approval ask's buttons are rendered for a ticket$/, (ctx) => {
    ctx.action = decideTopicAction({ type: 'ApprovalRequested', backlogId: TICKET_ID, payload: {} }, {}, 'qjump fixture');
  }, FEATURE);

  registry.defineScoped(/^the rendered buttons include a button labeled "Q jump"$/, (ctx) => {
    const labels = ctx.action.buttons.flat().map((b) => b.text);
    if (!labels.includes('Q jump')) {
      throw new Error(`expected a button labeled "Q jump" among the rendered buttons, got: ${JSON.stringify(labels)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^no rendered button is labeled "Expedite"$/, (ctx) => {
    const labels = ctx.action.buttons.flat().map((b) => b.text);
    if (labels.includes('Expedite')) {
      throw new Error(`expected no button labeled "Expedite" (renamed to Q jump), got: ${JSON.stringify(labels)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the Q jump button carries the expedite verb tagged with the ticket id$/, (ctx) => {
    const qjump = ctx.action.buttons.flat().find((b) => b.text === 'Q jump');
    if (!qjump || qjump.callbackData !== `expedite:${TICKET_ID}`) {
      throw new Error(`expected the Q jump button tagged expedite:${TICKET_ID}, got: ${JSON.stringify(qjump)}`);
    }
  }, FEATURE);

  // ── q-jump-approvals-02: tap closes the ask with Q jump vocabulary ─────
  registry.defineScoped(/^the ticket is still pending review$/, (ctx) => {
    ctx.recordedVerdict = undefined;
  }, FEATURE);

  registry.defineScoped(/^the Q jump button is tapped for the ticket$/, async (ctx) => {
    ctx.deliverResult = await tapQjump(ctx);
  }, FEATURE);

  registry.defineScoped(/^the posted ask's inline keyboard is removed$/, (ctx) => {
    if (ctx.editCalls.length !== 1 || ctx.editCalls[0].topicId !== ASK_TOPIC_ID || ctx.editCalls[0].messageId !== ASK_MESSAGE_ID) {
      throw new Error(`expected exactly one editApprovalAskMessage call targeting the persisted ask, got: ${JSON.stringify(ctx.editCalls)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^a Q jumped decision line with the recorded UTC time is appended to the message$/, (ctx) => {
    const editedText = ctx.editCalls[0].text;
    if (!editedText.startsWith(ORIGINAL_ASK_TEXT)) {
      throw new Error(`expected the original ask text preserved above the decision line, got:\n${editedText}`);
    }
    if (!/-- Q jumped \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(editedText)) {
      throw new Error(`expected a "-- Q jumped <UTC timestamp>" decision line, got:\n${editedText}`);
    }
  }, FEATURE);

  // ── q-jump-approvals-03: "/qjump <id>" - same effects as the button ────
  registry.defineScoped(/^the ticket is in the paused backlog$/, (ctx) => {
    fs.rmSync(ticketPath(ctx.targetPath, 'active'), { force: true });
    writeTicket(ctx.targetPath, 'paused', `id: ${TICKET_ID}\ntitle: qjump fixture\nhuman_approval: pending\n`);
  }, FEATURE);

  registry.defineScoped(/^a \/qjump message naming the ticket is received on the front desk$/, async (ctx) => {
    ctx.deliverResult = await sendApprovalsTopicText(ctx, `/qjump ${TICKET_ID}`);
  }, FEATURE);

  registry.defineScoped(/^the ticket's human_approval is recorded as approved$/, (ctx) => {
    const folder = fs.existsSync(ticketPath(ctx.targetPath, 'active')) ? 'active' : 'paused';
    const content = fs.readFileSync(ticketPath(ctx.targetPath, folder), 'utf8');
    if (!/^human_approval: approved$/m.test(content)) {
      throw new Error(`expected human_approval: approved, got:\n${content}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the ticket is moved into the active backlog$/, (ctx) => {
    if (fs.existsSync(ticketPath(ctx.targetPath, 'paused'))) {
      throw new Error('expected the ticket file no longer in backlog/paused/');
    }
    if (!fs.existsSync(ticketPath(ctx.targetPath, 'active'))) {
      throw new Error('expected the ticket file moved into backlog/active/');
    }
  }, FEATURE);

  registry.defineScoped(/^a routing handoff is injected to start the build immediately$/, (ctx) => {
    if (!ctx.dispatches.includes(TICKET_ID)) {
      throw new Error(`expected dispatchExpediteBuild to have fired for ${TICKET_ID}, got: ${JSON.stringify(ctx.dispatches)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the queue-jump effects are performed through the same effect path the Q jump button uses$/, (ctx) => {
    // tapQjump and sendApprovalsTopicText wire recordApprovalReply/
    // promoteTicketIfPaused/dispatchExpediteBuild through the identical
    // adapter shape - this step confirms all three effects actually fired
    // for THIS ticket via the typed-verb delivery path, not merely that
    // the same functions exist.
    if (!ctx.approvals.includes(TICKET_ID) || !ctx.promotions.includes(TICKET_ID) || !ctx.dispatches.includes(TICKET_ID)) {
      throw new Error(
        `expected approve+promote+dispatch to have all fired via the typed verb, got approvals=${JSON.stringify(ctx.approvals)} promotions=${JSON.stringify(ctx.promotions)} dispatches=${JSON.stringify(ctx.dispatches)}`
      );
    }
  }, FEATURE);

  // ── q-jump-approvals-04: /qjump never starts the offline expeditor ─────
  registry.defineScoped(/^no offline expeditor run is started$/, (ctx) => {
    if (ctx.cursorBridgeForwards.length !== 0) {
      throw new Error(`expected no Cursor-bridge forward (the offline expeditor's own delivery path), got: ${JSON.stringify(ctx.cursorBridgeForwards)}`);
    }
    const parsed = parseExpediteTicket(`/qjump ${TICKET_ID}`);
    if (parsed !== undefined) {
      throw new Error(`expected the offline expeditor's own parser to not recognize a /qjump message, got: ${JSON.stringify(parsed)}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
