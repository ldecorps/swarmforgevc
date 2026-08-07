const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  composeStageTransitionEvents,
  composeBounceEvents,
  composeStageSkipEvents,
  composeStallEvents,
  composeCloseEvent,
  composeAllLeanLedgerEvents,
} = require('../out/metrics/leanLedgerCompose');
const { formatBounceHistoryEntry } = require('../out/quality/bounceHistory');

// BL-819: each composer reads ONE already-shipping instrument and maps it
// to LeanLedgerEvent[] for a single ticket - reuse before invent (no new
// producer is written here, only readers over what already exists on disk).

function mkTmp() {
  return mkTmpDir('sfvc-lean-ledger-compose-');
}

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n\nbody\n');
}

function completedDir(worktree, role) {
  return path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed');
}

// ── composeStageTransitionEvents (stage-dwell) ──────────────────────────

test('composeStageTransitionEvents maps this ticket\'s completed handoffs across roles into a stage-entry and a stage-exit event each', () => {
  const coderWt = mkTmp();
  const cleanerWt = mkTmp();
  writeHandoff(completedDir(coderWt), '00_a.handoff', { task: 'BL-819-x', enqueued_at: '2026-08-07T08:00:00Z', dequeued_at: '2026-08-07T08:05:00Z', completed_at: '2026-08-07T09:00:00Z' });
  writeHandoff(completedDir(cleanerWt), '00_b.handoff', { task: 'BL-819-x', enqueued_at: '2026-08-07T09:00:00Z', dequeued_at: '2026-08-07T09:02:00Z', completed_at: '2026-08-07T09:30:00Z' });
  const roles = [
    { role: 'coder', worktreeName: 'coder', worktreePath: coderWt },
    { role: 'cleaner', worktreeName: 'cleaner', worktreePath: cleanerWt },
  ];
  const events = composeStageTransitionEvents(roles, 'BL-819');
  assert.equal(events.length, 4);
  assert.equal(events.every((e) => e.type === 'stage_transition' && e.source === 'stage-dwell' && e.ticket === 'BL-819'), true);
  assert.deepEqual([...new Set(events.map((e) => e.role))].sort(), ['cleaner', 'coder']);

  const coderEvents = events.filter((e) => e.role === 'coder');
  assert.equal(coderEvents.length, 2);
  const coderEntry = coderEvents.find((e) => !('processingMs' in e.data));
  const coderExit = coderEvents.find((e) => 'processingMs' in e.data);
  assert.ok(coderEntry, 'expected a stage-entry event with no processingMs key');
  assert.ok(coderExit, 'expected a stage-exit event carrying processingMs');
  assert.equal(coderEntry.at, '2026-08-07T08:05:00.000Z');
  assert.equal(coderExit.at, '2026-08-07T09:00:00.000Z');
  assert.equal(coderExit.data.processingMs, 55 * 60 * 1000);
  // dwell is derivable from the pair's own `at` values alone, with no
  // separately-stored dwell figure needed on either event.
  assert.equal(Date.parse(coderExit.at) - Date.parse(coderEntry.at), coderExit.data.processingMs);
});

test('composeStageTransitionEvents excludes other tickets\' handoffs', () => {
  const wt = mkTmp();
  writeHandoff(completedDir(wt), '00_a.handoff', { task: 'BL-1-x', dequeued_at: '2026-08-07T08:00:00Z', completed_at: '2026-08-07T08:10:00Z' });
  const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: wt }];
  assert.deepEqual(composeStageTransitionEvents(roles, 'BL-819'), []);
});

// ── composeBounceEvents (ticket YAML's own bounce_history) ─────────────

function writeTicketYamlWithBounces(dir, ticket, entries) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`id: ${ticket}`, 'title: "x"', `bounce_count: ${entries.length}`, 'bounce_history:', ...entries.map(formatBounceHistoryEntry)];
  fs.writeFileSync(path.join(dir, `${ticket}-x.yaml`), lines.join('\n') + '\n');
}

