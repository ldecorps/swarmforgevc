'use strict';

// BL-1340's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  No live ticket is refused promotion for a condition that no
//                action available to any role can clear while it stays
//                unpromoted.
//   invariant 2  Article 3.2.4 expedite ordering is decided over the full
//                eligible candidate set - no earlier filter may drop or
//                deprioritise an expedited defect before that ordering runs.
//
// Both drive the REAL swarmforge/scripts/promotion_gates_cli.bb against
// generated fixture roots - never a JavaScript restatement of the gate.
//
// GENERATOR REACH (the asserted floor, never a hoped-for one). The deadlock
// lives in one corner: a ticket whose acceptance names ITS OWN draft while
// its charter pins that draft's conversion. Drawing pointers and charters
// independently would reach that pair rarely, so the pointer is DERIVED from
// the ticket - every generated draft is the ticket's own - and the pin is
// drawn separately, which is precisely the axis the old gate conflated. The
// run fails unless it reached self-converting tickets, parked ones, and (for
// invariant 2) candidate sets where the expedited defect is the one the old
// buildability partition would have starved.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GATES_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
const ROUTE_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promote_and_route_next.sh');
const FIXTURE_PREFIX = 'bl1340-property-';

const PIN = "  - 'specs/pipeline/steps/index.js::bl1340Steps::the handler this parcel registers'";

function newRoot() {
  const root = mkTmpDir(FIXTURE_PREFIX);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 5\n');
  return root;
}

