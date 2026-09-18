'use strict';

// BL-1624: step handlers for "A standing shell test never asserts a diff
// against main" (specifier-authored feature, lands with this handler in
// the same parcel - BL-233, BL-1371).
//
// Scenario 01 reads the real, fixed shell test's source directly - no
// git diff main/origin-main assertion, the other step headers intact.
// Scenario 02 copies the real shell test and runner into a fresh fixture
// root with no extension/out and drives it for real, proving the loud
// precondition. Scenario 03 drives the real census script
// (test_standing_shell_tests_never_diff_main.sh) against the real tree.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { onAbnormalExit } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1624 A standing shell test never asserts a diff against main';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const SHELL_TEST = path.join(TEST_DIR, 'test_bl1388_land_step_guard_fixture.sh');
const CENSUS_SCRIPT = path.join(TEST_DIR, 'test_standing_shell_tests_never_diff_main.sh');
const RUNNER = path.join(TEST_DIR, 'land_step_lib_test_runner.bb');

// BL-1624 hardening: scenario 02's mkdtemp fixture root (ctx.bl1624Root)
// had no cleanup at all - not a partial leak on the failure path, a
// permanent one on every run. Confirmed: 4 already leaked under
// /tmp/bl1624-no-build-* from the coder/cleaner/architect's own prior
// verification runs before this fix. Same class already fixed twice this
// pass in bl1632/bl1626's own handlers - tracked via fixtureReaper's
// onAbnormalExit the moment the directory exists, with an inline cleanup
// on the happy path so it does not wait for process exit.
const trackedDirs = new Set();
function trackDir(dir) {
  trackedDirs.add(dir);
  return () => {
    if (trackedDirs.delete(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
onAbnormalExit(() => {
  for (const dir of Array.from(trackedDirs)) {
    trackedDirs.delete(dir);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
});
const FIXTURE_ISOLATION = path.join(TEST_DIR, 'lib', 'fixture_isolation.sh');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────

  scoped(/^the source of swarmforge\/scripts\/test\/test_bl1388_land_step_guard_fixture\.sh is read$/, (ctx) => {
    ctx.source = fs.readFileSync(SHELL_TEST, 'utf8');
  });

  scoped(/^it runs no git diff against main or origin\/main$/, (ctx) => {
    const nonComment = ctx.source
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    assert.ok(
      !/git diff\s+(main|origin\/main)/.test(nonComment),
      `expected no "git diff main/origin-main" assertion, source still has one:\n${ctx.source}`
    );
  });

  scoped(
    /^it still carries the step headers for the runner, the discoverable handler, the real guard path and the retired premise$/,
    (ctx) => {
      const expectedHeaders = [
        '1. the runner is green',
        '2. the refusal case measures the guard, not the fixture',
        '3. the real guard path, not an injected tree-guards-fn',
        '5. the retired premise is gone from the block',
      ];
      for (const header of expectedHeaders) {
        assert.ok(ctx.source.includes(header), `expected step header "${header}" still present`);
      }
      assert.ok(!ctx.source.includes('4. only the fixture block changed'), 'expected step 4 removed');
    }
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────

  scoped(/^a copy of the repository's shell test and runner in a fixture root with no extension\/out$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1624-no-build-'));
    const testDir = path.join(root, 'swarmforge', 'scripts', 'test');
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, 'lib'), { recursive: true });
    fs.copyFileSync(SHELL_TEST, path.join(testDir, path.basename(SHELL_TEST)));
    fs.chmodSync(path.join(testDir, path.basename(SHELL_TEST)), 0o755);
    fs.copyFileSync(RUNNER, path.join(testDir, path.basename(RUNNER)));
    fs.copyFileSync(FIXTURE_ISOLATION, path.join(testDir, 'lib', 'fixture_isolation.sh'));
    // extension/out deliberately absent - the fixture root's whole point.
    ctx.bl1624Root = root;
    ctx.cleanupBl1624Root = trackDir(root);
  });

  scoped(/^the shell test runs there$/, (ctx) => {
    const testDir = path.join(ctx.bl1624Root, 'swarmforge', 'scripts', 'test');
    const r = spawnSync('bash', [path.join(testDir, path.basename(SHELL_TEST))], {
      cwd: ctx.bl1624Root,
      encoding: 'utf8',
      timeout: 30000,
    });
    ctx.bl1624Result = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  });

  scoped(/^it exits 1 with one line naming extension\/out and npm run compile$/, (ctx) => {
    assert.equal(ctx.bl1624Result.status, 1, `expected exit 1, got: ${JSON.stringify(ctx.bl1624Result)}`);
    const combined = ctx.bl1624Result.stdout + ctx.bl1624Result.stderr;
    assert.ok(
      /extension\/out/.test(combined) && /npm run compile/.test(combined),
      `expected a line naming extension/out and npm run compile, got:\n${combined}`
    );
  });

  scoped(/^no runner assertion line is printed$/, (ctx) => {
    try {
      const combined = ctx.bl1624Result.stdout + ctx.bl1624Result.stderr;
      assert.ok(
        !/PASS: the land-step test runner|FAIL: the runner is still red/.test(combined),
        `expected no runner assertion line, got:\n${combined}`
      );
    } finally {
      ctx.cleanupBl1624Root();
    }
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────

  scoped(/^the census guard reads every standing row of the shell suite manifest$/, (ctx) => {
    const r = spawnSync('bash', [CENSUS_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000 });
    ctx.bl1624Census = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  });

  scoped(/^it names no offending test$/, (ctx) => {
    assert.equal(ctx.bl1624Census.status, 0, `expected exit 0, got:\n${ctx.bl1624Census.stdout}${ctx.bl1624Census.stderr}`);
    assert.ok(ctx.bl1624Census.stdout.includes('ALL PASS'), `expected ALL PASS, got: ${ctx.bl1624Census.stdout}`);
  });

  scoped(/^it reports the number of standing rows it read, and that number is at least 500$/, (ctx) => {
    const match = ctx.bl1624Census.stdout.match(/population:\s*(\d+)/);
    assert.ok(match, `expected a population count, got: ${ctx.bl1624Census.stdout}`);
    const population = Number(match[1]);
    assert.ok(population >= 500, `expected at least 500 standing rows, got ${population}`);
  });
}

module.exports = { registerSteps };
