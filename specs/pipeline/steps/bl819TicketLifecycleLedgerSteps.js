'use strict';

// BL-819: step handlers for the coordinator-owned ticket lifecycle ledger.
// Drives the REAL compiled lean-ledger-record.js CLI (the callable unit
// invoked at the actual handoff/close points) against fixture repos, and
// reads back through the real compiled leanLedgerStore/leanLedger modules -
// never a reimplementation of the composition/fold logic in the step file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const CLI = path.join(EXT_DIR, 'out', 'tools', 'lean-ledger-record.js');
const { readLeanLedgerEvents, readLeanLedgerSnapshot, appendLeanLedgerEventIfNew, leanLedgerFilePath, snapshotFilePath } = require(path.join(
  EXT_DIR,
  'out',
  'metrics',
  'leanLedgerStore'
));
const { foldLeanLedgerSnapshot } = require(path.join(EXT_DIR, 'out', 'quality', 'leanLedger'));
const { formatBounceHistoryEntry } = require(path.join(EXT_DIR, 'out', 'quality', 'bounceHistory'));

const TICKET = 'BL-9819';

// ── fixture helpers ─────────────────────────────────────────────────────

function mkFixtureRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl819-'));
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  // worktreeName 'coder' (anything but 'master') gives the flat, non-master
  // mailbox layout every non-master role's own worktree already has.
  fs.writeFileSync(path.join(target, '.swarmforge', 'roles.tsv'), ['coder', 'coder', target, 'swarmforge-coder', 'Coder', 'claude', 'task'].join('\t') + '\n');
  return target;
}

function completedHandoffsDir(target) {
  return path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');
}

function writeCompletedHandoff(target, ticket, headers) {
  const dir = completedHandoffsDir(target);
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  const name = `00_${Math.random().toString(36).slice(2)}.handoff`;
  fs.writeFileSync(path.join(dir, name), `task: ${ticket}-x\n${lines.join('\n')}\n\nbody\n`);
}

function writeTicketYamlWithBounces(dir, ticket, entries) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`id: ${ticket}`, 'title: "x"', `bounce_count: ${entries.length}`, 'bounce_history:', ...entries.map(formatBounceHistoryEntry)];
  fs.writeFileSync(path.join(dir, `${ticket}-x.yaml`), lines.join('\n') + '\n');
}

function writeDoneTicketAndTopic(target, ticket) {
  const doneDir = path.join(target, 'backlog', 'done');
  fs.mkdirSync(doneDir, { recursive: true });
  fs.writeFileSync(path.join(doneDir, `${ticket}-x.yaml`), `id: ${ticket}\ntitle: "x"\n`);
  const topicsDir = path.join(target, 'backlog', 'topics');
  fs.mkdirSync(topicsDir, { recursive: true });
  fs.writeFileSync(
    path.join(topicsDir, `${ticket}.json`),
    JSON.stringify({ id: ticket, messages: [{ seq: 0, ts: 1786050189124, author: 'swarm', type: 'outbound', text: `${ticket} ✅ done — x` }] })
  );
}

