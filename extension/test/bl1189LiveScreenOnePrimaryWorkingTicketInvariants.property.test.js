const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { resolveResidentHeldTicketMeta, dedupePrimaryWorkingTicket } = require('../out/concierge/residentPaneSpy');

// BL-1189 declared invariants, property-encoded. Runs only via
// `npm run test:properties`.

function mkRoot() {
  const root = mkTmpDir('bl1189-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  return root;
}

function writeRoleWithClaim(root, role, ticketId) {
  const worktree = path.join(root, `${role}-worktree`);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [role, role, worktree, `swarmforge-${role}`, role, 'claude'].join('\t') + '\n'
  );
  const dir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '00_claim.handoff'), `task: ${ticketId}-fixture\ndequeued_at: 2026-08-27T10:00:00Z\n\nbody\n`);
}

function writeBacklogItem(root, ticketId, folder) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ticketId}-fixture.yaml`), `id: ${ticketId}\ntitle: "fixture"\n`);
}

// Invariant 1: a ticket outside backlog/active (or nowhere at all) must
// never read as primary working now, regardless of a live in_process claim.
test('property (invariant 1): a claimed ticket reads as primary working iff it is in backlog/active', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 999 }),
      fc.constantFrom('active', 'done', 'paused', 'hold', 'nowhere'),
      (n, location) => {
        const root = mkRoot();
        const ticketId = `BL-${n}`;
        writeRoleWithClaim(root, 'coder', ticketId);
        if (location !== 'nowhere') {
          writeBacklogItem(root, ticketId, location);
        }

        const meta = resolveResidentHeldTicketMeta(root, 'coder');

        if (location === 'active') {
          assert.equal(meta.ticketId, ticketId, `expected ${ticketId} to read as primary working when active`);
        } else {
          assert.deepEqual(meta, {}, `expected no primary-working ticket when location is ${location}`);
        }
      }
    ),
    { numRuns: 30 }
  );
});

// Invariant 2: across one capture (one shared claimedTicketIds set), a
// given ticket is primary working on at most one seat.
test('property (invariant 2): exactly one survivor claims a given ticket across any number of simultaneous role claims', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 8 }), (claimCount) => {
      const claimed = new Set();
      const results = [];
      for (let i = 0; i < claimCount; i++) {
        results.push(dedupePrimaryWorkingTicket(claimed, { ticketId: 'BL-777', ticketTitle: `seat ${i}` }));
      }
      const survivors = results.filter((r) => r.ticketId === 'BL-777');
      assert.equal(survivors.length, 1, `expected exactly one survivor out of ${claimCount} simultaneous claims`);
      assert.equal(survivors[0].ticketTitle, 'seat 0', 'the FIRST claim in processing order must be the survivor');
    }),
    { numRuns: 20 }
  );
});

// Invariant 2, mixed with distinct tickets interleaved: dedup must be
// per-ticket, never collapsing unrelated tickets into each other.
test('property (invariant 2): distinct tickets interleaved with duplicates each keep exactly one survivor', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom('BL-1', 'BL-2', 'BL-3'), { minLength: 3, maxLength: 12 }),
      (ticketSequence) => {
        const claimed = new Set();
        const results = ticketSequence.map((ticketId) => dedupePrimaryWorkingTicket(claimed, { ticketId }));
        for (const ticketId of new Set(ticketSequence)) {
          const survivors = results.filter((r) => r.ticketId === ticketId);
          assert.equal(survivors.length, 1, `expected exactly one survivor for ${ticketId}`);
        }
      }
    ),
    { numRuns: 20 }
  );
});

// Non-vacuity: prove invariant 2's property would catch a broken
// implementation (no dedup at all - every claim survives).
test('non-vacuity: invariant 2 property would catch an implementation with no dedup', () => {
  const noDedup = (_claimed, meta) => meta; // the pre-BL-1189 shape
  const claimed = new Set();
  const results = [noDedup(claimed, { ticketId: 'BL-600' }), noDedup(claimed, { ticketId: 'BL-600' }), noDedup(claimed, { ticketId: 'BL-600' })];
  const survivors = results.filter((r) => r.ticketId === 'BL-600');
  assert.notEqual(survivors.length, 1, 'a no-dedup implementation must NOT produce exactly one survivor, proving the fixed version is what makes this property hold');
});
