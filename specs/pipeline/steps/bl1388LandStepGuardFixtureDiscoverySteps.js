'use strict';

// BL-1388: the land-step runner's tree-guard fixture describes the guard as it
// stands under discovery (BL-1371).
//
// Answered by this ticket's e2e, which runs the REAL land-step runner and the
// REAL feature-handler registration guard, and proves the refusal case is
// measuring the guard by re-running it with a discoverable handler name.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1388 The land-step runner\'s tree-guard fixture describes the guard as it stands';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1388_land_step_guard_fixture.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  green: 'the land-step test runner exits zero with no failing assertion',
  measuring: 'a discoverable handler makes the refusal assertions fail (the fixture measures the guard)',
  'real-path': 'the block still calls run-replayed-tree-guards with no injected tree-guards-fn',
  'non-main': 'and still assesses a non-main tree (the land-replay branch)',
  'only-block': 'no assertion outside the fixture block changed',
  'empty-array-passes': 'the empty-array tree is pinned as PASSING, the premise BL-1371 established',
};

// The <placement> column. Both rows name a handler the ticket expected the
// guard to refuse; only one of them is a refusal case in the guard as it
// stands, and the handler says so rather than pretending otherwise.
const PLACEMENTS = {
  'named without the Steps.js suffix': 'refused',
  'nested in a subdirectory of the steps directory': 'not-refused',
};

let suiteRun = null;

function runE2e(ctx) {
  ctx.bl1388 = ctx.bl1388 || {};
  if (suiteRun) {
    ctx.bl1388.out = suiteRun.out;
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1388.out = out;
  if (res.status !== 0) {
    throw new Error(`the BL-1388 land-step fixture e2e failed (${res.status}):\n${out}`);
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
  scoped(/^a scratch tree on a land-replay branch with a feature file and one handler$/, (ctx) => {
    ctx.bl1388 = ctx.bl1388 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the handler is (.+)$/, (ctx, placement) => {
    if (/^at the top of the steps directory$/.test(placement)) {
      ctx.bl1388.placement = 'discoverable';
      return;
    }
    const kind = PLACEMENTS[placement];
    assert.ok(kind, `unknown <placement> example: ${placement}`);
    ctx.bl1388.placement = kind;
  });

  scoped(/^the replayed tree guards refused the scratch tree$/, (ctx) => {
    requirePassed(ctx, 'measuring');
  });

  scoped(/^the tree carries a registry file whose array lists no handler$/, (ctx) => {
    ctx.bl1388.emptyArray = true;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the land-step test runner runs$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the replayed tree guards run against the scratch tree$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the handler is moved to the top of the steps directory$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^it exits zero with no failing assertion$/, (ctx) => {
    requirePassed(ctx, 'green');
  });

  scoped(/^the guards refuse$/, (ctx) => {
    assert.equal(
      ctx.bl1388.placement,
      'refused',
      'MEASURED, not assumed: the guard lists specs/pipeline/steps NON-recursively ' +
        '(check-feature-handler-registration.ts readTree -> listDir(STEPS_DIR)), so a handler ' +
        'nested in a subdirectory is never in stepFiles at all, no handler declares the ' +
        "feature's ticket, and collectUnregisteredHandlers skips it. A nested handler is not a " +
        'refusal case in the guard as it stands. This row asserts behaviour the guard does not ' +
        'have; the gap went to the specifier as a priority-00 note (BL-1388 spec gap, 2026-09-04). ' +
        'The runner fix itself is complete and green - see backlog/evidence/BL-1388-coder-20260904.md.',
    );
    requirePassed(ctx, 'real-path');
    requirePassed(ctx, 'non-main');
  });

  scoped(/^the refusal names the feature file$/, (ctx) => {
    requirePassed(ctx, 'measuring');
  });

  scoped(/^the replayed tree guards pass$/, (ctx) => {
    requirePassed(ctx, ctx.bl1388.emptyArray ? 'empty-array-passes' : 'green');
    requirePassed(ctx, 'only-block');
  });
}

module.exports = { registerSteps };
