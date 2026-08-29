'use strict';

// BL-1256: step handlers for "the reconcile kill switch's stay-loud gate
// observes the daemon, not the library". Scenarios 01 and 02 drive the
// REAL test_handoffd_master_main_reconcile_wiring.sh fixture (real git,
// real bare remote, real handoffd process, --reconcile-sweep-once for a
// deterministic single tick) via bl1256ReconcileWiringFixture.js's shared
// runner - memoized once per ctx, never a parallel reimplementation of the
// fixture's git plumbing. The Given/When steps below only mark state; the
// actual (slow, real-git) work happens lazily on the first Then that needs
// it, same lazy-memoized posture as BL-1248 scenario 02/03's own steps.
//
// Scenario 03 is a pure static check with no real git involved: it inspects
// the SOURCE of this repo's off-path step handlers for the exact blind-gate
// shape this ticket exists to remove (see HAND_PASSED_DISABLED_SWEEP_
// INVOCATION below).
const path = require('node:path');
const fs = require('node:fs');
const { requireWiringPass } = require('./lib/bl1256ReconcileWiringFixture');

const FEATURE =
  "BL-1256 the reconcile kill switch's stay-loud gate observes the daemon, not the library";

const SCENARIO_01_PASS =
  'with the switch off, a real daemon tick (--reconcile-sweep-once) still surfaces the divergence it declined to reconcile (BL-1256 scenario 01)';
const SCENARIO_02_PASS =
  'with the switch off, a block that persists past the escalation threshold still escalates to the operator (BL-1256 scenario 02)';

// The off-path step handlers this ticket's own invariant covers: every file
// that owns a Given/Then for a "switch off" scenario in the reconcile kill
// switch's acceptance surface. BL-1248's own file is included because it
// USED to contain exactly the blind shape this scenario refuses (scenario
// 05's now-removed runDivergenceStillSurfaced) - this is the anti-
// regression check for that removal, not merely a check on new code.
const OFF_PATH_HANDLER_FILES = [
  path.join(__dirname, 'bl1248MasterMainReconcileKillSwitchSteps.js'),
  path.join(__dirname, 'bl1256KillSwitchGateDrivesTheDaemonSteps.js'),
];

// BL-1256 scenario 03: assert on the INVOCATION SHAPE - a `bb -e` script
// passing a literal `true`/`false` as sweep!'s 3rd (enabled?) argument -
// never on the bare symbol name. "sweep!" and "disabled" both appear
// constantly in this repo's own prose and comments (including this file's
// own header above) and would trip a naive grep; scenario 01's legitimate
// `runSweepDecision` passes a DYNAMIC `enabled?` derived from
// parse-enabled?, never a hand-passed literal, so it must not match.
const HAND_PASSED_DISABLED_SWEEP_INVOCATION =
  /reconcile-lib\/sweep!\s+\([^)]*\)\s+\d+\s+(true|false)\s+adapters/;

function inspectOffPathHandlers() {
  const violations = [];
  for (const filePath of OFF_PATH_HANDLER_FILES) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (HAND_PASSED_DISABLED_SWEEP_INVOCATION.test(source)) {
      violations.push(filePath);
    }
  }
  return violations;
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a fixture repo with a real bare origin, whose local main and origin have diverged with local changes blocking a merge$/,
    (ctx) => {
      ctx.bl1256 = ctx.bl1256 || {};
    },
    FEATURE
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the shipped config sets "master_main_reconcile_enabled" to "false"$/,
    (ctx) => {
      ctx.bl1256 = ctx.bl1256 || {};
    },
    FEATURE
  );

  registry.defineScoped(
    /^the handoff daemon runs one real reconcile tick against the fixture$/,
    () => {},
    FEATURE
  );

  registry.defineScoped(
    /^the drift between local main and origin is recorded in the daemon log$/,
    (ctx) => {
      requireWiringPass(ctx, SCENARIO_01_PASS);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the divergence is surfaced to a human by that same tick$/,
    (ctx) => {
      requireWiringPass(ctx, SCENARIO_01_PASS);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no commit reachable from local main before the tick has been discarded$/,
    (ctx) => {
      requireWiringPass(ctx, SCENARIO_01_PASS);
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the block has persisted for more reconcile ticks than the escalation threshold allows$/,
    (ctx) => {
      ctx.bl1256 = ctx.bl1256 || {};
    },
    FEATURE
  );

  registry.defineScoped(
    /^the handoff daemon runs those real reconcile ticks against the fixture$/,
    () => {},
    FEATURE
  );

  registry.defineScoped(
    /^the operator escalation for the persistent block is still raised$/,
    (ctx) => {
      requireWiringPass(ctx, SCENARIO_02_PASS);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the step handlers for the reconcile kill switch's off-path scenarios$/,
    (ctx) => {
      ctx.bl1256 = { ...(ctx.bl1256 || {}), inspectedFiles: OFF_PATH_HANDLER_FILES };
    },
    FEATURE
  );

  registry.defineScoped(
    /^their invocations of the reconcile library are inspected$/,
    (ctx) => {
      ctx.bl1256 = { ...(ctx.bl1256 || {}), violations: inspectOffPathHandlers() };
    },
    FEATURE
  );

  registry.defineScoped(
    /^none of them drives sweep! with a hand-passed disabled flag instead of the daemon$/,
    (ctx) => {
      if (ctx.bl1256.violations.length > 0) {
        throw new Error(
          `BL-1256 scenario 03: found a hand-passed disabled-flag sweep! invocation in: ${ctx.bl1256.violations.join(', ')}`
        );
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
