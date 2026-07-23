'use strict';

// BL-375: step handlers for "Dependency-gate tests parallelise across
// workers instead of bounding the suite". Drives REAL structural checks
// against the actual extension/test/dependencyGateCli*.test.js family (a
// prefix, never a hardcoded single path - the ticket's own "any future
// profiling wants to find them without a hardcoded list" instruction, the
// same convention hotTestFilesStopWaitingSteps.js's own family reader now
// follows) - never a re-run of the tests themselves, matching the
// established structural-proof pattern (clisTestedInProcessSteps.js,
// systemdUnitsCanStartSteps.js).
const fs = require('node:fs');
const path = require('node:path');

const EXT_TEST_DIR = path.join(__dirname, '..', '..', '..', 'extension', 'test');
const PRE_SPLIT_TEST_COUNT = 12;

function familyFiles() {
  return fs
    .readdirSync(EXT_TEST_DIR)
    .filter((name) => name.startsWith('dependencyGateCli') && name.endsWith('.test.js'))
    .map((name) => ({ name, source: fs.readFileSync(path.join(EXT_TEST_DIR, name), 'utf8') }));
}

// Every `test('...', ...)` block, split at line-start `test(` boundaries -
// safe for this specific, self-authored family's consistent formatting
// (one top-level test() call per statement, never nested).
function testBlocks(source) {
  return source
    .split(/(?=^test\()/m)
    .filter((chunk) => chunk.startsWith('test('));
}

const REAL_ENGINE_CALL_PATTERN = /\b(?:runDependencyCruiser|runGate)\(/;
const MOCK_PATTERN = /\b(?:vi\.mock|jest\.mock|sinon\.stub|sinon\.fake)\s*\(/;

// BL-375's own warning: a Scenario Outline's <test> column must be validated
// against an explicit KNOWN_VALUES lookup, never a passthrough - an
// unrecognized slug (including a gherkin-mutator mutant) throws here rather
// than silently taking some default branch.
const KNOWN_VALUES = {
  'clean-fixture-passes': 'the REAL pinned checker + REAL project ruleset passes a clean fixture with no forbidden edge',
  'every-forbidden-rule': 'the REAL checker catches every forbidden-dependency rule, from a single engine run',
  'byte-identical-reports': 'running the REAL checker twice over identical fixture code produces byte-identical reports',
  'localstorage-global': 'runGate flags a bare localStorage.setItem(...) global reference that depcruise alone misses',
  'sessionstorage-global': 'sessionStorage is caught too, and a clean media file is not flagged',
  'per-parcel-single-file': 'per-parcel mode (a single changed file) reports only violations reachable from that file',
};

// BL-375 architect bounce: the ORIGINAL version of this function located
// only the FILE holding a test's title and let both Then steps check that
// whole file's source - so "it runs the real pinned checker" passed for
// ANY test sharing a file with a genuinely real-engine one, never proving
// the NAMED test's own body does. Now returns the test's own isolated
// block (testBlocks' own per-test split, already used by scenario 03) so
// both checks are scoped to exactly the test scenario 02 names.
function testBlockHoldingTitle(files, titleFragment) {
  for (const f of files) {
    const block = testBlocks(f.source).find((b) => b.includes(titleFragment));
    if (block) {
      // BL-375: the scenario's own two Then steps are scoped DIFFERENTLY
      // by design - "it runs the real pinned checker" is about the named
      // TEST's own body (block), "nothing in its FILE mocks..." is a
      // broader, file-wide guarantee (the Gherkin's own literal wording) -
      // both are carried here so each check reads the right one.
      return { name: f.name, block, source: f.source };
    }
  }
  throw new Error(`no dependencyGateCli* file holds a test titled with fragment: ${titleFragment}`);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the dependency-gate tests are spread across more than one test file$/, (ctx) => {
    ctx.files = familyFiles();
    if (ctx.files.length <= 1) {
      throw new Error(`expected the dependency-gate tests split across more than one file, found: ${ctx.files.map((f) => f.name).join(', ')}`);
    }
  });

  // ── dependency-gate-tests-parallelise-01 ─────────────────────────────
  registry.define(/^I count every test across all dependency-gate test files$/, (ctx) => {
    ctx.totalTests = ctx.files.reduce((sum, f) => sum + testBlocks(f.source).length, 0);
  });

  registry.define(/^the total equals the 12 tests the single pre-split file held$/, (ctx) => {
    if (ctx.totalTests !== PRE_SPLIT_TEST_COUNT) {
      throw new Error(`expected exactly ${PRE_SPLIT_TEST_COUNT} tests total across the split files, got ${ctx.totalTests}`);
    }
  });

  // ── dependency-gate-tests-parallelise-02 (Scenario Outline) ──────────
  registry.define(/^I inspect the real-engine test "([^"]+)"$/, (ctx, testSlug) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_VALUES, testSlug)) {
      throw new Error(`dependency-gate-tests-parallelise: unrecognized <test> example value "${testSlug}"`);
    }
    ctx.holder = testBlockHoldingTitle(ctx.files, KNOWN_VALUES[testSlug]);
  });

  registry.define(/^it runs the real pinned dependency-cruiser against the real project ruleset$/, (ctx) => {
    if (!REAL_ENGINE_CALL_PATTERN.test(ctx.holder.block)) {
      throw new Error(`expected the test itself (in ${ctx.holder.name}) to contain a genuine runDependencyCruiser(/runGate( call, not merely live in a file that has one`);
    }
  });

  registry.define(/^nothing in its file mocks, stubs, or fakes the dependency-cruiser engine$/, (ctx) => {
    // Deliberately file-scoped, not test-scoped - the Gherkin's own literal
    // wording ("nothing in ITS FILE mocks...").
    if (MOCK_PATTERN.test(ctx.holder.source)) {
      throw new Error(`expected ${ctx.holder.name} to contain no mock/stub/fake of the dependency-cruiser engine`);
    }
  });

  // ── dependency-gate-tests-parallelise-03 ─────────────────────────────
  registry.define(/^I group the real-engine tests by the file holding them$/, (ctx) => {
    ctx.realEngineCountByFile = {};
    for (const f of ctx.files) {
      const count = testBlocks(f.source).filter((block) => REAL_ENGINE_CALL_PATTERN.test(block)).length;
      ctx.realEngineCountByFile[f.name] = count;
    }
  });

  registry.define(/^no file holds more than 2 of them$/, (ctx) => {
    for (const [name, count] of Object.entries(ctx.realEngineCountByFile)) {
      if (count > 2) {
        throw new Error(`expected no file to hold more than 2 real-engine tests, ${name} holds ${count}`);
      }
    }
  });
}

module.exports = { registerSteps };
