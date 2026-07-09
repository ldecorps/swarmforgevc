const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  computeMeanTicketTime,
  computeBusyness,
  computeRetries,
  computeSwarmMetrics,
  computeChaserTelemetry,
} = require('../out/metrics/swarmMetrics');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-metrics-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
}

// --- computeMeanTicketTime (BL-071 swarm-metrics-02) ---

test('computeMeanTicketTime derives duration from the active -> done git history', () => {
  const repo = mkTmp();
  initRepo(repo);

  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-101.yaml'), 'id: BL-101\ntitle: t\nstatus: active\nmilestone: M4\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-101'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done', 'M4'));
  git(repo, ['mv', 'backlog/active/BL-101.yaml', 'backlog/done/M4/BL-101.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-101'], '2026-07-02T12:00:00');

  const result = computeMeanTicketTime(repo);

  assert.equal(result.sampleCount, 1);
  assert.equal(result.meanMs, 4 * 60 * 60 * 1000);
});

test('computeMeanTicketTime averages multiple closed tickets and ignores still-active ones', () => {
  const repo = mkTmp();
  initRepo(repo);

  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-101.yaml'), 'id: BL-101\ntitle: t\nstatus: active\nmilestone: M4\n');
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-102.yaml'), 'id: BL-102\ntitle: t\nstatus: active\nmilestone: M4\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote both'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done', 'M4'));
  git(repo, ['mv', 'backlog/active/BL-101.yaml', 'backlog/done/M4/BL-101.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-101'], '2026-07-02T12:00:00');
  git(repo, ['mv', 'backlog/active/BL-102.yaml', 'backlog/done/M4/BL-102.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-102'], '2026-07-02T09:30:00');

  // Both promoted together at 08:00: BL-101 closes at 12:00 (4h), BL-102
  // closes at 09:30 (1.5h) -> mean 2.75h.
  const result = computeMeanTicketTime(repo);
  assert.equal(result.sampleCount, 2);
  const expectedMean = ((4 * 60) + (1.5 * 60)) / 2 * 60 * 1000;
  assert.equal(result.meanMs, expectedMean);
});

test('computeMeanTicketTime returns null mean and zero sample count on a fresh repo with no closed tickets', () => {
  const repo = mkTmp();
  initRepo(repo);
  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-200.yaml'), 'id: BL-200\ntitle: t\nstatus: active\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote'], '2026-07-02T08:00:00');

  const result = computeMeanTicketTime(repo);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.meanMs, null);
});

test('computeMeanTicketTime includes a done ticket closed flat in backlog/done/ with no milestone', () => {
  const repo = mkTmp();
  initRepo(repo);

  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-103.yaml'), 'id: BL-103\ntitle: t\nstatus: active\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-103'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-103.yaml', 'backlog/done/BL-103.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-103'], '2026-07-02T10:00:00');

  const result = computeMeanTicketTime(repo);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.meanMs, 2 * 60 * 60 * 1000);
});

// --- computeBusyness (BL-071 swarm-metrics-03) ---

function writeHandoff(dir, filename, headers) {
  mkdirp(dir);
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(path.join(dir, filename), lines + '\n\nbody\n');
}

test('computeBusyness reflects completed intervals plus the open in_process interval', () => {
  const target = mkTmp();
  const coderWt = path.join(target, 'coder-wt');
  const completedDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const inProcessDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process');

  const runStart = Date.parse('2026-07-02T00:00:00Z');
  const now = runStart + 6 * 60 * 60 * 1000; // 6h run

  // 3 hours of completed work
  writeHandoff(completedDir, '00_a.handoff', {
    dequeued_at: new Date(runStart).toISOString(),
    completed_at: new Date(runStart + 3 * 60 * 60 * 1000).toISOString(),
  });
  // open in_process interval covering the last 1 hour
  writeHandoff(inProcessDir, '00_b.handoff', {
    dequeued_at: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
  });

  const busyness = computeBusyness([{ role: 'coder', worktreePath: coderWt }], runStart, now);

  assert.ok(Math.abs(busyness.coder - (4 / 6)) < 0.01, `expected ~66%, got ${busyness.coder}`);
});

