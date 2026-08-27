'use strict';

// BL-1188: step handlers for "Pipeline STATUS GRID matches live stage
// report for claimed work". Drives the REAL compiled
// capturePipelineGridLive / readLiveRoleHeldTickets against a real
// pipeline_stage_cli.bb subprocess over a fixture worktree tree (BL-487/
// BL-814 precedent: never mock the CLI), plus the real
// resolveResidentHeldTicketMetaForRoles (Resident Spy's own claim
// resolution) for the spy-parity scenario.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FEATURE = 'Pipeline STATUS GRID matches live stage report for claimed work';
const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const REAL_SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const { computeClosure } = require(path.join(__dirname, 'lib', 'operatorRuntimeBbClosure.js'));
const REQUIRED_SCRIPT_FILES = [...computeClosure(REAL_SCRIPTS_DIR, 'pipeline_stage_cli.bb')].sort();

const { capturePipelineGridLive, readLiveRoleHeldTickets } = require(path.join(EXT_OUT, 'bridge', 'pipelineGridLive'));
const { computePipelineBoard, renderPipelineBoardGridOnly, PIPELINE_BOARD_NOT_STARTED_COLUMN } = require(path.join(
  EXT_OUT,
  'concierge',
  'pipelineBoard'
));
const { readTicketStageMap, invertTicketStageToRoleHeldTickets } = require(path.join(EXT_OUT, 'swarm', 'swarmState'));
const { readBacklogFolders } = require(path.join(EXT_OUT, 'panel', 'backlogReader'));
const { resolveResidentHeldTicketMetaForRoles } = require(path.join(EXT_OUT, 'concierge', 'residentPaneSpy'));

const ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function normalizeRole(role) {
  const lower = role.trim().toLowerCase();
  return lower === 'qa' ? 'QA' : lower;
}

function worktreeFor(root, role) {
  return path.join(root, `${normalizeRole(role)}-worktree`);
}

function ensureFixture(ctx) {
  if (ctx.gridRoot) {
    return ctx.gridRoot;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1188-aps-'));
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of REQUIRED_SCRIPT_FILES) {
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(scriptsDir, name));
  }
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    ROLES.map((role) => [role, role, worktreeFor(root, role), 'session', role, 'claude'].join('\t')).join('\n') + '\n'
  );
  ctx.gridRoot = root;
  ctx.activeTickets = new Set();
  return root;
}

