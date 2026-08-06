const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { readLiveRoleHeldTickets, RoleHeldTicketsComputationFailedError } = require('../out/tools/telegram-front-desk-bot');

// BL-487: the REAL pipeline_stage_cli.bb `report` subprocess, never mocked,
// per this codebase's own dependencyGateCli*.test.js precedent. Mirrors
// swarmforge/scripts/test/
// test_operator_runtime_tick.sh's own make_fixture technique (copy the
// real .bb script + its load-file dependencies into an isolated fixture's
// own swarmforge/scripts/, so the REAL computation runs against a
// controlled, deterministic backlog/active + roles.tsv + mailbox tree
// instead of this actual repo's own live, ever-changing swarm state).
const REAL_SCRIPTS_DIR = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');

// BL-814: the full, minimal set of load-file dependencies
// pipeline_stage_cli.bb's `report` actually needs to run. Deleting any one
// of these must still break the fixture (proves this list was not widened
// to "everything in the directory" - it is exactly what is depended on).
// Recurrence history: BL-655 added ambulance_lib.bb, BL-805 added
// mono_router_lib.bb - both times this copy list went stale and the
// fixture missed it, because the failure it produced was a passing-shaped
// {} rather than an error (see BL-814).
const REQUIRED_SCRIPT_FILES = ['pipeline_stage_cli.bb', 'pipeline_stage_lib.bb', 'handoff_lib.bb', 'ambulance_lib.bb', 'mono_router_lib.bb'];

function mkFixtureRoot(omit) {
  const root = mkTmpDir('bl487-live-role-held-');
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of REQUIRED_SCRIPT_FILES) {
    if (name === omit) {
      continue;
    }
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

// BL-814: a fixture root with no swarmforge/scripts at all means the real
// CLI can never run - "the computation did not run", not "it ran and found
// nothing". Previously this degraded to a passing-shaped {}; it must now
// surface loudly instead.
test('BL-814: a fixture root with no swarmforge/scripts at all (the real CLI missing) surfaces a computation failure, not an empty map', async () => {
  const root = mkTmpDir('bl487-no-scripts-');

  await assert.rejects(() => readLiveRoleHeldTickets(root), RoleHeldTicketsComputationFailedError);
});

// BL-487 hardening, extended by BL-814: the function's own docstring names
// THREE tolerated-turned-loud failure modes - "bb missing, a torn/non-JSON
// stdout, a script error" - but the test above only exercises a non-zero bb
// EXIT (the missing-script-file case genuinely exits non-zero with stderr,
// since `bb <nonexistent path>` errors immediately - confirmed
// empirically). This drives the exit-0-but-garbage-stdout path, so the
// JSON.parse(stdout) call is reached with a failing parse - independent of
// any process/exit failure - and must surface loudly too, per
// engineering.prompt's CLI-failure-path rule (a wiring test over a
// shelled-out CLI must drive its documented failure contract, not only the
// happy path).
test('BL-814: a CLI that exits 0 but prints non-JSON garbage surfaces a computation failure, never a silent empty map', async () => {
  const root = mkFixtureRoot();
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb'), '(println "not valid json {")\n');

  await assert.rejects(() => readLiveRoleHeldTickets(root), RoleHeldTicketsComputationFailedError);
});

// ── BL-814: failed-computation-is-loud ─────────────────────────────────────
// Mirrors the acceptance feature's Scenario Outline exactly: deleting any
// ONE of the fixture's non-leaf load-file dependencies makes the real `bb`
// subprocess fail (FileNotFoundException at the load-file site), and that
// failure must surface rather than degrade to a passing-shaped {}. Also
// proves the fixture's copy list is minimal - not padded with unused files -
// since removing any of these three genuinely breaks the real computation.
for (const missingDependency of ['mono_router_lib.bb', 'ambulance_lib.bb', 'handoff_lib.bb']) {
  test(`BL-814: a fixture missing ${missingDependency} surfaces the failure instead of reporting an ordinary empty map`, async () => {
    const root = mkFixtureRoot(missingDependency);
    const coderWorktree = path.join(root, 'coder-worktree');
    writeRolesTsv(root, [['coder', 'coder', coderWorktree, 'session', 'Coder', 'claude']]);
    writeActiveTicket(root, 'BL-900');
    writeInProcessHandoff(root, coderWorktree, 'BL-900-board-freshness-fixture');

    await assert.rejects(() => readLiveRoleHeldTickets(root), RoleHeldTicketsComputationFailedError);
  });
}
