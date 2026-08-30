'use strict';

// BL-670 acceptance: the board says WHERE a ticket is AND whether that role has
// claimed it, since when, and how bruised the ticket is.
//
// Every scenario drives the REAL derivation over a REAL fixture tree - the same
// `pipeline_stage_cli.bb report` the concierge tick shells to on every tick -
// and reads the answer out of its JSON. Nothing here re-implements the rule; a
// second copy of it is precisely how the board and its consumers could come to
// disagree, which invariant 2 forbids.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');
const {
  readTicketStageMap,
  invertTicketStageToRoleHeldTickets,
  TICKET_STAGE_STATUS_CLAIMED,
  TICKET_STAGE_STATUS_IN_TRANSIT,
  TICKET_STAGE_STATUS_LAST_KNOWN,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'swarm', 'swarmState'));

const FEATURE_NAME = 'pipeline board shows last-known stage, never renders in-transit as not-started';

// Scenario Outline placeholders, validated against explicit known values.
const LOCATION_TO_STATUS = {
  "claimed in a role's in_process box": TICKET_STAGE_STATUS_CLAIMED,
  "waiting in the next role's new/ inbox": TICKET_STAGE_STATUS_IN_TRANSIT,
  'recorded only in the durable sent/ trail': TICKET_STAGE_STATUS_LAST_KNOWN,
};
const KNOWN_DOTS = new Set(['green', 'yellow', 'red']);

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

function fixtureRoot(ctx) {
  if (ctx.bl670.root) {
    return ctx.bl670.root;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl670-stage-'));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    ROLES.map(([role, worktree]) => {
      const wtPath = worktree === 'master' ? root : path.join(root, `wt-${role}`);
      return `${role}\t${worktree}\t${wtPath}\tswarmforge-${role}\t${role}\tclaude\ttask`;
    }).join('\n') + '\n'
  );
  ctx.bl670.root = root;
  return root;
}

// The physical mailbox shape handoff_lib.bb's mailbox-base-dir defines: a
// worktree role is FLAT, and only a master-resident role gets the per-role
// subdirectory. Getting this wrong is how a live pipeline reads as empty.
function mailboxDir(root, role, state) {
  const worktree = ROLES.find(([r]) => r === role)[1];
  const base =
    worktree === 'master'
      ? path.join(root, '.swarmforge', 'handoffs', role)
      : path.join(root, `wt-${role}`, '.swarmforge', 'handoffs');
  const dir = state === 'sent' ? path.join(base, 'sent') : path.join(base, 'inbox', state);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function activeTicket(ctx, id, bounces = 0) {
  const root = fixtureRoot(ctx);
  const history = bounces
    ? `bounce_history:\n${Array.from({ length: bounces }, (_, i) => `  - { at: 2026-08-3${i}, by: architect, blamed: coder }`).join('\n')}\n`
    : '';
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}.yaml`), `id: ${id}\ntitle: "t"\n${history}`);
}

function writeParcel(ctx, { role, state, ticketId, to, at }) {
  const dir = mailboxDir(fixtureRoot(ctx), role, state);
  const headers = [
    'from: coordinator',
    `to: ${to ?? role}`,
    'type: git_handoff',
    'priority: 50',
    `task: ${ticketId}-slice`,
    'commit: 1234567890',
    at ? `created_at: ${at}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  fs.writeFileSync(path.join(dir, `50_${ticketId}_${state}.handoff`), `${headers}\n\nmerge_and_process coordinator 1234567890\n`);
}

