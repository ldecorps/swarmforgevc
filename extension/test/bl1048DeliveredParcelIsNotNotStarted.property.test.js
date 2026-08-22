'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSharedTmpDir } = require('./helpers/tmpDir');

// BL-1048 declared invariants, coder-first authorship (BL-654):
//
//   1. "A ticket whose parcel has been delivered to a role is never
//      rendered not-started: the not-started column means no role has the
//      parcel, not that no role has opened it yet."
//   2. "One ticket resolves to exactly one role, whatever mix of delivered
//      and opened parcels it is observed in - widening the scanned source
//      set never reintroduces BL-464's double row."
//
// Drives the REAL end-to-end chain the live board runs - `bb
// pipeline_stage_cli.bb sync` (the coordinator's own writer, whose
// role-ticket-pairs-for this ticket widens) -> readTicketStageMap ->
// invertTicketStageToRoleHeldTickets -> computePipelineBoard, with
// activeIds supplied exactly the way conciergeTick.ts's
// activeMembershipIds does (the backlog/active/ set) so the not-started
// column is genuinely reachable. Never a reimplementation of either half:
// the expected column per draw is derived from the DRAW, not from the
// code under test.
//
// GENERATOR REACH (asserted, never hoped for - see the reach floors at the
// bottom). Two things are constructed rather than sampled:
//
//   (a) The delivered/opened mix. Every ticket's observation set is built
//       from an explicit SHAPE, so `delivered-only` - the state that used
//       to render NS and is the whole point of the ticket - is drawn as
//       often as `opened-only`, instead of being a rare corner of a
//       uniform random state draw.
//   (b) The double-row candidates for invariant 2. A collision pair is
//       never drawn independently and hoped to collide: the second
//       observation is DERIVED from the first by exactly the two
//       transformations the scan could conflate - flip the mailbox state
//       at the SAME role (delivered + opened at one door), and advance the
//       role downstream (the handoff transition window this widening makes
//       common). Every multi-observation ticket is therefore a double-row
//       candidate by construction.
//
// NON-VACUITY (staged-first restore, run 2026-08-22, recorded in the
// parcel commit):
//   - break 1 (inv 1): revert pipeline_stage_cli.bb's scanned-mailbox-states
//     to `:in_process` only -> every delivered-only ticket renders NS; the
//     invariant-1 assertion goes RED on the first `delivered-only` shape.
//   - break 2 (inv 2): replace reconcile-stage-map with a FIRST-wins fold
//     over the raw pairs, inverting most-downstream-wins to upstream-wins
//     -> RED on the first cross-role shape ("BL-9000: expected column
//     \"coder\", got \"specifier\"").
//
//     Recorded because it is a live trap for the next person who tries to
//     re-confirm this: the OBVIOUS break here - a plain LAST-wins fold -
//     does NOT go red, and it is not the assertion's fault. compute-stage-
//     map builds its pairs with `mapcat role-ticket-pairs-for roles` over
//     roles.tsv order, so last-pair-wins silently AGREES with most-
//     downstream-wins for every input this fixture can produce. Only a
//     fold that actually contradicts the rank rule exercises the
//     assertion. A last-wins fold passing is not evidence of a vacuous
//     test; it is evidence that reconciliation and iteration order happen
//     to encode the same answer.
//
//     Worth being precise about WHICH assertion catches it: the stage map
//     is a JSON object keyed by ticket id, so two entries for one ticket
//     are structurally impossible there (swarmState.ts's own "trivially one
//     role per ticket id by construction" note) - it is the derived-column
//     assertion, not the row count, that has the teeth against losing
//     reconciliation. The exactly-one-row assertion is the belt-and-braces
//     half, guarding the day that source shape ever widens.
// Both were confirmed RED before restoring.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');
const OUT = path.join(REPO_ROOT, 'extension', 'out');
const { readTicketStageMap, invertTicketStageToRoleHeldTickets } = require(path.join(OUT, 'swarm', 'swarmState'));
const { computePipelineBoard, PIPELINE_BOARD_NOT_STARTED_COLUMN } = require(path.join(OUT, 'concierge', 'pipelineBoard'));

