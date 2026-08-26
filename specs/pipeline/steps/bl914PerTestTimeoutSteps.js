'use strict';

// BL-914: step handlers for "heavy real-work unit tests carry their own
// timeout instead of raising the global budget". Parses the real test
// files and the real vitest.config.mjs (via testTimeoutParser.js) - never
// hand-copies the numbers being checked. A structural contract only: it
// pins that the overrides exist and the global default is untouched, not
// whether the headroom is actually enough under load (that is the
// ticket's own qa_e2e_procedure, a timing question, not a Gherkin one).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTestTimeouts } = require('./lib/testTimeoutParser');

const EXT_TEST = path.join(__dirname, '..', '..', '..', 'extension', 'test');
const VITEST_CONFIG = path.join(__dirname, '..', '..', '..', 'extension', 'vitest.config.mjs');

const FEATURE = 'heavy real-work unit tests carry their own timeout instead of raising the global budget';

// Every Examples: <file> value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough. The named test list is exactly the set
// this ticket's own description names per file - not "every test in the
// file", several of which deliberately carry no override (fixture-snapshot
// tests, the missing-diagram-source rejection).
const FILES = {
  dependencyGateCliReportsAndScope: {
    path: path.join(EXT_TEST, 'dependencyGateCliReportsAndScope.test.js'),
    testNames: ['running the REAL checker twice over identical fixture code produces byte-identical reports'],
  },
  renderBriefingDiagramsCli: {
    path: path.join(EXT_TEST, 'renderBriefingDiagramsCli.test.js'),
    testNames: [
      'renders exactly the two maintained diagrams, named and base64-encoded',
      'main() runs in-process against the real repo and prints the two maintained diagrams as JSON',
      'the compiled CLI runs standalone as a subprocess and produces the same result',
    ],
  },
  renderBriefingBurndownCli: {
    path: path.join(EXT_TEST, 'renderBriefingBurndownCli.test.js'),
    testNames: [
      'renderBriefingBurndown falls back to deriving its own history when no snapshot path is given (smoke test against the real repo)',
      'renderBriefingBurndown falls back to deriving its own history when the given snapshot path does not exist',
    ],
  },
};

function knownFile(token) {
  if (!Object.prototype.hasOwnProperty.call(FILES, token)) {
    throw new Error(`unknown <file> token: ${token}`);
  }
  return FILES[token];
}

function readSuiteDefaultTimeout() {
  const text = fs.readFileSync(VITEST_CONFIG, 'utf8');
  const match = text.match(/testTimeout:\s*(\d+)/);
  if (!match) {
    throw new Error(`could not find testTimeout: <number> in ${VITEST_CONFIG}`);
  }
  return Number(match[1]);
}

function namedTimeouts(fileEntry) {
  const calls = parseTestTimeouts(fs.readFileSync(fileEntry.path, 'utf8'));
  return fileEntry.testNames.map((name) => {
    const call = calls.find((c) => c.name === name);
    if (!call) {
      throw new Error(`expected a test('${name}', ...) call in ${fileEntry.path}, found none`);
    }
    return { name, timeoutMs: call.timeoutMs };
  });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the extension unit suite's vitest config declares a suite-wide default timeout$/,
    (ctx) => {
      ctx.suiteDefaultTimeout = readSuiteDefaultTimeout();
      assert.ok(Number.isFinite(ctx.suiteDefaultTimeout) && ctx.suiteDefaultTimeout > 0, 'expected a finite, positive suite-wide default timeout');
    },
    FEATURE
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────────
  registry.defineScoped(
    /^the heavy real-work tests named by this ticket in "([^"]+)"$/,
    (ctx, token) => {
      ctx.fileEntry = knownFile(token);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the test file is inspected$/,
    (ctx) => {
      ctx.namedTimeouts = namedTimeouts(ctx.fileEntry);
    },
    FEATURE
  );

  registry.defineScoped(
    /^every one of those tests declares an explicit per-test timeout$/,
    (ctx) => {
      for (const { name, timeoutMs } of ctx.namedTimeouts) {
        assert.notEqual(timeoutMs, null, `expected an explicit per-test timeout on "${name}", found none`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^each declared timeout is greater than the suite-wide default$/,
    (ctx) => {
      for (const { name, timeoutMs } of ctx.namedTimeouts) {
        assert.ok(timeoutMs > ctx.suiteDefaultTimeout, `expected "${name}"'s timeout (${timeoutMs}ms) to exceed the suite default (${ctx.suiteDefaultTimeout}ms)`);
      }
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the vitest config is inspected$/,
    (ctx) => {
      ctx.suiteDefaultTimeout = readSuiteDefaultTimeout();
    },
    FEATURE
  );

  registry.defineScoped(
    /^the suite-wide default timeout is still 20000 milliseconds$/,
    (ctx) => {
      assert.equal(ctx.suiteDefaultTimeout, 20000);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^every per-test timeout this ticket declares is inspected$/,
    (ctx) => {
      ctx.suiteDefaultTimeout = readSuiteDefaultTimeout();
      ctx.allNamedTimeouts = Object.values(FILES).flatMap((fileEntry) => namedTimeouts(fileEntry));
    },
    FEATURE
  );

  registry.defineScoped(
    /^no declared timeout is zero or otherwise unbounded$/,
    (ctx) => {
      for (const { name, timeoutMs } of ctx.allNamedTimeouts) {
        assert.notEqual(timeoutMs, null, `expected "${name}" to declare a timeout at all`);
        assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, `expected "${name}"'s timeout to be a bounded positive number, got ${timeoutMs}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^each stays within one order of magnitude of the suite-wide default$/,
    (ctx) => {
      const ceiling = ctx.suiteDefaultTimeout * 10;
      for (const { name, timeoutMs } of ctx.allNamedTimeouts) {
        assert.ok(timeoutMs <= ceiling, `expected "${name}"'s timeout (${timeoutMs}ms) to stay within one order of magnitude of the suite default (ceiling ${ceiling}ms)`);
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
