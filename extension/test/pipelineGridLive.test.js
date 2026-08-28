const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { capturePipelineGridLive, readLiveRoleHeldTickets } = require('../out/bridge/pipelineGridLive');

// BL-1188: the REAL pipeline_stage_cli.bb `report` subprocess, never mocked -
// same precedent as readLiveRoleHeldTicketsCli.test.js (BL-487/BL-814).
const REAL_SCRIPTS_DIR = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
const { computeClosure } = require(path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'operatorRuntimeBbClosure.js'));
const CLI_ENTRY_POINT = 'pipeline_stage_cli.bb';
const REQUIRED_SCRIPT_FILES = [...computeClosure(REAL_SCRIPTS_DIR, CLI_ENTRY_POINT)].sort();

function mkFixtureRoot() {
  const root = mkTmpDir('bl1188-pipeline-grid-live-');
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of REQUIRED_SCRIPT_FILES) {
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(scriptsDir, name));
  }
  return root;
}

function writeRolesTsv(root, rows) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeActiveTicket(root, id, extra = '') {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: "fixture ticket"\n${extra}`);
}

function clearInProcess(worktreePath) {
  fs.rmSync(path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true, force: true });
}

function writeInProcessHandoff(root, worktreePath, taskName, role) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '00_fixture.handoff'),
    `id: fixture\nfrom: architect\nto: ${role}\nrecipient: ${role}\npriority: 00\ntype: git_handoff\nrole: architect\ncommit: 0000000000\ntask: ${taskName}\n\nRe-read your role and constitution.\n`
  );
}

function writeCache(root, stageMap) {
  const dir = path.join(root, '.swarmforge', 'board');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ticket-stage-map.json'), JSON.stringify(stageMap));
}

// The grid matrix renders each ticket's numeric id with the "BL-" prefix
// stripped (deriveDisplayTicketId), gutter-padded and cell-separated with
// NBSP (padStartNbsp) rather than a plain space - unlike the caption line
// below it, which joins the same id and the title with a plain space. Match
// the NBSP-joined form so this finds the X-marked matrix row, not the caption.
function findMatrixRow(boardText, ticketId) {
  const displayId = ticketId.replace(/^BL-/, '');
  return boardText.split('\n').find((l) => l.startsWith(`${displayId} `));
}

// ── readLiveRoleHeldTickets: sync counterpart of BL-487's async CLI reader ──

test('BL-1188: readLiveRoleHeldTickets reports a role-held ticket computed live from the real in_process mailbox', () => {
  const root = mkFixtureRoot();
  const coderWorktree = path.join(root, 'coder-worktree');
  writeRolesTsv(root, [['coder', 'coder', coderWorktree, 'session', 'Coder', 'claude']]);
  writeActiveTicket(root, 'BL-900');
  writeInProcessHandoff(root, coderWorktree, 'BL-900-fixture', 'coder');

  const result = readLiveRoleHeldTickets(root);

  assert.deepEqual(result, { coder: ['BL-900'] });
});

test('BL-1188: readLiveRoleHeldTickets ignores a stale cache naming a different role entirely', () => {
  const root = mkFixtureRoot();
  const coderWorktree = path.join(root, 'coder-worktree');
  writeRolesTsv(root, [['coder', 'coder', coderWorktree, 'session', 'Coder', 'claude']]);
  writeActiveTicket(root, 'BL-900');
  writeInProcessHandoff(root, coderWorktree, 'BL-900-fixture', 'coder');
  writeCache(root, { 'BL-900': 'documenter' });

  const result = readLiveRoleHeldTickets(root);

  assert.deepEqual(result, { coder: ['BL-900'] });
});

test('BL-1188: readLiveRoleHeldTickets throws (never a silent empty map) when the real CLI cannot run at all', () => {
  const root = mkTmpDir('bl1188-no-scripts-');

  assert.throws(() => readLiveRoleHeldTickets(root));
});

test('BL-1188: readLiveRoleHeldTickets throws when the CLI exits 0 but prints non-JSON garbage', () => {
  const root = mkFixtureRoot();
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb'), '(println "not valid json {")\n');

  assert.throws(() => readLiveRoleHeldTickets(root));
});

// ── capturePipelineGridLive: live report is primary, cache is fallback only ─

test('BL-1188 live-report-not-cache-01: capture reflects the live in_process holder even while the cache disagrees, and moves when only the live holder moves (freshness-each-tick-05)', () => {
  const root = mkFixtureRoot();
  const architectWorktree = path.join(root, 'architect-worktree');
  const hardenerWorktree = path.join(root, 'hardener-worktree');
  writeRolesTsv(root, [
    ['architect', 'architect', architectWorktree, 'session', 'Architect', 'claude'],
    ['hardender', 'hardender', hardenerWorktree, 'session', 'Hardener', 'claude'],
  ]);
  writeActiveTicket(root, 'BL-428', 'epic: code-quality-gates\ntype: chore\n');
  // Cache held CONSTANT and WRONG throughout - if capture used it as its
  // sole/dominant source, the two ticks below would render identically.
  writeCache(root, { 'BL-428': 'documenter' });
  writeInProcessHandoff(root, architectWorktree, 'BL-428-fixture', 'architect');

  const first = capturePipelineGridLive(root);
  const firstRow = findMatrixRow(first.boardText, 'BL-428');
  assert.ok(firstRow, 'expected a rendered row for BL-428');

  clearInProcess(architectWorktree);
  writeInProcessHandoff(root, hardenerWorktree, 'BL-428-fixture', 'hardender');

  const second = capturePipelineGridLive(root);
  const secondRow = findMatrixRow(second.boardText, 'BL-428');
  assert.ok(secondRow, 'expected a rendered row for BL-428');

  // The stale, unchanged cache would render both ticks identically; a live,
  // per-tick recompute must not.
  assert.notEqual(firstRow, secondRow);
});

test('BL-1188: capturePipelineGridLive falls back to the ticket-stage-map cache when the live report is unavailable, and still reflects a cache change', () => {
  const root = mkTmpDir('bl1188-cache-fallback-');
  writeActiveTicket(root, 'BL-900', 'epic: code-quality-gates\ntype: chore\n');
  writeCache(root, { 'BL-900': 'documenter' });

  const withDocumenter = capturePipelineGridLive(root);
  const rowA = findMatrixRow(withDocumenter.boardText, 'BL-900');
  assert.ok(rowA, 'expected a rendered row for BL-900 from the cache fallback');

  writeCache(root, { 'BL-900': 'QA' });
  const withQA = capturePipelineGridLive(root);
  const rowB = findMatrixRow(withQA.boardText, 'BL-900');
  assert.ok(rowB, 'expected a rendered row for BL-900 from the cache fallback');

  assert.notEqual(rowA, rowB);
});
