'use strict';

// BL-1399: the freshness watchdog's property fixture supplies its own
// required-daemon registry through the seam the guard already reads.
//
// Every scenario is answered by this ticket's e2e, which drives the REAL
// checker and the REAL registry guard against fixture roots it builds itself,
// and finishes by running the REAL property test. Nothing greps a label: the
// defect closed here is a fixture that disagreed with a production file, and
// a scenario that only read text could not tell the difference.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1399 The freshness property fixture supplies its own required registry';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1399_freshness_fixture_own_registry.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  green: "the checker exits zero against the fixture's own registry",
  'own-registry': "the guard read the fixture's registry, not the live one",
  bites: 'a fixture registry naming a daemon the conf lacks is refused, naming babysitterd',
  'live-still-refuses': 'with the live required list the guard still refuses (BL-784 untouched)',
  unmodified: 'the live conf, registry, guard and checker are unmodified',
  'suite-green': 'bl1012FreshnessSelfInflictedIncidents is green',
  'rows-derived': 'dropping a derived supervisor row makes the guard refuse, naming that supervisor',
  'rows-match-glob': "the fixture's supervisor rows equal the live glob's basenames at test time",
};

// Module scope, not per-ctx: each scenario gets its own ctx, so a per-ctx memo
// would re-run the whole suite once per scenario (BL-1390).
let suiteRun = null;

function runE2e(ctx) {
  ctx.bl1399 = ctx.bl1399 || {};
  if (suiteRun) {
    ctx.bl1399.out = suiteRun.out;
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1399.out = out;
  if (res.status !== 0) {
    throw new Error(`the BL-1399 freshness-registry e2e failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePassed(ctx, claimKey) {
  const claim = CLAIMS[claimKey];
  assert.ok(claim, `unknown claim: ${claimKey}`);
  const out = runE2e(ctx);
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(
    /^a freshness fixture root whose conf pins handoffd and carries a derived row per supervisor the guard walks$/,
    (ctx) => {
      ctx.bl1399 = ctx.bl1399 || {};
    },
  );

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the fixture supplies a required registry naming only handoffd$/, (ctx) => {
    ctx.bl1399.case = 'green';
  });

  scoped(/^the fixture supplies a required registry naming handoffd and babysitterd$/, (ctx) => {
    ctx.bl1399.case = 'bites';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the freshness checker runs against the fixture$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the bl1012 property test runs$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the checker exits zero$/, (ctx) => {
    requirePassed(ctx, 'green');
  });

  scoped(/^the guard read the fixture's registry, not the live one$/, (ctx) => {
    requirePassed(ctx, 'own-registry');
  });

  scoped(/^the checker exits non-zero$/, (ctx) => {
    requirePassed(ctx, 'bites');
  });

  scoped(/^its output names babysitterd as having no row$/, (ctx) => {
    requirePassed(ctx, 'bites');
    // The guard is untouched: the same refusal still comes from the live list.
    requirePassed(ctx, 'live-still-refuses');
  });

  scoped(/^every property holds$/, (ctx) => {
    requirePassed(ctx, 'suite-green');
    requirePassed(ctx, 'unmodified');
    // The amendment's 2b: the supervisor rows are really derived, and the
    // guard's second arm really bites when one is missing.
    requirePassed(ctx, 'rows-derived');
    requirePassed(ctx, 'rows-match-glob');
  });
}

module.exports = { registerSteps };
