const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { readLiveRoleHeldTickets } = require('../out/tools/telegram-front-desk-bot');

// BL-487: the REAL pipeline_stage_cli.bb `report` subprocess, never mocked,
// per this codebase's own dependencyGateCli*.test.js precedent. Mirrors
// swarmforge/scripts/test/
// test_operator_runtime_tick.sh's own make_fixture technique (copy the
// real .bb script + its load-file dependencies into an isolated fixture's
// own swarmforge/scripts/, so the REAL computation runs against a
// controlled, deterministic backlog/active + roles.tsv + mailbox tree
// instead of this actual repo's own live, ever-changing swarm state).
const REAL_SCRIPTS_DIR = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');

function mkFixtureRoot() {
  const root = mkTmpDir('bl487-live-role-held-');
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of ['pipeline_stage_cli.bb', 'pipeline_stage_lib.bb', 'handoff_lib.bb']) {
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(scriptsDir, name));
  }
  return root;
}

function writeRolesTsv(root, rows) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeActiveTicket(root, id) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: "fixture ticket"\n`);
}

function writeInProcessHandoff(root, worktreePath, taskName) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '00_fixture.handoff'),
    `id: fixture\nfrom: architect\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\nrole: architect\ncommit: 0000000000\ntask: ${taskName}\n\nRe-read your role and constitution.\n`
  );
}

// ── board-freshness-without-coordinator-sync ──────────────────────────────

test('BL-487: reports a role-held ticket computed LIVE from the real in_process mailbox - no cache file involved at all', async () => {
  const root = mkFixtureRoot();
  const coderWorktree = path.join(root, 'coder-worktree');
  writeRolesTsv(root, [['coder', 'coder', coderWorktree, 'session', 'Coder', 'claude']]);
  writeActiveTicket(root, 'BL-900');
  writeInProcessHandoff(root, coderWorktree, 'BL-900-board-freshness-fixture');

  const result = await readLiveRoleHeldTickets(root);

  assert.deepEqual(result, { coder: ['BL-900'] });
});

test('BL-487: a stale/absent ticket-stage-map.json cache is irrelevant - the live mailbox is the only source read', async () => {
  const root = mkFixtureRoot();
  const coderWorktree = path.join(root, 'coder-worktree');
  writeRolesTsv(root, [['coder', 'coder', coderWorktree, 'session', 'Coder', 'claude']]);
  writeActiveTicket(root, 'BL-900');
  writeInProcessHandoff(root, coderWorktree, 'BL-900-board-freshness-fixture');
  // A stale cache naming a DIFFERENT role for the same ticket - if this
  // were read at all, the result would say "specifier", not "coder".
  fs.mkdirSync(path.join(root, '.swarmforge', 'board'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'board', 'ticket-stage-map.json'), JSON.stringify({ 'BL-900': 'specifier' }));

  const result = await readLiveRoleHeldTickets(root);

  assert.deepEqual(result, { coder: ['BL-900'] });
});

test('BL-487: no roles.tsv / no active ticket at all degrades to an empty map, never a crash', async () => {
  const root = mkFixtureRoot();

  const result = await readLiveRoleHeldTickets(root);

  assert.deepEqual(result, {});
});

test('BL-487: a fixture root with no swarmforge/scripts at all (the real CLI missing) degrades gracefully to an empty map', async () => {
  const root = mkTmpDir('bl487-no-scripts-');

  const result = await readLiveRoleHeldTickets(root);

  assert.deepEqual(result, {});
});
