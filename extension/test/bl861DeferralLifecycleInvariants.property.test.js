const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const fs = require('node:fs');
const { mkTmpDir } = require('./helpers/tmpDir');
const { checkReadsBlockerActivePath } = require('../out/quality/siblingDeferral');
const { appendSiblingDeferralRecordIfNew, readSiblingDeferralRecords } = require('../out/metrics/siblingDeferralStore');
const { computeTicketDeferralStatus, listStrandedDeferrals } = require('../out/metrics/siblingDeferralStatus');

// BL-861 (coder.prompt's Invariants section - first authorship rests with
// the coder): coder-authored property tests for this ticket's two declared
// invariants. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from the unit/coverage/mutation
// run per engineering.prompt's property-test separation rule.
//
// Non-vacuity, checked by hand before landing (both properties below):
//   - Invariant 1: commenting out qa-sibling-check.ts's `runDefer` refusal
//     guard (equivalently, hardcoding checkReadsBlockerActivePath to always
//     return false) reproduced the failure this property is built to catch
//     - a violating check landed in the store, and the property's final
//     "no stored record violates" assertion failed. Restoring the guard
//     made it pass again.
//   - Invariant 2: changing listStrandedDeferrals to filter on
//     `report.kind !== 'deferred'` instead of `report.kind === 'releasable'`
//     (a plausible off-by-one - it would also list plain 'verify' tickets
//     that never had a deferral at all) reproduced a divergence between
//     status and list that the property's biconditional caught. Restoring
//     the exact filter made it pass again.

function mkTmp() {
  return mkTmpDir('sfvc-bl861-invariants-');
}

function writeTicketYaml(dir, id) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture ticket"\n`);
}

// ── invariant 1: a recorded deferral check stays runnable after its blocker closes ──

const blockedByArb = fc.integer({ min: 1, max: 6 }).map((n) => `BL-90${n}`);
// Deliberately outside blockedByArb's id space, so a "different ticket's
// active path" check can never accidentally coincide with the blocker's own.
const otherTicketArb = fc.integer({ min: 1, max: 6 }).map((n) => `BL-80${n}`);
const siblingTicketArb = fc.integer({ min: 1, max: 6 }).map((n) => `BL-70${n}`);
const commitArb = fc.stringMatching(/^[0-9a-f]{10}$/);

const shellPrefixArb = fc.constantFrom('test -f ', 'cat ', 'grep pattern ', 'ls -la ', '$(cat ', '');
// Case variation the recorded --check is free-form text and may spell the
// path however QA typed it - the refusal must not depend on exact casing.
const activePathCaseArb = fc.constantFrom('backlog/active/', 'BACKLOG/ACTIVE/', 'Backlog/Active/', 'bAcKlOg/AcTive/');
const ticketCaseTransformArb = fc.constantFrom(
  (id) => id,
  (id) => id.toLowerCase(),
  (id) => id.toUpperCase()
);
const slugArb = fc.stringMatching(/^[a-z0-9-]{0,10}$/);

// Constructs a check that DOES read the blocker's own file under
// backlog/active/ - by direct construction (derives the violating check
// FROM blockedBy, the same transformation the real bug embeds), so every
// generated case is a genuine violation, not a hoped-for one.
function violatingCheckArbFor(blockedBy) {
  return fc
    .tuple(shellPrefixArb, activePathCaseArb, ticketCaseTransformArb, slugArb)
    .map(([prefix, activePath, transform, slug]) => `${prefix}${activePath}${transform(blockedBy)}-${slug}.yaml`);
}

const genericSafeCheckArb = fc.constantFrom(
  'npm run test',
  'npx vitest run some.test.js',
  'npm run compile',
  'git status',
  'ls backlog/active/' // the path alone, no ticket id - must NOT be refused
);

// Constructs a check reading a DIFFERENT ticket's own active-backlog path -
// exercises that only the BLOCKER's own path is refused, not the bare
// "backlog/active/" + "some BL id" shape.
function safeOtherTicketCheckArbFor(otherTicket) {
  return fc
    .tuple(shellPrefixArb, activePathCaseArb, slugArb)
    .map(([prefix, activePath, slug]) => `${prefix}${activePath}${otherTicket}-${slug}.yaml`);
}

const attemptArb = fc
  .record({
    ticket: siblingTicketArb,
    blockedBy: blockedByArb,
    otherTicket: otherTicketArb,
    commit: commitArb,
    useViolating: fc.boolean(),
  })
  .chain((base) => {
    const checkArb = base.useViolating
      ? violatingCheckArbFor(base.blockedBy)
      : fc.oneof(genericSafeCheckArb, safeOtherTicketCheckArbFor(base.otherTicket));
    return checkArb.map((check) => ({ ...base, check }));
  });

