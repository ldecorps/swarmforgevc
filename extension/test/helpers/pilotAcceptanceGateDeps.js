'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

// BL-1229: the real PilotAcceptanceGateDeps interface's own source text,
// and the two pure extractors both the completeness test and the property
// test need against it - one definition, never copy-pasted between them
// (the class of drift this whole ticket exists to prevent, applied to its
// own test-side tooling too).
const GATE_TS = path.join(__dirname, '..', '..', 'src', 'tools', 'pilotAcceptanceGate.ts');
const INTERFACE_NAME = 'PilotAcceptanceGateDeps';

// Extracts the interface's own text block: from `export interface <name> {`
// to the matching closing `}` (the interface body never nests braces of its
// own beyond inline object/function types, none of which appear here -
// confirmed by reading the real interface, and by every extractor test
// using the same one-line-per-member shape it actually has).
function extractInterfaceBody(tsSource, interfaceName) {
  const start = tsSource.indexOf(`export interface ${interfaceName} {`);
  if (start === -1) {
    throw new Error(`interface ${interfaceName} not found`);
  }
  const bodyStart = tsSource.indexOf('{', start) + 1;
  const bodyEnd = tsSource.indexOf('\n}', bodyStart);
  if (bodyEnd === -1) {
    throw new Error(`closing brace for interface ${interfaceName} not found`);
  }
  return tsSource.slice(bodyStart, bodyEnd);
}

// A member line looks like `  name: (...) => Type;` (required) or
// `  name?: (...) => Type;` (optional). Comment-only and blank lines are
// skipped; a line's own leading `//` never has a `:` before it that this
// regex would misparse as a member.
function extractRequiredMembers(interfaceBody) {
  const required = [];
  for (const rawLine of interfaceBody.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//')) continue;
    const m = line.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(\??):/);
    if (!m) continue;
    const [, name, optionalMark] = m;
    if (optionalMark !== '?') {
      required.push(name);
    }
  }
  return required;
}

module.exports = {
  baseAcceptanceGateDeps,
  makeAcceptanceGateDeps,
  BASE_ACCEPTANCE_GATE_DEPS_MEMBERS,
  GATE_TS,
  INTERFACE_NAME,
  extractInterfaceBody,
  extractRequiredMembers,
};
