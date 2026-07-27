'use strict';

// BL-487: step handlers for "the pipeline board reflects live role-held
// stage without depending on the coordinator running sync". Drives the
// REAL readLiveRoleHeldTickets (telegram-front-desk-bot.ts), which itself
// shells to the REAL pipeline_stage_cli.bb `report` subprocess against an
// isolated fixture root (the real .bb script + its load-file dependencies
// copied in, mirroring swarmforge/scripts/test/test_operator_runtime_tick
// .sh's own make_fixture technique) - never mocked. The rendered board
// itself reuses bl465PipelineBoardRenderRound2Steps.js's own shared
// render(ctx) (drives the REAL compiled computePipelineBoard), the same
// convention bl473PipelineBoardActiveMembershipSteps.js already
// established, never a hand-rolled reimplementation of the render rules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { readLiveRoleHeldTickets } = require(path.join(EXT_OUT, 'tools', 'telegram-front-desk-bot'));
const { render } = require('./bl465PipelineBoardRenderRound2Steps');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkFixtureRoot() {
  const root = mkTmp('bl487-fixture-');
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of ['pipeline_stage_cli.bb', 'pipeline_stage_lib.bb', 'handoff_lib.bb']) {
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(scriptsDir, name));
  }
  return root;
}

function writeRolesTsv(root, worktreePath) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), ['coder', 'coder', worktreePath, 'session', 'Coder', 'claude'].join('\t') + '\n');
}

function writeActiveTicket(root, id) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: "fixture ticket"\n`);
}

function writeInProcessHandoff(worktreePath, taskName) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '00_fixture.handoff'),
    `id: fixture\nfrom: architect\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\nrole: architect\ncommit: 0000000000\ntask: ${taskName}\n\nRe-read your role and constitution.\n`
  );
}

function writeCacheFile(root, map) {
  const dir = path.join(root, '.swarmforge', 'board');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ticket-stage-map.json'), JSON.stringify(map));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^active ticket "([^"]+)" is held in the coder's in_process mailbox$/, (ctx, ticketId) => {
    ctx.ticketId = ticketId;
    ctx.fixtureRoot = mkFixtureRoot();
    ctx.coderWorktree = path.join(ctx.fixtureRoot, 'coder-worktree');
    writeRolesTsv(ctx.fixtureRoot, ctx.coderWorktree);
    writeActiveTicket(ctx.fixtureRoot, ticketId);
    writeInProcessHandoff(ctx.coderWorktree, `${ticketId}-board-freshness-fixture`);
  });

  // ── board-freshness-without-coordinator-sync-01 ─────────────────────
  registry.define(/^the persisted ticket-stage-map cache does not contain "([^"]+)"$/, (ctx, ticketId) => {
    assert.equal(ctx.ticketId, ticketId, 'internal test setup: scenario ticket id mismatch');
    // No cache file written at all - the missing/never-synced-cache case.
  });

  // ── board-freshness-without-coordinator-sync-02 ─────────────────────
  registry.define(/^the persisted ticket-stage-map cache still says "([^"]+)" is held by the specifier$/, (ctx, ticketId) => {
    assert.equal(ctx.ticketId, ticketId, 'internal test setup: scenario ticket id mismatch');
    writeCacheFile(ctx.fixtureRoot, { [ticketId]: 'specifier' });
  });

  registry.define(/^the concierge tick computes the pipeline board$/, async (ctx) => {
    ctx.roleHeldTickets = await readLiveRoleHeldTickets(ctx.fixtureRoot);
    ctx.activeIds = [ctx.ticketId];
    render(ctx);
  });

  registry.define(/^"([^"]+)" appears on the board at the coder's stage$/, (ctx, ticketId) => {
    const row = ctx.board.rows.find((r) => r.id === ticketId);
    assert.ok(row, `expected ${ticketId} on the board, got: ${JSON.stringify(ctx.board.rows)}`);
    assert.equal(row.column, 'coder');
  });

  registry.define(/^"([^"]+)" appears on the board at the coder's stage, not the specifier's$/, (ctx, ticketId) => {
    const row = ctx.board.rows.find((r) => r.id === ticketId);
    assert.ok(row, `expected ${ticketId} on the board, got: ${JSON.stringify(ctx.board.rows)}`);
    assert.equal(row.column, 'coder');
    assert.notEqual(row.column, 'specifier');
  });
}

module.exports = { registerSteps };
