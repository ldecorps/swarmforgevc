'use strict';

// BL-1062: step handlers for "a generator-reach floor is satisfiable by
// construction". Scenario 01 RUNS the two real property files repeatedly, each
// run drawing its own fresh seed - which is the whole point, since the defect
// was a per-run lottery that a single green run cannot disprove. Scenario 02
// drives the SHIPPED floor assertion (test/helpers/reachFloors.js), the same
// function both tests call, rather than a restatement of it - and rather than
// mutating a live test file mid-run, which BL-1209 is the standing lesson
// against.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');

const FEATURE = 'BL-1062 a generator-reach floor is satisfiable by construction';

// The two files the ticket names, by the prose the Examples table uses.
const TEST_FILES = {
  'the materialized-guard sensitivity': 'test/bl968MaterializedGuardSensitivity.property.test.js',
  'the socket-fixture death shape': 'test/bl948SocketFixtureInvariants.property.test.js',
};

// Each run draws a fresh seed, so N runs is N independent trials against the
// floor. Five is enough to make the OLD bl968 lottery (~16% per run) fail with
// probability ~58% while keeping the acceptance affordable; the ticket's own
// 20-run measurement lives in the evidence file, where its cost is justified.
const RUNS = 5;

function runPropertyFile(relPath) {
  try {
    execFileSync(
      path.join(EXT_DIR, 'node_modules', '.bin', 'vitest'),
      ['run', '--config', 'vitest.properties.config.mjs', relPath],
      { cwd: EXT_DIR, encoding: 'utf8', stdio: 'pipe' }
    );
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^the implementation under test is correct$/, (ctx) => {
    // Nothing to arrange: the files are run against the shipped tree as it
    // stands. Named as a Given because the scenario's claim is only about a
    // CORRECT implementation - a red here means the floor is unsatisfiable,
    // not that the code under test is broken.
    ctx.bl1062 = {};
  });

  scoped(/^(.+) runs repeatedly, each run drawing a different seed$/, (ctx, which) => {
    const relPath = TEST_FILES[which.trim()];
    if (!relPath) {
      throw new Error(`unknown property file "${which}"; known: ${Object.keys(TEST_FILES).join(' | ')}`);
    }
    if (!fs.existsSync(path.join(EXT_DIR, relPath))) {
      throw new Error(`${relPath} does not exist`);
    }
    ctx.bl1062.relPath = relPath;
    ctx.bl1062.runs = [];
    for (let i = 0; i < RUNS; i += 1) {
      ctx.bl1062.runs.push(runPropertyFile(relPath));
    }
  });

  scoped(/^every declared reach floor is met on every run$/, (ctx) => {
    const failed = ctx.bl1062.runs.filter((run) => !run.ok);
    const floorFailures = failed.filter((run) => /reach floor:/.test(run.output));
    assert.deepEqual(
      floorFailures.map((run) => (run.output.match(/reach floor: [^\n]*/) || [''])[0]),
      [],
      `${ctx.bl1062.relPath}: a reach floor went unmet across ${RUNS} seeded runs`
    );
    // A non-floor failure is a different defect and must not be swallowed by
    // a scenario that only asks about floors.
    assert.deepEqual(
      failed.filter((run) => !/reach floor:/.test(run.output)).map((run) => run.output.slice(0, 400)),
      [],
      `${ctx.bl1062.relPath}: the file failed for a reason other than a reach floor`
    );
  });

  // ── 02: the floor still fails when a value stops being reached ──────
  scoped(/^the generator is restricted so one class is never drawn$/, (ctx) => {
    const { assertReachFloor } = require(path.join(EXT_DIR, 'test', 'helpers', 'reachFloors.js'));
    ctx.bl1062 = ctx.bl1062 || {};
    ctx.bl1062.assertReachFloor = assertReachFloor;
    // The coverage a restricted generator produces: two classes exercised, the
    // third never drawn. This is exactly the shape bl968 computes and hands to
    // the shared assertion.
    ctx.bl1062.restrictedCoverage = { 'git-root-resolve': 8, 'live-repo-read': 8 };
    ctx.bl1062.missingClass = 'benign-subprocess';
    ctx.bl1062.requiredClasses = ['git-root-resolve', 'live-repo-read', 'benign-subprocess'];
  });

  scoped(/^the test runs$/, (ctx) => {
    try {
      ctx.bl1062.assertReachFloor(ctx.bl1062.restrictedCoverage, ctx.bl1062.requiredClasses, 5, 'class');
      ctx.bl1062.thrown = null;
    } catch (err) {
      ctx.bl1062.thrown = err;
    }
  });

  scoped(/^the test fails and names the class that was not reached$/, (ctx) => {
    assert.ok(ctx.bl1062.thrown, 'the floor accepted a coverage map missing a class');
    assert.match(
      ctx.bl1062.thrown.message,
      new RegExp(`reach floor: class ${ctx.bl1062.missingClass}`),
      `the failure does not name the unreached class: ${ctx.bl1062.thrown.message}`
    );
  });

  // ── 03: no floor was removed to reach green ─────────────────────────
  scoped(/^the reach floors are inspected after the change$/, (ctx) => {
    ctx.bl1062 = ctx.bl1062 || {};
    ctx.bl1062.sources = Object.fromEntries(
      Object.entries(TEST_FILES).map(([label, rel]) => [rel, fs.readFileSync(path.join(EXT_DIR, rel), 'utf8')])
    );
  });

  scoped(/^each test still declares a floor for every value in its space$/, (ctx) => {
    const bl968 = ctx.bl1062.sources['test/bl968MaterializedGuardSensitivity.property.test.js'];
    const bl948 = ctx.bl1062.sources['test/bl948SocketFixtureInvariants.property.test.js'];

    // The floor must be asserted over the REQUIRED space, not over the same
    // constant that drives the iteration - otherwise deleting a value deletes
    // its check too, and the test goes green having stopped exercising it.
    for (const value of ['git-root-resolve', 'live-repo-read', 'benign-subprocess']) {
      assert.ok(
        new RegExp(`REQUIRED_CLASSES = \\[[^\\]]*'${value}'`, 's').test(bl968),
        `bl968 no longer requires the class ${value}`
      );
    }
    for (const value of ['direct', 'via-lib']) {
      assert.ok(
        new RegExp(`REQUIRED_DEPTHS = \\[[^\\]]*'${value}'`, 's').test(bl968),
        `bl968 no longer requires the depth ${value}`
      );
    }
    assert.match(bl968, /assertReachFloor\(coverage\.cls, REQUIRED_CLASSES/, 'bl968 dropped its class floor');
    assert.match(bl968, /assertReachFloor\(coverage\.depth, REQUIRED_DEPTHS/, 'bl968 dropped its depth floor');

    for (const value of ['clean', 'throw', 'nonzero']) {
      assert.ok(
        new RegExp(`assertReachFloor\\(drawnCounts, \\[[^\\]]*'${value}'`, 's').test(bl948),
        `bl948 no longer requires the death shape ${value}`
      );
    }
    assert.match(bl948, /assert\.equal\(drawn\.size, 3/, 'bl948 dropped its every-shape assertion');
  });
}

module.exports = { registerSteps };
