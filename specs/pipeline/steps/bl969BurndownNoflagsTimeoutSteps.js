'use strict';

// BL-969: step handlers for "the no-flags burndown CLI test carries a
// timeout covering its real cost". Same structural posture (and the same
// shared testTimeoutParser.js) as BL-914's handlers: parse the REAL test
// file and the REAL vitest.config.mjs, pin that the override exists with
// the floored headroom and that the suite default is untouched - never
// whether the headroom holds under load (the ticket's qa_e2e_procedure, a
// timing question, not a Gherkin one).
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTestTimeouts } = require('./lib/testTimeoutParser');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const VITEST_CONFIG = path.join(REPO_ROOT, 'extension', 'vitest.config.mjs');

const FEATURE = 'the no-flags burndown CLI test carries a timeout covering its real cost';

// KNOWN_VALUES: the scenario's quoted test name and file path - exactly the
// one call site this ticket covers, never a passthrough.
const KNOWN_TEST_NAME = 'the compiled CLI runs with no flags at all against the real repo (unchanged pre-BL-897 behavior)';
const KNOWN_FILE_REL = 'extension/test/renderBriefingBurndownCli.test.js';
const FLOOR_MS = 60000;

function readSuiteDefaultTimeout() {
  const text = fs.readFileSync(VITEST_CONFIG, 'utf8');
  const match = text.match(/testTimeout:\s*(\d+)/);
  if (!match) {
    throw new Error(`could not find testTimeout: <number> in ${VITEST_CONFIG}`);
  }
  return Number(match[1]);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the extension unit suite's vitest config declares a suite-wide default timeout$/, (ctx) => {
    ctx.suiteDefault = readSuiteDefaultTimeout();
    assert.ok(ctx.suiteDefault > 0, 'suite default must be a positive number');
  });

  scoped(/^the test "([^"]+)" in "([^"]+)"$/, (ctx, testName, fileRel) => {
    assert.equal(testName, KNOWN_TEST_NAME, `unknown test-name token: ${testName}`);
    assert.equal(fileRel, KNOWN_FILE_REL, `unknown file token: ${fileRel}`);
    ctx.testName = testName;
    ctx.filePath = path.join(REPO_ROOT, fileRel);
    assert.ok(fs.existsSync(ctx.filePath), `test file missing: ${ctx.filePath}`);
  });

  scoped(/^the test file is inspected$/, (ctx) => {
    const calls = parseTestTimeouts(fs.readFileSync(ctx.filePath, 'utf8'));
    ctx.call = calls.find((c) => c.name === ctx.testName);
    assert.ok(ctx.call, `expected a test('${ctx.testName}', ...) call site, found none`);
  });

  scoped(/^the test declares an explicit per-test timeout$/, (ctx) => {
    assert.ok(
      typeof ctx.call.timeoutMs === 'number',
      `the no-flags CLI test must carry its own timeout argument, found none (suite default would apply)`
    );
  });
  scoped(/^the declared timeout is at least 60000 milliseconds$/, (ctx) => {
    assert.ok(ctx.call.timeoutMs >= FLOOR_MS, `declared ${ctx.call.timeoutMs}ms < the ${FLOOR_MS}ms floor`);
  });
  scoped(/^the declared timeout stays within one order of magnitude of the suite-wide default$/, (ctx) => {
    assert.ok(
      ctx.call.timeoutMs <= ctx.suiteDefault * 10,
      `declared ${ctx.call.timeoutMs}ms exceeds 10x the ${ctx.suiteDefault}ms suite default (BL-914's ceiling)`
    );
  });

  scoped(/^the vitest config is inspected$/, (ctx) => {
    ctx.suiteDefault = readSuiteDefaultTimeout();
  });
  scoped(/^the suite-wide default timeout is still 20000 milliseconds$/, (ctx) => {
    assert.equal(ctx.suiteDefault, 20000, `the suite-wide default must stay 20000ms, got ${ctx.suiteDefault}`);
  });
}

module.exports = { registerSteps };