// roles.tsv order verbatim from the live .swarmforge/roles.tsv - rank
// (and therefore reconcile-stage-map's most-downstream-wins) is that file's
// own order, so the fixture must not invent a different one. specifier and
// coordinator are master-resident (one shared checkout, per-role mailbox
// subdirectory); every other role has its own worktree and the flat layout.
const ROLES = [
  { role: 'specifier', worktree: 'master' },
  { role: 'coder', worktree: 'coder' },
  { role: 'cleaner', worktree: 'cleaner' },
  { role: 'architect', worktree: 'architect' },
  { role: 'hardender', worktree: 'hardender' },
  { role: 'documenter', worktree: 'documenter' },
  { role: 'QA', worktree: 'QA' },
  { role: 'coordinator', worktree: 'master' },
];
const MASTER_RESIDENT = new Set(ROLES.filter((r) => r.worktree === 'master').map((r) => r.role));
const ROLE_NAMES = ROLES.map((r) => r.role);
const RANK = new Map(ROLE_NAMES.map((r, i) => [r, i]));

// buildGridRows renders a coordinator-held ticket in the QA column (BL-507:
// the grid has no coordinator column). Modelled here so the expected column
// is derived from the draw rather than read back from the renderer.
function renderedColumnFor(role) {
  return role === 'coordinator' ? 'QA' : role;
}

// The observation shapes. Each names how many parcels a ticket is observed
// in and, for the multi-observation ones, how the SECOND is derived from
// the first - never an independent second draw.
const SHAPES = [
  'none', // no parcel anywhere: must stay not-started
  'delivered-only', // inbox/new/ only: the defect this ticket closes
  'opened-only', // inbox/in_process/ only: the pre-existing behavior
  'both-states-same-role', // derived: flip the state at the SAME door
  'opened-then-delivered-downstream', // derived: advance the role, delivered
  'delivered-then-opened-downstream', // derived: advance the role, opened
];

function mailboxDir(root, role, state) {
  const stateSegments = state === 'new' ? ['inbox', 'new'] : ['inbox', 'in_process'];
  return MASTER_RESIDENT.has(role)
    ? path.join(root, '.swarmforge', 'handoffs', role, ...stateSegments)
    : path.join(root, `wt-${role}`, '.swarmforge', 'handoffs', ...stateSegments);
}

function writeParcel(root, obs, ticketId, seq) {
  const base = mailboxDir(root, obs.role, obs.state);
  const dir = obs.batched ? path.join(base, `batch_20260822T00000${seq % 10}Z_x`) : base;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${obs.kind === 'note' ? '10' : '50'}_${seq}.handoff`);
  const body =
    obs.kind === 'note'
      ? `from: coordinator\nto: ${obs.role}\ntype: note\npriority: 10\nmessage: ${ticketId} promoted to active/ — starting now\n\nRe-read your role and constitution.\n`
      : `from: coordinator\nto: ${obs.role}\ntype: git_handoff\npriority: 50\ntask: ${ticketId}-slice\ncommit: 12345678${seq % 10}0\n\nmerge_and_process coordinator 12345678${seq % 10}0\n`;
  fs.writeFileSync(file, body);
}

// The observation set for one ticket, built from its shape. `baseIndex`
// picks the first role; a downstream shape derives the second role from it
// by advancing along roles.tsv order - so "the same ticket at two roles"
// is guaranteed by construction on every such draw.
function observationsFor(shape, baseIndex, kind, batched) {
  const first = ROLE_NAMES[baseIndex % ROLE_NAMES.length];
  const downstream = ROLE_NAMES[Math.min(baseIndex + 1 + (baseIndex % 2), ROLE_NAMES.length - 1)];
  switch (shape) {
    case 'none':
      return [];
    case 'delivered-only':
      return [{ role: first, state: 'new', kind, batched }];
    case 'opened-only':
      return [{ role: first, state: 'in_process', kind, batched }];
    case 'both-states-same-role':
      return [
        { role: first, state: 'in_process', kind, batched },
        { role: first, state: 'new', kind, batched },
      ];
    case 'opened-then-delivered-downstream':
      return [
        { role: first, state: 'in_process', kind, batched },
        { role: downstream, state: 'new', kind, batched },
      ];
    case 'delivered-then-opened-downstream':
      return [
        { role: first, state: 'new', kind, batched },
        { role: downstream, state: 'in_process', kind, batched },
      ];
    default:
      throw new Error(`unknown shape ${shape}`);
  }
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const lines = ROLES.map(
    (r) =>
      `${r.role}\t${r.worktree}\t${r.worktree === 'master' ? root : path.join(root, `wt-${r.role}`)}\tswarmforge-${r.role}\t${r.role}\tclaude\ttask`
  );
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${lines.join('\n')}\n`);
}

