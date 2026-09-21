'use strict';

// BL-1677: step handlers for "A property file's own prefix sweep never
// reaps a live peer's fixture". Drives the REAL sweepStaleTmpDirs helper
// (extension/test/helpers/tmpDir.js) against real mkdtemp roots (scenario
// 01), the REAL blind-sweep finder (extension/test/helpers/
// blindTmpDirSweepFinder.js) against a real fixture directory holding the
// aliased form (scenario 02), and the REAL blindTmpDirSweepGuard.test.js
// spawned via vitest (scenario 03, "the guard TEST runs") - no
// reimplementation of any of the three.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sweepStaleTmpDirs } = require('../../../extension/test/helpers/tmpDir');
const { findBlindTmpDirSweeps } = require('../../../extension/test/helpers/blindTmpDirSweepFinder');

const FEATURE = "BL-1677 A property file's own prefix sweep never reaps a live peer's fixture";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EXTENSION_TEST_DIR = path.join(EXTENSION_DIR, 'test');
const PREFIX = 'bl1677-steps-fixture-';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: the owner-aware sweep, real helper ──────────────────────
  scoped(/^a scratch temp directory holding a root named with (.+) under the prefix$/, (ctx, owner) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1677-sweep-steps-'));
    ctx.sweepDir = dir;
    let name;
    if (owner === "a live peer process's pid") {
      // The test runner's own parent process - alive for the run's duration.
      name = `${PREFIX}${process.ppid}-a`;
    } else if (owner === "a dead process's pid") {
      // spawnSync blocks until the child has exited and been reaped, so by
      // the time it returns this pid is guaranteed gone, never a zombie.
      const dead = spawnSync(process.execPath, ['-e', '""']);
      assert.ok(dead.pid, 'expected the throwaway child to report a pid');
      name = `${PREFIX}${dead.pid}-a`;
    } else {
      throw new Error(`unrecognized owner: ${owner}`);
    }
    ctx.rootName = name;
    ctx.rootPath = path.join(dir, name);
    fs.mkdirSync(ctx.rootPath);
  });

  scoped(/^the prefix sweep the four files now use runs from this process$/, (ctx) => {
    sweepStaleTmpDirs({ prefix: PREFIX, dir: ctx.sweepDir });
  });

  scoped(/^that root is (kept|reaped)$/, (ctx, outcome) => {
    try {
      const exists = fs.existsSync(ctx.rootPath);
      if (outcome === 'reaped') {
        assert.equal(exists, false, `expected ${ctx.rootName} to have been reaped, it still exists`);
      } else {
        assert.equal(exists, true, `expected ${ctx.rootName} to be kept, it was removed`);
      }
    } finally {
      fs.rmSync(ctx.sweepDir, { recursive: true, force: true });
    }
  });

  // ── Scenario 02: the finder's aliased-form detection, real finder ───────
  scoped(
    /^a scratch test directory holding one file that binds os\.tmpdir\(\) to a variable and lists that variable with readdirSync$/,
    (ctx) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1677-finder-fixture-'));
      ctx.fixtureDir = dir;
      fs.writeFileSync(
        path.join(dir, 'aliasedOne.property.test.js'),
        'const parent = os.tmpdir();\nfor (const e of fs.readdirSync(parent)) { /* blind */ }\n'
      );
    }
  );

  scoped(
    /^the blind temp-dir sweep finder runs over the scratch directory and over the real extension\/test directory$/,
    (ctx) => {
      ctx.scratchOffenders = findBlindTmpDirSweeps(ctx.fixtureDir);
      ctx.realTreeOffenders = findBlindTmpDirSweeps(EXTENSION_TEST_DIR);
    }
  );

  scoped(/^it reports the scratch file$/, (ctx) => {
    try {
      assert.deepEqual(ctx.scratchOffenders, ['aliasedOne.property.test.js']);
    } finally {
      fs.rmSync(ctx.fixtureDir, { recursive: true, force: true });
    }
  });

  scoped(/^it reports nothing under extension\/test$/, (ctx) => {
    assert.deepEqual(
      ctx.realTreeOffenders,
      [],
      `blind temp-dir sweep(s) found on the real tree: ${ctx.realTreeOffenders.join(', ')}`
    );
  });

  // ── Scenario 03: the real guard test, spawned via vitest ─────────────────
  scoped(/^the blind temp-dir sweep guard test runs$/, (ctx) => {
    ctx.guardRun = spawnSync(
      'npx',
      ['vitest', 'run', 'test/blindTmpDirSweepGuard.test.js'],
      { cwd: EXTENSION_DIR, encoding: 'utf8' }
    );
  });

  scoped(/^it reports every test passed$/, (ctx) => {
    assert.equal(
      ctx.guardRun.status,
      0,
      `expected blindTmpDirSweepGuard.test.js to pass, exit ${ctx.guardRun.status}:\n${ctx.guardRun.stdout}\n${ctx.guardRun.stderr}`
    );
  });

  scoped(
    /^its migrated census lists exactly eleven files including (.+)$/,
    (ctx, namedList) => {
      const output = `${ctx.guardRun.stdout}${ctx.guardRun.stderr}`;
      const match = output.match(/BL-1623 census: (\d+) migrated file\(s\)/);
      assert.ok(match, `expected a "BL-1623 census: N migrated file(s)" line in the guard's output, got:\n${output}`);
      assert.equal(Number(match[1]), 11, `expected the census to count 11 migrated files, counted ${match[1]}`);

      const guardSource = fs.readFileSync(path.join(EXTENSION_TEST_DIR, 'blindTmpDirSweepGuard.test.js'), 'utf8');
      const named = namedList.split(/,| and /).map((s) => s.trim()).filter(Boolean);
      for (const name of named) {
        assert.match(
          guardSource,
          new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `expected the guard's MIGRATED_FILES to name ${name}`
        );
      }
    }
  );
}

module.exports = { registerSteps };
