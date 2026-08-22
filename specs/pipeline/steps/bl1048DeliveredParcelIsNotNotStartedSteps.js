'use strict';

// BL-1048: step handlers for "A delivered parcel is not not-started". The
// board's stage scan read each role's OPENED mail (inbox/in_process/) and
// nothing else, so a parcel that had been routed, delivered and woken - but
// not yet picked up - named its ticket in a file no scan opened, and the
// ticket rendered in the not-started column, indistinguishable from one no
// role had ever been given.
//
// Drives the REAL chain the live board runs, never a substitute for any
// half of it: a real fs fixture (roles.tsv, per-role mailboxes, backlog/
// active yaml) -> `bb pipeline_stage_cli.bb sync` (the coordinator's own
// writer, whose role-ticket-pairs-for this ticket widens) ->
// readTicketStageMap -> invertTicketStageToRoleHeldTickets ->
// computePipelineBoard. activeIds is supplied exactly the way
// conciergeTick.ts's activeMembershipIds does (the backlog/active/ set),
// which is what makes the not-started column reachable at all (BL-473).
//
// Every registration here is defineScoped to THIS feature: "the board is
// rendered" is already owned unscoped-ish by bl956PipelineBoardCaptionCap
// Steps.js for its own caption feature, and the scoping mechanism (BL-425)
// is exactly how two features share one literal step text without either
// touching the other.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A delivered parcel is not not-started';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { readTicketStageMap, invertTicketStageToRoleHeldTickets } = require(path.join(EXT_OUT, 'swarm', 'swarmState'));
const { computePipelineBoard, PIPELINE_BOARD_NOT_STARTED_COLUMN } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

// roles.tsv order verbatim from the live .swarmforge/roles.tsv - rank, and
// therefore reconcile-stage-map's most-downstream-wins, IS that file's
// order, so the fixture must not invent a different one. specifier and
// coordinator are master-resident (one shared checkout, per-role mailbox
// subdirectory); every other role has its own worktree and the flat layout.
const ROLES = [
  ['specifier', 'master'],
  ['coder', 'coder'],
  ['cleaner', 'cleaner'],
  ['architect', 'architect'],
  ['hardender', 'hardender'],
  ['documenter', 'documenter'],
  ['QA', 'QA'],
  ['coordinator', 'master'],
];
const MASTER_RESIDENT = new Set(ROLES.filter(([, wt]) => wt === 'master').map(([role]) => role));

// Scenario Outline <parcel state> tokens, validated against this explicit
// table - never a passthrough or binary check (engineering.prompt: a
// Scenario Outline handler validates against explicit KNOWN_VALUES). The
// two tokens are the two mailbox states a routed parcel can be observed
// in; "delivered but unopened" is the one the scan used to skip.
const PARCEL_STATES = {
  'delivered but unopened': 'new',
  opened: 'in_process',
};

function requireKnownParcelState(token) {
  const state = PARCEL_STATES[token];
  if (!state) {
    throw new Error(`unknown <parcel state> token: ${JSON.stringify(token)} (known: ${Object.keys(PARCEL_STATES).join(', ')})`);
  }
  return state;
}

// Hardening (BL-1048): the Background creates ctx.root, but a Given step
// below can throw while VALIDATING an Examples value (requireKnownParcelState
// on an unrecognized <parcel state> token, or the later-role bound check)
// before the When step's own try/finally ever runs - the same cross-step
// leak shape documented against bl931RotatePackGateSteps.js. Confirmed
// leaking a real fixture dir into $TMPDIR on a mutated <parcel state> token
// during this ticket's own hardening pass. A try/finally local to the
// throwing step cannot save it either: the dir was created by a DIFFERENT
// (earlier) step. Every throw that can fire before the When step's cleanup
// must release the fixture itself.
function cleanupFixture(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
}

function mailboxDir(root, role, state) {
  const segments = state === 'new' ? ['inbox', 'new'] : ['inbox', 'in_process'];
  return MASTER_RESIDENT.has(role)
    ? path.join(root, '.swarmforge', 'handoffs', role, ...segments)
    : path.join(root, `wt-${role}`, '.swarmforge', 'handoffs', ...segments);
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const lines = ROLES.map(
    ([role, worktree]) =>
      `${role}\t${worktree}\t${worktree === 'master' ? root : path.join(root, `wt-${role}`)}\tswarmforge-${role}\t${role}\tclaude\ttask`
  );
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${lines.join('\n')}\n`);
}

function markActive(ctx, ticketId) {
  const dir = path.join(ctx.root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ticketId}-fixture.yaml`), `id: ${ticketId}\ntitle: "fixture ticket"\n`);
  if (!ctx.activeIds.includes(ticketId)) {
    ctx.activeIds.push(ticketId);
  }
}

function writeGitHandoff(ctx, role, state, ticketId) {
  const dir = mailboxDir(ctx.root, role, state);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `50_${role}_${state}.handoff`),
    `from: coordinator\nto: ${role}\ntype: git_handoff\npriority: 50\ntask: ${ticketId}-slice\ncommit: 1234567890\n\nmerge_and_process coordinator 1234567890\n`
  );
}

function writeNote(ctx, role, state, ticketId) {
  const dir = mailboxDir(ctx.root, role, state);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `10_${role}_${state}_note.handoff`),
    `from: coordinator\nto: ${role}\ntype: note\npriority: 10\nmessage: ${ticketId} promoted to active/ — starting now\n\nRe-read your role and constitution.\n`
  );
}

