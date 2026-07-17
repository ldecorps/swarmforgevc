'use strict';

// BL-490: step handlers for "Expedite an approval ask: approve,
// force-promote, and dispatch a ticket to build now". Drives the REAL
// compiled decideTopicAction (topicRouter.ts, the button-rendering half),
// pollAndForward/recordExpediteDecisionAndClose (telegramFrontDeskBotCore.ts,
// the tap-dispatch half), and recordApprovalReply/promoteToActive (real fs,
// pendingApprovalReply.ts/backlogWriter.ts) against fake Telegram/dispatch
// adapters - never a hand-rolled reimplementation of the Expedite rules,
// mirroring bl410/bl484's own step-file convention for this codebase's
// concierge/front-desk machinery.
//
// KNOWN STEP-REGISTRY COLLISION (see engineering.prompt's Gherkin-step-
// registry note): "the ticket is still pending review" is VERBATIM IDENTICAL
// to a step already registered by bl484DecidedAskClosesItselfSteps.js
// (required before this file in steps/index.js) - so it is deliberately NOT
// re-registered here; bl484's own handler runs instead (`ctx.recordedVerdict
// = undefined`), which is exactly the state this file's own scenarios need
// too.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { decideTopicAction } = require(path.join(EXT_DIR, 'out', 'concierge', 'topicRouter'));
const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { recordApprovalReply } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));
const { promoteToActive } = require(path.join(EXT_DIR, 'out', 'panel', 'backlogWriter'));

const PRINCIPAL_ID = 111;
const TICKET_ID = 'BL-490';
const ASK_TOPIC_ID = 800;
const ASK_MESSAGE_ID = 42;
const ORIGINAL_ASK_TEXT = `${TICKET_ID} needs your approval before it can proceed. Reply here with "approve ${TICKET_ID}" (or "reject ${TICKET_ID} <reason>") to act.`;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl490-'));
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

