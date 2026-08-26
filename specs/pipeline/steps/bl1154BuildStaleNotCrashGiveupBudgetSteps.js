'use strict';

// BL-1154: build-stale restarts must not burn the crash give-up budget.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'Healthy build-stale restarts do not burn the front-desk crash give-up budget';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'front_desk_supervisor_lib_test_runner.bb');
const ACCEPTANCE_TEST = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_bl1154_build_stale_not_crash_giveup_budget.sh'
);
const PROPERTY_RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl1154_build_stale_giveup_budget_property_runner.bb'
);

function runOnce(script, ctx, key, shell) {
  if (ctx[key]) {
    return ctx[key];
  }
  const result = shell
    ? spawnSync('bash', [script], { encoding: 'utf8', timeout: 120000, cwd: REPO_ROOT })
    : spawnSync('bb', [script], { encoding: 'utf8', timeout: 60000, cwd: REPO_ROOT });
  ctx[key] = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${ctx[key]}`);
  }
  return ctx[key];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front-desk supervisor detects a healthy child as build-stale$/, () => {});

  scoped(/^it restarts that child onto a fresh Node build$/, (ctx) => {
    const out = runOnce(LIB_TEST, ctx, 'bl1154LibTest', false);
    if (!out.includes('ALL PASS')) {
      throw new Error(`expected lib runner pass, got:\n${out}`);
    }
  });

  scoped(
    /^the crash \/ give-up attempt counter is not incremented the same way as a crash restart$/,
    (ctx) => {
      const out = runOnce(ACCEPTANCE_TEST, ctx, 'bl1154Acceptance', true);
      if (!out.includes('bl-1154-01')) {
        throw new Error(`expected bl-1154-01 marker in:\n${out}`);
      }
      const prop = runOnce(PROPERTY_RUNNER, ctx, 'bl1154Property', false);
      if (!prop.includes('ALL TESTS PASSED')) {
        throw new Error(`property runner failed:\n${prop}`);
      }
    }
  );

  scoped(/^the bridge repeatedly exits unsuccessfully within the attempt budget$/, () => {});

  scoped(/^the attempt budget is exhausted$/, (ctx) => {
    const out = runOnce(PROPERTY_RUNNER, ctx, 'bl1154PropertyCrash', false);
    if (!out.includes('P2: crash loop reaches gave-up at cap')) {
      throw new Error(`expected crash give-up property in:\n${out}`);
    }
  });

  scoped(/^the supervisor still enters give-up and may escalate once per episode \(BL-1151\)$/, (ctx) => {
    const out = runOnce(ACCEPTANCE_TEST, ctx, 'bl1154Acceptance', true);
    if (!out.includes('ALL CHECKS PASSED')) {
      throw new Error(`acceptance test failed:\n${out}`);
    }
  });
}

module.exports = { registerSteps };