test('computeBusyness shows 0 for a role with empty completed/ and in_process/', () => {
  const target = mkTmp();
  const cleanerWt = path.join(target, 'cleaner-wt');
  mkdirp(path.join(cleanerWt, '.swarmforge', 'handoffs', 'inbox', 'completed'));
  mkdirp(path.join(cleanerWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'));

  const runStart = Date.now() - 6 * 60 * 60 * 1000;
  const busyness = computeBusyness([{ role: 'cleaner', worktreePath: cleanerWt }], runStart, Date.now());

  assert.equal(busyness.cleaner, 0);
});

// --- computeRetries (BL-071 swarm-metrics-04) ---

test('computeRetries counts only backward git_handoffs, not forward handoffs or notes', () => {
  const target = mkTmp();
  const qaWt = path.join(target, 'qa-wt');
  const coderWt = path.join(target, 'coder-wt');
  const specifierWt = path.join(target, 'specifier-wt');

  writeHandoff(path.join(qaWt, '.swarmforge', 'handoffs', 'sent'), '00_a.handoff', {
    type: 'git_handoff',
    from: 'QA',
    to: 'coder',
    task: 'BL-101-fix',
  });
  writeHandoff(path.join(coderWt, '.swarmforge', 'handoffs', 'sent'), '00_b.handoff', {
    type: 'git_handoff',
    from: 'coder',
    to: 'cleaner',
    task: 'BL-101-fix',
  });
  writeHandoff(path.join(specifierWt, '.swarmforge', 'handoffs', 'sent'), '00_c.handoff', {
    type: 'note',
    from: 'specifier',
    to: 'coordinator',
    message: 'fyi',
  });

  const roles = [
    { role: 'QA', worktreePath: qaWt },
    { role: 'coder', worktreePath: coderWt },
    { role: 'specifier', worktreePath: specifierWt },
  ];

  const { total, perTicket } = computeRetries(roles);

  assert.equal(total, 1);
  assert.equal(perTicket['BL-101'], 1);
});

// --- computeSwarmMetrics (BL-071 swarm-metrics-05: fresh run placeholders) ---

test('computeRetries counts multiple backward recipients per file', () => {
  const target = mkTmp();
  const qaWt = path.join(target, 'qa-wt');

  writeHandoff(path.join(qaWt, '.swarmforge', 'handoffs', 'sent'), '00_multi.handoff', {
    type: 'git_handoff',
    from: 'QA',
    to: 'coder, cleaner, specifier',
    task: 'BL-102-multi',
  });

  const { total, perTicket } = computeRetries([{ role: 'QA', worktreePath: qaWt }]);

  assert.equal(total, 3, 'should count 3 backward recipients');
  assert.equal(perTicket['BL-102'], 3);
});

test('computeRetries handles malformed handoff files gracefully', () => {
  const target = mkTmp();
  const specifierWt = path.join(target, 'specifier-wt');
  const sentDir = path.join(specifierWt, '.swarmforge', 'handoffs', 'sent');

  mkdirp(sentDir);
  fs.writeFileSync(path.join(sentDir, '00_broken.handoff'), 'garbage data');

  const { total, perTicket } = computeRetries([{ role: 'specifier', worktreePath: specifierWt }]);

  assert.equal(total, 0);
  assert.deepEqual(perTicket, {});
});

test('computeRetries ignores unknown role names', () => {
  const target = mkTmp();
  const unknownWt = path.join(target, 'unknown-wt');

  writeHandoff(path.join(unknownWt, '.swarmforge', 'handoffs', 'sent'), '00_bad.handoff', {
    type: 'git_handoff',
    from: 'unknown_role',
    to: 'coder',
    task: 'BL-103',
  });

  const { total } = computeRetries([{ role: 'unknown_role', worktreePath: unknownWt }]);

  assert.equal(total, 0);
});

test('computeBusyness handles missing directories gracefully', () => {
  const target = mkTmp();
  const missingWt = path.join(target, 'missing-wt');

  const runStart = Date.now() - 6 * 60 * 60 * 1000;
  const busyness = computeBusyness([{ role: 'missing', worktreePath: missingWt }], runStart, Date.now());

  assert.equal(busyness.missing, 0);
});

test('computeBusyness handles in_process batch directories', () => {
  const target = mkTmp();
  const coderWt = path.join(target, 'coder-wt');
  const batchDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process', 'batch_20260702T000000Z_000001');

  mkdirp(batchDir);
  writeHandoff(batchDir, '00_batch.handoff', {
    dequeued_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  });

  const now = Date.now();
  const runStart = now - 60 * 60 * 1000;
  const busyness = computeBusyness([{ role: 'coder', worktreePath: coderWt }], runStart, now);

  assert.ok(busyness.coder > 0, 'should account for batch interval');
});

test('computeBusyness ignores an in_process handoff missing a dequeued_at header', () => {
  const target = mkTmp();
  const coderWt = path.join(target, 'coder-wt');
  const inProcessDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process');

  // No dequeued_at header at all - should be skipped, not crash or NaN the interval.
  writeHandoff(inProcessDir, '00_a.handoff', { from: 'architect', to: 'coder' });

  const now = Date.now();
  const runStart = now - 60 * 60 * 1000;
  const busyness = computeBusyness([{ role: 'coder', worktreePath: coderWt }], runStart, now);

  assert.equal(busyness.coder, 0);
});

test('computeBusyness skips an unreadable in_process entry without throwing', () => {
  const target = mkTmp();
  const coderWt = path.join(target, 'coder-wt');
  const inProcessDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  mkdirp(inProcessDir);
  // A directory entry that is neither a real batch dir nor a readable file by
  // the time it's statted a second time is simulated by a broken symlink.
  fs.symlinkSync(path.join(inProcessDir, 'does-not-exist'), path.join(inProcessDir, 'broken.handoff'));

  const now = Date.now();
  const runStart = now - 60 * 60 * 1000;

  assert.doesNotThrow(() => computeBusyness([{ role: 'coder', worktreePath: coderWt }], runStart, now));
});

test('computeBusyness skips an in_process handoff it cannot read (permission denied)', () => {
  const target = mkTmp();
  const coderWt = path.join(target, 'coder-wt');
  const inProcessDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const filePath = path.join(inProcessDir, '00_unreadable.handoff');
  writeHandoff(inProcessDir, '00_unreadable.handoff', {
    dequeued_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  });
  fs.chmodSync(filePath, 0o000);

  const now = Date.now();
  const runStart = now - 60 * 60 * 1000;

  try {
    assert.doesNotThrow(() => computeBusyness([{ role: 'coder', worktreePath: coderWt }], runStart, now));
  } finally {
    fs.chmodSync(filePath, 0o644); // restore so the tmp dir can be cleaned up
  }
});

test('computeBusyness takes the earliest dequeued_at across multiple open in_process entries', () => {
  const target = mkTmp();
  const coderWt = path.join(target, 'coder-wt');
  const inProcessDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const now = Date.now();
  const runStart = now - 6 * 60 * 60 * 1000;

  // Later-dequeued entry first, earlier-dequeued entry second - the earlier
  // one must win so the open interval is measured from it, not whichever
  // file happened to sort first.
  writeHandoff(inProcessDir, '00_later.handoff', {
    dequeued_at: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
  });
  writeHandoff(inProcessDir, '00_earlier.handoff', {
    dequeued_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
  });

  const busyness = computeBusyness([{ role: 'coder', worktreePath: coderWt }], runStart, now);

  assert.ok(Math.abs(busyness.coder - (3 / 6)) < 0.01, `expected ~50%, got ${busyness.coder}`);
});

test('computeSwarmMetrics returns placeholders on a fresh run, never NaN/Infinity', () => {
  const target = mkTmp();
  initRepo(target);
  mkdirp(path.join(target, 'backlog', 'active'));
  git(target, ['add', '-A']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);

  const coderWt = path.join(target, 'coder-wt');
  mkdirp(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'completed'));
  mkdirp(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'));

  const result = computeSwarmMetrics(target, [{ role: 'coder', worktreePath: coderWt }], null, Date.now());

  assert.equal(result.meanTicketTimeMs, null);
  assert.equal(result.ticketSampleCount, 0);
  assert.equal(result.busyness.coder, 0);
  assert.equal(result.retryTotal, 0);
  assert.deepEqual(result.retryByTicket, {});
  assert.deepEqual(result.suiteDuration, { latestMs: null, meanMs: null, sampleCount: 0, warn: false });
  assert.deepEqual(result.chaserTelemetry.coder, { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 });

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /NaN|Infinity/);
});

// BL-078: computeSwarmMetrics plumbs its suiteWarnSeconds param straight
// through to computeSuiteDuration's warn threshold.
test('computeSwarmMetrics honors a custom suiteWarnSeconds threshold', () => {
  const target = mkTmp();
  initRepo(target);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);
  mkdirp(path.join(target, 'extension'));
  fs.writeFileSync(
    path.join(target, 'extension', '.test-durations.jsonl'),
    JSON.stringify({ finished_at: '2026-07-03T10:00:00Z', test_count: 1, result: 'pass', duration_ms: 50000 }) + '\n'
  );

  const lenient = computeSwarmMetrics(target, [], null, Date.now(), 60);
  assert.equal(lenient.suiteDuration.warn, false, '50s is under a 60s threshold');

  const strict = computeSwarmMetrics(target, [], null, Date.now(), 10);
  assert.equal(strict.suiteDuration.warn, true, '50s exceeds a 10s threshold');
});

