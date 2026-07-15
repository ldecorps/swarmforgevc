'use strict';

// BL-409: step handlers for the reject/amend verbs extending BL-357/BL-408's
// Telegram approval-reply chain. Drives the REAL pendingApprovalReply.ts
// (real fs) and pollAndForward (telegramFrontDeskBotCore.ts) for the
// reply-dispatch half, and the REAL runConciergeTick (same fixture shape as
// bl408PendingReviewApprovalsSteps.js) for the "no further ApprovalRequested"
// half - proving the reject write composes with the EXISTING, unmodified
// diffApprovalRequested transition logic rather than re-implementing it.
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
const TOPIC_ID = 42;
const BACKLOG_ID = 'BL-409-fixture';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl409-'));
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

// Same shape as bl408PendingReviewApprovalsSteps.js's buildAdapters - this
// fixture's readFolders returns an in-memory snapshot the step author keeps
// in sync with the real file, mirroring what a real disk scan would report
// after a write (a real runConciergeTick reads fresh from disk; this fixture
// hand-tracks the same state instead of re-implementing that scan here).
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
        ctx.sent.push({ topicId, text });
        return true;
      },
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  };
}

function mkUpdate(text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: TOPIC_ID, text } };
}

async function deliverReply(ctx, text) {
  ctx.contexts = [];
  const result = await pollAndForward(0, String(PRINCIPAL_ID), {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate(text)] }),
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
    // Real writers against ctx.targetPath - the SAME production functions
    // telegram-front-desk-bot.ts wires, not fakes, so the file assertions
    // below prove the real write, not a stand-in.
    recordApprovalReply: (backlogId) => Promise.resolve(recordApprovalReply(ctx.targetPath, backlogId)),
    recordRejectionReply: (backlogId, reason) => Promise.resolve(recordRejectionReply(ctx.targetPath, backlogId, reason)),
  });
  return result;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a pending-review ticket with an outstanding ApprovalRequested post in its topic$/, async (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.topicMap = { [BACKLOG_ID]: TOPIC_ID };
    ctx.created = [];
    ctx.sent = [];
    ctx.tickState = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [{ id: BACKLOG_ID, title: 'awaiting review', humanApproval: 'pending' }], done: [] };
    ctx.adapters = buildConciergeAdapters(ctx);
    writeTicket(ctx.targetPath, 'paused', `${BACKLOG_ID}.yaml`, `id: ${BACKLOG_ID}\ntitle: awaiting review\nhuman_approval: pending\n`);
    // First tick posts the ApprovalRequested this Background describes as
    // "outstanding" - mirrors bl408PendingReviewApprovalsSteps.js's own
    // BL-408-04 fixture shape.
    await runConciergeTick(ctx.adapters);
    ctx.sentAfterInitialAsk = ctx.sent.length;
    if (!ctx.sent.some((m) => APPROVAL_TEXT_PATTERN.test(m.text) && m.topicId === TOPIC_ID)) {
      throw new Error(`setup: expected the initial ApprovalRequested post; got ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── shared When step (all three scenarios) ─────────────────────────────
  registry.define(/^a topic reply of "([^"]*)"$/, (ctx, replyText) => {
    ctx.replyText = replyText;
  });

  registry.define(/^the reply is recorded against the ticket$/, async (ctx) => {
    ctx.deliverResult = await deliverReply(ctx, ctx.replyText);
  });

  // ── approve-reject-amend-01: reject ─────────────────────────────────────
  registry.define(/^its backlog file's human_approval line becomes rejected with the reason "([^"]*)"$/, (ctx, reason) => {
    const content = readTicketContent(ctx);
    const expected = new RegExp(`^human_approval: rejected {2}# ${reason}$`, 'm');
    if (!expected.test(content)) {
      throw new Error(`expected human_approval: rejected  # ${reason}, got:\n${content}`);
    }
    // Keep the concierge-tick fixture's in-memory folder snapshot in sync
    // with the real file we just proved above - a real disk-backed
    // readFolders would report this same value on the next tick.
    ctx.folders.paused[0].humanApproval = 'rejected';
  });

  registry.define(/^no further ApprovalRequested event is posted for that ticket$/, async (ctx) => {
    await runConciergeTick(ctx.adapters);
    const newApprovalPosts = ctx.sent.slice(ctx.sentAfterInitialAsk).filter((m) => APPROVAL_TEXT_PATTERN.test(m.text) && m.topicId === TOPIC_ID);
    if (newApprovalPosts.length > 0) {
      throw new Error(`expected no additional ApprovalRequested post for a rejected ticket, got ${JSON.stringify(newApprovalPosts)}`);
    }
  });

  // ── approve-reject-amend-02: amend ──────────────────────────────────────
  registry.define(/^the note is posted as operator context on the ticket$/, (ctx) => {
    const posted = ctx.contexts.find((c) => c.backlogId === BACKLOG_ID);
    if (!posted) {
      throw new Error(`expected an operator-context post for ${BACKLOG_ID}, got ${JSON.stringify(ctx.contexts)}`);
    }
    if (posted.text !== 'tighten the acceptance criteria') {
      throw new Error(`expected only the extracted note (verb prefix stripped) as context text, got: ${JSON.stringify(posted.text)}`);
    }
  });

  registry.define(/^the ticket's human_approval value is unchanged$/, (ctx) => {
    const content = readTicketContent(ctx);
    if (!/^human_approval: pending$/m.test(content)) {
      throw new Error(`expected human_approval to remain 'pending' after an amend reply, got:\n${content}`);
    }
  });

  // ── approve-reject-amend-03: approve regression guard ───────────────────
  registry.define(/^its backlog file's human_approval line becomes approved$/, (ctx) => {
    const content = readTicketContent(ctx);
    if (!/^human_approval: approved$/m.test(content)) {
      throw new Error(`expected human_approval: approved, got:\n${content}`);
    }
  });
}

module.exports = { registerSteps };
