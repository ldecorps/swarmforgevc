'use strict';

// BL-1154: build-stale restarts must not burn the crash give-up budget.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'Healthy build-stale restarts do not burn the front-desk crash give-up budget';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const LIB_TEST = path.join(SCRIPTS, 'front_desk_supervisor_lib_test_runner.bb');
const ACCEPTANCE_TEST = path.join(SCRIPTS, 'test_bl1154_build_stale_not_crash_giveup_budget.sh');
const PROPERTY_RUNNER = path.join(SCRIPTS, 'bl1154_build_stale_giveup_budget_property_runner.bb');

function runScript(script, ctx, key) {
  if (ctx[key]) {
    return ctx[key];
  }
  const result = spawnSync('bash', [script], { encoding: 'utf8', timeout: 120000, cwd: REPO_ROOT });
  ctx[key] = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${ctx[key]}`);
  }
  return ctx[key];
}

function runBb(script, ctx, key) {
  if (ctx[key]) {
    return ctx[key];
  }
  const result = spawnSync('bb', [script], { encoding: 'utf8', timeout: 60000, cwd: REPO_ROOT });
  ctx[key] = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${ctx[key]}`);
  }
  return ctx[key];
}

function assertPassMarker(out, marker, label) {
  if (!out.includes(marker)) {
    throw new Error(`expected ${label} (${marker}) in:\n${out}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front-desk supervisor detects a healthy child as build-stale$/, () => {});

  scoped(/^it restarts that child onto a fresh Node build$/, (ctx) => {
    assertPassMarker(runBb(LIB_TEST, ctx, 'bl1154LibTest'), 'ALL PASS', 'lib runner');
  });

  scoped(
    /^the crash \/ give-up attempt counter is not incremented the same way as a crash restart$/,
    (ctx) => {
      assertPassMarker(runScript(ACCEPTANCE_TEST, ctx, 'bl1154Acceptance'), 'bl-1154-01', 'bl-1154-01');
      assertPassMarker(runBb(PROPERTY_RUNNER, ctx, 'bl1154Property'), 'ALL TESTS PASSED', 'property runner');
    }
  );

  scoped(/^the bridge repeatedly exits unsuccessfully within the attempt budget$/, () => {});

  scoped(/^the attempt budget is exhausted$/, (ctx) => {
    assertPassMarker(
      runBb(PROPERTY_RUNNER, ctx, 'bl1154PropertyCrash'),
      'P2: crash loop reaches gave-up at cap',
      'crash give-up property'
    );
  });

  scoped(/^the supervisor still enters give-up and may escalate once per episode \(BL-1151\)$/, (ctx) => {
    assertPassMarker(runScript(ACCEPTANCE_TEST, ctx, 'bl1154Acceptance'), 'ALL CHECKS PASSED', 'acceptance');
  });
}

module.exports = { registerSteps };
