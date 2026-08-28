'use strict';

// BL-1202: step handlers for "the shared-repo canary reports on every exit
// path of a guarded run, including one that was killed". Drives the REAL
// check_property_suite_drift.sh via
// specs/pipeline/steps/lib/bl1202GuardExitPathCli.sh, which mirrors the
// standing shell test's own scenarios 14/15
// (test_property_suite_drift_guard.sh) exactly: a real fixture git repo, a
// fake suite command that mutates the shared checkout and then ends by
// passing, failing, or being killed mid-run via a real SIGTERM from
// outside.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'the shared-repo canary reports on every exit path of a guarded run, including one that was killed';

const CLI = path.join(__dirname, 'lib', 'bl1202GuardExitPathCli.sh');

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function mkFixtureRoot() {
  const root = fs.realpathSync(mkSocketFixtureRoot('bl1202-acceptance-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['-c', 'user.email=bl1202@example.com', '-c', 'user.name=bl1202', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

function cleanupFixtureRoot(ctx) {
  const st = ctx.bl1202;
  if (!st || !st.root) return;
  releaseSocketFixtureRoot(st.root);
  fs.rmSync(st.root, { recursive: true, force: true });
  ctx.bl1202 = null;
}

const ENDING_TO_MODE = {
  'being killed': 'killed',
  failing: 'failing',
  passing: 'passing',
};

function runGuard(root, mode) {
  const out = execFileSync('bash', [CLI, root, mode], { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the property-suite guard has taken its shared-repo canary baseline$/, (ctx) => {
    ctx.bl1202 = { root: mkFixtureRoot() };
  });

  // ── scenario 01 (Outline): every ending reports the canary ──────────────

  scoped(/^the guarded suite run ends by "?([a-z ]+?)"?$/, (ctx, ending) => {
    const st = ctx.bl1202;
    const mode = ENDING_TO_MODE[ending.trim()];
    assert.ok(mode, `unrecognized ending "${ending}" - not in this scenario's own Examples table`);
    st.mode = mode;
  });

  scoped(/^the shared repository was mutated during that run$/, () => {
    // The fake suite driven by the CLI always commits a mutation before
    // ending (passing/failing/killed alike) - this step is declarative,
    // matching the CLI's own fixed behavior rather than re-arranging it.
  });

  scoped(/^the guard finishes$/, (ctx) => {
    const st = ctx.bl1202;
    st.result = runGuard(st.root, st.mode);
  });

  scoped(/^the canary verdict is reported$/, (ctx) => {
    const st = ctx.bl1202;
    try {
      assert.equal(st.result.canaryReported, true, `expected the BL-1124 canary verdict to be reported for ending "${st.mode}", got: ${JSON.stringify(st.result)}`);
      assert.notEqual(st.result.exitCode, 0, `expected a mutated checkout to exit non-zero for ending "${st.mode}", got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 02: no suite process outlives a killed guard ───────────────

  scoped(/^the guarded suite run has been killed$/, (ctx) => {
    ctx.bl1202 = ctx.bl1202 || { root: mkFixtureRoot() };
    ctx.bl1202.mode = 'killed';
  });

  scoped(/^no process started by that suite run is still running$/, (ctx) => {
    const st = ctx.bl1202;
    try {
      assert.equal(st.result.childAlive, false, `expected no process (by process group) to outlive the killed guard, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });
}

module.exports = { registerSteps };
