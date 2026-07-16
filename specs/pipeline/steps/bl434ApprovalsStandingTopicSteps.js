'use strict';

// BL-434: step handlers for "One standing Approvals topic indexes every
// pending approval and is where the human acts". Combines three REAL
// compiled surfaces, no live Telegram/network:
//   - runConciergeTick (conciergeTick.ts) against fake in-memory adapters,
//     for the ASK + ROSTER half (scenarios 01/04/05) - mirrors
//     pendingApprovalAsksInTopicSteps.js's own buildAdapters shape, plus
//     rosterAdapters (approvalsRosterSync.ts).
//   - pollAndForward (telegramFrontDeskBotCore.ts) against fake poll
//     adapters, for the REPLY-DISPATCH half (scenarios 02/03) - mirrors
//     bl409ApproveRejectAmendSteps.js's own deliverReply shape.
//   - the real fs-backed recordApprovalReply/recordRejectionReply
//     (pendingApprovalReply.ts) against a temp backlog fixture, reused
//     (never a second approval-recording path) by both halves above.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));
const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { recordApprovalReply, recordRejectionReply, classifyApprovalsTopicReply } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));

const APPROVALS_SUBJECT_ID = 'APPROVALS';
const APPROVALS_TOPIC_ID = 750;
const PRINCIPAL_ID = 111;
const APPROVAL_TEXT_PATTERN = /needs your approval/;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl434-'));
}

