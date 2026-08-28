'use strict';

// BL-1215: step handlers for "the pilot acceptance gate marks a ticket
// done only once its implementation is reachable from origin/main".
// Drives the REAL landPilotedTicket (extension/out/tools/pilotAcceptanceGate)
// with a fake-but-complete deps object - the same convention
// pilotAcceptanceGate.test.js's own mkDeps uses - since this ticket's own
// invariant is about the ORCHESTRATION (does the gate consult
// checkOriginMainLanding before moving the yaml), not about git itself;
// the real git wiring (checkOriginMainLanding) has its own real-git tests
// in pilotAcceptanceGateCli.test.js.

const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'pilotAcceptanceGate');

const FEATURE = 'the pilot acceptance gate marks a ticket done only once its implementation is reachable from origin/main';

function loadModule() {
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

const TICKET_ID = 'BL-FIX';
const LANDED_COMMIT = 'abc1234567';

function mkDeps(overrides) {
  const calls = { move: 0, writeReceipt: 0 };
  const deps = {
    readAcceptanceDeclaration: () => 'specs/features/fixture.feature',
    resolveFeatureFilePath: () => '/repo/specs/features/fixture.feature',
    isLifecycleTeardownTicket: () => false,
    assessMultiworktreeFixture: () => ({
      satisfied: true,
      metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: '/repo' },
    }),
    runAcceptance: async () => ({ success: true, output: 'ok' }),
    recordAcceptanceExecution: () => {},
    readAcceptanceExecution: () => '/repo/specs/features/fixture.feature',
    checkCommitClaims: () => ({ checked: true, commitsChecked: 3 }),
    checkCrossFileDuplication: () => ({ checked: true, filesScanned: 0 }),
    checkScopedCrap: () => ({ checked: true, tsFilesScanned: 0, violations: [] }),
    checkMkdtempConvention: () => ({ checked: true, testFilesScanned: 0, violations: [], scannedPaths: [] }),
    checkPropertyGeneratorReach: () => ({ checked: true, propertyFilesScanned: 0, scannedPaths: [] }),
    checkShellEntryPointDrive: () => ({ checked: true, shellTestsScanned: 0, entryPointsNamed: 0 }),
    checkOrphanedAuthoredDocs: () => ({ checked: true, docsTouched: false }),
    checkUnreachableStepHandlers: () => ({ checked: true, stepFilesScanned: 0, patternsChecked: 0 }),
    checkMultiBranchParserCoverage: () => ({ checked: true, parsersScanned: 0 }),
    checkPerHatRolePromptEvidence: () => ({ checked: true, verdictsScanned: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-FIX-fixture.yaml' };
    },
    writeReceipt: () => {
      calls.writeReceipt += 1;
    },
    getLandedCommit: () => LANDED_COMMIT,
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
  return { deps, calls };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a piloted ticket whose acceptance contract has just passed$/, (ctx) => {
    ctx.bl1215 = { landPilotedTicket: loadModule().landPilotedTicket };
  });

  // ── scenario 01: unlanded implementation refuses done ────────────────────

  scoped(/^the run's implementation commit is not reachable from origin\/main$/, (ctx) => {
    const st = ctx.bl1215;
    const { deps, calls } = mkDeps({
      checkOriginMainLanding: () => ({ reachable: false, reason: `${LANDED_COMMIT} is not an ancestor of origin/main` }),
    });
    st.deps = deps;
    st.calls = calls;
  });

  scoped(/^the pilot acceptance gate reaches its land step$/, async (ctx) => {
    const st = ctx.bl1215;
    st.outcome = await st.landPilotedTicket(TICKET_ID, st.deps);
  });

  scoped(/^the ticket yaml is not moved to backlog\/done\/$/, (ctx) => {
    const st = ctx.bl1215;
    assert.equal(st.outcome.landed, false, `expected the land refused, got: ${JSON.stringify(st.outcome)}`);
    assert.equal(st.calls.move, 0, 'expected moveTicketToDone to never be called on refusal');
  });

  scoped(/^the refusal names the implementation commit that is missing from origin\/main$/, (ctx) => {
    const st = ctx.bl1215;
    assert.equal(st.outcome.reasonKind, 'commit-not-on-origin-main');
    assert.match(st.outcome.reason, new RegExp(LANDED_COMMIT));
  });

  scoped(/^no passing acceptance receipt is written for the run$/, (ctx) => {
    const st = ctx.bl1215;
    assert.equal(st.calls.writeReceipt, 0, 'expected writeReceipt to never be called on refusal');
  });

  // ── scenario 02: landed implementation still lands ───────────────────────

  scoped(/^the run's implementation commit is reachable from origin\/main$/, (ctx) => {
    const st = ctx.bl1215;
    const { deps, calls } = mkDeps({ checkOriginMainLanding: () => ({ reachable: true }) });
    st.deps = deps;
    st.calls = calls;
  });

  scoped(/^the ticket yaml is moved to backlog\/done\/$/, (ctx) => {
    const st = ctx.bl1215;
    assert.equal(st.outcome.landed, true, `expected the land to succeed, got: ${JSON.stringify(st.outcome)}`);
    assert.equal(st.calls.move, 1, 'expected moveTicketToDone to be called exactly once');
  });

  scoped(/^a passing acceptance receipt is written for the run$/, (ctx) => {
    const st = ctx.bl1215;
    assert.equal(st.calls.writeReceipt, 1, 'expected writeReceipt to be called exactly once');
    assert.equal(st.outcome.receipt.result, 'passed');
    assert.equal(st.outcome.receipt.landedCommit, LANDED_COMMIT);
  });

  // ── scenario 03: unreadable origin fails closed ──────────────────────────

  scoped(/^origin\/main cannot be read at all$/, (ctx) => {
    const st = ctx.bl1215;
    const { deps, calls } = mkDeps({
      checkOriginMainLanding: () => ({ reachable: false, reason: 'origin/main could not be fetched: no remote configured' }),
    });
    st.deps = deps;
    st.calls = calls;
  });

  scoped(/^the refusal says origin\/main could not be read$/, (ctx) => {
    const st = ctx.bl1215;
    assert.match(st.outcome.reason, /could not be fetched/);
  });
}

module.exports = { registerSteps };
