const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  computeMeanTicketTime,
  computeBusyness,
  computeRetries,
  computeSwarmMetrics,
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

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /NaN|Infinity/);
});
