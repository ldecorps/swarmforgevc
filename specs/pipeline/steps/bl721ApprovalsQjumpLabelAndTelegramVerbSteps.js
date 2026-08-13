'use strict';

// BL-721: step handlers for "Approvals Q jump - a renamed button, a typed
// verb, and separation from the offline expeditor". Drives REAL compiled
// production code (decideTopicAction/topicRouter.ts for the button half,
// pollAndForward/telegramFrontDeskBotCore.ts for both the tap-dispatch and
// typed-verb-dispatch halves, recordApprovalReply/pendingApprovalReply.ts +
// promoteToActive/backlogWriter.ts for the real fs-backed writers, and
// parseExpediteTicket/telegramCursorBridgeExpedite.ts for the offline
// expeditor's own separate parser) against fake Telegram/dispatch adapters
// - never a hand-rolled reimplementation of the queue-jump rules.
//
// Self-contained fixture (own Background, own ticket id, own step wording)
// rather than reusing BL-490's - several of this feature's natural phrasings
// ("the ticket is in the paused backlog", "the ticket's human_approval is
// recorded as approved", "the ticket is moved into the active backlog", "a
// routing handoff is injected to start the build immediately", "the posted
// ask's inline keyboard is removed", "a build is already in flight that
// edits the same files as the ticket") are VERBATIM IDENTICAL to text
// bl490ExpediteApprovalButtonSteps.js already registers, and "the ticket is
// still pending review" to bl484DecidedAskClosesItselfSteps.js - reusing
// any of them here would silently run THAT file's handler (registered
// earlier in steps/index.js's DOMAINS order) against a ticket id ('BL-490')
// this feature's own fixture never writes, failing on a missing file. Every
// step below is deliberately reworded to be textually distinct (checked by
// grep across specs/pipeline/steps/*.js before this file was wired in).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { decideTopicAction } = require(path.join(EXT_DIR, 'out', 'concierge', 'topicRouter'));
const { pollAndForward, APPROVALS_SUBJECT_ID } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { recordApprovalReply } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));
const { promoteToActive } = require(path.join(EXT_DIR, 'out', 'panel', 'backlogWriter'));
const { parseExpediteTicket } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgeExpedite'));

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
// feature's private helper (see file-level comment on the collision hazard
// that ruled out reusing its Background/steps instead).
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
// dispatch a real "/qjump <id>"/"/expedite <id>" reply goes through
// (decideApprovalsTopicReplyAction -> deliverApprovalsTopicReply /
// deliverApprovalsTopicQjump in telegramFrontDeskBotCore.ts), wired with the
// same effect adapters as tapQjump above so BL-721-04's "same effect as the
// button" claim is checked against real, shared production code, not two
// independently-hand-rolled fixtures.
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
  });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a Q jump-eligible approval ask was posted in a ticket's Telegram topic$/, (ctx) => {
    ctx.targetPath = mkTmp();
    writeTicket(ctx.targetPath, 'active', `id: ${TICKET_ID}\ntitle: qjump fixture\nhuman_approval: pending\n`);
    ctx.approvals = [];
    ctx.promotions = [];
    ctx.dispatches = [];
    ctx.editCalls = [];
    ctx.answered = [];
    ctx.notified = [];
    ctx.recordedVerdict = undefined;
    ctx.collision = undefined;
  });

  // ── BL-721-01: the button itself (pure, topicRouter) ────────────────────
  registry.define(/^the Q jump ask's buttons are rendered for the ticket$/, (ctx) => {
    ctx.action = decideTopicAction({ type: 'ApprovalRequested', backlogId: TICKET_ID, payload: {} }, {}, 'qjump fixture');
  });

  registry.define(/^the rendered buttons include a Q jump button, not an Expedite button$/, (ctx) => {
    const labels = ctx.action.buttons.flat().map((b) => b.text);
    if (!labels.includes('Q jump')) {
      throw new Error(`expected a Q jump button among the rendered buttons, got: ${JSON.stringify(labels)}`);
    }
    if (labels.includes('Expedite')) {
      throw new Error(`expected no Expedite button (renamed to Q jump), got: ${JSON.stringify(labels)}`);
    }
  });

  registry.define(/^the Q jump button carries the expedite verb tagged with the ticket id$/, (ctx) => {
    const qjump = ctx.action.buttons.flat().find((b) => b.text === 'Q jump');
    if (!qjump || qjump.callbackData !== `expedite:${TICKET_ID}`) {
      throw new Error(`expected the Q jump button tagged expedite:${TICKET_ID}, got: ${JSON.stringify(qjump)}`);
    }
  });

  registry.define(/^the Approve, Amend, and Reject buttons are still present alongside Q jump$/, (ctx) => {
    const labels = ctx.action.buttons.flat().map((b) => b.text);
    for (const expected of ['Approve', 'Amend', 'Reject', 'Q jump']) {
      if (!labels.includes(expected)) {
        throw new Error(`expected ${expected} present, got: ${JSON.stringify(labels)}`);
      }
    }
  });

  // ── BL-721-02: tap still approves + force-promotes + dispatches ────────
  registry.define(/^the ticket starts out paused, awaiting Q jump$/, (ctx) => {
    fs.rmSync(ticketPath(ctx.targetPath, 'active'), { force: true });
    writeTicket(ctx.targetPath, 'paused', `id: ${TICKET_ID}\ntitle: qjump fixture\nhuman_approval: pending\n`);
  });

  registry.define(/^the Q jump button is tapped for the ticket$/, async (ctx) => {
    ctx.deliverResult = await tapQjump(ctx);
  });

  registry.define(/^the ticket's human_approval is approved by the Q jump effect$/, (ctx) => {
    const folder = fs.existsSync(ticketPath(ctx.targetPath, 'active')) ? 'active' : 'paused';
    const content = fs.readFileSync(ticketPath(ctx.targetPath, folder), 'utf8');
    if (!/^human_approval: approved$/m.test(content)) {
      throw new Error(`expected human_approval: approved, got:\n${content}`);
    }
  });

  registry.define(/^the Q jump effect moves the ticket into the active backlog$/, (ctx) => {
    if (fs.existsSync(ticketPath(ctx.targetPath, 'paused'))) {
      throw new Error('expected the ticket file no longer in backlog/paused/');
    }
    if (!fs.existsSync(ticketPath(ctx.targetPath, 'active'))) {
      throw new Error('expected the ticket file moved into backlog/active/');
    }
  });

  registry.define(/^the Q jump effect dispatches a routing handoff to start the build immediately$/, (ctx) => {
    if (!ctx.dispatches.includes(TICKET_ID)) {
      throw new Error(`expected dispatchExpediteBuild to have fired for ${TICKET_ID}, got: ${JSON.stringify(ctx.dispatches)}`);
    }
  });

  // ── BL-721-03: tap closes the ask with the renamed decision line ───────
  registry.define(/^the Q jump ask has not yet been decided$/, (ctx) => {
    ctx.recordedVerdict = undefined;
  });

  registry.define(/^the Q jump ask's inline keyboard is removed$/, (ctx) => {
    if (ctx.editCalls.length !== 1 || ctx.editCalls[0].topicId !== ASK_TOPIC_ID || ctx.editCalls[0].messageId !== ASK_MESSAGE_ID) {
      throw new Error(`expected exactly one editApprovalAskMessage call targeting the persisted ask, got: ${JSON.stringify(ctx.editCalls)}`);
    }
  });

  registry.define(/^a Q jumped decision line with the recorded UTC time is appended to the message$/, (ctx) => {
    const editedText = ctx.editCalls[0].text;
    if (!editedText.startsWith(ORIGINAL_ASK_TEXT)) {
      throw new Error(`expected the original ask text preserved above the decision line, got:\n${editedText}`);
    }
    if (!/-- Q jumped \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(editedText)) {
      throw new Error(`expected a "-- Q jumped <UTC timestamp>" decision line, got:\n${editedText}`);
    }
  });

  // ── BL-721-04: "/qjump <id>" typed - same effect as the button ─────────
  registry.define(/^"\/qjump" is typed for the ticket as a reply in the Approvals topic$/, async (ctx) => {
    ctx.deliverResult = await sendApprovalsTopicText(ctx, `/qjump ${TICKET_ID}`);
  });

  // ── BL-721-05: "/qjump <id>" on a same-file collision warns, no dispatch ─
  registry.define(/^another in-flight build already edits the same files as this ticket$/, (ctx) => {
    ctx.collision = 'BL-100';
  });

  registry.define(/^an unsafe-dispatch warning is posted into the Approvals topic$/, (ctx) => {
    if (ctx.notified.length !== 1 || ctx.notified[0].topicId !== APPROVALS_TOPIC_ID || !/unsafe/i.test(ctx.notified[0].text ?? '')) {
      throw new Error(`expected an "unsafe" warning posted into the Approvals topic, got: ${JSON.stringify(ctx.notified)}`);
    }
  });

  registry.define(/^no dispatch is performed for the ticket, though it is still approved$/, (ctx) => {
    if (!ctx.approvals.includes(TICKET_ID)) {
      throw new Error(`expected the ticket still approved despite the collision, got: ${JSON.stringify(ctx.approvals)}`);
    }
    if (ctx.dispatches.includes(TICKET_ID)) {
      throw new Error('expected NO dispatch when a same-file build is in flight - the in-flight build must never be preempted');
    }
  });

  // ── BL-721-06: /expedite stays offline-only, never queue-jumps ─────────
  registry.define(/^"\/expedite" is typed for the ticket as a reply in the Approvals topic$/, async (ctx) => {
    ctx.deliverResult = await sendApprovalsTopicText(ctx, `/expedite ${TICKET_ID}`);
  });

  registry.define(/^no approval, promotion, or dispatch side effect is performed for the ticket$/, (ctx) => {
    if (ctx.approvals.length !== 0) {
      throw new Error(`expected no approval side effect for /expedite typed in the Approvals topic, got: ${JSON.stringify(ctx.approvals)}`);
    }
    if (ctx.promotions.length !== 0) {
      throw new Error(`expected no promotion side effect, got: ${JSON.stringify(ctx.promotions)}`);
    }
    if (ctx.dispatches.length !== 0) {
      throw new Error(`expected no dispatch side effect, got: ${JSON.stringify(ctx.dispatches)}`);
    }
  });

  registry.define(/^the offline expeditor's own parser still recognizes \/expedite for that ticket, unchanged$/, () => {
    const parsed = parseExpediteTicket(`/expedite ${TICKET_ID}`);
    if (parsed !== TICKET_ID) {
      throw new Error(`expected the offline expeditor's parser to still recognize /expedite ${TICKET_ID}, got: ${JSON.stringify(parsed)}`);
    }
  });
}

module.exports = { registerSteps };