// ── BL-098: computeChaserTelemetry ────────────────────────────────────────

function writeTelemetryLine(target, month, event) {
  const dir = path.join(target, '.swarmforge', 'telemetry');
  mkdirp(dir);
  fs.appendFileSync(path.join(dir, `chaser-${month}.jsonl`), JSON.stringify(event) + '\n');
}

test('telemetry-05: no telemetry directory reads as zero for every role, without error', () => {
  const target = mkTmp();
  const telemetry = computeChaserTelemetry(target, ['coder', 'cleaner'], Date.now());
  assert.deepEqual(telemetry, {
    coder: { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 },
    cleaner: { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 },
  });
});

test('telemetry-04: reports per-role totals matching the logged events', () => {
  const target = mkTmp();
  const now = Date.parse('2026-07-09T12:00:00Z');
  writeTelemetryLine(target, '2026-07', { type: 'chase', role: 'coder', handoffId: 'a.handoff', count: 1, at: '2026-07-09T10:00:00Z' });
  writeTelemetryLine(target, '2026-07', { type: 'chase', role: 'coder', handoffId: 'a.handoff', count: 2, at: '2026-07-09T11:00:00Z' });
  writeTelemetryLine(target, '2026-07', { type: 'nudge', role: 'coder', handoffId: 'b.handoff', count: 1, at: '2026-07-09T11:30:00Z' });
  writeTelemetryLine(target, '2026-07', { type: 'dead-letter', role: 'coder', handoffId: 'c.handoff', count: 3, at: '2026-07-09T11:45:00Z' });
  writeTelemetryLine(target, '2026-07', { type: 'respawn', role: 'coder', handoffId: 'd.handoff', count: 3, at: '2026-07-09T11:50:00Z' });
  writeTelemetryLine(target, '2026-07', { type: 'chase', role: 'cleaner', handoffId: 'e.handoff', count: 1, at: '2026-07-09T11:55:00Z' });

  const telemetry = computeChaserTelemetry(target, ['coder', 'cleaner'], now, 1);

  assert.equal(telemetry.coder.chases, 2);
  assert.equal(telemetry.coder.nudges, 1);
  assert.equal(telemetry.coder.deadLetters, 1);
  assert.equal(telemetry.coder.respawns, 1);
  // 1-day window, all 3 chase/nudge events for coder fall within it: 3/1 = 3.
  assert.equal(telemetry.coder.recentDailyRate, 3);
  assert.equal(telemetry.cleaner.chases, 1);
});

