'use strict';

// BL-1221: step handlers driving the REAL landPilotedTicket (compiled
// output) and reading the REAL 15 extension/test files that call it,
// never a reimplementation of the deps contract or the land path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { landPilotedTicket } = require('../../../extension/out/tools/pilotAcceptanceGate');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const GATE_TS = path.join(EXTENSION_DIR, 'src', 'tools', 'pilotAcceptanceGate.ts');

// The 15 files that actually CALL landPilotedTicket (verified via
// `grep -rl "landPilotedTicket(" extension/test/*.test.js` - two files
// merely MENTION the name in a string/comment and were excluded:
// multiworktreeAcceptanceFixture.test.js and pilotAcceptanceGateCli.test.js,
// neither of which constructs a deps stub of its own).
const CALLER_FILES = [
  'bl733ProducerCrosscheck.property.test.js',
  'crossFileDuplicationCheck.test.js',
  'multiBranchParserCoverageCheck.property.test.js',
  'multiBranchParserCoverageCheck.test.js',
  'perHatRolePromptEvidenceCheck.property.test.js',
  'perHatRolePromptEvidenceCheck.test.js',
  'pilotAcceptanceGate.property.test.js',
  'pilotAcceptanceGate.test.js',
  'pilotMkdtempConventionCheck.test.js',
  'pilotScopedCrapCheck.test.js',
  'pilotScopedCrapEvidence.property.test.js',
  'propertyGeneratorReachCheck.test.js',
  'shellEntryPointDriveCheck.test.js',
  'unreachableStepHandlerCheck.property.test.js',
  'unreachableStepHandlerCheck.test.js',
];

// A minimal, fully-supplied deps stub - every required member benign,
// mirroring the shape every one of the 15 files' own local mkDeps uses.
function benignDeps(overrides) {
  return {
    readAcceptanceDeclaration: () => 'specs/features/fixture.feature',
    resolveFeatureFilePath: () => path.join(EXTENSION_DIR, '..', 'specs', 'features', 'fixture.feature'),
    isLifecycleTeardownTicket: () => false,
    assessMultiworktreeFixture: () => ({
      satisfied: true,
      metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: EXTENSION_DIR },
    }),
    runAcceptance: async () => ({ success: true, output: 'ok' }),
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
    moveTicketToDone: () => ({ moved: true, destination: '/repo/backlog/done/BL-1221-fixture.yaml' }),
    writeReceipt: () => {},
    getLandedCommit: () => 'abc1234567',
    checkOriginMainLanding: () => ({ reachable: true }),
    now: () => '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

const FEATURE = 'pilot-gate test stubs satisfy every required member of the deps contract';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a test that drives landPilotedTicket through a deps stub$/, (ctx) => {
    ctx.bl1221 = { callerFiles: CALLER_FILES.map((f) => path.join(EXTENSION_DIR, 'test', f)) };
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────
  scoped(/^the test builds its deps stub$/, (ctx) => {
    ctx.bl1221.sources = ctx.bl1221.callerFiles.map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }));
  });

  scoped(/^the stub supplies "([^"]+)"$/, (ctx, member) => {
    const missing = ctx.bl1221.sources.filter((s) => !s.text.includes(member));
    if (missing.length > 0) {
      throw new Error(`expected every one of the ${ctx.bl1221.sources.length} caller files to supply "${member}", missing in:\n${missing.map((s) => s.file).join('\n')}`);
    }
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^the test lands a piloted ticket through that stub$/, (ctx) => {
    const deps = benignDeps();
    ctx.bl1221.landPromise = (async () => {
      try {
        return { outcome: await landPilotedTicket('BL-1221-fixture', deps) };
      } catch (err) {
        return { error: err };
      }
    })();
  });

  scoped(/^the land completes without reporting a missing deps member$/, async (ctx) => {
    const { outcome, error } = await ctx.bl1221.landPromise;
    if (error) {
      throw new Error(`expected landPilotedTicket to complete without throwing, got: ${error.message}\n${error.stack}`);
    }
    if (!error && String(outcome?.reason || '').includes('is not a function')) {
      throw new Error(`expected no missing-deps-member reason, got: ${JSON.stringify(outcome)}`);
    }
    ctx.bl1221.outcome = outcome;
  });

  scoped(/^the test's own assertions decide its verdict$/, (ctx) => {
    // A real, well-formed outcome object - `landed` present, one way or the
    // other - is the proof the land path reached ITS OWN decision logic
    // rather than throwing before it got there.
    assert.ok(
      typeof ctx.bl1221.outcome === 'object' && ctx.bl1221.outcome !== null && 'landed' in ctx.bl1221.outcome,
      `expected a real land outcome, got: ${JSON.stringify(ctx.bl1221.outcome)}`
    );
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────
  scoped(/^the deps contract is inspected$/, (ctx) => {
    ctx.bl1221.gateSrc = fs.readFileSync(GATE_TS, 'utf8');
  });

  scoped(/^"([^"]+)" is still a required member$/, (ctx, member) => {
    const re = new RegExp(`\\b${member}\\s*:\\s*\\([^)]*\\)\\s*=>[^;]*;`);
    const m = ctx.bl1221.gateSrc.match(re);
    if (!m) {
      throw new Error(`expected to find "${member}" declared in the deps interface`);
    }
    if (m[0].includes(`${member}?:`)) {
      throw new Error(`expected "${member}" to be required (no "?"), found: ${m[0]}`);
    }
  });

  scoped(/^the land path calls it without guarding on its presence$/, (ctx) => {
    const callSite = ctx.bl1221.gateSrc.match(/deps\.checkOrphanedAuthoredDocs\(\)/);
    if (!callSite) {
      throw new Error('expected an unconditional deps.checkOrphanedAuthoredDocs() call site');
    }
    const guarded = /deps\.checkOrphanedAuthoredDocs\?\.\(\)|typeof\s+deps\.checkOrphanedAuthoredDocs\s*===\s*['"]function['"]/;
    if (guarded.test(ctx.bl1221.gateSrc)) {
      throw new Error('expected no truthiness/optional-chaining guard around checkOrphanedAuthoredDocs');
    }
  });
}

module.exports = { registerSteps };
