'use strict';

// BL-1229: step handlers driving the REAL landPilotedTicket (compiled
// output), the REAL shared stub (helpers/pilotAcceptanceGateDeps.js), and
// the REAL 10 previously-crashing test files (run under their own actual
// runner - vitest for .test.js, node --test for the .property.test.js
// files vitest cannot collect, BL-1220), never a reimplementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { landPilotedTicket } = require('../../../extension/out/tools/pilotAcceptanceGate');
const {
  baseAcceptanceGateDeps,
  makeAcceptanceGateDeps,
  BASE_ACCEPTANCE_GATE_DEPS_MEMBERS,
} = require('../../../extension/test/helpers/pilotAcceptanceGateDeps');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const GATE_TS = path.join(EXTENSION_DIR, 'src', 'tools', 'pilotAcceptanceGate.ts');

// Measured 2026-08-28 (BL-1229's own table): 10 files, 22 crashing
// assertions. Split by which runner can actually collect them today -
// BL-1220 is a separate, unticketed-here gap, so the .property.test.js
// files run via node --test directly rather than through vitest.
const VITEST_FILES = [
  'pilotAcceptanceGate.test.js',
  'crossFileDuplicationCheck.test.js',
  'pilotScopedCrapCheck.test.js',
  'perHatRolePromptEvidenceCheck.test.js',
  'multiBranchParserCoverageCheck.test.js',
  'shellEntryPointDriveCheck.test.js',
  'unreachableStepHandlerCheck.test.js',
];
const NODE_TEST_FILES = [
  'pilotAcceptanceGate.property.test.js',
  'pilotScopedCrapEvidence.property.test.js',
  'bl733ProducerCrosscheck.property.test.js',
];

function runVitest(files) {
  const res = spawnSync(
    'npx',
    ['vitest', 'run', ...files.map((f) => path.join('test', f))],
    { cwd: EXTENSION_DIR, encoding: 'utf8' }
  );
  return { out: `${res.stdout || ''}${res.stderr || ''}`, status: res.status };
}

function runNodeTest(files) {
  const res = spawnSync('node', ['--test', ...files.map((f) => path.join('test', f))], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
  });
  return { out: `${res.stdout || ''}${res.stderr || ''}`, status: res.status };
}

function extractInterfaceBody(tsSource, interfaceName) {
  const start = tsSource.indexOf(`export interface ${interfaceName} {`);
  if (start === -1) throw new Error(`interface ${interfaceName} not found`);
  const bodyStart = tsSource.indexOf('{', start) + 1;
  const bodyEnd = tsSource.indexOf('\n}', bodyStart);
  if (bodyEnd === -1) throw new Error(`closing brace for interface ${interfaceName} not found`);
  return tsSource.slice(bodyStart, bodyEnd);
}

function extractRequiredMembers(interfaceBody) {
  const required = [];
  for (const rawLine of interfaceBody.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//')) continue;
    const m = line.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(\??):/);
    if (!m) continue;
    const [, name, optionalMark] = m;
    if (optionalMark !== '?') required.push(name);
  }
  return required;
}

