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

// BL-487 hardening: the function's own docstring names THREE tolerated
// failure modes - "bb missing, a torn/non-JSON stdout, a script error" -
// but every test above only exercises a non-zero bb EXIT (the missing-
// script-file case above genuinely exits non-zero with stderr, since `bb
// <nonexistent path>` errors immediately - confirmed empirically). None
// drove the exit-0-but-garbage-stdout path, so the JSON.parse(stdout)
// call inside the try/catch was never actually reached with a failing
// parse - only ever with well-formed JSON or never at all. Per
// engineering.prompt's CLI-failure-path rule (a wiring test over a
// shelled-out CLI must drive its documented failure contract, not only
// the happy path), replace the real pipeline_stage_cli.bb with a fake
// script that exits 0 but prints non-JSON garbage, proving the parse
// failure alone - independent of any process/exit failure - still
// degrades gracefully rather than throwing into the concierge tick.
test('BL-487: a CLI that exits 0 but prints non-JSON garbage degrades gracefully to an empty map, never throws', async () => {
  const root = mkFixtureRoot();
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb'), '(println "not valid json {")\n');

  const result = await readLiveRoleHeldTickets(root);

  assert.deepEqual(result, {});
});
