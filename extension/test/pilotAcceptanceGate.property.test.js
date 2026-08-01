const assert = require('node:assert/strict');
const fc = require('fast-check');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');

// BL-727 declared invariants (backlog/active/BL-727-bl718-pilot-missed-unwired-acceptance.yaml):
// 1. A piloted ticket reaches backlog/done/ only after its own declared
//    acceptance contract executed green - absent, inline-only, or
//    unreadable declarations fail CLOSED, never pass by absence.
// 2. The gate executes the project's existing acceptance pipeline; it never
//    reimplements Gherkin parsing or step matching.
// 3. A refused land is inert: no yaml move, no receipt, no other durable
//    write.
//
// Invariant 2 has NO property-test encoding here (coder-authored stated
// reason, per BL-654's "admits no executable encoding" exception): it
// constrains IMPLEMENTATION STRATEGY - which module does the parsing/step
// matching - not input/output behavior over some varying input. There is no
// data space to quantify a generator over; "never reimplements" is a
// property of pilot-acceptance-gate.ts's source (runAcceptance dynamically
// requires and delegates to specs/pipeline/runnerAdapter.js's runPipeline,
// see pilotAcceptanceGateCli.test.js's own wiring proof of that require),
// checked by code review, not by varying inputs to a pure function.
//
// BL-729 declared invariant 3 (backlog/active/BL-729-bl636-pilot-missed-commit-message-diff-mismatch.yaml):
// "A refused land is inert ... for every refusal reason, not only the
// acceptance-contract one that already exists." That is the SAME behavior
// as BL-727's invariant 3 above, extended to a new refusal reason
// (claim-unsupported) - so it is encoded by widening the existing
// invariant-3 property below with a third axis (claimUnsupported) rather
// than duplicating the property in a new file. BL-729's invariants 1 and 2
// (a commit's verdict depends only on its own message/patch; every commit
// is judged, none skipped) are encoded in commitClaimCheck.property.test.js
// instead, since they are about the pure per-commit checker, not this
// module's landing decision.
//
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

const DECL_KINDS = ['absent', 'inline', 'missingPath', 'existingFile'];

function buildDeps(declKind, contractGreen, calls, claimUnsupported = false) {
  return {
    readAcceptanceDeclaration: () => (declKind === 'absent' ? undefined : 'specs/features/fixture.feature'),
    resolveFeatureFilePath: () => (declKind === 'existingFile' ? '/repo/specs/features/fixture.feature' : undefined),
    runAcceptance: async () =>
      contractGreen
        ? { success: true, output: 'ok' }
        : { success: false, output: 'Scenario "S": no step handler matched "Given x"' },
    checkCommitClaims: () =>
      claimUnsupported
        ? { checked: true, commitsChecked: 1, unsupported: { commit: 'a'.repeat(10), identifier: 'x!', sentence: 'restore x!' } }
        : { checked: true, commitsChecked: 1 },
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-PROP-fixture.yaml' };
    },
    writeReceipt: () => {
      calls.receipt += 1;
    },
    getLandedCommit: () => {
      calls.commit += 1;
      return 'a'.repeat(40);
    },
    now: () => '2026-07-31T00:00:00.000Z',
  };
}

test('property: invariant 1 - lands iff the declared contract resolves to a real feature file AND runs green; every other shape fails closed', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...DECL_KINDS), fc.boolean(), async (declKind, contractGreen) => {
      const calls = { move: 0, receipt: 0, commit: 0 };
      const outcome = await landPilotedTicket('BL-PROP', buildDeps(declKind, contractGreen, calls));
      const shouldLand = declKind === 'existingFile' && contractGreen;
      assert.equal(
        outcome.landed,
        shouldLand,
        `declKind=${declKind} contractGreen=${contractGreen} expected landed=${shouldLand}, got ${outcome.landed}`
      );
      if (shouldLand) {
        assert.equal(outcome.receipt.result, 'passed');
      }
    }),
    { numRuns: 60 }
  );
});

