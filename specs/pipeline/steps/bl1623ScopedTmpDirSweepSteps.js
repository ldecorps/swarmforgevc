'use strict';

// BL-1623: step handlers for "A fixture sweep never reaps a live run's temp
// root". Drives the REAL sweepStaleTmpDirs helper (extension/test/helpers/
// tmpDir.js) against real mkdtemp roots (scenario 01), reads the REAL
// migrated property files' own source (scenario 02, the census pin), and
// drives the REAL blind-sweep finder (extension/test/helpers/
// blindTmpDirSweepFinder.js) against a real fixture directory and the real
// repository tree (scenario 03) - no reimplementation of any of the three.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sweepStaleTmpDirs } = require('../../../extension/test/helpers/tmpDir');
const { findBlindTmpDirSweeps } = require('../../../extension/test/helpers/blindTmpDirSweepFinder');

const FEATURE = "BL-1623 A fixture sweep never reaps a live run's temp root";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_TEST_DIR = path.join(REPO_ROOT, 'extension', 'test');
const PREFIX = 'bl1623-steps-fixture-';

const MIGRATED_FILES = [
  'bl1030RefusalCostsNothing.property.test.js',
  'bl1300SingleEnforceableBudget.property.test.js',
  'bl1309LandDecideEntanglementInvariants.property.test.js',
  'bl1343ReplayNeverDropsOwnPathInvariants.property.test.js',
  'bl1356StampOffInvariants.property.test.js',
  'bl1358MutantTimeCeilingInvariants.property.test.js',
  'bl1359MergeChargedInvariants.property.test.js',
];

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: only a root whose recorded owner is gone is removed ────
  scoped(/^a temp root named with the sweep prefix and (.+)$/, (ctx, owner) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1623-sweep-steps-'));
    ctx.sweepDir = dir;
    let name;
    if (owner === "this process's own pid") {
      name = `${PREFIX}${process.pid}-a`;
    } else if (owner === 'a pid that is alive') {
      // The test runner's own parent process - alive for the run's duration.
      name = `${PREFIX}${process.ppid}-a`;
    } else if (owner === 'a pid that no longer exists') {
      // spawnSync blocks until the child has exited and been reaped, so by
      // the time it returns this pid is guaranteed gone, never a zombie.
      const dead = spawnSync(process.execPath, ['-e', '""']);
      assert.ok(dead.pid, 'expected the throwaway child to report a pid');
      name = `${PREFIX}${dead.pid}-a`;
    } else if (owner === 'no pid at all, the pre-fix name shape') {
      name = `${PREFIX}legacy-a`;
    } else {
      throw new Error(`unrecognized owner: ${owner}`);
    }
    ctx.rootName = name;
    ctx.rootPath = path.join(dir, name);
    fs.mkdirSync(ctx.rootPath);
  });

  scoped(/^the scoped temp-root sweep runs for that prefix$/, (ctx) => {
    sweepStaleTmpDirs({ prefix: PREFIX, dir: ctx.sweepDir });
  });

  scoped(/^the root (is removed|survives)$/, (ctx, outcome) => {
    try {
      const exists = fs.existsSync(ctx.rootPath);
      if (outcome === 'is removed') {
        assert.equal(exists, false, `expected ${ctx.rootName} to have been removed, it still exists`);
      } else {
        assert.equal(exists, true, `expected ${ctx.rootName} to survive, it was removed`);
      }
    } finally {
      fs.rmSync(ctx.sweepDir, { recursive: true, force: true });
    }
  });

  // ── Scenario 02: the census pin - each migrated file's own source ───────
  scoped(/^the source of (.+) is read$/, (ctx, file) => {
    ctx.file = file;
    ctx.source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  });

  scoped(/^it builds its temp roots with its prefix followed by its own pid$/, (ctx) => {
    assert.match(
      ctx.source,
      /\$\{FIXTURE_PREFIX\}\$\{process\.pid\}-/,
      `expected ${ctx.file} to build its roots as \${FIXTURE_PREFIX}\${process.pid}-, found no such literal`
    );
  });

  scoped(/^it sweeps through the scoped temp-root helper and never lists the temp dir itself$/, (ctx) => {
    assert.match(ctx.source, /sweepStaleTmpDirs\(/, `expected ${ctx.file} to call sweepStaleTmpDirs`);
    assert.doesNotMatch(
      ctx.source,
      /readdirSync\(\s*os\.tmpdir\(\)\s*\)/,
      `expected ${ctx.file} to never blindly list the temp dir directly`
    );
  });

  // ── Scenario 03: the guard's finder, on a fixture and on the real tree ──
  scoped(
    /^a fixture directory holding one property file that lists the temp dir itself and one that sweeps through the helper$/,
    (ctx) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1623-finder-fixture-'));
      ctx.fixtureDir = dir;
      fs.writeFileSync(
        path.join(dir, 'blindOne.property.test.js'),
        'for (const e of fs.readdirSync(os.tmpdir())) { /* blind */ }\n'
      );
      fs.writeFileSync(path.join(dir, 'cleanOne.property.test.js'), "sweepStaleTmpDirs({ prefix: 'x-' });\n");
    }
  );

  scoped(/^the blind temp-dir sweep finder runs over that directory$/, (ctx) => {
    ctx.fixtureOffenders = findBlindTmpDirSweeps(ctx.fixtureDir);
  });

  scoped(/^it names exactly the blind file$/, (ctx) => {
    try {
      assert.deepEqual(ctx.fixtureOffenders, ['blindOne.property.test.js']);
    } finally {
      fs.rmSync(ctx.fixtureDir, { recursive: true, force: true });
    }
  });

  scoped(/^the same finder over this repository's property files names none and counts 7 migrated files$/, () => {
    const offenders = findBlindTmpDirSweeps(EXTENSION_TEST_DIR);
    assert.deepEqual(offenders, [], `blind temp-dir sweep(s) found on the real tree: ${offenders.join(', ')}`);

    const present = MIGRATED_FILES.filter((name) => fs.existsSync(path.join(EXTENSION_TEST_DIR, name)));
    assert.equal(present.length, 7, `expected 7 migrated files present, found ${present.length}`);
  });
}

module.exports = { registerSteps };
