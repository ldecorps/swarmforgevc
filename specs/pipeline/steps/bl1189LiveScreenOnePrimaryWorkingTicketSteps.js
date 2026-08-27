'use strict';

// BL-1189: step handlers for "Live Screen shows at most one primary working
// seat per ticket". Drives the REAL compiled resolveResidentHeldTicketMeta /
// dedupePrimaryWorkingTicket over a real filesystem fixture (roles.tsv,
// in_process mailboxes, backlog/active), composed the same way
// captureLiveScreenPanes composes them internally - minus the tmux pane
// capture itself, which these scenarios do not need: attribution here is
// driven entirely by live in_process claims and backlog location, not pane
// text.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FEATURE = 'Live Screen shows at most one primary working seat per ticket';
const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { resolveResidentHeldTicketMetaForRoles, dedupePrimaryWorkingTicket } = require(path.join(
  EXT_OUT,
  'concierge',
  'residentPaneSpy'
));

const LIVE_SCREEN_ROLE_ORDER = ['coordinator', 'specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function normalizeRole(role) {
  const lower = role.trim().toLowerCase();
  return lower === 'qa' ? 'QA' : lower;
}

function ensureFixture(ctx) {
  if (ctx.root) {
    return ctx.root;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1189-aps-'));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), '');
  ctx.root = root;
  ctx.rolesTsvRows = [];
  ctx.activeTickets = new Set();
  return root;
}

function worktreeFor(root, role) {
  return path.join(root, `${normalizeRole(role)}-worktree`);
}

function ensureRoleRegistered(ctx, role) {
  const root = ensureFixture(ctx);
  const normalized = normalizeRole(role);
  if (ctx.rolesTsvRows.some((r) => r[0] === normalized)) {
    return;
  }
  ctx.rolesTsvRows.push([normalized, normalized, worktreeFor(root, normalized), `swarmforge-${normalized}`, normalized, 'claude']);
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), ctx.rolesTsvRows.map((r) => r.join('\t')).join('\n') + '\n');
}

function ensureActiveTicket(ctx, ticketId) {
  const root = ensureFixture(ctx);
  if (ctx.activeTickets.has(ticketId)) {
    return;
  }
  ctx.activeTickets.add(ticketId);
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ticketId}-fixture.yaml`), `id: ${ticketId}\ntitle: "fixture ticket"\n`);
}

function claimInProcess(ctx, ticketId, role, dequeuedAt = '2026-08-27T10:00:00Z') {
  const root = ensureFixture(ctx);
  ensureRoleRegistered(ctx, role);
  ensureActiveTicket(ctx, ticketId);
  const dir = path.join(worktreeFor(root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `00_${ticketId}.handoff`),
    `task: ${ticketId}-fixture\ndequeued_at: ${dequeuedAt}\n\nbody\n`
  );
}

// A "stale residual" is explicitly NOT a live in_process claim - a
// completed/archived handoff a role never cleared out of a non-live
// mailbox subdirectory. resolveResidentHeldTicketMeta only ever reads
// inbox/in_process, so this must stay invisible to it by construction.
function writeStaleResidual(ctx, ticketId, role) {
  const root = ensureFixture(ctx);
  ensureRoleRegistered(ctx, role);
  const dir = path.join(worktreeFor(root, role), '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `00_${ticketId}.handoff`), `task: ${ticketId}-fixture\ndequeued_at: 2026-08-01T00:00:00Z\n\nbody\n`);
}

function closeTicketIntoDone(ctx, ticketId) {
  const root = ensureFixture(ctx);
  const dir = path.join(root, 'backlog', 'done');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ticketId}-fixture.yaml`), `id: ${ticketId}\ntitle: "fixture ticket"\n`);
}

// Mirrors captureLiveScreenPanes: one shared claimedTicketIds set threaded
// across every role in a fixed order, for ONE capture.
function captureAllTiles(ctx) {
  const root = ensureFixture(ctx);
  const claimed = new Set();
  const byRole = {};
  for (const role of LIVE_SCREEN_ROLE_ORDER) {
    const raw = resolveResidentHeldTicketMetaForRoles(root, [role]);
    byRole[role] = dedupePrimaryWorkingTicket(claimed, raw);
  }
  return byRole;
}