const coverage = {
  deliveredOnly: 0,
  openedOnly: 0,
  bothStatesSameRole: 0,
  crossRole: 0,
  deliveredNote: 0,
  deliveredBatched: 0,
  deliveredMasterResident: 0,
  noParcel: 0,
  closedButDelivered: 0,
};

let SHARED_ROOT;
let drawSeq = 0;

beforeAll(() => {
  SHARED_ROOT = mkSharedTmpDir('aps-bl1048-prop-');
});

// One draw: build the fixture, run the real chain, assert both invariants.
function runDraw(tickets) {
  const root = path.join(SHARED_ROOT, `draw-${drawSeq++}`);
  fs.mkdirSync(root, { recursive: true });
  writeRolesTsv(root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });

  const activeIds = [];
  const expectedColumn = new Map();
  const closedIds = [];
  let seq = 0;

  tickets.forEach((t, i) => {
    const ticketId = `BL-${9000 + i}`;
    const observations = observationsFor(t.shape, t.baseIndex, t.kind, t.batched);
    for (const obs of observations) {
      writeParcel(root, obs, ticketId, seq++);
    }

    if (t.active) {
      activeIds.push(ticketId);
      fs.writeFileSync(
        path.join(root, 'backlog', 'active', `${ticketId}-fixture.yaml`),
        `id: ${ticketId}\ntitle: "fixture ticket"\n`
      );
      // Expected column, derived from the DRAW: most-downstream observed
      // role (reconcile-stage-map's own rule), with the coordinator->QA
      // grid remap applied. No observation at all => not-started.
      const winner = observations.reduce(
        (best, o) => (best === null || RANK.get(o.role) > RANK.get(best) ? o.role : best),
        null
      );
      expectedColumn.set(ticketId, winner === null ? PIPELINE_BOARD_NOT_STARTED_COLUMN : renderedColumnFor(winner));
    } else {
      closedIds.push(ticketId);
      if (observations.some((o) => o.state === 'new')) {
        coverage.closedButDelivered++;
      }
    }

    // Reach accounting - what this draw actually exercised.
    const delivered = observations.filter((o) => o.state === 'new');
    const opened = observations.filter((o) => o.state === 'in_process');
    if (observations.length === 0) coverage.noParcel++;
    if (delivered.length > 0 && opened.length === 0) coverage.deliveredOnly++;
    if (opened.length > 0 && delivered.length === 0) coverage.openedOnly++;
    if (t.shape === 'both-states-same-role') coverage.bothStatesSameRole++;
    if (new Set(observations.map((o) => o.role)).size > 1) coverage.crossRole++;
    if (delivered.some((o) => o.kind === 'note')) coverage.deliveredNote++;
    if (delivered.some((o) => o.batched)) coverage.deliveredBatched++;
    if (delivered.some((o) => MASTER_RESIDENT.has(o.role))) coverage.deliveredMasterResident++;
  });

  execFileSync('bb', [CLI, root, 'sync'], { encoding: 'utf8' });
  const roleHeldTickets = invertTicketStageToRoleHeldTickets(readTicketStageMap(root));
  const board = computePipelineBoard(roleHeldTickets, [], {}, { activeIds });

  for (const [ticketId, expected] of expectedColumn) {
    const rows = board.rows.filter((r) => r.id === ticketId);

    // Invariant 2: exactly one row, whatever mix of delivered and opened
    // parcels the ticket was observed in.
    assert.equal(
      rows.length,
      1,
      `${ticketId}: expected exactly one row, got ${JSON.stringify(rows)} (root ${root})`
    );
    assert.equal(
      rows[0].column,
      expected,
      `${ticketId}: expected column "${expected}", got "${rows[0].column}" (root ${root})`
    );

    // Invariant 1: a ticket with a parcel delivered anywhere is never
    // not-started. Stated as its own assertion rather than left implicit
    // in the column check above, because it is the defect's own claim.
    if (expected !== PIPELINE_BOARD_NOT_STARTED_COLUMN) {
      assert.notEqual(
        rows[0].column,
        PIPELINE_BOARD_NOT_STARTED_COLUMN,
        `${ticketId}: a ticket whose parcel a role holds must never render not-started (root ${root})`
      );
    }
  }

  // A parcel naming a ticket no longer in backlog/active/ puts nothing on
  // the board - the widened source set never fabricates membership.
  for (const ticketId of closedIds) {
    assert.equal(
      board.rows.filter((r) => r.id === ticketId).length,
      0,
      `${ticketId}: a closed ticket must get no row (root ${root})`
    );
  }

  fs.rmSync(root, { recursive: true, force: true });
}

