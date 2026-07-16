'use strict';

// BL-408: step handlers for approve-from-Telegram fixes. Tests the
// interactions between:
//   - backlogReader.ts normalizing 'pending-review' to 'pending'
//   - pendingApprovalReply.ts matching both 'pending' and 'pending-review'
//   - conciergeTick.ts scanning active + paused folders for pending approvals
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { parseBacklogYaml } = require(path.join(EXT_DIR, 'out', 'panel', 'backlogReader'));
const { recordApprovalReply, isApprovalReplyText, approveHumanApprovalText } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));

const APPROVAL_TEXT_PATTERN = /needs your approval/;

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
        ctx.sent.push({ topicId, text });
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

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl408-'));
}

function writeTicket(targetPath, folder, fileName, content) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the existing ApprovalRequested \/ recordApprovalReply chain$/, (ctx) => {
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.state = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [], done: [] };
    ctx.adapters = buildAdapters(ctx);
    ctx.targetPath = mkTmp();
  });

  // ── BL-408-01: pending-review recognized as pending ───────────────────
  registry.define(/^a ticket whose backlog file has "human_approval: pending-review"$/, (ctx) => {
    ctx.testBacklogId = 'BL-408-01-fixture';
    ctx.testContent = `id: ${ctx.testBacklogId}\ntitle: test\nhuman_approval: pending-review\n`;
    writeTicket(ctx.targetPath, 'active', `${ctx.testBacklogId}.yaml`, ctx.testContent);
  });

  registry.define(/^the ticket's human approval state is read$/, (ctx) => {
    ctx.parsedItem = parseBacklogYaml(ctx.testContent);
  });

  registry.define(/^it is classified as pending$/, (ctx) => {
    if (ctx.parsedItem.humanApproval !== 'pending') {
      throw new Error(`expected humanApproval: 'pending', got: ${ctx.parsedItem.humanApproval}`);
    }
  });

  // ── BL-408-02: approve flips pending-review ──────────────────────────
  registry.define(/^a topic reply matching an approval reply is recorded against it$/, (ctx) => {
    if (!isApprovalReplyText('approve')) {
      throw new Error('isApprovalReplyText must recognize "approve"');
    }
    const changed = recordApprovalReply(ctx.targetPath, ctx.testBacklogId);
    if (!changed) {
      throw new Error('expected recordApprovalReply to flip the ticket');
    }
  });

  registry.define(/^its backlog file now has "human_approval: approved"$/, (ctx) => {
    const content = fs.readFileSync(path.join(ctx.targetPath, 'backlog', 'active', `${ctx.testBacklogId}.yaml`), 'utf8');
    if (!/human_approval: approved/.test(content)) {
      throw new Error(`expected human_approval: approved, got:\n${content}`);
    }
  });

  // ── BL-408-03: paused ticket's approval request is posted ──────────────
  registry.define(/^a ticket sitting in backlog\/paused\/ with human_approval pending-review$/, (ctx) => {
    ctx.testBacklogId = 'BL-408-03-fixture';
    ctx.folders.paused = [{ id: ctx.testBacklogId, title: 'awaiting promotion', humanApproval: 'pending' }];
    writeTicket(ctx.targetPath, 'paused', `${ctx.testBacklogId}.yaml`, `id: ${ctx.testBacklogId}\ntitle: awaiting promotion\nhuman_approval: pending-review\n`);
  });

  registry.define(/^a concierge tick runs$/, async (ctx) => {
    ctx.tickResult = await runConciergeTick(ctx.adapters);
  });

  registry.define(/^another concierge tick runs$/, async (ctx) => {
    ctx.tickResult = await runConciergeTick(ctx.adapters);
  });

  // BL-434: the ask now posts into the ONE standing Approvals topic
  // (ensureApprovalsTopic => 750 above), never the ticket's own per-ticket
  // topic - this scenario's own substance ("a paused ticket ALSO gets
  // asked, not just an active one") is unaffected by that relocation, so
  // the check just moves to the new destination.
  registry.define(/^an ApprovalRequested event is posted for that ticket$/, (ctx) => {
    const approvalMessage = ctx.sent.find((m) => APPROVAL_TEXT_PATTERN.test(m.text) && m.text.includes(ctx.testBacklogId) && m.topicId === 750);
    if (!approvalMessage) {
      throw new Error(`expected an approval request for ${ctx.testBacklogId} in the Approvals topic, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── BL-408-04: already-requested approval not re-posted ────────────────
  registry.define(/^a paused ticket that already has an outstanding ApprovalRequested post for its current pending state$/, async (ctx) => {
    ctx.testBacklogId = 'BL-408-04-fixture';
    ctx.folders.paused = [{ id: ctx.testBacklogId, title: 'pending-review', humanApproval: 'pending' }];
    ctx.adapters = buildAdapters(ctx);
    // First tick: posts the approval request
    await runConciergeTick(ctx.adapters);
    ctx.sentAfterFirstAsk = ctx.sent.length;
  });

  registry.define(/^no additional ApprovalRequested event is posted for that ticket$/, async (ctx) => {
    // Second tick: should NOT repost
    await runConciergeTick(ctx.adapters);
    if (ctx.sent.length !== ctx.sentAfterFirstAsk) {
      throw new Error(`expected no new approval request, got ${ctx.sent.length - ctx.sentAfterFirstAsk} new messages`);
    }
  });

  // ── BL-408-05: done ticket never gets approval request ─────────────────
  registry.define(/^a ticket sitting in backlog\/done\/$/, (ctx) => {
    ctx.testBacklogId = 'BL-408-05-fixture';
    ctx.folders.done = [{ id: ctx.testBacklogId, title: 'completed', humanApproval: 'pending' }];
  });

  registry.define(/^no ApprovalRequested event is posted for that ticket$/, (ctx) => {
    const approvalMessages = ctx.sent.filter((m) => APPROVAL_TEXT_PATTERN.test(m.text));
    if (approvalMessages.length > 0) {
      throw new Error(`expected no approval requests, got ${JSON.stringify(approvalMessages)}`);
    }
  });
}

module.exports = { registerSteps };