function writeChaserTelemetry(target, monthKey, lines) {
  const dir = path.join(target, '.swarmforge', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `chaser-${monthKey}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function recordLifecycle(ctx) {
  const out = execFileSync('node', [CLI, '--ticket', ctx.ticket, '--target', ctx.target], { encoding: 'utf8' });
  return JSON.parse(out);
}

function listFilesRecursive(dir) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^a coordinator with a lean ledger enabled for the current shift$/, (ctx) => {
    ctx.target = mkFixtureRepo();
    ctx.ticket = TICKET;
  });

  // ── shared When ─────────────────────────────────────────────────────
  registry.define(/^the coordinator records that ticket's lifecycle$/, (ctx) => {
    ctx.result = recordLifecycle(ctx);
  });

  // ── BL-819 stage-transition-appended-01 ────────────────────────────
  registry.define(/^a ticket that enters the coder stage and later leaves it$/, (ctx) => {
    ctx.dequeuedAt = '2026-08-07T08:05:00.000Z';
    ctx.completedAt = '2026-08-07T09:00:00.000Z';
    writeCompletedHandoff(ctx.target, ctx.ticket, {
      enqueued_at: '2026-08-07T08:00:00.000Z',
      dequeued_at: ctx.dequeuedAt,
      completed_at: ctx.completedAt,
    });
  });

  registry.define(/^the ledger holds one entry for the stage entry and one for the stage exit$/, (ctx) => {
    const events = readLeanLedgerEvents(ctx.target, ctx.ticket).filter((e) => e.type === 'stage_transition' && e.role === 'coder');
    if (events.length !== 2) {
      throw new Error(`expected 2 stage_transition events (entry + exit), got ${events.length}: ${JSON.stringify(events)}`);
    }
    ctx.stageEntry = events.find((e) => !('processingMs' in e.data));
    ctx.stageExit = events.find((e) => 'processingMs' in e.data);
    if (!ctx.stageEntry || !ctx.stageExit) {
      throw new Error(`expected one entry-marker (no processingMs) and one exit-marker (processingMs) event, got ${JSON.stringify(events)}`);
    }
  });

  registry.define(/^the entry carries the stage name, the parcel id, and the audit timestamps it was derived from$/, (ctx) => {
    for (const evt of [ctx.stageEntry, ctx.stageExit]) {
      if (evt.role !== 'coder') {
        throw new Error(`expected stage name "coder", got "${evt.role}"`);
      }
      if (evt.ticket !== ctx.ticket) {
        throw new Error(`expected parcel id ${ctx.ticket}, got ${evt.ticket}`);
      }
    }
    if (ctx.stageEntry.at !== ctx.dequeuedAt) {
      throw new Error(`expected the entry marker's timestamp to be ${ctx.dequeuedAt}, got ${ctx.stageEntry.at}`);
    }
    if (ctx.stageExit.at !== ctx.completedAt) {
      throw new Error(`expected the exit marker's timestamp to be ${ctx.completedAt}, got ${ctx.stageExit.at}`);
    }
  });

  registry.define(/^the ticket's dwell in that stage is derivable from those two entries alone$/, (ctx) => {
    const derivedDwellMs = Date.parse(ctx.stageExit.at) - Date.parse(ctx.stageEntry.at);
    const actualDwellMs = Date.parse(ctx.completedAt) - Date.parse(ctx.dequeuedAt);
    if (derivedDwellMs !== actualDwellMs) {
      throw new Error(`expected dwell derived from the two entries' own timestamps (${derivedDwellMs}ms) to equal the real dwell (${actualDwellMs}ms)`);
    }
  });

  // ── BL-819 bounce-recorded-with-blame-and-class-02 ─────────────────
  registry.define(/^a ticket bounced by (\S+) blaming (\S+) with class ([\w-]+)$/, (ctx, bouncingRole, blamedRole, failureClass) => {
    ctx.bounce = { bouncingRole, blamedRole, failureClass };
    ctx.evidence = `backlog/evidence/${ctx.ticket}-${bouncingRole}-20260807.md`;
    writeTicketYamlWithBounces(path.join(ctx.target, 'backlog', 'active'), ctx.ticket, [
      { at: '2026-08-07', by: bouncingRole, blamed: blamedRole, failureClass, commit: 'abc1234567', evidence: ctx.evidence },
    ]);
  });

  registry.define(/^the ledger holds a bounce entry naming that bouncing role, blamed role, and class$/, (ctx) => {
    const events = readLeanLedgerEvents(ctx.target, ctx.ticket).filter((e) => e.type === 'bounce');
    if (events.length !== 1) {
      throw new Error(`expected exactly 1 bounce event, got ${events.length}`);
    }
    ctx.bounceEvent = events[0];
    if (ctx.bounceEvent.data.by !== ctx.bounce.bouncingRole) {
      throw new Error(`expected bouncing role ${ctx.bounce.bouncingRole}, got ${ctx.bounceEvent.data.by}`);
    }
    if (ctx.bounceEvent.data.blamedRole !== ctx.bounce.blamedRole) {
      throw new Error(`expected blamed role ${ctx.bounce.blamedRole}, got ${ctx.bounceEvent.data.blamedRole}`);
    }
    if (ctx.bounceEvent.data.failureClass !== ctx.bounce.failureClass) {
      throw new Error(`expected failure class ${ctx.bounce.failureClass}, got ${ctx.bounceEvent.data.failureClass}`);
    }
  });

  registry.define(/^the entry points at the bounce evidence file rather than copying its text$/, (ctx) => {
    if (ctx.bounceEvent.data.evidence !== ctx.evidence) {
      throw new Error(`expected evidence pointer ${ctx.evidence}, got ${ctx.bounceEvent.data.evidence}`);
    }
    if (typeof ctx.bounceEvent.data.evidence !== 'string' || !ctx.bounceEvent.data.evidence.endsWith('.md')) {
      throw new Error('expected evidence to be a file path, not copied evidence text');
    }
  });

  // ── BL-819 skipped-stage-records-declared-reason-03 ────────────────
  registry.define(/^a ticket whose required_stages omits the cleaner$/, (ctx) => {
    ctx.skippedRole = 'cleaner';
  });

  registry.define(/^whose stage_skip_reasons explains why the cleaner was skipped$/, (ctx) => {
    ctx.skipReason = 'bounded single-lib change, no shared code touched';
    const dir = path.join(ctx.target, '.swarmforge');
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      'ticket-id': ctx.ticket,
      from: 'coder',
      to: 'architect',
      skipped: [ctx.skippedRole],
      reasons: { [ctx.skippedRole]: ctx.skipReason },
      sender: 'coder',
      created_at: '2026-08-07T09:00:00.000Z',
    };
    fs.appendFileSync(path.join(dir, 'routing-skips.jsonl'), JSON.stringify(entry) + '\n');
  });

  registry.define(/^the ledger marks the cleaner as skipped for that ticket$/, (ctx) => {
    const snapshot = readLeanLedgerSnapshot(ctx.target, ctx.ticket);
    ctx.cleanerSkip = snapshot.skips.find((s) => s.role === 'cleaner');
    if (!ctx.cleanerSkip) {
      throw new Error(`expected a skip entry for cleaner, got ${JSON.stringify(snapshot.skips)}`);
    }
  });

  registry.define(/^the recorded skip reason is the one the ticket declared$/, (ctx) => {
    if (ctx.cleanerSkip.reason !== ctx.skipReason) {
      throw new Error(`expected skip reason "${ctx.skipReason}", got "${ctx.cleanerSkip.reason}"`);
    }
  });

  // ── BL-819 close-outcome-appended-04 ───────────────────────────────
  registry.define(/^a ticket that QA approved and the coordinator moved to done$/, (ctx) => {
    execFileSync('git', ['init', '-q'], { cwd: ctx.target });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: ctx.target });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: ctx.target });
    writeDoneTicketAndTopic(ctx.target, ctx.ticket);
    execFileSync('git', ['add', '-A'], { cwd: ctx.target });
    execFileSync('git', ['commit', '-q', '-m', `close ${ctx.ticket}`], { cwd: ctx.target });
    ctx.approvedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.target, encoding: 'utf8' }).trim();
  });

  registry.define(/^the ledger holds a close entry naming the approved commit and the destination folder$/, (ctx) => {
    const closeEvt = readLeanLedgerEvents(ctx.target, ctx.ticket).find((e) => e.type === 'close');
    if (!closeEvt) {
      throw new Error('expected a close event');
    }
    ctx.closeEvent = closeEvt;
    if (closeEvt.data.commit !== ctx.approvedCommit) {
      throw new Error(`expected close commit ${ctx.approvedCommit}, got ${closeEvt.data.commit}`);
    }
    if (closeEvt.data.folder !== 'done') {
      throw new Error(`expected destination folder "done", got ${closeEvt.data.folder}`);
    }
  });

  registry.define(/^the ticket's full path through the pipeline is reconstructable from the ledger alone$/, (ctx) => {
    const snapshot = readLeanLedgerSnapshot(ctx.target, ctx.ticket);
    if (!snapshot.closed || snapshot.closedAt !== ctx.closeEvent.at) {
      throw new Error(`expected the snapshot to read closed=true at the close event's own timestamp, got ${JSON.stringify(snapshot)}`);
    }
  });

  // ── BL-819 idempotent-under-replay-05 ──────────────────────────────
  registry.define(/^a lifecycle event already recorded in the ledger$/, (ctx) => {
    ctx.dequeuedAt = '2026-08-07T08:05:00.000Z';
    ctx.completedAt = '2026-08-07T09:00:00.000Z';
    writeCompletedHandoff(ctx.target, ctx.ticket, { enqueued_at: '2026-08-07T08:00:00.000Z', dequeued_at: ctx.dequeuedAt, completed_at: ctx.completedAt });
    recordLifecycle(ctx);
    ctx.ledgerFile = leanLedgerFilePath(ctx.target, ctx.completedAt);
    ctx.ledgerTextBefore = fs.readFileSync(ctx.ledgerFile, 'utf8');
    ctx.snapshotBefore = readLeanLedgerSnapshot(ctx.target, ctx.ticket);
  });

  registry.define(/^the same event is recorded again after a hook re-run or a daemon restart$/, (ctx) => {
    recordLifecycle(ctx);
  });

  registry.define(/^the ledger is byte-identical to before the second append$/, (ctx) => {
    const after = fs.readFileSync(ctx.ledgerFile, 'utf8');
    if (after !== ctx.ledgerTextBefore) {
      throw new Error('expected the ledger file to be byte-identical after a redundant re-run');
    }
  });

  registry.define(/^the per-ticket snapshot is unchanged$/, (ctx) => {
    const after = readLeanLedgerSnapshot(ctx.target, ctx.ticket);
    if (JSON.stringify(after) !== JSON.stringify(ctx.snapshotBefore)) {
      throw new Error('expected the per-ticket snapshot to be unchanged after a redundant re-run');
    }
  });

  // ── BL-819 snapshot-is-a-pure-fold-06 ──────────────────────────────
  registry.define(/^a ticket with several lifecycle entries in the ledger$/, (ctx) => {
    writeCompletedHandoff(ctx.target, ctx.ticket, { enqueued_at: '2026-08-07T08:00:00.000Z', dequeued_at: '2026-08-07T08:05:00.000Z', completed_at: '2026-08-07T09:00:00.000Z' });
    writeTicketYamlWithBounces(path.join(ctx.target, 'backlog', 'active'), ctx.ticket, [
      { at: '2026-08-07', by: 'architect', blamed: 'coder', failureClass: 'behavior', commit: 'abc1234567', evidence: `backlog/evidence/${ctx.ticket}-architect-20260807.md` },
    ]);
    recordLifecycle(ctx);
  });

  registry.define(/^the per-ticket snapshot is rebuilt from the ledger from scratch$/, (ctx) => {
    const events = readLeanLedgerEvents(ctx.target, ctx.ticket);
    ctx.rebuiltSnapshot = foldLeanLedgerSnapshot(ctx.ticket, events);
    ctx.storedSnapshot = readLeanLedgerSnapshot(ctx.target, ctx.ticket);
  });

  registry.define(/^the rebuilt snapshot equals the stored snapshot$/, (ctx) => {
    if (JSON.stringify(ctx.rebuiltSnapshot) !== JSON.stringify(ctx.storedSnapshot)) {
      throw new Error(`expected the rebuilt snapshot to equal the stored one.\nrebuilt: ${JSON.stringify(ctx.rebuiltSnapshot)}\nstored: ${JSON.stringify(ctx.storedSnapshot)}`);
    }
  });

  registry.define(/^discarding the snapshot loses no information that the ledger does not still hold$/, (ctx) => {
    fs.rmSync(snapshotFilePath(ctx.target, ctx.ticket), { force: true });
    if (readLeanLedgerSnapshot(ctx.target, ctx.ticket) !== null) {
      throw new Error('expected the snapshot file to actually be gone before re-deriving');
    }
    const rebuiltAgain = foldLeanLedgerSnapshot(ctx.ticket, readLeanLedgerEvents(ctx.target, ctx.ticket));
    if (JSON.stringify(rebuiltAgain) !== JSON.stringify(ctx.storedSnapshot)) {
      throw new Error('expected the ledger alone to fully reconstruct the discarded snapshot');
    }
  });

  // ── BL-819 unsourced-field-is-absent-not-invented-07 ───────────────
  registry.define(/^a lifecycle aspect for which no shipped instrument records a value$/, (ctx) => {
    // A ticket closed with no git history anywhere in the fixture: the
    // approved commit genuinely has no instrument to source it from here
    // (composeCloseEvent's own degrade path - proven at the unit level).
    writeDoneTicketAndTopic(ctx.target, ctx.ticket);
  });

  registry.define(/^that field is absent from the ledger entry$/, (ctx) => {
    const closeEvt = readLeanLedgerEvents(ctx.target, ctx.ticket).find((e) => e.type === 'close');
    if (!closeEvt) {
      throw new Error('expected a close event even with no git history to source a commit from');
    }
    ctx.unsourcedCloseEvent = closeEvt;
    if ('commit' in closeEvt.data) {
      throw new Error(`expected "commit" to be absent with no git history, got ${JSON.stringify(closeEvt.data)}`);
    }
  });

  registry.define(/^no placeholder, estimate, or narrated value is written in its place$/, (ctx) => {
    if (Object.prototype.hasOwnProperty.call(ctx.unsourcedCloseEvent.data, 'commit')) {
      throw new Error('expected no "commit" key at all - not even an explicit null placeholder');
    }
  });

  // ── BL-819 stall-and-chase-recorded-08 ─────────────────────────────
  registry.define(/^a parcel that stalled long enough for handoffd to chase it$/, (ctx) => {
    writeCompletedHandoff(ctx.target, ctx.ticket, { enqueued_at: '2026-08-07T08:00:00.000Z', dequeued_at: '2026-08-07T08:05:00.000Z', completed_at: '2026-08-07T08:40:00.000Z' });
    ctx.nudgeAt = '2026-08-07T08:10:00.000Z';
    ctx.chaseAt = '2026-08-07T08:20:00.000Z';
    writeChaserTelemetry(ctx.target, '2026-08', [
      { type: 'nudge', role: 'coder', at: ctx.nudgeAt, count: 1 },
      { type: 'chase', role: 'coder', at: ctx.chaseAt, count: 2 },
    ]);
  });

  registry.define(/^the ledger holds a stall entry and a chase entry for that parcel$/, (ctx) => {
    const events = readLeanLedgerEvents(ctx.target, ctx.ticket).filter((e) => e.type === 'stall');
    ctx.stallEntry = events.find((e) => e.data.eventType === 'nudge');
    ctx.chaseEntry = events.find((e) => e.data.eventType === 'chase');
    if (!ctx.stallEntry) {
      throw new Error(`expected a stall (nudge) entry, got ${JSON.stringify(events)}`);
    }
    if (!ctx.chaseEntry) {
      throw new Error(`expected a chase entry, got ${JSON.stringify(events)}`);
    }
  });

  registry.define(/^each carries the timestamp it was observed at$/, (ctx) => {
    if (ctx.stallEntry.at !== ctx.nudgeAt) {
      throw new Error(`expected the stall entry's timestamp to be ${ctx.nudgeAt}, got ${ctx.stallEntry.at}`);
    }
    if (ctx.chaseEntry.at !== ctx.chaseAt) {
      throw new Error(`expected the chase entry's timestamp to be ${ctx.chaseAt}, got ${ctx.chaseEntry.at}`);
    }
  });

  // ── BL-819 shift-scoped-ledger-rolls-over-09 ───────────────────────
  registry.define(/^a ledger holding entries for the current shift$/, (ctx) => {
    ctx.day1At = '2026-08-07T10:00:00.000Z';
    appendLeanLedgerEventIfNew(ctx.target, { ticket: ctx.ticket, type: 'stall', source: 'chaser-telemetry', at: ctx.day1At, role: 'coder', data: { eventType: 'chase', count: 1 } });
    ctx.day1File = leanLedgerFilePath(ctx.target, ctx.day1At);
    ctx.day1TextBefore = fs.readFileSync(ctx.day1File, 'utf8');
  });

  registry.define(/^a new shift begins$/, (ctx) => {
    ctx.day2At = '2026-08-08T10:00:00.000Z';
    appendLeanLedgerEventIfNew(ctx.target, { ticket: ctx.ticket, type: 'stall', source: 'chaser-telemetry', at: ctx.day2At, role: 'coder', data: { eventType: 'chase', count: 2 } });
    ctx.day2File = leanLedgerFilePath(ctx.target, ctx.day2At);
  });

  registry.define(/^new entries are appended to the new shift's ledger$/, (ctx) => {
    if (ctx.day2File === ctx.day1File) {
      throw new Error('expected the new shift to roll over into a distinct ledger file');
    }
    const text = fs.readFileSync(ctx.day2File, 'utf8');
    if (!text.includes(ctx.day2At)) {
      throw new Error('expected the new day\'s file to hold the new event');
    }
  });

  registry.define(/^the previous shift's ledger is left intact and readable$/, (ctx) => {
    const text = fs.readFileSync(ctx.day1File, 'utf8');
    if (text !== ctx.day1TextBefore) {
      throw new Error('expected the previous shift\'s ledger file to be untouched by the new shift\'s append');
    }
  });

  // ── BL-819 coordinator-gains-no-new-power-10 ───────────────────────
  registry.define(/^the coordinator has recorded a full shift of lifecycle data$/, (ctx) => {
    writeCompletedHandoff(ctx.target, ctx.ticket, { enqueued_at: '2026-08-07T08:00:00.000Z', dequeued_at: '2026-08-07T08:05:00.000Z', completed_at: '2026-08-07T09:00:00.000Z' });
    ctx.filesBefore = new Set(listFilesRecursive(ctx.target));
  });

  registry.define(/^it acts on that data$/, (ctx) => {
    ctx.result = recordLifecycle(ctx);
  });

  registry.define(/^it may only report it or use powers it already held$/, (ctx) => {
    const newFiles = listFilesRecursive(ctx.target).filter((f) => !ctx.filesBefore.has(f));
    const outsideLean = newFiles.filter((f) => !f.includes(`${path.sep}.swarmforge${path.sep}lean${path.sep}`));
    if (outsideLean.length > 0) {
      throw new Error(`expected recording a ticket's lifecycle to write only under .swarmforge/lean/, also wrote: ${JSON.stringify(outsideLean)}`);
    }
  });

  registry.define(/^it authors no domain spec and edits no constitution article$/, (ctx) => {
    const forbidden = listFilesRecursive(ctx.target).filter(
      (f) => f.includes(`${path.sep}backlog${path.sep}paused${path.sep}`) || f.includes(`${path.sep}swarmforge${path.sep}constitution${path.sep}`)
    );
    if (forbidden.length > 0) {
      throw new Error(`expected no writes under backlog/paused/ or swarmforge/constitution/, found: ${JSON.stringify(forbidden)}`);
    }
  });
}

module.exports = { registerSteps };
