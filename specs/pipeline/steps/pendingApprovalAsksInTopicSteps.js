'use strict';

// BL-357: step handlers for "A ticket that needs the human's approval asks
// him for it, in its own topic". Combines two REAL compiled surfaces, no
// live Telegram/network:
//   - runConciergeTick (conciergeTick.ts) against fake in-memory adapters,
//     for the ASK half (scenarios 01/02/04/05) - mirrors
//     conciergeNeedsApprovalSteps.js's own buildAdapters shape.
//   - the real fs-backed recordApprovalReply (pendingApprovalReply.ts)
//     against a temp backlog fixture, for the RECORD half (scenario 03) -
//     the one genuinely new writer this ticket adds.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));
const { recordApprovalReply, isApprovalReplyText } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));

const BACKLOG_ID = 'BL-357-approval-fixture';
const TITLE = 'a fine feature';
const SECOND_BACKLOG_ID = 'BL-358-approval-fixture';
const APPROVAL_TEXT_PATTERN = /needs your approval/;
const APPROVALS_TOPIC_ID = 750;

function buildAdapters(ctx) {
  return {
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => ctx.state,
    writeTickState: (next) => {
      ctx.state = next;
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
        if (ctx.sendShouldFail) {
          return false;
        }
        ctx.sent.push({ topicId, text });
        return true;
      },
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      // BL-434: the ask now posts into the standing Approvals topic, never
      // the ticket's own per-ticket topic - scenarios below that check
      // WHERE the ask landed now check this destination instead.
      ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
      // BL-493: the standing Backlog topic + edit-in-place post/edit pair -
      // this feature's own scenarios don't assert on ticket-status
      // routing, but runConciergeTick unconditionally reaches these now.
      ensureBacklogTopic: async () => 760,
      postMessage: async () => 9000,
      editMessage: async () => true,
      getTicketMessageState: () => undefined,
      setTicketMessageState: () => {},
    },
    iconAdapters: {
      // BL-342: a safe default for fixtures that predate topic icons and
      // do not exercise them - an empty sticker list means syncTopicIcon
      // always no-ops (skipped-unresolved-icon), so runConciergeTick's own
      // icon-sync pass never calls setTopicIcon unexpectedly here.
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  };
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl357-'));
}

function writeTicket(targetPath, folder, fileName, content) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a ticket carries a pending human approval$/, (ctx) => {
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.state = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [{ id: BACKLOG_ID, title: TITLE, humanApproval: 'pending' }], paused: [], done: [] };
    ctx.sendShouldFail = false;
    ctx.adapters = buildAdapters(ctx);
    ctx.targetPath = mkTmp();
    writeTicket(ctx.targetPath, 'active', `${BACKLOG_ID}-fixture.yaml`, `id: ${BACKLOG_ID}\ntitle: ${TITLE}\nhuman_approval: pending\n`);
  });

  // Shared across every scenario below.
  registry.define(/^the swarm next reviews what needs the human$/, async (ctx) => {
    ctx.result = await runConciergeTick(ctx.adapters);
  });

  // ── pending-approval-asks-in-its-topic-01 ───────────────────────────────
  // BL-434: the ask now posts into the ONE standing Approvals topic, never
  // the ticket's own per-ticket topic - superseded by BL-434's own
  // approvals-standing-topic-01 scenario, which additionally asserts the
  // negative (never posted into the ticket's own topic); this check just
  // moves to the new destination so this pre-existing scenario stays true.
  registry.define(/^the ticket's approval request is posted in the Approvals topic$/, (ctx) => {
    if (!ctx.sent.some((m) => APPROVAL_TEXT_PATTERN.test(m.text) && m.topicId === APPROVALS_TOPIC_ID)) {
      throw new Error(`expected an approval request posted into the Approvals topic, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── pending-approval-asks-in-its-topic-02/03 (shared Given) ─────────────
  registry.define(/^the ticket has already asked the human for its approval$/, async (ctx) => {
    await runConciergeTick(ctx.adapters);
    ctx.sentAfterFirstAsk = ctx.sent.length;
  });

  registry.define(/^no second request is posted in the ticket's topic$/, (ctx) => {
    if (ctx.sent.length !== ctx.sentAfterFirstAsk) {
      throw new Error(`expected no new message after the first ask, got ${JSON.stringify(ctx.sent.slice(ctx.sentAfterFirstAsk))}`);
    }
  });

  // ── pending-approval-asks-in-its-topic-03 ───────────────────────────────
  registry.define(/^the human approves in that ticket's topic$/, (ctx) => {
    if (!isApprovalReplyText('approve')) {
      throw new Error('isApprovalReplyText must recognize a plain "approve" reply');
    }
    ctx.recorded = recordApprovalReply(ctx.targetPath, BACKLOG_ID);
  });

  registry.define(/^the ticket no longer needs the human's approval$/, (ctx) => {
    if (!ctx.recorded) {
      throw new Error('expected recordApprovalReply to report the flip');
    }
    const content = fs.readFileSync(path.join(ctx.targetPath, 'backlog', 'active', `${BACKLOG_ID}-fixture.yaml`), 'utf8');
    if (!/human_approval: approved/.test(content)) {
      throw new Error(`expected human_approval: approved on disk, got:\n${content}`);
    }
  });

  // ── pending-approval-asks-in-its-topic-04 ───────────────────────────────
  registry.define(/^a second ticket whose approval is not pending$/, (ctx) => {
    ctx.folders.active.push({ id: SECOND_BACKLOG_ID, title: 'no approval needed' });
  });

  registry.define(/^no approval is requested for the second ticket$/, (ctx) => {
    const approvalMessages = ctx.sent.filter((m) => APPROVAL_TEXT_PATTERN.test(m.text));
    // BL-434: both tickets' asks would land in the SAME standing Approvals
    // topic, so "for the first ticket only" is now proven by the ask's own
    // TEXT (it names the ticket id) rather than by a distinct topicId.
    if (approvalMessages.length !== 1 || approvalMessages[0].topicId !== APPROVALS_TOPIC_ID || !approvalMessages[0].text.includes(BACKLOG_ID)) {
      throw new Error(`expected exactly one approval request, for the first ticket only, got ${JSON.stringify(approvalMessages)}`);
    }
  });

  // ── pending-approval-asks-in-its-topic-05 ───────────────────────────────
  registry.define(/^the request for the human's approval could not be posted$/, async (ctx) => {
    ctx.sendShouldFail = true;
    ctx.firstResult = await runConciergeTick(ctx.adapters);
    // BL-493: the ticket's own TaskStarted status message now routes
    // through a SEPARATE, independent channel (postMessage) from the
    // ApprovalRequested ask (sendMessage) - only the latter is made to
    // fail here, so the first tick's overall routed count reflects
    // TaskStarted's own success, not the ask's failure. What this
    // scenario actually proves (the ask itself is retried, never dropped)
    // is that NOTHING matching the ask's own text posted on this first
    // tick - checked directly, rather than via the tick's total count.
    if (ctx.sent.some((m) => APPROVAL_TEXT_PATTERN.test(m.text))) {
      throw new Error(`expected the failed ask to post nothing on the first tick, got ${JSON.stringify(ctx.sent)}`);
    }
    ctx.sendShouldFail = false;
  });

  registry.define(/^the request is made again$/, (ctx) => {
    if (!ctx.sent.some((m) => APPROVAL_TEXT_PATTERN.test(m.text))) {
      throw new Error(`expected the retried approval request to post, got ${JSON.stringify(ctx.sent)}`);
    }
  });
}

module.exports = { registerSteps };