const ticketArb = fc.record({
  shape: fc.constantFrom(...SHAPES),
  baseIndex: fc.integer({ min: 0, max: ROLE_NAMES.length - 1 }),
  kind: fc.constantFrom('git_handoff', 'note'),
  batched: fc.boolean(),
  // Mostly active (the board's own membership set); a minority closed, so
  // the filter-active half of the widening is exercised too.
  active: fc.oneof({ arbitrary: fc.constant(true), weight: 4 }, { arbitrary: fc.constant(false), weight: 1 }),
});

describe('BL-1048: a delivered parcel is not not-started', () => {
  it('renders every ticket with a delivered or opened parcel at exactly one real role, and only a parcel-less ticket as not-started', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { minLength: 2, maxLength: 6 }), (tickets) => {
        runDraw(tickets);
      }),
      { numRuns: Number(process.env.PROPERTY_RUNS ?? 24), verbose: false }
    );

    // Reach floors: absolute counts, asserted rather than hoped for. A
    // property that never reaches the delivered-only state would pass
    // against the live defect (the failure shape BL-654's generator-reach
    // clause exists to close), so the floors are part of the test.
    assert.ok(coverage.deliveredOnly >= 8, `delivered-only reach too low: ${JSON.stringify(coverage)}`);
    assert.ok(coverage.openedOnly >= 8, `opened-only reach too low: ${JSON.stringify(coverage)}`);
    assert.ok(coverage.bothStatesSameRole >= 4, `both-states-same-role reach too low: ${JSON.stringify(coverage)}`);
    assert.ok(coverage.crossRole >= 6, `cross-role double-row candidate reach too low: ${JSON.stringify(coverage)}`);
    assert.ok(coverage.deliveredNote >= 4, `delivered-note reach too low: ${JSON.stringify(coverage)}`);
    assert.ok(coverage.deliveredBatched >= 4, `delivered-batch_ reach too low: ${JSON.stringify(coverage)}`);
    assert.ok(
      coverage.deliveredMasterResident >= 2,
      `delivered master-resident reach too low: ${JSON.stringify(coverage)}`
    );
    assert.ok(coverage.noParcel >= 4, `no-parcel (genuinely not-started) reach too low: ${JSON.stringify(coverage)}`);
    assert.ok(coverage.closedButDelivered >= 2, `closed-but-delivered reach too low: ${JSON.stringify(coverage)}`);
  });
});
