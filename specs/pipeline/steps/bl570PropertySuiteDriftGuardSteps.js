'use strict';

// BL-570: step handlers for "A shared pre-commit guard catches property-suite
// drift". Drives the REAL swarmforge/scripts/check_property_suite_drift.sh
// with an injectable suite command (green / red / unavailable) — never a
// *_FORCE_RESULT env bypass. Captured Example values are load-bearing
// (ticket notes / engineering.prompt): handlers assert on the parameter,
// not a hardcoded default.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'A shared pre-commit guard catches property-suite drift';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');
const { propertyGuardIsWired } = require(path.join(__dirname, 'lib', 'bl1409PropertyGuardWiring.js'));

const KNOWN_SUITE_STATES = new Set(['green', 'red', 'unavailable']);
const KNOWN_SUITE_ACTIONS = new Set(['runs', 'skips']);
const KNOWN_WARNINGS = new Set(['skipped', 'overridden']);
const KNOWN_STAGED_PATHS = new Set([
  'extension/src/pipelineBoard.ts',
  'extension/test/pipelineBoard.property.test.js',
  'docs/diagrams/architecture.md',
  'backlog/paused/BL-999-example.yaml',
]);

const SUITE_ARGV = {
  green: ['bash', '-c', 'exit 0'],
  red: ['bash', '-c', 'echo "FAIL extension/test/pipelineBoard.property.test.js" >&2; exit 1'],
  unavailable: ['bash', '-c', 'exit 127'],
};

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl570-acceptance-'));
  fixtureRoots.push(root);
  git(root, 'init', '-q');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return root;
}

function stagePath(ctx, relPath) {
  const full = path.join(ctx.root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'v1\n');
  git(ctx.root, 'add', relPath);
}

function registerSteps(registry) {
  registry.defineScoped(/^the shared pre-commit property guard is installed$/, (ctx) => {
    ctx.root = mkFixtureRepo();
    assert.ok(fs.existsSync(GUARD), `expected guard script at ${GUARD}`);
    // BL-1409: "installed" is two hops - the hook reaches run_commit_guards.sh
    // (BL-1252's delegation), and the runner's OWN guard set (BL-1398's
    // derivation, never a second parser of the runner's own guard-invocation
    // lines) names the guard - never a literal grep for
    // check_property_suite_drift.sh in one file.
    const result = propertyGuardIsWired({ repoRoot: REPO_ROOT });
    assert.ok(result.wired, `expected the property guard installed through the full delegation, got: ${JSON.stringify(result)}`);
  }, FEATURE);

  registry.defineScoped(/^the property suite is "([^"]+)"$/, (ctx, state) => {
    assert.ok(KNOWN_SUITE_STATES.has(state), `unknown property suite state: ${state}`);
    ctx.suiteState = state;
    ctx.suiteArgv = SUITE_ARGV[state];
  }, FEATURE);

  registry.defineScoped(/^the only staged change is "([^"]+)"$/, (ctx, stagedPath) => {
    assert.ok(KNOWN_STAGED_PATHS.has(stagedPath), `unknown staged_path example: ${stagedPath}`);
    // Drop any prior staged set so "only" is literal.
    git(ctx.root, 'reset', '-q', 'HEAD');
    for (const leftover of ['extension', 'docs', 'backlog']) {
      fs.rmSync(path.join(ctx.root, leftover), { recursive: true, force: true });
    }
    ctx.stagedPath = stagedPath;
    stagePath(ctx, stagedPath);
  }, FEATURE);

  registry.defineScoped(/^the property guard override is set$/, (ctx) => {
    ctx.override = true;
  }, FEATURE);

  registry.defineScoped(/^the property guard runs$/, (ctx) => {
    const env = { ...process.env };
    if (ctx.override) {
      env.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD = '1';
    } else {
      delete env.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD;
    }
    const result = spawnSync('bash', [GUARD, ...ctx.suiteArgv], {
      cwd: ctx.root,
      encoding: 'utf8',
      env,
    });
    ctx.out = `${result.stdout || ''}${result.stderr || ''}`;
    ctx.rc = result.status ?? 1;
  }, FEATURE);

  registry.defineScoped(/^the guard "(runs|skips)" the property suite$/, (ctx, action) => {
    assert.ok(KNOWN_SUITE_ACTIONS.has(action), `unknown suite_action: ${action}`);
    if (action === 'runs') {
      assert.match(ctx.out, /property-suite-guard: run\b/, `expected run marker, got:\n${ctx.out}`);
      assert.doesNotMatch(ctx.out, /property-suite-guard: skip-paths/, `runs must not skip-paths:\n${ctx.out}`);
    } else {
      assert.match(ctx.out, /property-suite-guard: skip-paths/, `expected skip-paths, got:\n${ctx.out}`);
      assert.doesNotMatch(ctx.out, /property-suite-guard: run\b/, `skips must not run:\n${ctx.out}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the commit is allowed$/, (ctx) => {
    assert.equal(ctx.rc, 0, `expected commit allowed (rc 0), got ${ctx.rc}:\n${ctx.out}`);
  }, FEATURE);

  registry.defineScoped(/^the commit is blocked$/, (ctx) => {
    assert.notEqual(ctx.rc, 0, `expected commit blocked (non-zero), got:\n${ctx.out}`);
  }, FEATURE);

  registry.defineScoped(/^the guard output names the failing property test file$/, (ctx) => {
    assert.match(
      ctx.out,
      /\.property\.test\.js\b/,
      `expected a *.property.test.js name in guard output:\n${ctx.out}`
    );
  }, FEATURE);

  registry.defineScoped(/^the guard output warns that the property check was "([^"]+)"$/, (ctx, warning) => {
    assert.ok(KNOWN_WARNINGS.has(warning), `unknown warning kind: ${warning}`);
    const re = new RegExp(warning, 'i');
    assert.match(ctx.out, re, `expected warning "${warning}" in:\n${ctx.out}`);
  }, FEATURE);
}

module.exports = { registerSteps };