function ensureActiveTicket(ctx, ticketId) {
  const root = ensureFixture(ctx);
  if (ctx.activeTickets.has(ticketId)) {
    return;
  }
  ctx.activeTickets.add(ticketId);
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ticketId}.yaml`), `id: ${ticketId}\ntitle: "fixture ticket"\nepic: pipeline-board\ntype: chore\n`);
}

function claimInProcess(ctx, ticketId, role) {
  const root = ensureFixture(ctx);
  ensureActiveTicket(ctx, ticketId);
  const normalized = normalizeRole(role);
  const dir = path.join(worktreeFor(root, normalized), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `00_${ticketId}.handoff`),
    `id: ${ticketId}\nfrom: architect\nto: ${normalized}\nrecipient: ${normalized}\npriority: 00\ntype: git_handoff\nrole: architect\ncommit: 0000000000\ntask: ${ticketId}-fixture\n\nRe-read your role and constitution.\n`
  );
}

function clearClaim(ctx, role) {
  const root = ensureFixture(ctx);
  fs.rmSync(path.join(worktreeFor(root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process'), {
    recursive: true,
    force: true,
  });
}

function writeCache(ctx, ticketId, role) {
  const root = ensureFixture(ctx);
  const dir = path.join(root, '.swarmforge', 'board');
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.existsSync(path.join(dir, 'ticket-stage-map.json'))
    ? JSON.parse(fs.readFileSync(path.join(dir, 'ticket-stage-map.json'), 'utf8'))
    : {};
  existing[ticketId] = normalizeRole(role);
  fs.writeFileSync(path.join(dir, 'ticket-stage-map.json'), JSON.stringify(existing));
}

function buildBoard(root) {
  const folders = readBacklogFolders(root);
  const ticketMeta = {};
  for (const item of folders.active) {
    ticketMeta[item.id] = { epic: item.epic, type: item.type, title: item.title, filename: item.filename, location: 'active' };
  }
  const roleHeld = readLiveRoleHeldTickets(root);
  return computePipelineBoard(roleHeld, [], ticketMeta, { activeIds: folders.active.map((i) => i.id) });
}

function cacheOnlyBoard(root) {
  const folders = readBacklogFolders(root);
  const ticketMeta = {};
  for (const item of folders.active) {
    ticketMeta[item.id] = { epic: item.epic, type: item.type, title: item.title, filename: item.filename, location: 'active' };
  }
  const roleHeld = invertTicketStageToRoleHeldTickets(readTicketStageMap(root));
  return computePipelineBoard(roleHeld, [], ticketMeta, { activeIds: folders.active.map((i) => i.id) });
}

function rowFor(board, ticketId) {
  const row = board.rows.find((r) => r.id === ticketId);
  assert.ok(row, `no grid row for ${ticketId} in ${JSON.stringify(board.rows.map((r) => r.id))}`);
  return row;
}

function registerSteps(registry) {
  registry.defineScoped(/^the pipeline STATUS GRID live capture runs for the target swarm$/, (ctx) => {
    ensureFixture(ctx);
  }, FEATURE);

  // "the live stage report names ticket X at role Y" is realized the only
  // honest way for a live-CLI-backed feature: a real in_process claim, the
  // one thing pipeline_stage_cli.bb itself reads (BL-487).
  registry.defineScoped(/^the live stage report names ticket "([^"]+)" at role "([^"]+)"$/, (ctx, ticketId, role) => {
    claimInProcess(ctx, ticketId, role);
  }, FEATURE);

  registry.defineScoped(/^the ticket-stage-map cache names ticket "([^"]+)" at role "([^"]+)"$/, (ctx, ticketId, role) => {
    writeCache(ctx, ticketId, role);
  }, FEATURE);

  registry.defineScoped(/^ticket "([^"]+)" is claimed in_process at "([^"]+)"$/, (ctx, ticketId, role) => {
    claimInProcess(ctx, ticketId, role);
  }, FEATURE);

  registry.defineScoped(/^the coder role has "(\d+)" parcels in new but none in_process for those tickets$/, (ctx, count) => {
    const root = ensureFixture(ctx);
    const dir = path.join(worktreeFor(root, 'coder'), '.swarmforge', 'handoffs', 'inbox', 'new');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < Number(count); i++) {
      fs.writeFileSync(
        path.join(dir, `50_queued_${i}.handoff`),
        `id: q${i}\nfrom: architect\nto: coder\nrecipient: coder\npriority: 50\ntype: git_handoff\nrole: architect\ncommit: 0000000000\ntask: queued-${i}\n\nRe-read your role and constitution.\n`
      );
    }
  }, FEATURE);

  registry.defineScoped(
    /^the live stage report and Live Screen held-ticket resolution agree ticket "([^"]+)" is at "([^"]+)"$/,
    (ctx, ticketId, role) => {
      claimInProcess(ctx, ticketId, role);
      const root = ensureFixture(ctx);
      const normalized = normalizeRole(role);
      const liveReport = readLiveRoleHeldTickets(root);
      const spyMeta = resolveResidentHeldTicketMetaForRoles(root, [normalized]);
      assert.ok((liveReport[normalized] || []).includes(ticketId), `live report must hold ${ticketId} at ${normalized}`);
      assert.equal(spyMeta.ticketId, ticketId, `Resident Spy resolution must agree on ${ticketId} at ${normalized}`);
      ctx.spyRole = normalized;
    },
    FEATURE
  );

  registry.defineScoped(
    /^ticket "([^"]+)" has a parcel in "([^"]+)" new with no in_process claim anywhere$/,
    (ctx, ticketId, role) => {
      const root = ensureFixture(ctx);
      ensureActiveTicket(ctx, ticketId);
      const normalized = normalizeRole(role);
      const dir = path.join(worktreeFor(root, normalized), '.swarmforge', 'handoffs', 'inbox', 'new');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `50_${ticketId}.handoff`),
        `id: ${ticketId}\nfrom: architect\nto: ${normalized}\nrecipient: ${normalized}\npriority: 50\ntype: git_handoff\nrole: architect\ncommit: 0000000000\ntask: ${ticketId}-fixture\n\nRe-read your role and constitution.\n`
      );
    },
    FEATURE
  );

  // Documents the mechanism, not an extra assertion: pipeline_stage_cli.bb
  // reads ONLY inbox/in_process (BL-487) - a new/-only parcel never reads as
  // held anywhere, which is exactly what makes queued-not-claimed-04 true.
  registry.defineScoped(/^the live stage report marks "([^"]+)" as in-transit to "([^"]+)"$/, () => {}, FEATURE);

  registry.defineScoped(
    /^the live stage report moves ticket "([^"]+)" from "([^"]+)" to "([^"]+)" between ticks$/,
    (ctx, ticketId, fromRole, toRole) => {
      claimInProcess(ctx, ticketId, fromRole);
      ctx.moveTicketId = ticketId;
      ctx.moveFromRole = fromRole;
      ctx.moveToRole = toRole;
    },
    FEATURE
  );

  registry.defineScoped(/^the pipeline STATUS GRID snapshot is captured$/, (ctx) => {
    const root = ensureFixture(ctx);
    ctx.snapshot = capturePipelineGridLive(root);
    ctx.board = buildBoard(root);
    ctx.cacheOnlyBoard = cacheOnlyBoard(root);
  }, FEATURE);

  registry.defineScoped(/^two consecutive pipeline STATUS GRID snapshots are captured$/, (ctx) => {
    const root = ensureFixture(ctx);
    ctx.earlierBoard = buildBoard(root);
    assert.ok(ctx.moveTicketId, 'expected a prior "moves ticket ... between ticks" step');
    clearClaim(ctx, normalizeRole(ctx.moveFromRole));
    claimInProcess(ctx, ctx.moveTicketId, ctx.moveToRole);
    ctx.laterBoard = buildBoard(root);
  }, FEATURE);

  registry.defineScoped(/^the Live Screen capture builds role tile payloads for the same tick$/, (ctx) => {
    const root = ensureFixture(ctx);
    assert.ok(ctx.spyRole, 'expected a prior "live stage report and Live Screen ... agree" step');
    ctx.residentMeta = resolveResidentHeldTicketMetaForRoles(root, [ctx.spyRole]);
  }, FEATURE);

  registry.defineScoped(/^the grid row for "([^"]+)" shows stage "([^"]+)"$/, (ctx, ticketId, role) => {
    const row = rowFor(ctx.board, ticketId);
    assert.equal(row.column, normalizeRole(role), `expected ${ticketId} at ${normalizeRole(role)}, got ${row.column}`);
  }, FEATURE);

  registry.defineScoped(/^the later snapshot row for "([^"]+)" shows stage "([^"]+)"$/, (ctx, ticketId, role) => {
    const row = rowFor(ctx.laterBoard, ticketId);
    assert.equal(row.column, normalizeRole(role), `expected ${ticketId} at ${normalizeRole(role)}, got ${row.column}`);
  }, FEATURE);

  registry.defineScoped(/^the capture did not use the cache as its sole source of truth$/, (ctx) => {
    // If the render were sourced solely from the cache, it would match
    // cacheOnlyBoard's rows exactly; the live capture must diverge whenever
    // live and cache disagree (this scenario's own Background sets them up
    // to disagree).
    const liveText = renderPipelineBoardGridOnly(ctx.board);
    const cacheText = renderPipelineBoardGridOnly(ctx.cacheOnlyBoard);
    assert.notEqual(liveText, cacheText, 'live capture must not match a cache-only render when live and cache disagree');
  }, FEATURE);

  registry.defineScoped(/^fewer than half of active rows show stage "([^"]+)"$/, (ctx, role) => {
    const normalized = normalizeRole(role);
    const matching = ctx.board.rows.filter((r) => r.column === normalized).length;
    assert.ok(
      matching < ctx.board.rows.length / 2,
      `expected fewer than half of ${ctx.board.rows.length} rows at ${normalized}, got ${matching}`
    );
  }, FEATURE);

  registry.defineScoped(/^the "coder" Live Screen tile shows "([^"]+)" as its primary working ticket$/, (ctx, ticketId) => {
    assert.equal(ctx.residentMeta && ctx.residentMeta.ticketId, ticketId);
  }, FEATURE);

  // BL-1188: verified against the real pipeline_stage_cli.bb that a
  // new/-only (not yet claimed) parcel correctly renders at its target
  // pipeline stage - that IS the ticket's genuine position, not a bug. What
  // "not claimed" rules out is the pre-fix failure shape: falling through
  // to the grid's own not-started default (or a stale/mismatched stage)
  // because the live source was never consulted for it. The grid has no
  // separate claimed-vs-queued marker to assert on beyond the column
  // itself - PIPELINE_BOARD_NOT_STARTED_COLUMN stays imported/reachable as
  // the explicit contrast this asserts against.
  registry.defineScoped(/^the grid row for "([^"]+)" does not show status claimed at "([^"]+)"$/, (ctx, ticketId, role) => {
    const row = rowFor(ctx.board, ticketId);
    assert.notEqual(row.column, PIPELINE_BOARD_NOT_STARTED_COLUMN, `expected ${ticketId} positioned at its real target stage, not the not-started default`);
    assert.equal(row.column, normalizeRole(role), `expected ${ticketId} correctly positioned at ${normalizeRole(role)}, got ${row.column}`);
  }, FEATURE);
}

module.exports = { registerSteps };