function writeTicket(ctx, folder, id, title) {
  const dir = path.join(ctx.targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: ${title}\nhuman_approval: pending\n`);
}

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
      ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
    rosterAdapters: {
      ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
      postMessage: async (topicId, text) => {
        ctx.rosterMessageId = (ctx.rosterMessageId ?? 0) + 1;
        ctx.rosterText = text;
        return ctx.rosterMessageId;
      },
      editMessage: async (topicId, messageId, text) => {
        ctx.rosterText = text;
        return true;
      },
    },
  };
}

async function tick(ctx) {
  ctx.tickResult = await runConciergeTick(ctx.adapters);
}

// Adds a ticket to the in-memory folders snapshot, writes its real backlog
// file, and runs a tick so it is already "pending approval in the Approvals
// topic" by the time a scenario's own When step fires - mirrors
// bl409ApproveRejectAmendSteps.js's own "outstanding ApprovalRequested"
// Background shape, generalized to a parameterized ticket id.
async function givenTicketPending(ctx, id) {
  writeTicket(ctx, 'paused', id, `fixture for ${id}`);
  ctx.folders.paused.push({ id, title: `fixture for ${id}`, humanApproval: 'pending' });
  await tick(ctx);
}

async function deliverApprovalsTopicReply(ctx, text) {
  ctx.updateCounter = (ctx.updateCounter ?? 0) + 1;
  return pollAndForward(0, String(PRINCIPAL_ID), {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [{ update_id: ctx.updateCounter, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: APPROVALS_TOPIC_ID, text } }],
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
    // Real writers against ctx.targetPath - the SAME production functions
    // telegram-front-desk-bot.ts wires, not fakes (mirrors
    // bl409ApproveRejectAmendSteps.js's own posture).
    recordApprovalReply: (backlogId) => Promise.resolve(recordApprovalReply(ctx.targetPath, backlogId)),
    recordRejectionReply: (backlogId, reason) => Promise.resolve(recordRejectionReply(ctx.targetPath, backlogId, reason)),
    notifyApprovalsTopic: async (topicId, text2) => {
      ctx.notified.push({ topicId, text: text2 });
      return true;
    },
  });
}

// Reflects a ticket's approval/rejection back into the in-memory folders
// snapshot this fixture hand-tracks - a real disk-backed readFolders would
// report this same value on the next tick (mirrors bl409's own
// ctx.folders.paused[0].humanApproval = 'rejected' pattern).
function markResolvedInFolders(ctx, id, humanApproval) {
  for (const item of ctx.folders.paused) {
    if (item.id === id) {
      item.humanApproval = humanApproval;
    }
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a standing Approvals topic exists$/, (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.notified = [];
    ctx.tickState = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [], done: [] };
    ctx.adapters = buildConciergeAdapters(ctx);
  });

  // ── approvals-standing-topic-01 ─────────────────────────────────────────
  registry.define(/^a ticket transitions to awaiting human approval$/, (ctx) => {
    ctx.askBacklogId = 'BL-434-ask-fixture';
    writeTicket(ctx, 'active', ctx.askBacklogId, 'a fine feature');
    ctx.folders.active.push({ id: ctx.askBacklogId, title: 'a fine feature', humanApproval: 'pending' });
  });

  // Distinct wording from the generic "the concierge tick runs" text
  // epicProgressChangeGateSteps.js already owns - the shared step-registry
  // has no per-feature scoping, so an identical Gherkin line collides
  // (first-registered handler wins), the same systemic pattern
  // bl408PendingReviewApprovalsSteps.js's own "a concierge tick runs"
  // (indefinite article) already sidesteps.
  registry.define(/^the concierge tick runs for the Approvals topic$/, async (ctx) => {
    await tick(ctx);
  });

  registry.define(/^the ticket's approval ask is posted in the Approvals topic$/, (ctx) => {
    ctx.approvalAsk = ctx.sent.find((m) => APPROVAL_TEXT_PATTERN.test(m.text) && m.topicId === APPROVALS_TOPIC_ID && m.text.includes(ctx.askBacklogId));
    if (!ctx.approvalAsk) {
      throw new Error(`expected an approval ask posted into the Approvals topic naming ${ctx.askBacklogId}, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^the ask is not posted in the ticket's own BL topic$/, (ctx) => {
    // The ticket's own topic legitimately carries OTHER messages (its
    // TaskStarted opener, in this fixture) - only the approval ask itself
    // must never land there.
    const ownTopicId = ctx.topicMap[ctx.askBacklogId];
    if (ctx.sent.some((m) => APPROVAL_TEXT_PATTERN.test(m.text) && m.topicId === ownTopicId)) {
      throw new Error(`expected no approval ask posted into ${ctx.askBacklogId}'s own topic, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^the ask names the ticket id so a reply can target it$/, (ctx) => {
    const parsed = classifyApprovalsTopicReply(`approve ${ctx.askBacklogId}`);
    if (parsed.kind !== 'approve' || parsed.backlogId !== ctx.askBacklogId) {
      throw new Error(`expected the ask's own ticket id to round-trip through the Approvals-topic reply grammar, got ${JSON.stringify(parsed)}`);
    }
    if (!ctx.approvalAsk.text.includes(ctx.askBacklogId)) {
      throw new Error(`expected the ask text itself to name ${ctx.askBacklogId}, got: ${ctx.approvalAsk.text}`);
    }
  });

  // ── approvals-standing-topic-02/03/05 (shared Given) ────────────────────
  registry.define(/^ticket "([^"]*)" is pending approval in the Approvals topic$/, async (ctx, id) => {
    await givenTicketPending(ctx, id);
  });

  registry.define(/^no ticket "([^"]*)" is pending approval$/, () => {
    // A clean fixture already has no such ticket - nothing to set up.
  });

  // ── approvals-standing-topic-02/03 (shared When) ────────────────────────
  registry.define(/^the human replies "([^"]*)" in the Approvals topic$/, async (ctx, reply) => {
    ctx.replyResult = await deliverApprovalsTopicReply(ctx, reply);
  });

  // ── approvals-standing-topic-02 ──────────────────────────────────────────
  registry.define(/^the "([^"]*)" is recorded against ticket "([^"]*)"$/, (ctx, verb, id) => {
    const content = fs.readFileSync(path.join(ctx.targetPath, 'backlog', 'paused', `${id}.yaml`), 'utf8');
    const expected = verb === 'approve' ? /^human_approval: approved$/m : /^human_approval: rejected\s{2}#/m;
    if (!expected.test(content)) {
      throw new Error(`expected "${verb}" recorded against ${id}, got:\n${content}`);
    }
  });

  // ── approvals-standing-topic-03 ──────────────────────────────────────────
  registry.define(/^no approval is recorded for "([^"]*)"$/, (ctx, id) => {
    const filePath = path.join(ctx.targetPath, 'backlog', 'paused', `${id}.yaml`);
    if (fs.existsSync(filePath)) {
      throw new Error(`expected no ticket file for ${id} to exist or change, got one at ${filePath}`);
    }
    if (ctx.replyResult.posted !== 0) {
      throw new Error(`expected the reply naming a non-pending id to record nothing, got posted=${ctx.replyResult.posted}`);
    }
  });

  registry.define(/^the reply is surfaced back as not acted on$/, (ctx) => {
    if (!ctx.notified.some((n) => n.topicId === APPROVALS_TOPIC_ID)) {
      throw new Error(`expected a surfacing reply into the Approvals topic, got ${JSON.stringify(ctx.notified)}`);
    }
    if (ctx.replyResult.dropped !== 1) {
      throw new Error(`expected the not-currently-pending reply to be a deliberate drop, got dropped=${ctx.replyResult.dropped}`);
    }
  });

  // ── approvals-standing-topic-04 ──────────────────────────────────────────
  registry.define(/^the Approvals topic roster lists both pending tickets$/, (ctx) => {
    if (!ctx.rosterText || !ctx.rosterText.includes('BL-440') || !ctx.rosterText.includes('BL-433')) {
      throw new Error(`expected the roster to list both BL-440 and BL-433, got: ${ctx.rosterText}`);
    }
  });

  // ── approvals-standing-topic-05 ──────────────────────────────────────────
  registry.define(/^the human approves "([^"]*)" in the Approvals topic$/, async (ctx, id) => {
    await deliverApprovalsTopicReply(ctx, `approve ${id}`);
    markResolvedInFolders(ctx, id, 'approved');
    await tick(ctx);
  });

  registry.define(/^"([^"]*)" is no longer in the Approvals topic roster$/, (ctx, id) => {
    if (ctx.rosterText && ctx.rosterText.includes(id)) {
      throw new Error(`expected ${id} removed from the roster, got: ${ctx.rosterText}`);
    }
  });
}

module.exports = { registerSteps };
