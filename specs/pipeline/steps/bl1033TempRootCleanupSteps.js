'use strict';

// BL-1033: step handlers for "a property runner's temp root is removed even
// when the run throws".
//
// Every scenario runs the REAL bl1025_expedite_approval_property_runner.bb as
// a subprocess and reads the filesystem afterwards - the leak is a real
// directory or it is not, and nothing here simulates one.
//
// The abnormal exits are produced by a `git` shim on PATH that fails a chosen
// invocation, which makes the runner's OWN `g` helper throw ex-info exactly as
// a real git failure would. The alternative - editing the runner to throw -
// would be testing an edited runner rather than the shipped one.
//
// Leak detection lists the temp directory and filters by name. NOT fs/glob or
// a glob library: a glob does not match DIRECTORIES, so a glob-based detector
// reports zero leaks however many there are, and every assertion here would
// pass vacuously. That was caught during authoring by removing the fix and
// watching the check stay green.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const FEATURE = "a property runner's temp root is removed even when the run throws";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const RUNNER = path.join(SCRIPTS, 'test', 'bl1025_expedite_approval_property_runner.bb');
const PREFIX = 'bl1025-prop-';

const {
  scanForTempDirTrapViolations,
} = require(path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'tempDirTrapGuard'));

// Explicit known values per the Scenario Outline handler rule: an ending the
// handlers do not know is a hard failure, never a passthrough.
const KNOWN_ENDINGS = new Set(['throws from its git helper', 'fails its exhaustive-sweep guard']);

// Bisected against the runner with the fix removed: failing git calls 1-17
// leaks the root, 18 onward does not. The boundary is the end of fixture
// setup - past it, a git failure is recorded rather than thrown, so the run
// reaches its own delete-tree either way.
const LAST_THROWING_GIT_CALL = 17;

let trackedPaths = [];
afterEach(() => {
  while (trackedPaths.length) {
    fs.rmSync(trackedPaths.pop(), { recursive: true, force: true });
  }
});

// java.io.tmpdir is where fs/create-temp-dir actually writes; os.tmpdir() can
// differ, and reading the wrong directory would report "no leak" forever.
function tmpBase() {
  const res = spawnSync('bb', ['-e', '(println (System/getProperty "java.io.tmpdir"))'], { encoding: 'utf8' });
  return (res.stdout || '').trim() || os.tmpdir();
}

function rootsIn(base) {
  return new Set(fs.readdirSync(base).filter((n) => n.startsWith(PREFIX)));
}

function mkScratch(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedPaths.push(dir);
  return dir;
}

