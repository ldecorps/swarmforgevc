'use strict';

// BL-1695: step handlers for "the bl1538 closure fixture copies the
// closure, not the whole scripts tree". Drives the REAL shared fixture
// helper (extension/test/helpers/bl1538ClosureFixture.js) the property
// test file itself imports - never a reimplementation of the copy logic
// - for scenario 01; scenario 02 is a static read of the property test
// file's own source for its three invariant-2 assertion messages.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { trackedTmpRoot } = require('./lib/fixtureReaper');
const { assertionsInBlock, everyMatchingAssertionInterpolates } = require('../../../extension/test/helpers/assertionNamesCauseCheck');

const EXTENSION_TEST_DIR = path.join(__dirname, '..', '..', '..', 'extension', 'test');
const PROPERTY_FILE = path.join(EXTENSION_TEST_DIR, 'bl1538Bl1028RunnerFixtureClosureInvariants.property.test.js');
const INVARIANT_2_ANCHOR = "describe('BL-1538 invariant 2:";

const FEATURE = 'BL-1695 the bl1538 closure fixture copies the closure, not the whole scripts tree';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the property file's fixture helpers are loaded from extension\/test$/, (ctx) => {
    // require, not fs.readFileSync: scenario 01 drives the REAL fixture
    // helper's behavior, never a parse of it.
    ctx.fixture = require(path.join(EXTENSION_TEST_DIR, 'helpers', 'bl1538ClosureFixture'));
    assert.ok(ctx.fixture, `expected to load bl1538ClosureFixture.js from ${EXTENSION_TEST_DIR}`);
  });

  scoped(/^the fixture builds its scratch scripts tree under a temporary root$/, (ctx) => {
    ctx.dest = trackedTmpRoot('bl1695-acceptance-');
    ctx.fixture.copyScriptsTree(ctx.dest);
  });

  scoped(/^the root holds exactly the closure of promotion_gates_cli\.bb as \.bb files$/, (ctx) => {
    // BL-1695 authoring finding (2026-09-22): the runner's OWN
    // recomputation of promotion-gate-deps (it load-files
    // bb_load_closure_lib.bb directly, line ~56) and invariant 1's own
    // closureOf(root, ENTRY) re-derivation both need the
    // closure-computation TOOLING present too, not just
    // promotion_gates_cli.bb's own closure - verified empirically:
    // omitting either bb_load_closure_lib.bb or bb_load_closure_cli.bb
    // makes the fixture fail outright ("File does not exist"), so
    // "exactly the closure" here means the CLOSURE plus the two files
    // the closure-computation mechanism itself is built from, never the
    // 496-file directory the ticket's own fix replaces.
    const expected = [...ctx.fixture.BASE_CLOSURE, ctx.fixture.CLOSURE_LIB, ctx.fixture.CLOSURE_CLI].sort();
    const topLevelBbFiles = fs
      .readdirSync(ctx.dest)
      .filter((name) => name.endsWith('.bb'))
      .sort();
    assert.deepEqual(
      topLevelBbFiles,
      expected,
      `expected the scratch root to hold exactly ${JSON.stringify(expected)}, got ${JSON.stringify(topLevelBbFiles)}`
    );
  });

  scoped(/^the runner is present under the root's test directory$/, (ctx) => {
    const runnerPath = path.join(ctx.dest, ctx.fixture.RUNNER_REL);
    assert.ok(fs.existsSync(runnerPath), `expected the runner at ${runnerPath}`);
  });

  scoped(/^no other file from swarmforge\/scripts was copied$/, (ctx) => {
    const expectedCount = ctx.fixture.BASE_CLOSURE.length + 2 /* CLOSURE_LIB, CLOSURE_CLI */ + 1 /* test/ dir */;
    const entries = fs.readdirSync(ctx.dest);
    assert.equal(
      entries.length,
      expectedCount,
      `expected exactly ${expectedCount} top-level entries (closure + closure tooling + test/), got ${entries.length}: ${JSON.stringify(entries.sort())}`
    );
    if (ctx.dest) {
      fs.rmSync(ctx.dest, { recursive: true, force: true });
    }
  });

  scoped(/^the source of the property file is read$/, (ctx) => {
    ctx.source = fs.readFileSync(PROPERTY_FILE, 'utf8');
  });

  scoped(
    /^each assertion message in the invariant-2 property interpolates the removed member$/,
    (ctx) => {
      const assertions = assertionsInBlock(ctx.source, INVARIANT_2_ANCHOR);
      assert.ok(assertions, 'expected to find the invariant 2 describe block');
      const result = everyMatchingAssertionInterpolates(assertions, /removed/, '${removed}');
      assert.ok(result.relevant.length >= 3, `expected at least 3 assertions referencing removed in invariant 2, got ${result.relevant.length}`);
      assert.ok(result.ok, `expected every removed-referencing assertion to interpolate \${removed}, missing: ${JSON.stringify(result.missing)}`);
    }
  );

  scoped(
    /^the subprocess assertion carries the runner's stderr and the presence assertion carries the observed copy set$/,
    (ctx) => {
      const assertions = assertionsInBlock(ctx.source, INVARIANT_2_ANCHOR);
      assert.ok(assertions, 'expected to find the invariant 2 describe block');
      const block = assertions.join('\n');
      assert.match(block, /result\.stderr/, 'expected the subprocess-failure assertion to carry the runner stderr');
      assert.match(block, /observed copy set/, 'expected the presence-failure assertion to carry the observed copy set');
    }
  );
}

module.exports = { registerSteps };
