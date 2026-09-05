'use strict';

// BL-1229: the ONE base object every landPilotedTicket test stub is built
// from, so the next contract widening costs one clear failure (the
// completeness test below/alongside this file, over THIS object) rather
// than one crash per test file that forgot to update its own hand-rolled
// stub - exactly what happened when BL-757 added checkOrphanedAuthoredDocs
// and 15 files never noticed (BL-1221).
//
// This list is EXPLICIT and manually maintained - never derived by
// wrapping an incomplete object in a Proxy/auto-defaulter that invents a
// value for whatever key is missing. That would silently convert the next
// widening's crash into a passing test that exercises nothing, which the
// human ruling (2026-08-28, BL-1229) forbids outright: "a missing deps
// member must not be filled in with a silent default." The completeness
// test is what must go red when this list falls behind the interface -
// this file's own job is only to be a normal, honest object of defaults,
// checked from outside, never to catch its own gaps.
//
// Every value here is the SAME benign default already used near-identically
// across the 15 real callers (verified during BL-1229's migration) - never a
// new behavior invented for this file. A test that cares about a member's
// actual return value overrides it explicitly; every other member reads
// exactly as it always did.
function baseAcceptanceGateDeps() {
  let executedFeaturePath;
  return {
    readAcceptanceDeclaration: () => 'specs/features/fixture.feature',
    readRequiredWiring: () => undefined,
    readTicketNotes: () => undefined,
    acceptanceReceiptExists: () => false,
    resolveFeatureFilePath: () => '/repo/specs/features/fixture.feature',
    isLifecycleTeardownTicket: () => false,
    assessMultiworktreeFixture: () => ({
      satisfied: true,
      metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: '/repo' },
    }),
    runAcceptance: async () => ({ success: true, output: 'ok' }),
    recordAcceptanceExecution: (featureFilePath) => {
      executedFeaturePath = featureFilePath;
    },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => ({ checked: true, commitsChecked: 1 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkOrphanedAuthoredDocs: () => ({ checked: true, docsTouched: false }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => ({ moved: true, destination: '/repo/backlog/done/fixture.yaml' }),
    writeReceipt: () => {},
    getLandedCommit: () => 'abc1234567',
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-09-05T00:00:00.000Z',
  };
}

// The names baseAcceptanceGateDeps() supplies, as a plain array - the
// completeness test reads THIS, never the interface twice, so there is
// exactly one place that lists "what this file currently covers."
const BASE_ACCEPTANCE_GATE_DEPS_MEMBERS = Object.keys(baseAcceptanceGateDeps());

// Builds a full deps object: the base above, then this call's own
// overrides layered on top (plain object spread - later keys win). A test
// that overrides nothing still gets a COMPLETE object; a test overriding
// one member changes only that one, exactly as every pre-existing local
// mkDeps already did.
function makeAcceptanceGateDeps(overrides) {
  return { ...baseAcceptanceGateDeps(), ...(overrides || {}) };
}

module.exports = {
  baseAcceptanceGateDeps,
  makeAcceptanceGateDeps,
  BASE_ACCEPTANCE_GATE_DEPS_MEMBERS,
};