test('composeBounceEvents maps this ticket\'s own bounce_history, including its evidence pointer, excluding other tickets\' files', () => {
  const target = mkTmp();
  writeTicketYamlWithBounces(path.join(target, 'backlog', 'active'), 'BL-819', [
    { at: '2026-08-07', by: 'architect', blamed: 'coder', failureClass: 'behavior', commit: 'abc1234567', evidence: 'backlog/evidence/BL-819-architect-20260807.md' },
  ]);
  writeTicketYamlWithBounces(path.join(target, 'backlog', 'active'), 'BL-820', [
    { at: '2026-08-07', by: 'QA', blamed: 'coder', failureClass: 'unit', commit: 'def1234567', evidence: 'backlog/evidence/BL-820-qa-20260807.md' },
  ]);
  const events = composeBounceEvents(target, 'BL-819');
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'bounce-store');
  assert.equal(events[0].type, 'bounce');
  assert.equal(events[0].at, '2026-08-07T00:00:00.000Z');
  assert.equal(events[0].data.by, 'architect');
  assert.equal(events[0].data.blamedRole, 'coder');
  assert.equal(events[0].data.failureClass, 'behavior');
  assert.equal(events[0].data.commit, 'abc1234567');
  assert.equal(events[0].data.evidence, 'backlog/evidence/BL-819-architect-20260807.md');
});

test('composeBounceEvents finds a closed ticket\'s bounce_history nested under backlog/done/<milestone>/', () => {
  const target = mkTmp();
  writeTicketYamlWithBounces(path.join(target, 'backlog', 'done', 'M8'), 'BL-819', [
    { at: '2026-08-06', by: 'QA', blamed: 'coder', failureClass: 'compile', commit: 'deadbeef00', evidence: 'backlog/evidence/BL-819-qa-20260806.md' },
  ]);
  const events = composeBounceEvents(target, 'BL-819');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.evidence, 'backlog/evidence/BL-819-qa-20260806.md');
});

test('composeBounceEvents returns empty for a ticket with no YAML record anywhere', () => {
  const target = mkTmp();
  assert.deepEqual(composeBounceEvents(target, 'BL-819'), []);
});

// ── composeStageSkipEvents (routing-skip-log) ───────────────────────────

test('composeStageSkipEvents expands a routing-skips.jsonl entry into one event per skipped role, with its own reason', () => {
  const coderWt = mkTmp();
  const entry = {
    'ticket-id': 'BL-819',
    from: 'coder',
    to: 'architect',
    skipped: ['cleaner'],
    reasons: { cleaner: 'bounded single-lib change' },
    sender: 'coder',
    created_at: '2026-08-07T09:00:00.000Z',
  };
  fs.mkdirSync(path.join(coderWt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(coderWt, '.swarmforge', 'routing-skips.jsonl'), JSON.stringify(entry) + '\n');
  const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: coderWt }];
  const events = composeStageSkipEvents(roles, 'BL-819');
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'routing-skip-log');
  assert.equal(events[0].type, 'stage_skip');
  assert.equal(events[0].role, 'cleaner');
  assert.equal(events[0].data.reason, 'bounded single-lib change');
  assert.equal(events[0].at, '2026-08-07T09:00:00.000Z');
});

test('composeStageSkipEvents handles a skip with no declared reason (empty string, never fabricated text)', () => {
  const wt = mkTmp();
  const entry = { 'ticket-id': 'BL-819', from: 'coder', to: 'QA', skipped: ['documenter'], reasons: {}, sender: 'coder', created_at: '2026-08-07T09:00:00.000Z' };
  fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.swarmforge', 'routing-skips.jsonl'), JSON.stringify(entry) + '\n');
  const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: wt }];
  const events = composeStageSkipEvents(roles, 'BL-819');
  assert.equal(events[0].data.reason, '');
});

