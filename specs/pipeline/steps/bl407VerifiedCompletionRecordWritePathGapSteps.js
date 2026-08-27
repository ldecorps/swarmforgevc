'use strict';

// BL-407: step handlers for "closed tickets get a verified completion
// record so their topics can be retired". Root cause (confirmed against the
// LIVE swarm's own front-desk-supervisor.log, which shows real "FAILED to
// commit topic record" lines for BL-408/BL-404 correlating with supervisor
// restarts): commitScopedFile's single git add+commit attempt can lose a
// transient race (two processes sharing one physical worktree - the front-
// desk bot and a concurrent coordinator/specifier commit - contending for
// .git/index.lock), and nothing ever retried it, so a momentary collision
// became a PERMANENT durability gap (26 real done tickets: BL-305..328,
// BL-333, BL-334). Drives the REAL compiled write path
// (blTopicStore.appendMessage), the real bounded retry
// (gitCommitScopedFile.commitScopedFile), the real reconciliation tool
// (repair-bl-topic-records.repairBlTopicRecords), and the real refusal
// guard (topicDeletion.decideTopicDeletion) against disposable git
// fixtures - never the live repo's own real 26 tickets, which stay a
// separate operational backfill (repair-bl-topic-records.js run against
// the real master checkout) outside this unit-level acceptance concern.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { appendMessage, hasCompletionRecord, isRecordCommitted, recordPath } = require(path.join(EXT_OUT, 'concierge', 'blTopicStore'));
const { completionSummaryText } = require(path.join(EXT_OUT, 'concierge', 'topicRouter'));
const { repairBlTopicRecords } = require(path.join(EXT_OUT, 'tools', 'repair-bl-topic-records'));
const { decideTopicDeletion } = require(path.join(EXT_OUT, 'concierge', 'topicDeletion'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
}

function mkGitRepo() {
  const target = mkTmp('bl407-topic-write-path-');
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return target;
}

function writeDoneTicket(targetPath, id, title) {
  const dir = path.join(targetPath, 'backlog', 'done');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: ${title}\nstatus: done\n`);
}

function writeUncommittedTopicRecord(targetPath, id, title) {
  const filePath = recordPath(targetPath, id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const record = {
    id,
    messages: [
      { seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: `What it is: ${title}` },
      { seq: 1, ts: 2000, author: 'swarm', type: 'outbound', text: `${id} - ${title} is complete.` },
    ],
  };
  fs.writeFileSync(filePath, JSON.stringify(record));
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^the ticket-close \/ QA-approval flow that writes a topic's completion record$/, (ctx) => {
    ctx.targetRepo = mkGitRepo();
  });

  // ── completion-record-gap-01 ───────────────────────────────────────────
  registry.define(/^a ticket that is closed via the normal QA-approval flow$/, (ctx) => {
    ctx.ticketId = 'BL-900';
    ctx.title = 'Fix the thing';
    writeDoneTicket(ctx.targetRepo, ctx.ticketId, ctx.title);
  });

  registry.define(/^its topic record is written$/, (ctx) => {
    const event = { type: 'TaskCompleted', backlogId: ctx.ticketId, payload: {} };
    ctx.completionText = completionSummaryText(event, ctx.title);
    appendMessage(ctx.targetRepo, ctx.ticketId, { author: 'swarm', type: 'outbound', text: ctx.completionText });
  });

  registry.define(/^it includes a verified completion message$/, (ctx) => {
    const record = JSON.parse(fs.readFileSync(recordPath(ctx.targetRepo, ctx.ticketId), 'utf8'));
    assert.ok(hasCompletionRecord(record, ctx.completionText), 'expected the completion text to be present in the record');
    assert.ok(isRecordCommitted(ctx.targetRepo, ctx.ticketId), 'expected appendMessage\'s own write to have been durably committed - the write path this ticket fixes');
  });

  // ── completion-record-gap-02 ───────────────────────────────────────────
  registry.define(/^the 26 topics with no verified completion record$/, (ctx) => {
    // A representative sample, never a hand-rolled substitute for the real
    // shape: every one of the real 26 (confirmed by inspecting
    // backlog/topics/*.json directly) is a ticket whose record content is
    // already correct (an opener plus its completion summary) but was
    // simply never git-committed - the exact durability gap, not a content
    // gap (BL-348's separate missing-opener repair already covers that
    // other shape).
    ctx.affectedIds = ['BL-901', 'BL-902', 'BL-903'];
    for (const id of ctx.affectedIds) {
      writeDoneTicket(ctx.targetRepo, id, `Ticket ${id}`);
      writeUncommittedTopicRecord(ctx.targetRepo, id, `Ticket ${id}`);
    }
  });

  registry.define(/^the reconciliation pass runs$/, (ctx) => {
    ctx.reconcileResult = repairBlTopicRecords(ctx.targetRepo);
  });

  registry.define(/^each topic is either backfilled with a completion record or explicitly archived$/, (ctx) => {
    for (const id of ctx.affectedIds) {
      const outcome = ctx.reconcileResult.outcomes.find((o) => o.backlogId === id);
      assert.ok(outcome, `expected a reconciliation outcome for ${id}`);
      assert.equal(outcome.reason, 'backfilled-commit', `expected ${id} to be backfilled, got: ${JSON.stringify(outcome)}`);
      assert.ok(isRecordCommitted(ctx.targetRepo, id), `expected ${id}'s record to now be durably committed`);
    }
  });

  // ── completion-record-gap-03 ───────────────────────────────────────────
  registry.define(/^a topic still lacking a verified completion record after reconciliation$/, (ctx) => {
    // Reconciliation only ever backfills a COMMIT for content that is
    // already correct - it never invents a completion message for a topic
    // that genuinely has none, so this ticket's own topic map still points
    // at a real topic with no completion text recorded at all.
    ctx.ticket = { id: 'BL-999', title: 'Never actually finished' };
    ctx.topicMap = { 'BL-999': 42 };
    ctx.record = { id: 'BL-999', messages: [] };
  });

  registry.define(/^topic deletion evaluates it$/, (ctx) => {
    ctx.decision = decideTopicDeletion(ctx.ticket, ctx.topicMap, ctx.record, true, Date.now(), 1);
  });

  registry.define(/^it still refuses to delete that topic$/, (ctx) => {
    assert.equal(ctx.decision.action, 'keep', `expected the refusal guard to still keep an unverified topic, got: ${JSON.stringify(ctx.decision)}`);
    assert.equal(ctx.decision.reason, 'unverified');
  });
}

module.exports = { registerSteps };
