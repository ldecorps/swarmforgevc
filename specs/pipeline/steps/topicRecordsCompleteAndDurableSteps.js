'use strict';

// BL-348: step handlers for "A BL topic record is a complete and durable
// transcript". Drives the REAL compiled functions
// (extension/out/concierge/blTopicStore, extension/out/concierge/
// topicRecordRepair, extension/out/tools/repair-bl-topic-records,
// extension/out/panel/backlogReader) - no reimplementation of the repair
// or durability logic here, same boundary this suite's siblings draw
// (serialiseBlTopicContentSteps.js).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { readRecord, appendMessage, recordPath } = require(path.join(EXT_OUT, 'concierge', 'blTopicStore'));
const { repairBlTopicRecords } = require(path.join(EXT_OUT, 'tools', 'repair-bl-topic-records'));
const { messageTextForEvent } = require(path.join(EXT_OUT, 'concierge', 'topicRouter'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl348-acceptance-'));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function mkGitRepo() {
  const target = mkTmp();
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return target;
}

function writeDoneTicket(targetPath, id, { title, notes, firstAcceptanceStep }) {
  const dir = path.join(targetPath, 'backlog', 'done');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`id: ${id}`, `title: ${title}`, 'status: done'];
  if (notes) {
    lines.push('notes: |', ...notes.split('\n').map((l) => `  ${l}`));
  }
  if (firstAcceptanceStep) {
    lines.push('acceptance:', '  steps:', `    - ${firstAcceptanceStep}`);
  }
  fs.writeFileSync(path.join(dir, `${id}.yaml`), lines.join('\n') + '\n');
}

function writeTopicRecord(targetPath, id, record) {
  const filePath = recordPath(targetPath, id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record));
  git(targetPath, ['add', filePath]);
  git(targetPath, ['commit', '-q', '-m', `seed ${id}`]);
}

function completionText(id, title) {
  return `${id} - ${title} is complete.`;
}

