'use strict';

// BL-1540: step handlers for "two shell tests dispatch a self-rooting helper
// through the real scripts dir". Drives the REAL guard
// (test_shell_fixture_dispatch_isolation.sh) and the two repaired tests
// themselves - no reimplementation of the guard's derivation here, so this
// file cannot drift from what the guard actually enforces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_REL = 'swarmforge/scripts/test/test_shell_fixture_dispatch_isolation.sh';
const GUARD_PASS_LINE = 'PASS: no shell test dispatches a self-rooting helper from the real scripts dir';

const FEATURE = 'BL-1540 Two shell tests dispatch a self-rooting helper through the real scripts dir';

// Scenario Outline values are validated against an explicit table and throw
// on anything else - never a passthrough. Each repaired test's fixture-bound
// variable is recorded here once, so the "lies under its fixture root" check
// (scenario 01) reads the SAME binding the test itself uses rather than
// re-deriving a guess at its name.
const KNOWN_TESTS = {
  'swarmforge/scripts/test/test_ceremony_handoff_cli.sh': {
    variable: 'CEREMONY',
    helper: 'ceremony_handoff.sh',
  },
  'swarmforge/scripts/test/test_bl1097_router_refuses_dispatched_ticket.sh': {
    variable: 'ROUTE_SH',
    helper: 'route_backlog_to_coder.sh',
  },
};

function requireKnownTest(rel) {
  if (!(rel in KNOWN_TESTS)) {
    throw new Error(`unknown <test>: "${rel}" - known: ${Object.keys(KNOWN_TESTS).join(' | ')}`);
  }
  return KNOWN_TESTS[rel];
}

function runShellFile(rel) {
  const abs = path.join(REPO_ROOT, rel);
  assert.ok(fs.existsSync(abs), `not found on disk: ${abs}`);
  return spawnSync('bash', [abs], { encoding: 'utf8', cwd: REPO_ROOT });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^the guard "([^"]+)" which names shell tests executing a self-rooting helper through the real scripts dir$/, (ctx, guardRel) => {
    assert.equal(guardRel, GUARD_REL, `feature text names a different guard path than this handler knows: "${guardRel}"`);
    ctx.guardPath = path.join(REPO_ROOT, guardRel);
    assert.ok(fs.existsSync(ctx.guardPath), `guard not found on disk: ${ctx.guardPath}`);
  });

  // ── Scenario Outline 01: each repaired test's own fixture-bound path ─────
  scoped(/^the guard's offence derivation is run over "([^"]+)"$/, (ctx, testRel) => {
    requireKnownTest(testRel);
    ctx.testRel = testRel;
    ctx.testPath = path.join(REPO_ROOT, testRel);
    assert.ok(fs.existsSync(ctx.testPath), `test not found on disk: ${ctx.testPath}`);
    // The guard scans the whole real test dir in one pass rather than taking
    // a single-file argument - running it here is the same derivation the
    // "guard is green" scenario checks, read for the one offender this
    // scenario is about.
    ctx.guardResult = spawnSync('bash', [ctx.guardPath], { encoding: 'utf8', cwd: REPO_ROOT });
  });

  scoped(/^it names no offence in "([^"]+)"$/, (ctx, testRel) => {
    assert.equal(testRel, ctx.testRel, `expected the offence check to follow the same test the derivation ran over ("${ctx.testRel}"), got "${testRel}"`);
    const out = `${ctx.guardResult.stdout}${ctx.guardResult.stderr}`;
    const offenderName = path.basename(testRel);
    assert.ok(
      !out.includes(`${offenderName}:$`),
      `expected no offence naming ${offenderName}, got:\n${out}`
    );
  });

  scoped(/^the path through which "([^"]+)" executes "([^"]+)" lies under its fixture root$/, (ctx, testRel, helper) => {
    const known = requireKnownTest(testRel);
    assert.equal(
      helper,
      known.helper,
      `feature table names helper "${helper}" for "${testRel}" but this handler knows "${known.helper}"`
    );
    const source = fs.readFileSync(ctx.testPath, 'utf8');

    const assignMatch = source.match(new RegExp(`^${known.variable}="([^"]+)"`, 'm'));
    assert.ok(assignMatch, `expected an assignment for ${known.variable} in ${testRel}`);
    const rhs = assignMatch[1];

    // The guard's own offence pattern (Article 2.2's "no passthrough" rule
    // applies to this check too: it must fail the SAME way the guard would,
    // not merely differently from the pre-fix text).
    assert.ok(
      !/\$\{?SCRIPT_DIR\}?\/\.\.\//.test(rhs),
      `${known.variable} is still bound through the real scripts dir: ${rhs}`
    );
    assert.ok(
      rhs.endsWith(`/${helper}`),
      `${known.variable} does not resolve to ${helper}: ${rhs}`
    );

    // The binding must be anchored at a variable that is itself a throwaway
    // fixture root (mktemp -d), not merely "not $SCRIPT_DIR/.." by accident.
    const rootVarMatch = rhs.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?\//);
    assert.ok(rootVarMatch, `${known.variable}'s value is not anchored at a variable: ${rhs}`);
    const rootVar = rootVarMatch[1];
    const mktempBinding = new RegExp(`^${rootVar}="\\$\\(cd "\\$\\(mktemp -d\\)" && pwd`, 'm');
    assert.ok(
      mktempBinding.test(source),
      `expected ${rootVar} to be bound from a throwaway mktemp -d root in ${testRel}`
    );
  });

  // ── Scenario 02: the guard itself is green ────────────────────────────────
  // ── Scenario Outline 03: each repaired test is itself still green ────────
  // Same step text runs both the guard and each repaired test - what "green"
  // means differs per the Then clause below, never conflated (IR-DRY note).
  scoped(/^the standing suite runs "([^"]+)"$/, (ctx, rel) => {
    ctx.suiteRel = rel;
    ctx.suiteResult = runShellFile(rel);
  });

  scoped(/^the run exits zero and reports no offending shell test$/, (ctx) => {
    assert.equal(ctx.suiteRel, GUARD_REL, `expected this Then to follow a run of the guard ("${GUARD_REL}"), got "${ctx.suiteRel}"`);
    const out = `${ctx.suiteResult.stdout}${ctx.suiteResult.stderr}`;
    assert.equal(ctx.suiteResult.status, 0, `expected the guard to exit zero, got:\n${out}`);
    assert.ok(out.includes(GUARD_PASS_LINE), `expected the guard's own PASS line, got:\n${out}`);
  });

  scoped(/^the run exits zero and reports no failed check$/, (ctx) => {
    requireKnownTest(ctx.suiteRel);
    const out = `${ctx.suiteResult.stdout}${ctx.suiteResult.stderr}`;
    assert.equal(ctx.suiteResult.status, 0, `expected ${ctx.suiteRel} to exit zero, got:\n${out}`);
    assert.ok(!/^FAIL/m.test(out), `expected no failed check in ${ctx.suiteRel}, got:\n${out}`);
    assert.ok(/^ALL (CHECKS )?PASS(ED)?$/m.test(out), `expected an ALL-PASS summary line from ${ctx.suiteRel}, got:\n${out}`);
  });
}

module.exports = { registerSteps };