// Every ticket's acceptance names ITS OWN feature path - the pointer is
// derived from the id, never drawn beside it, so a self-converting candidate
// is produced by construction rather than by luck.
function writeTicket(root, t) {
  const rel = `specs/features/${t.id}-slice.feature${t.draft ? '.draft' : ''}`;
  fs.writeFileSync(path.join(root, rel), 'Feature: the slice\n');
  const lines = [
    `id: ${t.id}`,
    `title: "${t.id} fixture"`,
    `type: ${t.expedited ? 'defect' : 'feature'}`,
    ...(t.expedited ? ['severity: high'] : []),
    'human_approval: approved',
    'epic: solo',
    `priority: ${t.priority}`,
    `acceptance: ${rel}`,
    ...(t.pinned ? ['required_wiring:', PIN] : []),
    '',
  ];
  const file = path.join(root, 'backlog', 'paused', `${t.id}-fixture.yaml`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

function runCli(args) {
  const result = spawnSync('bb', [GATES_CLI, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  return { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
}

const ticketArb = (index) =>
  fc.record({ draft: fc.boolean(), pinned: fc.boolean(), expedited: fc.boolean() }).map((t) => ({
    ...t,
    id: `BL-94${String(index).padStart(2, '0')}`,
    priority: 10,
  }));

test('BL-1340/BL-654 invariant 1: promotion never refuses for a condition no role can clear while the ticket stays unpromoted', () => {
  // BL-1691: the three named cells constructed directly - each cell's own
  // generator fixes draft/pinned to guarantee that cell's shape; expedited
  // stays randomized (unused by this test's own assertions).
  const CELL_ARBS = {
    selfConverting: () => fc.record({ draft: fc.constant(true), pinned: fc.constant(true), expedited: fc.boolean() }),
    parked: () => fc.record({ draft: fc.constant(true), pinned: fc.constant(false), expedited: fc.boolean() }),
    live: () => fc.record({ draft: fc.constant(false), pinned: fc.boolean(), expedited: fc.boolean() }),
  };
  const CELLS = Object.keys(CELL_ARBS);
  const PER_CELL_RUNS = runsPerCell(24, CELLS.length);
  const reach = { selfConverting: 0, parked: 0, live: 0 };

  for (const cell of CELLS) {
    fc.assert(
      fc.property(
        CELL_ARBS[cell]().map((t) => ({ ...t, id: `BL-9401`, priority: 10 })),
        (t) => {
          const root = newRoot();
          try {
            const file = writeTicket(root, t);
            const { status, out } = runCli(['evaluate', root, file, 'false', '5']);
            const selfConverting = t.draft && t.pinned;
            reach[selfConverting ? 'selfConverting' : t.draft ? 'parked' : 'live'] += 1;

            if (selfConverting) {
              // The deadlock case. Nothing available to any role clears it while
              // the ticket stays paused: the coordinator cannot promote, the
              // coder never receives it, and the specifier cannot repoint
              // `acceptance:` at a .feature that does not exist yet without
              // throwing the runner for every other parcel (BL-233).
              assert.equal(status, 0, `a self-converting draft was refused:\n${out}`);
              assert.match(out, /^ALLOW$/m);
            } else if (t.draft) {
              // A parked draft is still refused - and the refusal must say which
              // kind it is, or it reproduces the silence it removes.
              assert.notEqual(status, 0, `a parked draft was admitted:\n${out}`);
              assert.match(out, /parked/);
              assert.match(out, /no conversion pinned/);
            } else {
              assert.equal(status, 0, `a live feature pointer was refused:\n${out}`);
            }
            return true;
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: PER_CELL_RUNS },
    );
  }

  assertReachFloor(reach, CELLS, PER_CELL_RUNS, 'promotion-shape');
});

test('BL-1340/BL-654 invariant 2: the expedite lane is decided over the full candidate set, never after a buildability filter', () => {
  // BL-1691: the starvable shape is DERIVED, not hoped for - every draw
  // fixes one expedited-draft ticket (the starved candidate) and one
  // buildable non-expedited ticket (the one the old partition would have
  // preferred), then mixes in 0-2 further random tickets for variety. The
  // draw budget (24) and per-draw body are unchanged; only the array's own
  // construction guarantees the shape invariant 2 exercises.
  const REQUIRED = [
    { draft: true, pinned: true, expedited: true },
    { draft: false, pinned: true, expedited: false },
  ];
  const STARVABLE_SET_RUNS = runsPerCell(24, 1);
  const reach = { starvableSets: 0 };

  fc.assert(
    fc.property(
      fc.array(fc.record({ draft: fc.boolean(), pinned: fc.constant(true), expedited: fc.boolean() }), {
        minLength: 0,
        maxLength: 2,
      }),
      (extra) => {
        const raw = [...REQUIRED, ...extra];
        const root = newRoot();
        try {
          const tickets = raw.map((t, i) => ({
            ...t,
            id: `BL-95${String(i).padStart(2, '0')}`,
            // The non-expedited tickets get the BEST ticket priority, so if
            // anything but the expedite lane were deciding they would win.
            priority: t.expedited ? 90 : 1,
          }));
          const expedited = tickets.filter((t) => t.expedited);
          // The set the old bash partition would have starved: an expedited
          // defect pointing at a draft, alongside a buildable non-expedited one -
          // guaranteed present by REQUIRED above, on every draw.
          assert.ok(expedited.some((t) => t.draft) && tickets.some((t) => !t.expedited && !t.draft));
          reach.starvableSets += 1;

          const files = tickets.map((t) => writeTicket(root, t));
          const { status, out } = runCli(['select', root, '5', ...files]);
          assert.equal(status, 0, `select refused the whole set:\n${out}`);
          const picked = out.trim();
          assert.ok(
            expedited.some((t) => picked.includes(t.id)),
            `a non-expedited candidate outranked an expedited defect: ${picked}`,
          );
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: STARVABLE_SET_RUNS },
  );

  assertReachFloor(reach, ['starvableSets'], 1, 'starvable-set');
});

test('BL-1340/BL-654 invariant 2: the router hands the chokepoint one undivided candidate set', () => {
  // The half no fixture can observe from outside: the bash caller must not
  // pre-partition. A partition ahead of `select` silently outranks Article
  // 3.2.4 no matter how correct the chokepoint's own ordering is, and it is
  // invisible to any test that only asks the CLI.
  const script = fs.readFileSync(ROUTE_SCRIPT, 'utf8');
  assert.ok(!/is_buildable/.test(script), 'promote_and_route_next.sh still partitions candidates by buildability');
  const selectCalls = script.match(/promotion_gates_cli\.bb" select/g) || [];
  assert.equal(
    selectCalls.length,
    1,
    `the router calls select ${selectCalls.length} times; more than one call is a partition by another name`,
  );
});