function registerSteps(registry) {
  registry.defineScoped(/^the Live Screen is authenticated under a standing full pack$/, (ctx) => {
    ensureFixture(ctx);
    for (const role of LIVE_SCREEN_ROLE_ORDER) {
      ensureRoleRegistered(ctx, role);
    }
  }, FEATURE);

  registry.defineScoped(/^each role tile resolves its held ticket from live capture$/, () => {}, FEATURE);

  registry.defineScoped(/^ticket "([^"]+)" is claimed in_process only at "([^"]+)"$/, (ctx, ticketId, role) => {
    claimInProcess(ctx, ticketId, role);
  }, FEATURE);

  registry.defineScoped(/^ticket "([^"]+)" is claimed in_process only at "([^"]+)" after stale lists exist$/, (ctx, ticketId, role) => {
    claimInProcess(ctx, ticketId, role, '2026-08-27T11:00:00Z');
  }, FEATURE);

  registry.defineScoped(
    /^roles "([^"]+)", "([^"]+)", and "([^"]+)" have no in_process claim for "([^"]+)"$/,
    (ctx, r1, r2, r3, ticketId) => {
      for (const role of [r1, r2, r3]) {
        ensureRoleRegistered(ctx, role);
      }
      ensureActiveTicket(ctx, ticketId);
    },
    FEATURE
  );

  registry.defineScoped(/^ticket "([^"]+)" was bookkeep-closed into backlog done one tick ago$/, (ctx, ticketId) => {
    closeTicketIntoDone(ctx, ticketId);
  }, FEATURE);

  registry.defineScoped(/^no role holds an in_process parcel for "([^"]+)"$/, () => {}, FEATURE);

  registry.defineScoped(/^role "([^"]+)" still has a stale stage-map entry naming "([^"]+)"$/, (ctx, role, ticketId) => {
    writeStaleResidual(ctx, ticketId, role);
  }, FEATURE);

  registry.defineScoped(/^ticket "([^"]+)" appears in stale held lists for "([^"]+)" and "([^"]+)"$/, (ctx, ticketId, r1, r2) => {
    writeStaleResidual(ctx, ticketId, r1);
    writeStaleResidual(ctx, ticketId, r2);
  }, FEATURE);

  registry.defineScoped(
    /^the "([^"]+)" seat holds tickets "([^"]+)", "([^"]+)", and "([^"]+)" in_process$/,
    (ctx, role, t1, t2, t3) => {
      claimInProcess(ctx, t1, role, '2026-08-27T09:00:00Z');
      claimInProcess(ctx, t2, role, '2026-08-27T10:00:00Z');
      claimInProcess(ctx, t3, role, '2026-08-27T11:00:00Z');
    },
    FEATURE
  );

  registry.defineScoped(/^no other seat holds any of those tickets in_process$/, () => {}, FEATURE);

  registry.defineScoped(/^the Live Screen capture builds all role tile payloads$/, (ctx) => {
    ctx.tiles = captureAllTiles(ctx);
  }, FEATURE);

  registry.defineScoped(/^the Live Screen capture runs twice within one capture TTL$/, (ctx) => {
    ctx.tilesFirst = captureAllTiles(ctx);
    ctx.tilesSecond = captureAllTiles(ctx);
    ctx.tiles = ctx.tilesSecond;
  }, FEATURE);

  registry.defineScoped(/^exactly one tile shows "([^"]+)" as its primary working ticket$/, (ctx, ticketId) => {
    const claiming = Object.entries(ctx.tiles).filter(([, meta]) => meta.ticketId === ticketId);
    assert.equal(claiming.length, 1, `expected exactly one tile claiming ${ticketId}, got ${claiming.map(([r]) => r).join(',')}`);
  }, FEATURE);

  registry.defineScoped(/^the "([^"]+)" tile is that primary holder$/, (ctx, role) => {
    assert.ok(ctx.tiles[normalizeRole(role)]?.ticketId, `expected ${role} to hold the primary ticket`);
  }, FEATURE);

  registry.defineScoped(/^the "([^"]+)" tile shows "([^"]+)" as its primary working ticket$/, (ctx, role, ticketId) => {
    assert.equal(ctx.tiles[normalizeRole(role)]?.ticketId, ticketId);
  }, FEATURE);

  registry.defineScoped(/^the "([^"]+)" tile does not show "([^"]+)" as primary working now$/, (ctx, role, ticketId) => {
    assert.notEqual(ctx.tiles[normalizeRole(role)]?.ticketId, ticketId);
  }, FEATURE);

  registry.defineScoped(/^roles "([^"]+)" and "([^"]+)" do not show "([^"]+)" as primary working now$/, (ctx, r1, r2, ticketId) => {
    assert.notEqual(ctx.tiles[normalizeRole(r1)]?.ticketId, ticketId);
    assert.notEqual(ctx.tiles[normalizeRole(r2)]?.ticketId, ticketId);
  }, FEATURE);

  registry.defineScoped(/^no tile shows "([^"]+)" as its primary working ticket$/, (ctx, ticketId) => {
    for (const [, meta] of Object.entries(ctx.tilesFirst ?? ctx.tiles)) {
      assert.notEqual(meta.ticketId, ticketId);
    }
    for (const [, meta] of Object.entries(ctx.tilesSecond ?? ctx.tiles)) {
      assert.notEqual(meta.ticketId, ticketId);
    }
  }, FEATURE);

  // heldParcelCount itself is the RAW total held (BL-1046: 3 claims -> 3),
  // not "further beyond the primary" - "N further" in prose means the
  // total minus the one already shown as the primary working ticket.
  registry.defineScoped(/^the "([^"]+)" tile shows that "(\d+)" further parcels are held$/, (ctx, role, count) => {
    const total = ctx.tiles[normalizeRole(role)]?.heldParcelCount;
    assert.ok(total !== undefined, `expected ${role} to report a heldParcelCount`);
    assert.equal(total - 1, Number(count), `expected ${count} further parcels beyond the primary, got heldParcelCount ${total}`);
  }, FEATURE);

  registry.defineScoped(
    /^no other tile shows any of "([^"]+)", "([^"]+)", or "([^"]+)" as primary working now$/,
    (ctx, t1, t2, t3) => {
      for (const [tileRole, meta] of Object.entries(ctx.tiles)) {
        if (tileRole === 'cleaner') {
          continue;
        }
        assert.ok(![t1, t2, t3].includes(meta.ticketId), `${tileRole} unexpectedly holds one of ${t1}, ${t2}, ${t3}`);
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