test('property: a defer attempt whose --check reads the blocker\'s own backlog/active/ path is always refused (reachable), and only such attempts', () => {
  fc.assert(
    fc.property(attemptArb, (attempt) => {
      const target = mkTmp();
      const record = {
        ticket: attempt.ticket,
        blockedBy: attempt.blockedBy,
        action: 'defer',
        failureClass: 'integration',
        check: attempt.check,
        commit: attempt.commit,
        at: '2026-08-09T10:00:00.000Z',
      };
      const refused = checkReadsBlockerActivePath(record.check, record.blockedBy);
      assert.equal(refused, attempt.useViolating, `check=${JSON.stringify(record.check)} blockedBy=${record.blockedBy}`);
      // Mirrors qa-sibling-check.ts's runDefer: refused checks are never
      // handed to the store at all.
      if (!refused) {
        appendSiblingDeferralRecordIfNew(target, record);
      }
      const stored = readSiblingDeferralRecords(target);
      // Asserted reachability: the generator actually hits BOTH branches,
      // not just a post-condition that would hold vacuously if refusal
      // never fired (or always fired).
      if (attempt.useViolating) {
        assert.equal(stored.length, 0, "a check reading the blocker's own active path must never be accepted");
      } else {
        assert.equal(stored.length, 1, "a check that does not read the blocker's own active path must be accepted");
      }
      // The invariant itself, re-derived from the FINAL store state - no
      // stored record may carry a check that reads its own blockedBy's
      // active-backlog path.
      for (const storedRecord of stored) {
        assert.equal(
          checkReadsBlockerActivePath(storedRecord.check, storedRecord.blockedBy),
          false,
          "a stored deferral check must survive its blocker closing"
        );
      }
    }),
    { numRuns: 100 }
  );
});

// ── invariant 2: status and list are derived from a single shared lookup ──

// Five candidate blockers, each independently closed (backlog/done/) or
// still open (backlog/active/) per run - and four candidate siblings, each
// independently deferred against some subset of the five (independently
// per pair, so every adjacency shape - none, one, several, all - is
// reachable across runs). `cleared` additionally clears a subset of the
// deferred pairs (defer immediately followed by a later clear) - WITHOUT
// this, a ticket can never reach kind 'verify' while still holding records
// in the store (a ticket with zero defer records is never even a listing
// candidate), so a filter bug that also matches 'verify' (e.g. `kind !==
// 'deferred'` instead of `kind === 'releasable'`) would never be exercised
// - the exact gap a first draft of this property had (see the non-vacuity
// note above this file's header).
const BLOCKER_IDS = ['BL-810', 'BL-820', 'BL-830', 'BL-840', 'BL-850'];
const SIBLING_IDS = ['BL-710', 'BL-720', 'BL-730', 'BL-740'];

const closedFlagsArb = fc.array(fc.boolean(), { minLength: BLOCKER_IDS.length, maxLength: BLOCKER_IDS.length });
const adjacencyArb = fc.array(fc.array(fc.boolean(), { minLength: BLOCKER_IDS.length, maxLength: BLOCKER_IDS.length }), {
  minLength: SIBLING_IDS.length,
  maxLength: SIBLING_IDS.length,
});
const clearedArb = fc.array(fc.array(fc.boolean(), { minLength: BLOCKER_IDS.length, maxLength: BLOCKER_IDS.length }), {
  minLength: SIBLING_IDS.length,
  maxLength: SIBLING_IDS.length,
});

test("property: status and list never disagree - a ticket status reports releasable always appears in list, and a ticket list surfaces is always releasable per status (BL-861 invariant 2)", () => {
  fc.assert(
    fc.property(closedFlagsArb, adjacencyArb, clearedArb, (closedFlags, adjacency, cleared) => {
      const target = mkTmp();
      BLOCKER_IDS.forEach((blockerId, i) => {
        const dir = closedFlags[i] ? path.join(target, 'backlog', 'done') : path.join(target, 'backlog', 'active');
        writeTicketYaml(dir, blockerId);
      });
      SIBLING_IDS.forEach((siblingId, s) => {
        BLOCKER_IDS.forEach((blockerId, b) => {
          if (!adjacency[s][b]) {
            return;
          }
          appendSiblingDeferralRecordIfNew(target, {
            ticket: siblingId,
            blockedBy: blockerId,
            action: 'defer',
            failureClass: 'integration',
            check: 'npm run test',
            commit: 'abc1234567',
            at: '2026-08-09T10:00:00.000Z',
          });
          if (cleared[s][b]) {
            appendSiblingDeferralRecordIfNew(target, {
              ticket: siblingId,
              blockedBy: blockerId,
              action: 'clear',
              commit: 'def4567890',
              at: '2026-08-09T10:00:01.000Z',
            });
          }
        });
      });

      const strandedTickets = listStrandedDeferrals(target).map((report) => report.ticket);
      for (const siblingId of SIBLING_IDS) {
        const status = computeTicketDeferralStatus(target, siblingId);
        assert.equal(
          status.kind === 'releasable',
          strandedTickets.includes(siblingId),
          `ticket=${siblingId} status.kind=${status.kind} strandedTickets=${JSON.stringify(strandedTickets)}`
        );
      }
    }),
    { numRuns: 100 }
  );
});