test('composeStageSkipEvents ignores a missing routing-skips.jsonl and a malformed line', () => {
  const wt = mkTmp();
  fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.swarmforge', 'routing-skips.jsonl'), 'not json\n');
  const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: wt }, { role: 'cleaner', worktreeName: 'cleaner', worktreePath: mkTmp() }];
  assert.deepEqual(composeStageSkipEvents(roles, 'BL-819'), []);
});

// ── composeStallEvents (chaser-telemetry, time-window correlated) ──────

function writeChaserTelemetry(mainWorktreePath, monthKey, lines) {
  const dir = path.join(mainWorktreePath, '.swarmforge', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `chaser-${monthKey}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('composeStallEvents attributes a chase event to the one ticket whose queue window contains it', () => {
  const main = mkTmp();
  writeHandoff(completedDir(main), '00_a.handoff', { task: 'BL-819-x', enqueued_at: '2026-08-07T08:00:00Z', dequeued_at: '2026-08-07T08:20:00Z', completed_at: '2026-08-07T08:30:00Z' });
  writeChaserTelemetry(main, '2026-08', [{ type: 'chase', role: 'coder', at: '2026-08-07T08:10:00.000Z', count: 1 }]);
  const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: main }];
  const events = composeStallEvents(main, roles, 'BL-819');
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'chaser-telemetry');
  assert.equal(events[0].type, 'stall');
  assert.equal(events[0].role, 'coder');
  assert.equal(events[0].data.eventType, 'chase');
  assert.equal(events[0].data.count, 1);
});

test('composeStallEvents excludes a chase event whose timestamp falls outside every window for that role', () => {
  const main = mkTmp();
  writeHandoff(completedDir(main), '00_a.handoff', { task: 'BL-819-x', enqueued_at: '2026-08-07T08:00:00Z', dequeued_at: '2026-08-07T08:20:00Z', completed_at: '2026-08-07T08:30:00Z' });
  writeChaserTelemetry(main, '2026-08', [{ type: 'chase', role: 'coder', at: '2026-08-07T09:00:00.000Z', count: 1 }]);
  const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: main }];
  assert.deepEqual(composeStallEvents(main, roles, 'BL-819'), []);
});

test('composeStallEvents skips (never guesses) a chase event whose timestamp falls inside two different tickets\' overlapping windows for the same role', () => {
  const main = mkTmp();
  writeHandoff(completedDir(main), '00_a.handoff', { task: 'BL-819-x', enqueued_at: '2026-08-07T08:00:00Z', dequeued_at: '2026-08-07T08:20:00Z', completed_at: '2026-08-07T09:00:00Z' });
  writeHandoff(completedDir(main), '00_b.handoff', { task: 'BL-820-y', enqueued_at: '2026-08-07T08:05:00Z', dequeued_at: '2026-08-07T08:25:00Z', completed_at: '2026-08-07T08:50:00Z' });
  writeChaserTelemetry(main, '2026-08', [{ type: 'chase', role: 'cleaner', at: '2026-08-07T08:15:00.000Z', count: 1 }]);
  const roles = [{ role: 'cleaner', worktreeName: 'cleaner', worktreePath: main }];
  assert.deepEqual(composeStallEvents(main, roles, 'BL-819'), []);
});

// ── composeCloseEvent (backlog-close) ───────────────────────────────────

function writeTicketYaml(dir, ticket) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ticket}-x.yaml`), `id: ${ticket}\ntitle: "x"\n`);
}

function writeTopic(target, ticket, messages) {
  fs.mkdirSync(path.join(target, 'backlog', 'topics'), { recursive: true });
  fs.writeFileSync(path.join(target, 'backlog', 'topics', `${ticket}.json`), JSON.stringify({ id: ticket, messages }));
}