function derive(ctx) {
  const run = spawnSync('bb', [CLI, fixtureRoot(ctx), 'report'], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(run.status, 0, `the derivation failed: ${run.stdout}${run.stderr}`);
  ctx.bl670.map = JSON.parse(run.stdout.trim().split('\n').pop());
  return ctx.bl670.map;
}

function discard(ctx) {
  if (ctx.bl670 && ctx.bl670.root) {
    fs.rmSync(ctx.bl670.root, { recursive: true, force: true });
    ctx.bl670.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  const reset = (ctx) => {
    ctx.bl670 = { root: null };
  };

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^ticket 647 traversed specifier and coder and its parcel now sits in the cleaner's new\/ inbox$/, (ctx) => {
    reset(ctx);
    activeTicket(ctx, 'BL-647');
    ctx.bl670.asOf = '2026-07-26T10:11:00Z';
    writeParcel(ctx, { role: 'specifier', state: 'sent', ticketId: 'BL-647', to: 'coder', at: '2026-07-26T09:52:00Z' });
    writeParcel(ctx, { role: 'coder', state: 'sent', ticketId: 'BL-647', to: 'cleaner', at: ctx.bl670.asOf });
    writeParcel(ctx, { role: 'cleaner', state: 'new', ticketId: 'BL-647', at: ctx.bl670.asOf });
  });

  scoped(/^a stale orphaned night-batch claim with no derivable ticket id also sits in_process$/, (ctx) => {
    const dir = mailboxDir(fixtureRoot(ctx), 'cleaner', 'in_process');
    const batch = path.join(dir, 'batch_20260726T000000Z_night');
    fs.mkdirSync(batch, { recursive: true });
    fs.writeFileSync(path.join(batch, '50_orphan.handoff'), 'from: coordinator\nto: cleaner\ntype: note\npriority: 50\nmessage: overnight sweep\n\novernight sweep\n');
  });

  scoped(/^the board's ticket stage is derived$/, (ctx) => {
    derive(ctx);
  });

  scoped(/^ticket 647 derives stage cleaner with status in-transit-to as of 10:11$/, (ctx) => {
    const entry = ctx.bl670.map['BL-647'];
    assert.ok(entry, 'the ticket derived nothing at all');
    assert.equal(entry.stage, 'cleaner');
    assert.equal(entry.status, TICKET_STAGE_STATUS_IN_TRANSIT);
    assert.ok(entry.asOf, 'the derivation carries no as-of time');
    assert.equal(new Date(entry.asOf).toISOString().slice(11, 16), '10:11', `as-of reads ${entry.asOf}`);
    // The orphan neither crashed the derivation nor took a row of its own.
    assert.deepEqual(Object.keys(ctx.bl670.map), ['BL-647']);
    discard(ctx);
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^a ticket whose most recent observable parcel is (.+)$/, (ctx, location) => {
    const status = LOCATION_TO_STATUS[location];
    assert.ok(status, `unknown location example value "${location}"`);
    reset(ctx);
    ctx.bl670.expectedStatus = status;
    activeTicket(ctx, 'BL-900');
    const at = '2026-08-30T08:00:00Z';
    if (status === TICKET_STAGE_STATUS_CLAIMED) {
      writeParcel(ctx, { role: 'cleaner', state: 'in_process', ticketId: 'BL-900', at });
    } else if (status === TICKET_STAGE_STATUS_IN_TRANSIT) {
      writeParcel(ctx, { role: 'cleaner', state: 'new', ticketId: 'BL-900', at });
    } else {
      writeParcel(ctx, { role: 'coder', state: 'sent', ticketId: 'BL-900', to: 'cleaner', at });
    }
  });

  scoped(/^that ticket derives status (.+) with an as-of time$/, (ctx, status) => {
    assert.equal(status, ctx.bl670.expectedStatus, 'the Examples row disagrees with its own location');
    const entry = ctx.bl670.map['BL-900'];
    assert.ok(entry, 'the ticket derived nothing at all');
    assert.equal(entry.status, status);
    assert.equal(entry.stage, 'cleaner');
    assert.ok(entry.asOf, 'no as-of time on the derivation');
    discard(ctx);
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^a ticket whose stage is derived from the durable handoff trail$/, (ctx) => {
    reset(ctx);
    activeTicket(ctx, 'BL-901');
    writeParcel(ctx, { role: 'hardender', state: 'sent', ticketId: 'BL-901', to: 'documenter', at: '2026-08-30T07:00:00Z' });
    // Persist it the way `sync` does, so both consumers read one store.
    const run = spawnSync('bb', [CLI, fixtureRoot(ctx), 'sync'], { encoding: 'utf8', cwd: REPO_ROOT });
    assert.equal(run.status, 0, `sync failed: ${run.stdout}${run.stderr}`);
  });

  scoped(/^both the board and the completion ring read that ticket's stage$/, (ctx) => {
    // The board's own reader, and the same reader a second consumer uses -
    // one derivation, one store, so there is nowhere for them to diverge.
    ctx.bl670.boardView = readTicketStageMap(ctx.bl670.root);
    ctx.bl670.ringView = readTicketStageMap(ctx.bl670.root);
    ctx.bl670.roleHeld = invertTicketStageToRoleHeldTickets(ctx.bl670.boardView);
  });

  scoped(/^they report the same stage, status and as-of time$/, (ctx) => {
    const board = ctx.bl670.boardView['BL-901'];
    const ring = ctx.bl670.ringView['BL-901'];
    assert.ok(board, 'the board sees no stage for the ticket');
    assert.deepEqual(board, ring);
    assert.equal(board.stage, 'documenter');
    assert.equal(board.status, TICKET_STAGE_STATUS_LAST_KNOWN);
    assert.ok(board.asOf);
    // ...and the inverted view the grid renders names the same role.
    assert.deepEqual(ctx.bl670.roleHeld.documenter, ['BL-901']);
    discard(ctx);
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^a ticket with (\d+) recorded bounces$/, (ctx, bounces) => {
    reset(ctx);
    ctx.bl670.bounces = Number(bounces);
    activeTicket(ctx, 'BL-902', ctx.bl670.bounces);
    writeParcel(ctx, { role: 'coder', state: 'in_process', ticketId: 'BL-902', at: '2026-08-30T08:00:00Z' });
  });

  scoped(/^its health dot is derived$/, (ctx) => {
    derive(ctx);
  });

  scoped(/^the dot is (green|yellow|red)$/, (ctx, colour) => {
    assert.ok(KNOWN_DOTS.has(colour), `unknown dot colour example value "${colour}"`);
    const entry = ctx.bl670.map['BL-902'];
    assert.ok(entry, 'the ticket derived nothing at all');
    assert.equal(entry.healthDot, colour, `${ctx.bl670.bounces} bounce(s) painted ${entry.healthDot}`);
    discard(ctx);
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  scoped(/^every role's in_process and new\/ boxes are empty$/, (ctx) => {
    reset(ctx);
    activeTicket(ctx, 'BL-903');
    for (const [role] of ROLES) {
      mailboxDir(fixtureRoot(ctx), role, 'in_process');
      mailboxDir(fixtureRoot(ctx), role, 'new');
    }
  });

  scoped(/^the durable sent\/ trail records the ticket forwarded to the documenter$/, (ctx) => {
    writeParcel(ctx, { role: 'hardender', state: 'sent', ticketId: 'BL-903', to: 'documenter', at: '2026-08-30T06:00:00Z' });
  });

  scoped(/^that ticket derives stage documenter with status last-known$/, (ctx) => {
    const entry = ctx.bl670.map['BL-903'];
    assert.ok(entry, 'the board went blind on a ticket the trail knows about');
    assert.equal(entry.stage, 'documenter');
    assert.equal(entry.status, TICKET_STAGE_STATUS_LAST_KNOWN);
    assert.ok(entry.asOf);
    discard(ctx);
  });
}

module.exports = { registerSteps };