const FEATURE = 'Widening the pilot land-gate deps contract cannot silently strand its test stubs';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the pilot land-gate deps contract$/, (ctx) => {
    ctx.bl1229 = { gateSrc: fs.readFileSync(GATE_TS, 'utf8') };
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────
  scoped(/^the pilot land-gate test files run under their own runner$/, (ctx) => {
    ctx.bl1229.vitestResult = runVitest(VITEST_FILES);
    ctx.bl1229.nodeTestResult = runNodeTest(NODE_TEST_FILES);
  });

  scoped(/^no assertion fails with "([^"]+)" for a deps member$/, (ctx, phrase) => {
    const combined = `${ctx.bl1229.vitestResult.out}\n${ctx.bl1229.nodeTestResult.out}`;
    if (combined.includes(phrase)) {
      throw new Error(`expected no "${phrase}" anywhere in the 10 named files' own output`);
    }
  });

  scoped(/^every assertion that was crashing on a missing deps member now reports a real verdict$/, (ctx) => {
    if (ctx.bl1229.vitestResult.status !== 0) {
      throw new Error(`expected the vitest-collected files to pass: ${ctx.bl1229.vitestResult.out}`);
    }
    if (ctx.bl1229.nodeTestResult.status !== 0) {
      throw new Error(`expected the node --test files to pass: ${ctx.bl1229.nodeTestResult.out}`);
    }
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^a new member is added to the pilot land-gate deps contract$/, (ctx) => {
    const interfaceBody = extractInterfaceBody(ctx.bl1229.gateSrc, 'PilotAcceptanceGateDeps');
    ctx.bl1229.widenedRequired = extractRequiredMembers(
      `${interfaceBody}\n  aNewThrowawayRequiredMember: () => void;\n`
    );
  });

  scoped(/^no test stub supplies it$/, (ctx) => {
    ctx.bl1229.supplied = new Set(BASE_ACCEPTANCE_GATE_DEPS_MEMBERS);
    assert.ok(!ctx.bl1229.supplied.has('aNewThrowawayRequiredMember'));
  });

  scoped(/^the omission is reported once$/, (ctx) => {
    ctx.bl1229.missing = ctx.bl1229.widenedRequired.filter((name) => !ctx.bl1229.supplied.has(name));
    assert.equal(ctx.bl1229.missing.length, 1, `expected exactly one missing member reported, got: ${JSON.stringify(ctx.bl1229.missing)}`);
  });

  scoped(/^the report names the missing member$/, (ctx) => {
    assert.deepEqual(ctx.bl1229.missing, ['aNewThrowawayRequiredMember']);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────
  scoped(/^a test builds a deps stub omitting "([^"]+)"$/, (ctx, member) => {
    const incomplete = baseAcceptanceGateDeps();
    delete incomplete[member];
    ctx.bl1229.stub = incomplete;
  });

  scoped(/^the pilot land-gate runs against that stub$/, (ctx) => {
    ctx.bl1229.runPromise = (async () => {
      try {
        return { outcome: await landPilotedTicket('BL-1229-fixture', ctx.bl1229.stub) };
      } catch (err) {
        return { error: err };
      }
    })();
  });

  scoped(/^the run fails$/, async (ctx) => {
    const { error } = await ctx.bl1229.runPromise;
    if (!error) {
      throw new Error('expected the run to throw (a missing member is never silently defaulted)');
    }
    ctx.bl1229.error = error;
  });

  scoped(/^the run does not report a land verdict$/, async (ctx) => {
    const { outcome } = await ctx.bl1229.runPromise;
    assert.equal(outcome, undefined, `expected no land verdict, got: ${JSON.stringify(outcome)}`);
  });

  // ── Scenario 05 ───────────────────────────────────────────────────────
  scoped(/^the pilot land-gate deps contract is inspected$/, (ctx) => {
    // Background already loaded ctx.bl1229.gateSrc.
  });

  scoped(/^"([^"]+)" is still a required member$/, (ctx, member) => {
    const re = new RegExp(`\\b${member}\\s*:\\s*\\([^)]*\\)\\s*=>[^;]*;`);
    const m = ctx.bl1229.gateSrc.match(re);
    if (!m) throw new Error(`expected to find "${member}" declared in the deps interface`);
    if (m[0].includes(`${member}?:`)) throw new Error(`expected "${member}" to be required (no "?"), found: ${m[0]}`);
  });

  scoped(/^the land path calls it without guarding on its presence$/, (ctx) => {
    const callSite = ctx.bl1229.gateSrc.match(/deps\.checkOrphanedAuthoredDocs\(\)/);
    if (!callSite) throw new Error('expected an unconditional deps.checkOrphanedAuthoredDocs() call site');
    const guarded = /deps\.checkOrphanedAuthoredDocs\?\.\(\)|typeof\s+deps\.checkOrphanedAuthoredDocs\s*===\s*['"]function['"]/;
    if (guarded.test(ctx.bl1229.gateSrc)) throw new Error('expected no truthiness/optional-chaining guard around checkOrphanedAuthoredDocs');
  });

  // ── Scenario 04 (Outline) ────────────────────────────────────────────
  const ORPHAN_OUTCOMES = {
    'no orphaned docs': { checked: true, docsTouched: false },
    'an orphaned doc': {
      checked: true,
      docsTouched: true,
      miss: { path: 'docs/how-to/BL-1229-fixture.md', modeRelative: 'how-to/BL-1229-fixture.md' },
    },
  };
  const VERDICTS = { land: true, refuse: false };

  scoped(/^a test builds a complete deps stub whose orphan-docs check returns (.+)$/, (ctx, token) => {
    if (!Object.prototype.hasOwnProperty.call(ORPHAN_OUTCOMES, token)) {
      throw new Error(`unknown <orphan outcome>: ${token}`);
    }
    ctx.bl1229.calls = { move: 0 };
    ctx.bl1229.stub = makeAcceptanceGateDeps({
      checkOrphanedAuthoredDocs: () => ORPHAN_OUTCOMES[token],
      moveTicketToDone: () => {
        ctx.bl1229.calls.move += 1;
        return { moved: true, destination: '/repo/backlog/done/BL-1229-fixture.yaml' };
      },
    });
  });

  scoped(/^the gate reports "(land|refuse)"$/, async (ctx, verdictToken) => {
    const { outcome, error } = await ctx.bl1229.runPromise;
    if (error) throw new Error(`expected no throw, got: ${error.message}`);
    const expectLanded = VERDICTS[verdictToken];
    assert.equal(outcome.landed, expectLanded, `expected landed=${expectLanded}, got: ${JSON.stringify(outcome)}`);
  });
}

module.exports = { registerSteps };