function seedOrphanedCompletion(ctx) {
  ctx.target = mkGitRepo();
  ctx.ticketId = 'BL-900';
  ctx.title = 'Fix the thing';
  ctx.notes = 'This is why it matters.';
  ctx.firstAcceptanceStep = 'Given a broken thing';
  writeDoneTicket(ctx.target, ctx.ticketId, { title: ctx.title, notes: ctx.notes, firstAcceptanceStep: ctx.firstAcceptanceStep });
  writeTopicRecord(ctx.target, ctx.ticketId, {
    id: ctx.ticketId,
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: completionText(ctx.ticketId, ctx.title) }],
  });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a BL topic record is the durable history of a ticket's topic$/, () => {
    // Narrative only - each scenario's own Given step below builds its own
    // concrete fixture (an orphaned-completion record, an already-correct
    // one, or a fresh live-write target), same as this suite's siblings.
  });

  // ── topic-records-complete-and-durable-01 / 03 (shared Given) ─────────
  registry.define(/^a record whose first message is the ticket's completion$/, (ctx) => {
    seedOrphanedCompletion(ctx);
  });

  // ── topic-records-complete-and-durable-02 ───────────────────────────
  registry.define(/^a record missing its opening summary$/, (ctx) => {
    seedOrphanedCompletion(ctx);
  });

  registry.define(/^the ticket it belongs to is closed$/, (ctx) => {
    // Already true: seedOrphanedCompletion wrote the ticket straight into
    // backlog/done/ - restated here only to name the scenario's own
    // precondition explicitly.
    if (!fs.existsSync(path.join(ctx.target, 'backlog', 'done', `${ctx.ticketId}.yaml`))) {
      throw new Error('expected the ticket to already be in backlog/done/');
    }
  });

  // ── topic-records-complete-and-durable-04 ───────────────────────────
  registry.define(/^the records have already been repaired$/, (ctx) => {
    seedOrphanedCompletion(ctx);
    repairBlTopicRecords(ctx.target);
    ctx.afterFirstRepair = readRecord(ctx.target, ctx.ticketId);
  });

  // ── topic-records-complete-and-durable-05 ───────────────────────────
  registry.define(/^a record that already opens with its summary$/, (ctx) => {
    ctx.target = mkGitRepo();
    ctx.ticketId = 'BL-901';
    const title = 'Already correct ticket';
    writeDoneTicket(ctx.target, ctx.ticketId, { title });
    ctx.originalRecord = {
      id: ctx.ticketId,
      messages: [
        { seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'What it is: Already correct ticket' },
        { seq: 1, ts: 2000, author: 'swarm', type: 'outbound', text: completionText(ctx.ticketId, title) },
      ],
    };
    writeTopicRecord(ctx.target, ctx.ticketId, ctx.originalRecord);
  });

  // ── topic-records-complete-and-durable-06 ───────────────────────────
  registry.define(/^a record that has been repaired$/, (ctx) => {
    seedOrphanedCompletion(ctx);
    repairBlTopicRecords(ctx.target);
  });

  // ── topic-records-complete-and-durable-07 ───────────────────────────
  registry.define(/^a ticket whose topic receives a message during normal operation$/, (ctx) => {
    ctx.target = mkGitRepo();
    ctx.ticketId = 'BL-902';
  });

  // ── topic-records-complete-and-durable-08 ───────────────────────────
  registry.define(/^a record whose commit cannot be made$/, (ctx) => {
    // A non-git target - the exact real-world shape a commit failure comes
    // from (commitScopedFile fails open, returning false, never throwing).
    ctx.target = mkTmp();
    ctx.ticketId = 'BL-903';
  });

  // ── When steps ───────────────────────────────────────────────────────
  registry.define(/^the records are repaired$/, (ctx) => {
    ctx.repairResult = repairBlTopicRecords(ctx.target);
  });

  registry.define(/^the records are repaired again$/, (ctx) => {
    ctx.secondRepairResult = repairBlTopicRecords(ctx.target);
  });

  registry.define(/^the repository is checked out fresh$/, (ctx) => {
    ctx.freshCheckout = mkTmp();
    git(ctx.target, ['clone', '-q', ctx.target, ctx.freshCheckout]);
  });

  registry.define(/^the message is recorded$/, (ctx) => {
    ctx.reportedFailures = [];
    ctx.recordedEntry = appendMessage(
      ctx.target,
      ctx.ticketId,
      { author: 'human', type: 'inbound', text: 'a real message', ts: 1 },
      (ticketId, filePath) => ctx.reportedFailures.push({ ticketId, filePath })
    );
  });

  // ── Then steps ───────────────────────────────────────────────────────
  registry.define(/^that record opens with a summary of what the ticket was$/, (ctx) => {
    const record = readRecord(ctx.target, ctx.ticketId);
    if (!/^What it is:/.test(record.messages[0].text)) {
      throw new Error(`expected the record's first message to open with a summary, got ${JSON.stringify(record.messages[0])}`);
    }
  });

  registry.define(/^the restored summary says what the ticket was, what it solved, and how it worked$/, (ctx) => {
    const record = readRecord(ctx.target, ctx.ticketId);
    const opener = record.messages[0].text;
    if (!/^What it is: /.test(opener)) throw new Error(`expected "What it is:", got ${opener}`);
    if (!/What it solves: /.test(opener)) throw new Error(`expected "What it solves:", got ${opener}`);
    if (!/How it works: /.test(opener)) throw new Error(`expected "How it works:", got ${opener}`);
  });

  registry.define(/^it matches what the summary would have said when the ticket opened$/, (ctx) => {
    const record = readRecord(ctx.target, ctx.ticketId);
    const expected = messageTextForEvent({
      type: 'TaskStarted',
      backlogId: ctx.ticketId,
      payload: { title: ctx.title, notes: ctx.notes, firstAcceptanceStep: ctx.firstAcceptanceStep },
    });
    if (record.messages[0].text !== expected) {
      throw new Error(`expected the restored opener to byte-match the live TaskStarted format:\n${expected}\ngot:\n${record.messages[0].text}`);
    }
  });

  registry.define(/^the restored summary comes before the completion in that record's history$/, (ctx) => {
    const record = readRecord(ctx.target, ctx.ticketId);
    if (record.messages.length !== 2) {
      throw new Error(`expected exactly 2 messages (opener + completion), got ${JSON.stringify(record.messages)}`);
    }
    if (!/^What it is:/.test(record.messages[0].text)) {
      throw new Error(`expected message 0 to be the restored opener, got ${JSON.stringify(record.messages[0])}`);
    }
    if (!record.messages[1].text.endsWith('is complete.')) {
      throw new Error(`expected message 1 to be the completion, got ${JSON.stringify(record.messages[1])}`);
    }
    if (record.messages[0].ts >= record.messages[1].ts) {
      throw new Error(`expected the opener's ts strictly before the completion's, got ${JSON.stringify(record.messages)}`);
    }
  });

  registry.define(/^no record gains a second opening summary$/, (ctx) => {
    if (ctx.secondRepairResult.outcomes.some((o) => o.repaired)) {
      throw new Error(`expected the second repair pass to repair nothing, got ${JSON.stringify(ctx.secondRepairResult)}`);
    }
    const record = readRecord(ctx.target, ctx.ticketId);
    const openers = record.messages.filter((m) => /^What it is:/.test(m.text));
    if (openers.length !== 1) {
      throw new Error(`expected exactly one opening summary, got ${openers.length}: ${JSON.stringify(record.messages)}`);
    }
    if (JSON.stringify(record) !== JSON.stringify(ctx.afterFirstRepair)) {
      throw new Error('expected the record to be byte-identical after a second, no-op repair pass');
    }
  });

  registry.define(/^that record is unchanged$/, (ctx) => {
    const record = readRecord(ctx.target, ctx.ticketId);
    if (JSON.stringify(record) !== JSON.stringify(ctx.originalRecord)) {
      throw new Error(`expected the already-correct record untouched, got ${JSON.stringify(record)}`);
    }
    if (!ctx.repairResult.outcomes.some((o) => o.backlogId === ctx.ticketId && o.reason === 'opener-already-present')) {
      throw new Error(`expected an "opener-already-present" outcome for ${ctx.ticketId}, got ${JSON.stringify(ctx.repairResult)}`);
    }
  });

  registry.define(/^the repaired record and its restored summary are both in the fresh checkout$/, (ctx) => {
    const record = readRecord(ctx.freshCheckout, ctx.ticketId);
    if (record.messages.length !== 2 || !/^What it is:/.test(record.messages[0].text)) {
      throw new Error(`expected the repaired record (with its restored opener) in the fresh checkout, got ${JSON.stringify(record)}`);
    }
  });

  registry.define(/^that record is committed to the repository$/, (ctx) => {
    const filePath = recordPath(ctx.target, ctx.ticketId);
    const log = git(ctx.target, ['log', '--format=%H', '--', filePath]).trim();
    if (!log) {
      throw new Error(`expected a real commit touching ${filePath}, git log was empty`);
    }
    const status = git(ctx.target, ['status', '--porcelain', '--', filePath]).trim();
    if (status) {
      throw new Error(`expected the record file committed (clean), git status shows: ${status}`);
    }
    if (ctx.reportedFailures.length !== 0) {
      throw new Error(`expected no reported commit failure on a real git target, got ${JSON.stringify(ctx.reportedFailures)}`);
    }
  });

  registry.define(/^the failure to commit it is surfaced$/, (ctx) => {
    if (ctx.reportedFailures.length !== 1) {
      throw new Error(`expected exactly one reported commit failure, got ${JSON.stringify(ctx.reportedFailures)}`);
    }
    const failure = ctx.reportedFailures[0];
    if (failure.ticketId !== ctx.ticketId) {
      throw new Error(`expected the failure reported for ${ctx.ticketId}, got ${failure.ticketId}`);
    }
    if (failure.filePath !== recordPath(ctx.target, ctx.ticketId)) {
      throw new Error(`expected the failure to name the record's own file path, got ${failure.filePath}`);
    }
    // The write itself must still have succeeded (fails open) - a reported
    // failure is never a dropped write.
    if (ctx.recordedEntry.text !== 'a real message') {
      throw new Error('expected the message write itself to still succeed despite the commit failure');
    }
  });
}

module.exports = { registerSteps };
