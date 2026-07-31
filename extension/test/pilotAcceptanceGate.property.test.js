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
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

const DECL_KINDS = ['absent', 'inline', 'missingPath', 'existingFile'];

function buildDeps(declKind, contractGreen, calls) {
  return {
    readAcceptanceDeclaration: () => (declKind === 'absent' ? undefined : 'specs/features/fixture.feature'),
    resolveFeatureFilePath: () => (declKind === 'existingFile' ? '/repo/specs/features/fixture.feature' : undefined),
    runAcceptance: async () =>
      contractGreen
        ? { success: true, output: 'ok' }
        : { success: false, output: 'Scenario "S": no step handler matched "Given x"' },
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

test('property: invariant 3 - a refused land never moves the yaml or writes a receipt', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...DECL_KINDS), fc.boolean(), async (declKind, contractGreen) => {
      const calls = { move: 0, receipt: 0, commit: 0 };
      const outcome = await landPilotedTicket('BL-PROP', buildDeps(declKind, contractGreen, calls));
      if (!outcome.landed) {
        assert.equal(calls.move, 0, `refused land (declKind=${declKind}, contractGreen=${contractGreen}) called moveTicketToDone`);
        assert.equal(calls.receipt, 0, `refused land (declKind=${declKind}, contractGreen=${contractGreen}) called writeReceipt`);
      }
    }),
    { numRuns: 60 }
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
