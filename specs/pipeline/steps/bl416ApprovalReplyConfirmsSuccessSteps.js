'use strict';

// BL-416: step handlers for "a ticket-topic reply never falsely claims
// 'nothing to approve'". Drives the REAL compiled units the fix touches -
// classifyApprovalReplyAction/recordApprovalReply/isTicketPendingApproval
// (pendingApprovalReply.ts) and composeTicketApprovalOverride
// (operator-decide.ts) - against a real fs backlog fixture, no live tmux/
// network. gateDecision is hardcoded to { action: 'nothing' } throughout:
// this feature is entirely about the ticket-scoped human_approval fallback,
// never about answering a live role gate (operatorDecideStatus.test.js
// already owns that decision's own branches).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { classifyApprovalReplyAction, recordApprovalReply, isTicketPendingApproval } = require(
  path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply')
);
const { composeTicketApprovalOverride } = require(path.join(EXT_DIR, 'out', 'tools', 'operator-decide'));

// Mirrors operatorDecideStatus.ts's own literal - the pre-existing generic
// reply a caller falls back to whenever composeTicketApprovalOverride
// returns undefined (unchanged by this ticket).
const GENERIC_NOTHING_TO_APPROVE_TEXT = 'Nothing to approve right now.';

const BACKLOG_ID = 'BL-416-fixture';
const OTHER_BACKLOG_ID = 'BL-417-fixture';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl416-'));
}

function writeTicket(targetPath, folder, fileName, content) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

// Given the classified reply action + this ticket's own pending state,
// produces the reply the human would see - the real override when one
// applies, the existing generic fallback otherwise (that fallback's own
// branches are operatorDecideStatus.ts's concern, not this ticket's).
function composeReply(targetPath, backlogId, replyText) {
  const action = classifyApprovalReplyAction(replyText);
  if (action.kind === 'approve') {
    recordApprovalReply(targetPath, backlogId);
  }
  const ticketPending = isTicketPendingApproval(targetPath, backlogId);
  const override = composeTicketApprovalOverride({ action: 'nothing' }, action.kind, ticketPending, backlogId);
  return override !== undefined ? override : GENERIC_NOTHING_TO_APPROVE_TEXT;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a human reply arrives in a ticket's Telegram topic$/, (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.backlogId = BACKLOG_ID;
  });

  // ── Given: this topic's ticket's own pending state ──────────────────
  registry.define(/^this topic's ticket is pending approval$/, (ctx) => {
    writeTicket(ctx.targetPath, 'active', `${BACKLOG_ID}-slug.yaml`, `id: ${BACKLOG_ID}\ntitle: t\nhuman_approval: pending\n`);
  });

  registry.define(/^this topic's ticket is still pending approval$/, (ctx) => {
    writeTicket(ctx.targetPath, 'active', `${BACKLOG_ID}-slug.yaml`, `id: ${BACKLOG_ID}\ntitle: t\nhuman_approval: pending\n`);
  });

  registry.define(/^this topic's ticket is pending approval while a different ticket is not$/, (ctx) => {
    writeTicket(ctx.targetPath, 'active', `${BACKLOG_ID}-slug.yaml`, `id: ${BACKLOG_ID}\ntitle: t\nhuman_approval: pending\n`);
    writeTicket(ctx.targetPath, 'active', `${OTHER_BACKLOG_ID}-slug.yaml`, `id: ${OTHER_BACKLOG_ID}\ntitle: t\nhuman_approval: approved\n`);
    ctx.otherBacklogId = OTHER_BACKLOG_ID;
  });

  registry.define(/^this topic's ticket is not pending approval$/, (ctx) => {
    writeTicket(ctx.targetPath, 'active', `${BACKLOG_ID}-slug.yaml`, `id: ${BACKLOG_ID}\ntitle: t\nhuman_approval: approved\n`);
  });

  // ── Given/And: the reply's own text ─────────────────────────────────
  registry.define(/^the reply is the approve keyword$/, (ctx) => {
    ctx.replyText = 'approve';
  });

  registry.define(/^the reply is not an approve, reject, or amend keyword$/, (ctx) => {
    ctx.replyText = 'where is the introducing summary?';
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the reply is processed$/, (ctx) => {
    ctx.reply = composeReply(ctx.targetPath, ctx.backlogId, ctx.replyText);
  });

  registry.define(/^a reply is processed in this topic$/, (ctx) => {
    ctx.replyText = 'where is the introducing summary?';
    ctx.reply = composeReply(ctx.targetPath, ctx.backlogId, ctx.replyText);
  });

  registry.define(/^a non-keyword reply is processed$/, (ctx) => {
    ctx.replyText = 'where is the introducing summary?';
    ctx.reply = composeReply(ctx.targetPath, ctx.backlogId, ctx.replyText);
  });

  // ── Then: scenario 01 ────────────────────────────────────────────────
  registry.define(/^the ticket's approval field is set to approved$/, (ctx) => {
    const content = fs.readFileSync(path.join(ctx.targetPath, 'backlog', 'active', `${BACKLOG_ID}-slug.yaml`), 'utf8');
    if (!/human_approval: approved/.test(content)) {
      throw new Error(`expected human_approval: approved on disk, got:\n${content}`);
    }
  });

  registry.define(/^the confirmation names the approved ticket as a success$/, (ctx) => {
    if (!ctx.reply.includes(ctx.backlogId) || !/approved/i.test(ctx.reply)) {
      throw new Error(`expected a by-name success confirmation, got: ${ctx.reply}`);
    }
  });

  registry.define(/^the confirmation is not the generic "nothing to approve" text$/, (ctx) => {
    if (ctx.reply === GENERIC_NOTHING_TO_APPROVE_TEXT) {
      throw new Error('expected the confirmation to differ from the generic fallback');
    }
  });

  // ── Then: scenario 02 ────────────────────────────────────────────────
  registry.define(/^the response reflects that this ticket is still awaiting approval$/, (ctx) => {
    if (!ctx.reply.includes(ctx.backlogId) || !/awaiting approval/i.test(ctx.reply)) {
      throw new Error(`expected a still-awaiting-approval response, got: ${ctx.reply}`);
    }
  });

  registry.define(/^the response is not the generic "nothing to approve" text$/, (ctx) => {
    if (ctx.reply === GENERIC_NOTHING_TO_APPROVE_TEXT) {
      throw new Error('expected the response to differ from the generic fallback');
    }
  });

  // ── Then: scenario 03 ────────────────────────────────────────────────
  registry.define(/^the pending state considered is this topic's ticket, not a global slot$/, (ctx) => {
    if (isTicketPendingApproval(ctx.targetPath, ctx.backlogId) !== true) {
      throw new Error("expected this topic's own ticket to read as pending");
    }
    if (isTicketPendingApproval(ctx.targetPath, ctx.otherBacklogId) !== false) {
      throw new Error('expected the different ticket to read independently as not pending');
    }
    if (!/awaiting approval/i.test(ctx.reply)) {
      throw new Error(`expected this topic's own reply to reflect its own pending ticket, got: ${ctx.reply}`);
    }
  });

  // ── Then: scenario 04 ────────────────────────────────────────────────
  registry.define(/^the generic "nothing to approve" response is acceptable$/, (ctx) => {
    if (ctx.reply !== GENERIC_NOTHING_TO_APPROVE_TEXT) {
      throw new Error(`expected the generic fallback text, got: ${ctx.reply}`);
    }
  });
}

module.exports = { registerSteps };
