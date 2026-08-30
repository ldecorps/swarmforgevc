'use strict';

// BL-670's consumer-side invariants, coder-authored (BL-654), property lane
// only. Invariant 1 is about the DERIVATION and lives in the Babashka lane
// beside it (swarmforge/scripts/test/bl670_stage_qualifier_property_runner.bb);
// these two are about what the readers do with it.
//
// Invariant 2 - "ONE derivation, two consumers. The board and BL-659's
// completion ring read the same stage/status/as-of from the same durable
// trail, so they can never disagree."
//
//   Two consumers cannot disagree if they cannot each hold their own opinion,
//   so the property is stated over the READER: for any map on disk - including
//   the shapes a real store actually contains, qualified and pre-BL-670 bare
//   roles mixed together - two independent reads agree entry for entry, and
//   the inverted role-held view the grid renders names the same stage the
//   entry does. A reader that normalised differently on a second call, or an
//   inverter that disagreed with its own input, is exactly how the board and
//   the ring drift apart.
//
// Invariant 3 - "BL-487's freshness posture is preserved: the board recomputes
// from live state each tick and never regresses to trusting the
// coordinator-written cache as the source of truth."
//
//   The reader must hold no memory. Encoded as: rewrite the file between two
//   reads and the second read must show the NEW content - a memoised or
//   cached reader passes every other test in this file and fails this one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor } = require('./helpers/reachFloors');
const {
  readTicketStageMap,
  invertTicketStageToRoleHeldTickets,
  normaliseTicketStageEntry,
  TICKET_STAGE_STATUS_CLAIMED,
  TICKET_STAGE_STATUS_IN_TRANSIT,
  TICKET_STAGE_STATUS_LAST_KNOWN,
} = require('../out/swarm/swarmState');

const ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'documenter', 'QA'];
const STATUSES = [TICKET_STAGE_STATUS_CLAIMED, TICKET_STAGE_STATUS_IN_TRANSIT, TICKET_STAGE_STATUS_LAST_KNOWN];
const SHAPE_FLOOR = 15;

// The three value shapes a real ticket-stage-map.json contains: what the
// current CLI writes, what a pre-BL-670 checkout wrote, and the junk a torn
// write leaves. Drawn per entry rather than per file, because a real store
// mid-upgrade is MIXED and a per-file draw would never produce one.
const entryArb = fc.oneof(
  fc.record({
    stage: fc.constantFrom(...ROLES),
    status: fc.constantFrom(...STATUSES),
    asOf: fc.constant('2026-08-30T10:11:00Z'),
    healthDot: fc.constantFrom('green', 'yellow', 'red'),
  }),
  fc.constantFrom(...ROLES),
  fc.constantFrom(null, 42, '', {}, { status: 'claimed' })
);

const mapArb = fc
  .array(fc.tuple(fc.integer({ min: 1, max: 40 }).map((n) => `BL-${n}`), entryArb), { minLength: 0, maxLength: 12 })
  .map((pairs) => Object.fromEntries(pairs));

function withStore(map, body) {
  const root = mkTmpDir('bl670-prop-');
  try {
    fs.mkdirSync(path.join(root, '.swarmforge', 'board'), { recursive: true });
    const file = path.join(root, '.swarmforge', 'board', 'ticket-stage-map.json');
    fs.writeFileSync(file, JSON.stringify(map));
    return body(root, file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('BL-670 invariant 2: one derivation, two consumers that cannot disagree', () => {
  it('reads the same entries twice, and inverts to the same stages', () => {
    const coverage = {};
    fc.assert(
      fc.property(mapArb, (map) => {
        for (const value of Object.values(map)) {
          coverage[typeof value === 'string' ? 'bare' : normaliseTicketStageEntry(value) ? 'qualified' : 'junk'] =
            (coverage[typeof value === 'string' ? 'bare' : normaliseTicketStageEntry(value) ? 'qualified' : 'junk'] || 0) + 1;
        }
        return withStore(map, (root) => {
          const board = readTicketStageMap(root);
          const ring = readTicketStageMap(root);

          assert.deepEqual(board, ring, 'two consumers read the same store differently');

          const roleHeld = invertTicketStageToRoleHeldTickets(board);
          for (const [ticketId, entry] of Object.entries(board)) {
            assert.ok(
              (roleHeld[entry.stage] || []).includes(ticketId),
              `${ticketId} reads as ${entry.stage} but the grid view does not place it there`
            );
            assert.ok(STATUSES.includes(entry.status), `${ticketId} carries an unknown status ${entry.status}`);
          }
          // ...and nothing appears in the grid view that the map does not name.
          for (const [role, ids] of Object.entries(roleHeld)) {
            for (const id of ids) {
              assert.equal(board[id].stage, role, `${id} was placed at ${role} out of nowhere`);
            }
          }
          return true;
        });
      }),
      { numRuns: 60 }
    );
    assertReachFloor(coverage, ['qualified', 'bare', 'junk'], SHAPE_FLOOR, 'stored entry shape');
  });
});

describe('BL-670 invariant 3: the reader holds no memory of the cache', () => {
  it('shows the new content when the store changes between reads', () => {
    const coverage = {};
    fc.assert(
      fc.property(mapArb, mapArb, (before, after) => {
        coverage.draw = (coverage.draw || 0) + 1;
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          coverage.changed = (coverage.changed || 0) + 1;
        }
        return withStore(before, (root, file) => {
          const first = readTicketStageMap(root);
          fs.writeFileSync(file, JSON.stringify(after));
          const second = readTicketStageMap(root);

          return withStore(after, (freshRoot) => {
            assert.deepEqual(
              second,
              readTicketStageMap(freshRoot),
              'the second read did not reflect the rewritten store - the reader is trusting a cache'
            );
            assert.ok(first !== second, 'the reader handed back the same object twice');
            return true;
          });
        });
      }),
      { numRuns: 40 }
    );
    // A run whose two maps were always identical could not tell a fresh read
    // from a cached one.
    assertReachFloor(coverage, ['changed'], 20, 'draws where the store actually changed');
  });

  it('never fabricates a stage when the store is missing or torn', () => {
    fc.assert(
      fc.property(fc.string(), (junk) => {
        const root = mkTmpDir('bl670-torn-');
        try {
          assert.deepEqual(readTicketStageMap(root), {}, 'a missing store produced a stage');
          fs.mkdirSync(path.join(root, '.swarmforge', 'board'), { recursive: true });
          fs.writeFileSync(path.join(root, '.swarmforge', 'board', 'ticket-stage-map.json'), junk);
          const map = readTicketStageMap(root);
          for (const entry of Object.values(map)) {
            assert.ok(entry.stage, 'an entry with no stage escaped the reader');
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
        return true;
      }),
      { numRuns: 40 }
    );
  });
});