test('composeCloseEvent finds a ticket sitting in backlog/done/ and dates the close from its own topic\'s done message', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-819');
  writeTopic(target, 'BL-819', [
    { seq: 0, ts: 1786040339921, author: 'swarm', type: 'outbound', text: 'BL-819 🎵 in progress — x' },
    { seq: 1, ts: 1786050189124, author: 'swarm', type: 'outbound', text: 'BL-819 ✅ done — x' },
  ]);
  const event = composeCloseEvent(target, 'BL-819');
  assert.ok(event);
  assert.equal(event.source, 'backlog-close');
  assert.equal(event.type, 'close');
  assert.equal(event.data.folder, 'done');
  assert.equal(event.at, new Date(1786050189124).toISOString());
});

test('composeCloseEvent names the approved commit - the real commit that added the ticket\'s file to backlog/done/', () => {
  const target = mkTmp();
  execFileSync('git', ['init', '-q'], { cwd: target });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: target });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: target });
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-819');
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'close BL-819'], { cwd: target });
  const approvedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8' }).trim();
  writeTopic(target, 'BL-819', [{ seq: 0, ts: 1786050189124, author: 'swarm', type: 'outbound', text: 'BL-819 ✅ done — x' }]);
  const event = composeCloseEvent(target, 'BL-819');
  assert.ok(event);
  assert.equal(event.data.commit, approvedCommit);
});

test('composeCloseEvent omits commit (never invents one) when the fixture has no git history to read it from', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-819');
  writeTopic(target, 'BL-819', [{ seq: 0, ts: 1786050189124, author: 'swarm', type: 'outbound', text: 'BL-819 ✅ done — x' }]);
  const event = composeCloseEvent(target, 'BL-819');
  assert.ok(event);
  assert.equal('commit' in event.data, false);
});

test('composeCloseEvent finds a ticket nested under backlog/done/<milestone>/', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done', 'M8'), 'BL-819');
  writeTopic(target, 'BL-819', [{ seq: 0, ts: 1786050189124, author: 'swarm', type: 'outbound', text: 'BL-819 ✅ done — x' }]);
  const event = composeCloseEvent(target, 'BL-819');
  assert.ok(event);
  assert.equal(event.data.folder, 'done');
});

test('composeCloseEvent returns null for a ticket not (yet) in backlog/done/ - never fabricates a close', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'active'), 'BL-819');
  assert.equal(composeCloseEvent(target, 'BL-819'), null);
});

test('composeCloseEvent returns null when the ticket is in done/ but its topic has no done message to date the close from', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-819');
  writeTopic(target, 'BL-819', [{ seq: 0, ts: 1786040339921, author: 'swarm', type: 'outbound', text: 'BL-819 🎵 in progress — x' }]);
  assert.equal(composeCloseEvent(target, 'BL-819'), null);
});

// ── composeAllLeanLedgerEvents (orchestrator) ───────────────────────────

test('composeAllLeanLedgerEvents unions every composer\'s output for one ticket', () => {
  const target = mkTmp();
  writeHandoff(completedDir(target), '00_a.handoff', { task: 'BL-819-x', enqueued_at: '2026-08-07T08:00:00Z', dequeued_at: '2026-08-07T08:05:00Z', completed_at: '2026-08-07T08:10:00Z' });
  writeTicketYamlWithBounces(path.join(target, 'backlog', 'done'), 'BL-819', [
    { at: '2026-08-07', by: 'architect', blamed: 'coder', failureClass: 'behavior', commit: 'abc1234567', evidence: 'backlog/evidence/BL-819-architect-20260807.md' },
  ]);
  writeTopic(target, 'BL-819', [{ seq: 0, ts: 1786050189124, author: 'swarm', type: 'outbound', text: 'BL-819 ✅ done — x' }]);
  const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: target }];
  const events = composeAllLeanLedgerEvents(target, roles, 'BL-819');
  assert.deepEqual(
    events.map((e) => e.type).sort(),
    ['bounce', 'close', 'stage_transition', 'stage_transition'].sort()
  );
});