test('telemetry: events reads across multiple monthly telemetry files', () => {
  const target = mkTmp();
  writeTelemetryLine(target, '2026-06', { type: 'chase', role: 'coder', handoffId: 'x.handoff', count: 1, at: '2026-06-30T00:00:00Z' });
  writeTelemetryLine(target, '2026-07', { type: 'chase', role: 'coder', handoffId: 'y.handoff', count: 2, at: '2026-07-01T00:00:00Z' });

  const telemetry = computeChaserTelemetry(target, ['coder'], Date.parse('2026-07-09T00:00:00Z'));
  assert.equal(telemetry.coder.chases, 2);
});

test('telemetry: events outside the recent window do not inflate the daily rate', () => {
  const target = mkTmp();
  const now = Date.parse('2026-07-09T00:00:00Z');
  writeTelemetryLine(target, '2026-06', { type: 'chase', role: 'coder', handoffId: 'old.handoff', count: 1, at: '2026-06-01T00:00:00Z' });

  const telemetry = computeChaserTelemetry(target, ['coder'], now, 7);
  assert.equal(telemetry.coder.chases, 1, 'old event still counts toward the lifetime total');
  assert.equal(telemetry.coder.recentDailyRate, 0, 'but not toward the recent-window rate');
});

test('telemetry: an unrecognized event type is ignored, not an error (forward-compatible schema)', () => {
  const target = mkTmp();
  writeTelemetryLine(target, '2026-07', { type: 'stage-transition', role: 'coder', at: '2026-07-09T10:00:00Z' });
  writeTelemetryLine(target, '2026-07', { type: 'chase', role: 'coder', handoffId: 'a.handoff', count: 1, at: '2026-07-09T10:00:00Z' });

  const telemetry = computeChaserTelemetry(target, ['coder'], Date.parse('2026-07-09T12:00:00Z'));
  assert.equal(telemetry.coder.chases, 1);
});

test('telemetry: a malformed JSON line is skipped, never a crash', () => {
  const target = mkTmp();
  const dir = path.join(target, '.swarmforge', 'telemetry');
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, 'chaser-2026-07.jsonl'), 'not json\n' + JSON.stringify({ type: 'chase', role: 'coder', at: '2026-07-09T10:00:00Z' }) + '\n');

  const telemetry = computeChaserTelemetry(target, ['coder'], Date.parse('2026-07-09T12:00:00Z'));
  assert.equal(telemetry.coder.chases, 1);
});

test('telemetry: an event for a role not in the current roleNames list is ignored', () => {
  const target = mkTmp();
  writeTelemetryLine(target, '2026-07', { type: 'chase', role: 'retired-role', handoffId: 'a.handoff', at: '2026-07-09T10:00:00Z' });

  const telemetry = computeChaserTelemetry(target, ['coder'], Date.parse('2026-07-09T12:00:00Z'));
  assert.equal(telemetry.coder.chases, 0);
  assert.equal(Object.keys(telemetry).includes('retired-role'), false);
});
