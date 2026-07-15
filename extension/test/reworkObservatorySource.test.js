const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadCompletedTicketRecords, latestReworkRoleByTicket } = require('../out/metrics/reworkObservatorySource');

function mkTmp() {
  return mkTmpDir('sfvc-rework-source-');
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

// Explicit `checkout -b main` regardless of the host's init.defaultBranch,
// so every fixture has a real branch literally named "main" - the ref
// loadCompletedTicketRecords always reads from (BL-340).
function initRepoOnMain(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['checkout', '-q', '-b', 'main']);
}

function writeTicket(repo, subdir, filename, extraYaml = '') {
  mkdirp(path.join(repo, 'backlog', subdir));
  fs.writeFileSync(path.join(repo, 'backlog', subdir, filename), `id: ${filename.replace('.yaml', '')}\ntitle: t\n${extraYaml}`);
}

// ── loadCompletedTicketRecords (real git fixture) ───────────────────────────

test('a ticket closed into backlog/done is recorded with its close date and mutation_cost class', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-101.yaml', 'mutation_cost: high\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-101'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-101.yaml', 'backlog/done/BL-101.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-101'], '2026-07-02T12:00:00');

  // Cross-check against git's OWN recorded commit date, never a hardcoded
  // literal - GIT_AUTHOR_DATE with no explicit offset is interpreted in the
  // host's local timezone, so the exact ms value is host-dependent; what
  // must hold is that loadCompletedTicketRecords reports the SAME instant
  // git itself recorded for that commit.
  const expectedIso = execFileSync(
    'git',
    ['-C', repo, 'log', '-1', '--format=%cI', 'main', '--', 'backlog/done/BL-101.yaml'],
    { encoding: 'utf8' }
  ).trim();

  const records = loadCompletedTicketRecords(repo, []);

  assert.equal(records.length, 1);
  assert.equal(records[0].ticketId, 'BL-101');
  assert.equal(records[0].completedAtMs, Date.parse(expectedIso));
  assert.equal(records[0].ticketClass, 'high');
  assert.equal(records[0].bounced, false);
});

test('a still-active ticket (never closed) is excluded from the completed set', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-200.yaml');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-200'], '2026-07-02T08:00:00');

  const records = loadCompletedTicketRecords(repo, []);

  assert.deepEqual(records, []);
});

test('a QA bounce recorded only as committed evidence on main is counted, even when absent from the current worktree checkout', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-300.yaml', 'mutation_cost: medium\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-300'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-300.yaml', 'backlog/done/BL-300.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-300'], '2026-07-02T12:00:00');

  // The evidence file lands on main...
  mkdirp(path.join(repo, 'backlog', 'evidence'));
  fs.writeFileSync(path.join(repo, 'backlog', 'evidence', 'BL-300-bounce-20260702.md'), '# BL-300 QA bounce\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'BL-300 QA bounce evidence'], '2026-07-02T13:00:00');

  // ...but the CURRENT worktree checkout is rolled back to a branch that
  // predates it - a plain filesystem read of backlog/evidence/ here would
  // find nothing, exactly the undercount BL-340 exists to prevent.
  git(repo, ['checkout', '-q', '-b', 'stale-worktree', 'HEAD~1']);
  assert.equal(fs.existsSync(path.join(repo, 'backlog', 'evidence', 'BL-300-bounce-20260702.md')), false);

  const records = loadCompletedTicketRecords(repo, []);

  const bl300 = records.find((r) => r.ticketId === 'BL-300');
  assert.ok(bl300, 'expected BL-300 in the completed set');
  assert.equal(bl300.bounced, true);
});

test('a ticket with a live backward handoff is bounced and attributed to the role that sent it back', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-400.yaml');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-400'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-400.yaml', 'backlog/done/BL-400.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-400'], '2026-07-02T12:00:00');

  const architectWt = path.join(repo, 'architect-wt');
  const sentDir = path.join(architectWt, '.swarmforge', 'handoffs', 'sent');
  mkdirp(sentDir);
  fs.writeFileSync(
    path.join(sentDir, '00_a.handoff'),
    'type: git_handoff\nfrom: architect\nto: coder\ntask: BL-400-fix\ncreated_at: 2026-07-02T10:00:00Z\n\nbody\n'
  );

  const records = loadCompletedTicketRecords(repo, [{ role: 'architect', worktreePath: architectWt }]);

  const bl400 = records.find((r) => r.ticketId === 'BL-400');
  assert.ok(bl400);
  assert.equal(bl400.bounced, true);
  assert.equal(bl400.bouncedFromRole, 'architect');
});

test('a ticket with neither a live handoff nor evidence is not bounced', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-500.yaml');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-500'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-500.yaml', 'backlog/done/BL-500.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-500'], '2026-07-02T12:00:00');

  const records = loadCompletedTicketRecords(repo, []);
  const bl500 = records.find((r) => r.ticketId === 'BL-500');
  assert.equal(bl500.bounced, false);
  assert.equal(bl500.bouncedFromRole, null);
});

// ── latestReworkRoleByTicket (pure) ─────────────────────────────────────────

test('latestReworkRoleByTicket keeps the most recent event\'s role when a ticket bounced more than once', () => {
  const roles = latestReworkRoleByTicket([
    { ticketId: 'BL-1', fromRole: 'architect', atMs: 1000 },
    { ticketId: 'BL-1', fromRole: 'QA', atMs: 2000 },
  ]);
  assert.equal(roles.get('BL-1'), 'QA');
});

test('latestReworkRoleByTicket tracks each ticket independently', () => {
  const roles = latestReworkRoleByTicket([
    { ticketId: 'BL-1', fromRole: 'architect', atMs: 1000 },
    { ticketId: 'BL-2', fromRole: 'hardener', atMs: 1000 },
  ]);
  assert.equal(roles.get('BL-1'), 'architect');
  assert.equal(roles.get('BL-2'), 'hardener');
});

test('latestReworkRoleByTicket with no events returns an empty map', () => {
  assert.deepEqual(latestReworkRoleByTicket([]), new Map());
});
