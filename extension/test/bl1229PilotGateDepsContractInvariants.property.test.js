'use strict';

// BL-1229 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`. Drives the REAL compiled
// landPilotedTicket and the REAL shared stub
// (helpers/pilotAcceptanceGateDeps.js) - never a reimplementation of
// either.
//
//   1. "A test-built deps stub that does not satisfy the full
//      landPilotedTicket contract fails loudly; a missing member is
//      never silently defaulted." P1 randomizes WHICH ONE of the real
//      interface's required members is omitted from an otherwise-complete
//      stub and asserts the run always throws, never returns a land
//      verdict - for every required member, not only
//      checkOrphanedAuthoredDocs (the one member BL-757/BL-1221 actually
//      forgot).
//   2. "Adding a member to the deps contract produces one failure naming
//      that member, regardless of how many test files build a stub."
//      P2 randomizes a synthetic member name and how many throwaway
//      required members are added to a simulated widened interface, and
//      asserts the completeness check (the same extractor
//      pilotAcceptanceGateDepsCompleteness.test.js uses) reports EXACTLY
//      that many missing members, each correctly named - regardless of
//      how many of the 15 real caller files exist, since none of them
//      enter this check at all; the shared stub is the ONLY thing being
//      widened against.
//
// GENERATOR REACH (BL-654): P1's generator draws from the interface's OWN
// live required-member list, so every generated case omits a REAL
// member - there is no synthetic domain to miss. P2's synthetic member
// names are drawn to avoid colliding with any real member name (asserted
// below), so every generated widening is a genuine, unrepresented gap.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');
const {
  baseAcceptanceGateDeps,
  BASE_ACCEPTANCE_GATE_DEPS_MEMBERS,
  GATE_TS,
  INTERFACE_NAME,
  extractInterfaceBody,
  extractRequiredMembers,
} = require('./helpers/pilotAcceptanceGateDeps');

const gateSrc = fs.readFileSync(GATE_TS, 'utf8');
const REAL_REQUIRED_MEMBERS = extractRequiredMembers(extractInterfaceBody(gateSrc, INTERFACE_NAME));

// assessMultiworktreeFixture is required by the TYPE but only INVOKED at
// runtime for a lifecycle-teardown ticket (pilotAcceptanceGate.ts's own
// requireMultiworktreeFixture: `if (!deps.isLifecycleTeardownTicket(...))
// return { fixture: <hardcoded> }` - the deps call never happens on the
// non-teardown path this file's base fixture otherwise represents).
// Omitting it is only OBSERVABLE on that path - found live, non-vacuously,
// by this very property before this line existed (P1 failed on
// "assessMultiworktreeFixture" with a real land verdict instead of a
// throw). Every other required member's own call site is unconditional
// under the base fixture's shape.
const CONDITIONALLY_INVOKED_MEMBER_OVERRIDES = {
  assessMultiworktreeFixture: { isLifecycleTeardownTicket: () => true },
};

test('P1: a stub missing any single required member fails loudly, whichever member it is', async () => {
  assert.ok(REAL_REQUIRED_MEMBERS.length >= 15, 'sanity: the interface has a substantial required-member list');
  const drawn = new Set();
  // Every required member is iterated EXPLICITLY - satisfied by
  // construction, never left to chance - with fc layered on top per
  // member only to vary run bookkeeping consistently with this suite's
  // other seeded-property files; a bare fc.constantFrom sampled member-by-
  // member missed one in 60 draws (measured: "runAcceptance" undrawn),
  // which is exactly the shape BL-1062's own history warns against.
  for (const memberToOmit of REAL_REQUIRED_MEMBERS) {
    await fc.assert(
      fc.asyncProperty(fc.constant(memberToOmit), async (member) => {
        drawn.add(member);
        const incomplete = {
          ...baseAcceptanceGateDeps(),
          ...(CONDITIONALLY_INVOKED_MEMBER_OVERRIDES[member] || {}),
        };
        delete incomplete[member];
        let threw = false;
        let landedOutcome;
        try {
          landedOutcome = await landPilotedTicket('BL-1229-p1', incomplete);
        } catch {
          threw = true;
        }
        if (!threw) {
          throw new Error(`omitting "${member}" did not throw - got a land verdict instead: ${JSON.stringify(landedOutcome)}`);
        }
      }),
      { numRuns: 3 }
    );
  }
  // The floor STAYS satisfied by construction: every required member was
  // omitted at least once, never merely a sample of them.
  const undrawn = REAL_REQUIRED_MEMBERS.filter((m) => !drawn.has(m));
  assert.deepEqual(undrawn, [], `expected every required member to be drawn at least once, never omitted: ${JSON.stringify(undrawn)}`);
});

const SAFE_NAME = fc
  .stringMatching(/^[a-z][a-zA-Z0-9]{4,14}$/)
  .filter((name) => !BASE_ACCEPTANCE_GATE_DEPS_MEMBERS.includes(name) && !REAL_REQUIRED_MEMBERS.includes(name));

test('P2: widening the contract by N members reports exactly N missing members, each named, regardless of how many are added', () => {
  fc.assert(
    fc.property(fc.uniqueArray(SAFE_NAME, { minLength: 1, maxLength: 4 }), (newMemberNames) => {
      const widenedBody =
        extractInterfaceBody(gateSrc, INTERFACE_NAME) +
        '\n' +
        newMemberNames.map((n) => `  ${n}: () => void;`).join('\n') +
        '\n';
      const widenedRequired = extractRequiredMembers(widenedBody);
      const supplied = new Set(BASE_ACCEPTANCE_GATE_DEPS_MEMBERS);
      const missing = widenedRequired.filter((name) => !supplied.has(name));

      assert.equal(
        missing.length,
        newMemberNames.length,
        `expected exactly ${newMemberNames.length} missing member(s) for ${JSON.stringify(newMemberNames)}, got ${missing.length}: ${JSON.stringify(missing)}`
      );
      for (const name of newMemberNames) {
        assert.ok(missing.includes(name), `expected the report to name ${name}, got: ${JSON.stringify(missing)}`);
      }
    }),
    { numRuns: 20 }
  );
});

// ── non-vacuity proofs (each mutation run for real, restored byte-
//    identical afterward, confirmed via diff against a pre-break backup) ──
//
// P1: commenting out `delete incomplete[member]` (so the "incomplete" stub
// is actually complete) failed on the very first case
// ("readAcceptanceDeclaration did not throw - got a land verdict instead")
// - proving the property actually exercises omission, not merely that
// SOME promise settles.
//
// P2: inverting the filter (`widenedRequired.filter((name) =>
// supplied.has(name))`, reporting what IS covered instead of what is
// missing) failed immediately ("expected 1, got 20") - proving the
// property is sensitive to the missing-member computation, not just to
// whether the widened body parses.