function tapExpedite(ctx) {
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

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^an approval ask was posted in a ticket's Telegram topic$/, (ctx) => {
    ctx.targetPath = mkTmp();
    writeTicket(ctx.targetPath, 'active', `id: ${TICKET_ID}\ntitle: expedite fixture\nhuman_approval: pending\n`);
    ctx.approvals = [];
    ctx.promotions = [];
    ctx.dispatches = [];
    ctx.editCalls = [];
    ctx.answered = [];
    ctx.recordedVerdict = undefined;
    ctx.collision = undefined;
  });

  registry.define(/^the posted ask is the BL-410 inline-keyboard approval ask$/, () => {
    // Documented by the Background text itself - approvalRequestedButtons
    // (topicRouter.ts) is the real production source of the BL-410 buttons,
    // separately unit/acceptance-tested by BL-410's own feature. Nothing
    // further to arrange here.
  });

  // ── expedite-approval-01: the button itself (pure, topicRouter) ────────
  registry.define(/^the approval ask's buttons are rendered for a ticket$/, (ctx) => {
    ctx.action = decideTopicAction({ type: 'ApprovalRequested', backlogId: TICKET_ID, payload: {} }, {}, 'expedite fixture');
  });

  registry.define(/^the rendered buttons include an Expedite button$/, (ctx) => {
    const labels = ctx.action.buttons.flat().map((b) => b.text);
    if (!labels.includes('Expedite')) {
      throw new Error(`expected an Expedite button among the rendered buttons, got: ${JSON.stringify(labels)}`);
    }
  });

  registry.define(/^the Expedite button carries the expedite verb tagged with the ticket id$/, (ctx) => {
    const expedite = ctx.action.buttons.flat().find((b) => b.text === 'Expedite');
    if (!expedite || expedite.callbackData !== `expedite:${TICKET_ID}`) {
      throw new Error(`expected the Expedite button tagged expedite:${TICKET_ID}, got: ${JSON.stringify(expedite)}`);
    }
  });

  registry.define(/^the Approve, Amend, and Reject buttons are still present$/, (ctx) => {
    const labels = ctx.action.buttons.flat().map((b) => b.text);
    for (const expected of ['Approve', 'Amend', 'Reject']) {
      if (!labels.includes(expected)) {
        throw new Error(`expected ${expected} still present alongside Expedite, got: ${JSON.stringify(labels)}`);
      }
    }
  });

  // ── expedite-approval-02: tap records approval via the same effect ─────
  // "the ticket is still pending review" resolves to bl484's own handler
  // (see file-level comment) - sets ctx.recordedVerdict = undefined, which
  // is exactly the state this scenario needs.

  registry.define(/^the Expedite button is tapped for the ticket$/, async (ctx) => {
    ctx.deliverResult = await tapExpedite(ctx);
  });

  registry.define(/^the ticket's human_approval is recorded as approved$/, (ctx) => {
    const folder = fs.existsSync(ticketPath(ctx.targetPath, 'active')) ? 'active' : 'paused';
    const content = fs.readFileSync(ticketPath(ctx.targetPath, folder), 'utf8');
    if (!/^human_approval: approved$/m.test(content)) {
      throw new Error(`expected human_approval: approved, got:\n${content}`);
    }
  });

  registry.define(/^the approval is recorded through the same effect path a plain Approve tap uses$/, (ctx) => {
    // recordApprovalReply (pendingApprovalReply.ts) is the SAME function
    // BL-410's own Approve-tap dispatch calls - proven by construction here
    // (tapExpedite wires the identical adapter), and this step confirms it
    // was actually invoked for THIS ticket, not merely available.
    if (!ctx.approvals.includes(TICKET_ID)) {
      throw new Error(`expected recordApprovalReply to have been called for ${TICKET_ID}, got: ${JSON.stringify(ctx.approvals)}`);
    }
  });

  // ── expedite-approval-03: force-promotes a paused ticket ───────────────
  registry.define(/^the ticket is in the paused backlog$/, (ctx) => {
    fs.rmSync(ticketPath(ctx.targetPath, 'active'), { force: true });
    writeTicket(ctx.targetPath, 'paused', `id: ${TICKET_ID}\ntitle: expedite fixture\nhuman_approval: pending\n`);
  });

  registry.define(/^the ticket is moved into the active backlog$/, (ctx) => {
    if (fs.existsSync(ticketPath(ctx.targetPath, 'paused'))) {
      throw new Error('expected the ticket file no longer in backlog/paused/');
    }
    if (!fs.existsSync(ticketPath(ctx.targetPath, 'active'))) {
      throw new Error('expected the ticket file moved into backlog/active/');
    }
  });

  registry.define(/^the promotion happens without waiting for the coordinator's sequencing$/, (ctx) => {
    // No coordinator concept exists anywhere in this fixture's adapters at
    // all - the promotion above fired synchronously inside the tap itself,
    // proving by construction it never waited on one.
    if (!ctx.promotions.includes(TICKET_ID)) {
      throw new Error(`expected promoteTicketIfPaused to have promoted ${TICKET_ID}, got: ${JSON.stringify(ctx.promotions)}`);
    }
  });

  // ── expedite-approval-04: dispatches immediately ────────────────────────
  registry.define(/^the ticket has been approved and promoted by an expedite tap$/, () => {
    // Nothing further to arrange - the Background already leaves the
    // ticket pending/active; the SAME tap ("When the expedite effect
    // completes" below) performs the approve+promote+dispatch in one
    // motion, mirroring how BL-484's own scenarios frame a Given/When
    // pair around one tap action.
  });

  registry.define(/^the expedite effect completes$/, async (ctx) => {
    ctx.deliverResult = await tapExpedite(ctx);
  });

  registry.define(/^a routing handoff is injected to start the build immediately$/, (ctx) => {
    if (!ctx.dispatches.includes(TICKET_ID)) {
      throw new Error(`expected dispatchExpediteBuild to have fired for ${TICKET_ID}, got: ${JSON.stringify(ctx.dispatches)}`);
    }
  });

  registry.define(/^the dispatch bypasses the coordinator's orthogonality and sequencing triage$/, (ctx) => {
    // Same proof-by-construction as expedite-approval-03's sequencing step -
    // no coordinator/orthogonality check exists anywhere in this fixture's
    // adapters, and the dispatch above still fired.
    if (!ctx.dispatches.includes(TICKET_ID)) {
      throw new Error(`expected the dispatch to have fired unconditionally, got: ${JSON.stringify(ctx.dispatches)}`);
    }
  });

  // ── expedite-approval-05: already-active ticket, no redundant promote ──
  registry.define(/^the ticket is already in the active backlog$/, (ctx) => {
    // The Background already wrote the fixture into backlog/active/ -
    // nothing further to arrange.
    if (!fs.existsSync(ticketPath(ctx.targetPath, 'active'))) {
      throw new Error('setup: expected the ticket already in backlog/active/');
    }
  });

  registry.define(/^the ticket is approved and dispatched to build immediately$/, (ctx) => {
    if (!ctx.approvals.includes(TICKET_ID)) {
      throw new Error(`expected the ticket approved, got approvals: ${JSON.stringify(ctx.approvals)}`);
    }
    if (!ctx.dispatches.includes(TICKET_ID)) {
      throw new Error(`expected the ticket dispatched, got dispatches: ${JSON.stringify(ctx.dispatches)}`);
    }
  });

  registry.define(/^no paused-to-active promotion is attempted$/, (ctx) => {
    if (ctx.promotions.length !== 0) {
      throw new Error(`expected no promotion for an already-active ticket, got: ${JSON.stringify(ctx.promotions)}`);
    }
  });

  // ── expedite-approval-06: same-file collision warns, does not preempt ──
  registry.define(/^a build is already in flight that edits the same files as the ticket$/, (ctx) => {
    ctx.collision = 'BL-100';
  });

  registry.define(/^the human is shown a clear toast that the forced dispatch is unsafe$/, (ctx) => {
    if (ctx.answered.length !== 1 || !/unsafe/i.test(ctx.answered[0].text ?? '')) {
      throw new Error(`expected an "unsafe" toast, got: ${JSON.stringify(ctx.answered)}`);
    }
  });

  registry.define(/^the ticket is still approved and queued to build without preempting the in-flight build$/, (ctx) => {
    if (!ctx.approvals.includes(TICKET_ID)) {
      throw new Error(`expected the ticket still approved despite the collision, got: ${JSON.stringify(ctx.approvals)}`);
    }
    if (ctx.dispatches.includes(TICKET_ID)) {
      throw new Error('expected NO dispatch when a same-file build is in flight - the in-flight build must never be preempted');
    }
  });

  // ── expedite-approval-07: closes itself like any other decided ask ─────
  registry.define(/^the posted ask's inline keyboard is removed$/, (ctx) => {
    if (ctx.editCalls.length !== 1 || ctx.editCalls[0].topicId !== ASK_TOPIC_ID || ctx.editCalls[0].messageId !== ASK_MESSAGE_ID) {
      throw new Error(`expected exactly one editApprovalAskMessage call targeting the persisted ask, got: ${JSON.stringify(ctx.editCalls)}`);
    }
  });

  registry.define(/^an Expedited decision line with the recorded UTC time is appended to the message$/, (ctx) => {
    const editedText = ctx.editCalls[0].text;
    if (!editedText.startsWith(ORIGINAL_ASK_TEXT)) {
      throw new Error(`expected the original ask text preserved above the decision line, got:\n${editedText}`);
    }
    if (!/-- Expedited \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(editedText)) {
      throw new Error(`expected an "-- Expedited <UTC timestamp>" decision line, got:\n${editedText}`);
    }
  });

  // ── expedite-approval-08: a tap on an already-decided ask ──────────────
  registry.define(/^a decision has already been recorded for the ticket$/, (ctx) => {
    ctx.recordedVerdict = 'approved';
  });

  registry.define(/^the Expedite button on the already-decided ask is tapped$/, async (ctx) => {
    ctx.deliverResult = await tapExpedite(ctx);
  });

  // "the callback is answered with an already-decided toast" is registered
  // uniquely here - bl484's own step of near-identical wording carries an
  // extra "naming the approved verdict" suffix and does not anchor-match
  // this feature's shorter text, so there is no real collision (only a grep
  // substring false-positive, checked and ruled out).
  registry.define(/^the callback is answered with an already-decided toast$/, (ctx) => {
    if (ctx.answered.length !== 1 || !/already decided/i.test(ctx.answered[0].text ?? '')) {
      throw new Error(`expected an "already decided" toast, got: ${JSON.stringify(ctx.answered)}`);
    }
  });

  registry.define(/^no approval, promotion, or dispatch side effect is performed$/, (ctx) => {
    if (ctx.approvals.length !== 0) {
      throw new Error(`expected no approval side effect for a stale tap, got: ${JSON.stringify(ctx.approvals)}`);
    }
    if (ctx.promotions.length !== 0) {
      throw new Error(`expected no promotion side effect for a stale tap, got: ${JSON.stringify(ctx.promotions)}`);
    }
    if (ctx.dispatches.length !== 0) {
      throw new Error(`expected no dispatch side effect for a stale tap, got: ${JSON.stringify(ctx.dispatches)}`);
    }
  });
}

module.exports = { registerSteps };
