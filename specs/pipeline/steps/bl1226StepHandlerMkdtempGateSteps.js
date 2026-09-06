'use strict';

// BL-1226: step handlers for "The mkTmpDir convention gate covers acceptance
// step handlers". Drives the REAL assessPilotMkdtempConvention /
// classifyMkdtempConventionPath (extension/out/tools/pilotMkdtempConventionCheck)
// against a scratch subject root - never a reimplementation of the check.
//
// This file itself lives under specs/pipeline/steps/, so it is EXEMPT in
// pilotMkdtempConventionCheck.ts's own EXEMPT_REPO_PATHS - every fixture
// string below that spells a raw mkdtemp call is test DATA proving the
// detector works, not executable code the gate should ever flag.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const {
  assessPilotMkdtempConvention,
  classifyMkdtempConventionPath,
  PILOT_RAW_MKDTEMP_REFUSAL,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'pilotMkdtempConventionCheck'));

const FEATURE = 'The mkTmpDir convention gate covers acceptance step handlers';

// BL-1410's own class (a steps-lane handler drawing its fixture root from
// extension/test's Vitest-swept mkTmpDir, never swept under the acceptance
// runner) is exactly what this file must not add a new instance of - a
// plain mkdtempSync root with its own exit-time cleanup, same convention as
// bl1409Bl570WiringFollowsTheDelegationSteps.js's seamRoots.
const scratchRoots = [];
process.on('exit', () => {
  for (const root of scratchRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1226-subject-'));
  scratchRoots.push(root);
  return root;
}

// Split so this file's own text never contains the contiguous literal
// "mkdtempSync(" - belt-and-suspenders alongside the EXEMPT_REPO_PATHS entry
// above (BL-743's own test files use both, see pilotMkdtempConventionCheck.test.js).
const MKDTEMP = 'mkdtemp' + 'Sync';

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

const RAW_CALL_SOURCE = `const dir = ${MKDTEMP}('/tmp/x-');\n`;
const CLEAN_CALL_SOURCE =
  "const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');\n" +
  "const dir = mkSocketFixtureRoot('x-');\n";

const BASE_EXPRESSION_SOURCES = {
  'os.tmpdir()': `const os = require('os'); const dir = ${MKDTEMP}(os.tmpdir() + '/x-');\n`,
  "require('os').tmpdir()": `const dir = ${MKDTEMP}(require('os').tmpdir() + '/x-');\n`,
  "require('node:os').tmpdir()": `const dir = ${MKDTEMP}(require('node:os').tmpdir() + '/x-');\n`,
  "'/tmp'": `const dir = ${MKDTEMP}('/tmp/x-');\n`,
  'a module-level base constant': `const BASE = '/tmp';\nconst dir = ${MKDTEMP}(BASE + '/x-');\n`,
  'the shared fixture-root helper': CLEAN_CALL_SOURCE,
};

function ensureCtx(ctx) {
  ctx.root = ctx.root || freshRoot();
  ctx.touchedPaths = ctx.touchedPaths || [];
  return ctx;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the mkTmpDir convention check is asked about a parcel's touched paths$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^a step handler "([^"]+)" that creates a fixture root without the shared helper$/, (ctx, rel) => {
    ensureCtx(ctx);
    writeFile(ctx.root, rel, RAW_CALL_SOURCE);
    ctx.lastHandlerPath = rel;
  });

  scoped(/^a step handler "([^"]+)" that obtains its fixture root from the shared helper$/, (ctx, rel) => {
    ensureCtx(ctx);
    writeFile(ctx.root, rel, CLEAN_CALL_SOURCE);
    ctx.lastHandlerPath = rel;
  });

  scoped(/^that handler is among the touched paths$/, (ctx) => {
    ensureCtx(ctx);
    ctx.touchedPaths.push(ctx.lastHandlerPath);
  });

  scoped(/^that handler is not among the touched paths$/, (ctx) => {
    ensureCtx(ctx);
    // Deliberately a no-op: the handler stays on disk (written above) but is
    // never added to touchedPaths - invariant 1's own premise.
  });

  scoped(/^a touched step handler whose fixture root is created with the base expression "([^"]+)"$/, (ctx, baseExpression) => {
    ensureCtx(ctx);
    const source = BASE_EXPRESSION_SOURCES[baseExpression];
    assert.ok(source, `unknown <base_expression> example value: ${baseExpression}`);
    const rel = 'specs/pipeline/steps/exampleBaseExpressionSteps.js';
    writeFile(ctx.root, rel, source);
    ctx.lastHandlerPath = rel;
    ctx.touchedPaths.push(rel);
  });

  scoped(/^the touched path "([^"]+)"$/, (ctx, relativePath) => {
    ensureCtx(ctx);
    ctx.classifyPath = relativePath;
  });

  scoped(/^the convention check runs$/, (ctx) => {
    ensureCtx(ctx);
    ctx.outcome = assessPilotMkdtempConvention(ctx.root, ctx.touchedPaths);
  });

  scoped(/^the convention check classifies it$/, (ctx) => {
    ensureCtx(ctx);
    ctx.classification = classifyMkdtempConventionPath(ctx.classifyPath);
  });

  scoped(/^the check reports a violation naming "([^"]+)" and the offending line number$/, (ctx, rel) => {
    const hits = (ctx.outcome.violations || []).filter((v) => v.file === rel);
    assert.equal(hits.length, 1, `expected exactly one violation naming ${rel}, got ${JSON.stringify(ctx.outcome.violations)}`);
    assert.ok(Number.isInteger(hits[0].line) && hits[0].line > 0, `expected a real line number, got ${JSON.stringify(hits[0])}`);
  });

  scoped(/^the gate refuses the parcel with "([^"]+)"$/, (ctx, refusalText) => {
    assert.equal(PILOT_RAW_MKDTEMP_REFUSAL, refusalText);
    assert.ok((ctx.outcome.violations || []).length > 0, 'expected at least one violation to drive the refusal');
  });

  scoped(/^the check reports no violations$/, (ctx) => {
    assert.deepEqual(ctx.outcome.violations, []);
  });

  scoped(/^the check records "([^"]+)" as scanned$/, (ctx, rel) => {
    assert.ok((ctx.outcome.scannedPaths || []).includes(rel), `expected ${rel} among scannedPaths, got ${JSON.stringify(ctx.outcome.scannedPaths)}`);
  });

  scoped(/^the check records "([^"]+)" as not scanned$/, (ctx, rel) => {
    assert.ok(!(ctx.outcome.scannedPaths || []).includes(rel), `expected ${rel} NOT among scannedPaths, got ${JSON.stringify(ctx.outcome.scannedPaths)}`);
  });

  scoped(/^the check verdict for that handler is "([^"]+)"$/, (ctx, verdict) => {
    const isViolation = (ctx.outcome.violations || []).some((v) => v.file === ctx.lastHandlerPath);
    assert.equal(isViolation ? 'violation' : 'clean', verdict);
  });

  scoped(/^the classification is "([^"]+)"$/, (ctx, classification) => {
    assert.equal(ctx.classification, classification);
  });
}

module.exports = { registerSteps };
