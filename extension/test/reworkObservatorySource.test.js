const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadCompletedTicketRecords, latestReworkRoleByTicket } = require('../out/metrics/reworkObservatorySource');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

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
  copySeededRepoInto(dir);
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

// ── BL-1873: only a recorded bounce counts, never routine pass evidence ──

test('BL-1873: a ticket with only routine pass evidence (QA/architect, no "bounce" in the name) is not bounced', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-600.yaml');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-600'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-600.yaml', 'backlog/done/BL-600.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-600'], '2026-07-02T12:00:00');

  mkdirp(path.join(repo, 'backlog', 'evidence'));
  fs.writeFileSync(path.join(repo, 'backlog', 'evidence', 'BL-600-QA-20260702.md'), '# pass\n');
  fs.writeFileSync(path.join(repo, 'backlog', 'evidence', 'BL-600-architect-20260702.md'), '# pass\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'BL-600 pass evidence'], '2026-07-02T13:00:00');

  const records = loadCompletedTicketRecords(repo, []);
  const bl600 = records.find((r) => r.ticketId === 'BL-600');
  assert.ok(bl600, 'expected BL-600 in the completed set');
  assert.equal(bl600.bounced, false, 'routine pass evidence alone must never count as a bounce');
});

test('BL-1873: a bounce_count above 0 on the ticket YAML counts as a bounce, with no evidence file at all', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-700.yaml', 'bounce_count: 1\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-700'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-700.yaml', 'backlog/done/BL-700.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-700'], '2026-07-02T12:00:00');

  const records = loadCompletedTicketRecords(repo, []);
  const bl700 = records.find((r) => r.ticketId === 'BL-700');
  assert.ok(bl700);
  assert.equal(bl700.bounced, true);
});

test('BL-1873: an evidence file whose name contains "bounce" counts, even with bounce_count absent/zero', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-800.yaml');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-800'], '2026-07-02T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-800.yaml', 'backlog/done/BL-800.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-800'], '2026-07-02T12:00:00');

  mkdirp(path.join(repo, 'backlog', 'evidence'));
  fs.writeFileSync(path.join(repo, 'backlog', 'evidence', 'BL-800-qa-bounce-20260702.md'), '# bounce\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'BL-800 bounce evidence'], '2026-07-02T13:00:00');

  const records = loadCompletedTicketRecords(repo, []);
  const bl800 = records.find((r) => r.ticketId === 'BL-800');
  assert.ok(bl800);
  assert.equal(bl800.bounced, true);
});

// ── BL-1873: the history walk is scoped to a trailing window via sinceMs ──

test('BL-1873: a ticket closed inside the scoped window still gets its close date and class even though its promotion predates the window', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-900.yaml', 'mutation_cost: low\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-900'], '2026-01-01T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-900.yaml', 'backlog/done/BL-900.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-900'], '2026-07-02T12:00:00');

  // sinceMs lands AFTER the promotion commit but before the close commit -
  // the promotion's own arrival is invisible to the scoped walk.
  const sinceMs = Date.parse('2026-06-01T00:00:00Z');
  const records = loadCompletedTicketRecords(repo, [], sinceMs);
  const bl900 = records.find((r) => r.ticketId === 'BL-900');
  assert.ok(bl900, 'expected BL-900 to still be recorded even though its promotion is outside the scoped window');
  assert.equal(bl900.ticketClass, 'low');
});

test('BL-1873: a ticket closed BEFORE the scoped window is excluded entirely', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  writeTicket(repo, 'active', 'BL-901.yaml');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote BL-901'], '2026-01-01T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-901.yaml', 'backlog/done/BL-901.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-901'], '2026-01-02T12:00:00');

  const sinceMs = Date.parse('2026-06-01T00:00:00Z'); // after the close commit
  const records = loadCompletedTicketRecords(repo, [], sinceMs);
  assert.equal(records.find((r) => r.ticketId === 'BL-901'), undefined);
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

// The test above processes events in chronological array order, so it
// cannot tell "picks the later timestamp" apart from "picks whichever was
// processed last" - both produce the same result there. Reversing the
// array order pins the actual comparison (event.atMs > current.atMs), not
// insertion order.
test('latestReworkRoleByTicket picks the later timestamp regardless of array order', () => {
  const roles = latestReworkRoleByTicket([
    { ticketId: 'BL-1', fromRole: 'QA', atMs: 2000 },
    { ticketId: 'BL-1', fromRole: 'architect', atMs: 1000 },
  ]);
  assert.equal(roles.get('BL-1'), 'QA');
});

// Pins the strict > boundary (never >=): on a genuine tie, the
// first-PROCESSED event keeps its role, since a later event only
// overwrites when it is STRICTLY newer.
test('latestReworkRoleByTicket keeps the first-processed event on a timestamp tie', () => {
  const roles = latestReworkRoleByTicket([
    { ticketId: 'BL-1', fromRole: 'architect', atMs: 1000 },
    { ticketId: 'BL-1', fromRole: 'QA', atMs: 1000 },
  ]);
  assert.equal(roles.get('BL-1'), 'architect');
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