// Passes through to the real git except on the Nth call, where it fails - the
// runner's `g` helper then throws, which is the live throw path.
function gitShim(failAt) {
  const dir = mkScratch('sfvc-bl1033-shim-');
  const counter = path.join(dir, 'calls');
  const realGit = (spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout || '').trim();
  fs.writeFileSync(path.join(dir, 'git'),
    '#!/usr/bin/env bash\n' +
    `n=$(( $(cat "${counter}" 2>/dev/null || echo 0) + 1 ))\n` +
    `printf '%s' "$n" > "${counter}"\n` +
    `if [ "$n" = "${failAt}" ]; then echo 'bl1033: forced git failure' >&2; exit 1; fi\n` +
    `exec ${realGit} "$@"\n`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  return dir;
}

// A copy whose 32-case sweep can never be satisfied, so the sweep guard fails
// the run. It lives OUTSIDE the repo, in the layout the runner's own relative
// load-file resolution needs, so no scratch .bb is left inside
// swarmforge/scripts for a tree-wide guard to scan.
function brokenSweepCopy() {
  const root = mkScratch('sfvc-bl1033-copy-');
  const scripts = path.join(root, 'scripts');
  const testDir = path.join(scripts, 'test');
  fs.mkdirSync(testDir, { recursive: true });
  for (const dep of ['expedite_lib.bb', 'is_qa_ancestor.sh']) {
    fs.copyFileSync(path.join(SCRIPTS, dep), path.join(scripts, dep));
  }
  const patched = fs.readFileSync(RUNNER, 'utf8').replace('(not= 32 @swept)', '(not= 999 @swept)');
  assert.ok(patched.includes('(not= 999 @swept)'),
    'the sweep-guard break did not apply - the scenario would pass vacuously');
  const target = path.join(testDir, 'runner.bb');
  fs.writeFileSync(target, patched);
  return target;
}

function runRunner(ctx, { target = RUNNER, shimDir } = {}) {
  ctx.base = ctx.base || tmpBase();
  const before = rootsIn(ctx.base);
  const env = { ...process.env };
  if (shimDir) env.PATH = `${shimDir}:${env.PATH}`;
  const res = spawnSync('bb', [target], { encoding: 'utf8', env });
  const after = rootsIn(ctx.base);
  ctx.exit = res.status;
  ctx.output = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.leaked = [...after].filter((n) => !before.has(n));
  // Never accumulate: whatever this run created is this run's to remove.
  for (const name of ctx.leaked) {
    fs.rmSync(path.join(ctx.base, name), { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the BL-1025 expedite-approval property runner$/, (ctx) => {
    assert.ok(fs.existsSync(RUNNER), `the runner under test is missing: ${RUNNER}`);
    ctx.base = tmpBase();
  });

  scoped(/^a run in which every property passes$/, (ctx) => {
    ctx.mode = 'normal';
  });

  scoped(/^a run that (.+)$/, (ctx, ends) => {
    assert.ok(KNOWN_ENDINGS.has(ends),
      `unknown ending "${ends}" - the handlers know ${[...KNOWN_ENDINGS].join(', ')}`);
    ctx.mode = ends;
  });

  scoped(/^a run in which a property is violated$/, (ctx) => {
    // The sweep guard IS one of the runner's own property assertions; breaking
    // it is a violated property, and the run must still fail because of it.
    ctx.mode = 'fails its exhaustive-sweep guard';
  });

  scoped(/^the temp-dir-trap guard scanning swarmforge\/scripts$/, (ctx) => {
    ctx.guardTarget = SCRIPTS;
  });

  const execute = (ctx) => {
    if (ctx.mode === 'normal') {
      runRunner(ctx);
      return;
    }
    if (ctx.mode === 'throws from its git helper') {
      // MEASURED, not guessed. Only git calls 1-17 - the fixture setup - throw
      // out of the run; from call 18 the failure is recorded as a property
      // failure and the run walks to its own delete-tree. So a shim failing
      // call 20 leaves nothing to reclaim and this scenario passes whether the
      // fix is present or not. Call 17 is the DEEPEST throw that genuinely
      // exits early, so it is the strongest case this scenario can make.
      runRunner(ctx, { shimDir: gitShim(LAST_THROWING_GIT_CALL) });
      return;
    }
    runRunner(ctx, { target: brokenSweepCopy() });
  };

  scoped(/^the runner finishes$/, execute);
  scoped(/^the runner exits$/, execute);

  scoped(/^the guard runs$/, (ctx) => {
    ctx.violations = scanForTempDirTrapViolations(ctx.guardTarget);
  });

  scoped(/^no fixture directory from that run remains$/, (ctx) => {
    assert.deepEqual(ctx.leaked, [],
      `the run left ${ctx.leaked.length} fixture director(y|ies) behind: ${ctx.leaked.join(', ')}`);
  });

  scoped(/^it reports the failure and exits non-zero$/, (ctx) => {
    assert.notEqual(ctx.exit, 0,
      `a violated property must still fail the run; output: ${ctx.output}`);
    assert.match(ctx.output, /exhaustive/,
      `the failure must say what broke; output: ${ctx.output}`);
  });

  scoped(/^the guard reports no violations$/, (ctx) => {
    assert.deepEqual(ctx.violations, [],
      `${ctx.violations.length} temp-dir-trap violation(s): ${ctx.violations.map((v) => v.file).join(', ')}`);
  });
}

module.exports = { registerSteps };