function rowsFor(ctx, ticketId) {
  return ctx.board.rows.filter((r) => r.id === ticketId);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a pipeline board rendered from the roles' mailboxes$/, (ctx) => {
    // "aps-" prefix so fixture_reaper_lib.bb's known-fixture-prefixes
    // already covers anything a killed run leaves behind; the render step
    // below removes it on the normal path regardless.
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1048-'));
    writeRolesTsv(ctx.root);
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'active'), { recursive: true });
    ctx.activeIds = [];
    ctx.ticketId = 'BL-1048';
    ctx.role = 'cleaner';
  });

  // ── Givens ───────────────────────────────────────────────────────────
  // Scenario Outline -01, and scenarios -03/-05's own literal Given lines
  // (which are this same step text with the token spelled out).
  scoped(/^a ticket's parcel is (.+) at a role$/, (ctx, parcelStateToken) => {
    let state;
    try {
      state = requireKnownParcelState(parcelStateToken);
    } catch (err) {
      cleanupFixture(ctx);
      throw err;
    }
    markActive(ctx, ctx.ticketId);
    writeGitHandoff(ctx, ctx.role, state, ctx.ticketId);
  });

  // ── Scenario -02 ─────────────────────────────────────────────────────
  scoped(/^an active ticket has no parcel at any role$/, (ctx) => {
    markActive(ctx, ctx.ticketId);
  });

  // ── Scenario -03 ─────────────────────────────────────────────────────
  // The later role is DERIVED from the role already holding it (one step
  // further down roles.tsv order), so "later" is true by construction
  // rather than by two independently-chosen role names that happen to be
  // in the right order.
  scoped(/^that ticket's parcel is delivered but unopened at a later role$/, (ctx) => {
    const order = ROLES.map(([role]) => role);
    const laterIndex = order.indexOf(ctx.role) + 1;
    if (!(laterIndex > 0 && laterIndex < order.length)) {
      cleanupFixture(ctx);
      throw new Error(`no role later than ${ctx.role} in roles.tsv order`);
    }
    ctx.laterRole = order[laterIndex];
    writeGitHandoff(ctx, ctx.laterRole, 'new', ctx.ticketId);
  });

  // ── Scenario -04 ─────────────────────────────────────────────────────
  scoped(/^a ticket is named only by a delivered but unopened note at a role$/, (ctx) => {
    markActive(ctx, ctx.ticketId);
    // A note carries no task: header at all (handoff-protocol.md forbids
    // one) - its id lives only in the message header, so this proves the
    // widened source reads the same headers the opened scan already did.
    writeNote(ctx, ctx.role, 'new', ctx.ticketId);
  });

  // ── Scenario -05 ─────────────────────────────────────────────────────
  scoped(/^that ticket is no longer active$/, (ctx) => {
    fs.rmSync(path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}-fixture.yaml`), { force: true });
    ctx.activeIds = ctx.activeIds.filter((id) => id !== ctx.ticketId);
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^the board is rendered$/, (ctx) => {
    try {
      execFileSync('bb', [CLI, ctx.root, 'sync'], { encoding: 'utf8' });
      const roleHeldTickets = invertTicketStageToRoleHeldTickets(readTicketStageMap(ctx.root));
      ctx.board = computePipelineBoard(roleHeldTickets, [], {}, { activeIds: ctx.activeIds });
    } finally {
      // The board is fully computed in memory by here, so every Then below
      // reads ctx.board, never the fixture - remove it in a finally rather
      // than after the last assertion, so a bounce or throw cannot leak it.
      cleanupFixture(ctx);
    }
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^that ticket's row names that role$/, (ctx) => {
    const rows = rowsFor(ctx, ctx.ticketId);
    assert.equal(rows.length, 1, `expected exactly one row for ${ctx.ticketId}, got ${JSON.stringify(ctx.board.rows)}`);
    assert.equal(rows[0].column, ctx.role, `expected ${ctx.ticketId} at the "${ctx.role}" stage, got "${rows[0].column}"`);
  });

  scoped(/^the not-started column does not name it$/, (ctx) => {
    const named = ctx.board.rows.filter((r) => r.id === ctx.ticketId && r.column === PIPELINE_BOARD_NOT_STARTED_COLUMN);
    assert.equal(named.length, 0, `expected ${ctx.ticketId} absent from the not-started column, got ${JSON.stringify(ctx.board.rows)}`);
  });

  scoped(/^the not-started column names that ticket$/, (ctx) => {
    const rows = rowsFor(ctx, ctx.ticketId);
    assert.equal(rows.length, 1, `expected exactly one row for ${ctx.ticketId}, got ${JSON.stringify(ctx.board.rows)}`);
    assert.equal(
      rows[0].column,
      PIPELINE_BOARD_NOT_STARTED_COLUMN,
      `expected ${ctx.ticketId} in the not-started column, got "${rows[0].column}"`
    );
  });

  scoped(/^that ticket's row names the later role$/, (ctx) => {
    const rows = rowsFor(ctx, ctx.ticketId);
    assert.equal(rows.length, 1, `expected exactly one row for ${ctx.ticketId}, got ${JSON.stringify(ctx.board.rows)}`);
    assert.equal(rows[0].column, ctx.laterRole, `expected ${ctx.ticketId} at the later "${ctx.laterRole}" stage, got "${rows[0].column}"`);
  });

  scoped(/^no other column names that ticket$/, (ctx) => {
    const elsewhere = ctx.board.rows.filter((r) => r.id === ctx.ticketId && r.column !== ctx.laterRole);
    assert.equal(elsewhere.length, 0, `expected ${ctx.ticketId} in no column but "${ctx.laterRole}", got ${JSON.stringify(ctx.board.rows)}`);
  });

  scoped(/^no row names that ticket$/, (ctx) => {
    assert.equal(rowsFor(ctx, ctx.ticketId).length, 0, `expected no row for ${ctx.ticketId}, got ${JSON.stringify(ctx.board.rows)}`);
  });
}

module.exports = { registerSteps };
