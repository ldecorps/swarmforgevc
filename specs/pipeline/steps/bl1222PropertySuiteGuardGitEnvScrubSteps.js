'use strict';

// BL-1222: step handlers for "the property-suite guard launches the suite
// without the hook's git environment". Drives the REAL
// check_property_suite_drift.sh end to end (never a reimplementation) via
// specs/pipeline/steps/lib/bl1222PropertySuiteGuardGitEnvScrubCli.sh, which
// mirrors this project's other CLI-driver step handlers (bl1192, bl1230):
// a real git fixture, the real guard script, no environment reimplemented
// in JS.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'the property-suite guard launches the suite without the hook\'s git environment';

const CLI = path.join(__dirname, 'lib', 'bl1222PropertySuiteGuardGitEnvScrubCli.sh');

function runCli(mode) {
  const out = execFileSync('bash', [CLI, mode], { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out.trim().split('\n').pop());
}

const CONDITION_TO_MODE = {
  'override variable set': 'short-circuit-override',
  'no triggering path staged': 'short-circuit-no-trigger',
  'suite toolchain missing': 'short-circuit-toolchain-missing',
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the guard is invoked with a git hook environment naming a live worktree$/, (ctx) => {
    ctx.bl1222 = {};
  });

  scoped(/^the guard launches the suite$/, (ctx) => {
    ctx.bl1222.result = runCli('env-scrubbed');
  });

  scoped(
    /^the guard launches a suite that shells out to a nested script which creates a repository and commits in it$/,
    (ctx) => {
      ctx.bl1222.result = runCli('nested-shell-isolated');
    }
  );

  scoped(/^the guard runs under condition "([^"]+)"$/, (ctx, condition) => {
    const mode = CONDITION_TO_MODE[condition];
    assert.ok(mode, `unknown condition: ${condition}`);
    ctx.bl1222.result = runCli(mode);
  });

  scoped(/^the suite process has no GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE set$/, (ctx) => {
    const { result } = ctx.bl1222;
    assert.equal(result.exitCode, 0, `expected the guard to exit 0, got ${result.exitCode}`);
    assert.equal(result.launched, true, 'expected the injected suite to actually run');
    assert.equal((result.envLeak || '').trim(), '', `expected no GIT_* leak, got: ${result.envLeak}`);
  });

  scoped(/^the triggering worktree's branch still points at the commit it pointed at before$/, (ctx) => {
    const { result } = ctx.bl1222;
    assert.equal(result.exitCode, 0, `expected the guard to exit 0, got ${result.exitCode}`);
    assert.equal(result.launched, true, 'expected the nested shell fixture to actually run');
    assert.equal(result.branchUnchanged, true, 'expected the invoking worktree\'s HEAD to be unchanged');
  });

  scoped(/^it exits zero without launching the suite$/, (ctx) => {
    const { result } = ctx.bl1222;
    assert.equal(result.exitCode, 0, `expected exit 0, got ${result.exitCode}`);
    assert.equal(result.launched, false, 'expected the suite to never launch under this short-circuit');
  });
}

module.exports = { registerSteps };