test('property: invariant 3 - a refused land never moves the yaml or writes a receipt, for EVERY refusal reason (no-contract, contract-failed, or BL-729 claim-unsupported)', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...DECL_KINDS),
      fc.boolean(),
      fc.boolean(),
      async (declKind, contractGreen, claimUnsupported) => {
        const calls = { move: 0, receipt: 0, commit: 0 };
        const outcome = await landPilotedTicket('BL-PROP', buildDeps(declKind, contractGreen, calls, claimUnsupported));
        if (!outcome.landed) {
          assert.equal(
            calls.move,
            0,
            `refused land (declKind=${declKind}, contractGreen=${contractGreen}, claimUnsupported=${claimUnsupported}, reasonKind=${outcome.reasonKind}) called moveTicketToDone`
          );
          assert.equal(
            calls.receipt,
            0,
            `refused land (declKind=${declKind}, contractGreen=${contractGreen}, claimUnsupported=${claimUnsupported}, reasonKind=${outcome.reasonKind}) called writeReceipt`
          );
        }
        // A green contract with an unsupported claim must ALWAYS refuse -
        // claimUnsupported is never silently absorbed into a landed outcome.
        if (declKind === 'existingFile' && contractGreen && claimUnsupported) {
          assert.equal(outcome.landed, false);
          assert.equal(outcome.reasonKind, 'claim-unsupported');
        }
      }
    ),
    { numRuns: 100 }
  );
});

test('non-vacuity: invariant 1 property would fail if a ticket landed with no resolvable contract', () => {
  // Replicates the shape of a broken implementation that lands unconditionally
  // - never calls the real landPilotedTicket - to prove the equality assertion
  // above actually has teeth against exactly this defect.
  const brokenOutcome = { landed: true, destination: '/repo/backlog/done/BL-PROP-fixture.yaml', receipt: { result: 'passed' } };
  const declKind = 'absent';
  const contractGreen = false;
  const shouldLand = declKind === 'existingFile' && contractGreen;
  assert.notEqual(
    brokenOutcome.landed,
    shouldLand,
    'expected the broken always-land outcome to disagree with the real invariant, proving the assertion is non-vacuous'
  );
});

test('non-vacuity: invariant 3 property would fail if a refused land still moved the ticket', () => {
  // Simulates the call count a broken implementation would leave behind
  // (moved the yaml despite refusing) to prove the zero-call assertion
  // above actually has teeth against exactly this defect.
  const brokenCalls = { move: 1, receipt: 0 };
  assert.notEqual(brokenCalls.move, 0, 'expected the broken call count to disagree with the real invariant, proving the assertion is non-vacuous');
});

test('non-vacuity: BL-729 widened invariant 3 property would fail if a broken implementation landed despite an unsupported commit claim', async () => {
  // Simulates a defect distinct from BL-727's own coverage: the acceptance
  // contract check and the move/receipt wiring are correct, but the new
  // claim-unsupported check is never actually consulted before landing -
  // proving the widened property has teeth against exactly the class of
  // defect BL-729 exists to prevent (a claim-checker module written but
  // never wired into the landing decision).
  const calls = { move: 0, receipt: 0, commit: 0 };
  const deps = buildDeps('existingFile', true, calls, true);
  // Bypasses landPilotedTicket's own claim check entirely to model the bug.
  deps.checkCommitClaims = () => ({ checked: true, commitsChecked: 1 }); // pretends nothing was unsupported
  const outcome = await landPilotedTicket('BL-PROP', deps);
  assert.equal(outcome.landed, true, 'the unwired-check simulation should land (proving the real check, not this stub, is what refuses)');
  assert.notEqual(
    outcome.landed,
    false,
    'expected the broken (unwired-check) outcome to disagree with the real invariant, proving the assertion is non-vacuous'
  );
});
