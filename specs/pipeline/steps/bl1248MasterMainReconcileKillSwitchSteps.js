'use strict';

// BL-1248: step handlers for "the master-main-reconcile sweep can be
// switched off from config, and is off until BL-1236 lands". Scenarios 02
// (the real-git "one that matters"), 03 (the daemon log line), and 05
// (BL-1256: re-pointed, see below) drive the REAL
// test_handoffd_master_main_reconcile_wiring.sh fixture (real git, real
// bare remote, real handoffd process) via bl1256ReconcileWiringFixture.js's
// shared runner - never a parallel reimplementation of that fixture's git
// plumbing. Scenario 01 is a pure-decision-layer proof (no real git needed
// for what it asserts) and drives master_main_reconcile_lib.bb directly via
// a `bb -e` one-liner, the same pure adapters-injected posture as this
// lib's own unit test runner. Scenario 04 reads the actually-shipped conf
// file straight off disk.
//
// BL-1256: scenario 05 USED to be a pure-decision-layer proof too (calling
// sweep! directly via `bb -e` with a hand-passed disabled flag over fake
// adapters) - that made it blind to where the guard actually sits in
// handoffd.bb, so it stayed green for a guard moved to the daemon call
// site, which is exactly the shape it exists to catch. Re-pointed at the
// real daemon fixture below; the old direct-sweep! handler
// (runDivergenceStillSurfaced) is gone.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { requireWiringPass } = require('./lib/bl1256ReconcileWiringFixture');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');
const FEATURE =
  'BL-1248 the master-main-reconcile sweep can be switched off from config, and is off until BL-1236 lands';

const VALUE_TO_CONF_TEXT = {
  true: 'config master_main_reconcile_enabled true',
  false: 'config master_main_reconcile_enabled false',
  'an absent key': '',
  'an empty value': 'config master_main_reconcile_enabled',
  'the word banana': 'config master_main_reconcile_enabled banana',
};

// Runs sweep! (the real production function) against a should-reconcile
// scenario (behind>0, fully clean tree) with the given conf text, and
// reports whether the sole state-mutating adapter (:merge!) fired - the
// observable meaning of "the sweep runs" this scenario outline asserts.
function runSweepDecision(confText) {
  const script = `
(load-file "${LIB_BB.replace(/\\/g, '\\\\')}")
(require '[babashka.fs :as fs])
(def merge-calls (atom 0))
(def adapters {:rev-counts! (fn [] {:ahead 0 :behind 5})
               :dirty-paths! (fn [] #{})
               :merge-changed-paths! (fn [] #{})
               :merge! (fn [] (swap! merge-calls inc) {:success true})
               :surface! (fn [_] nil)
               :escalate! (fn [_] nil)
               :log! (fn [& _] nil)})
(def enabled? (master-main-reconcile-lib/parse-enabled? (System/getenv "BL1248_CONF_TEXT")))
(master-main-reconcile-lib/sweep! (str (fs/create-temp-dir)) 100 enabled? adapters)
(println (if (pos? @merge-calls) "RUNS" "SKIPPED"))
`;
  const result = spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, BL1248_CONF_TEXT: confText },
  });
  if (result.status !== 0) {
    throw new Error(`bb sweep-decision script failed: ${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a swarmforge project root whose config is read by the handoff daemon$/,
    (ctx) => {
      ctx.bl1248 = {};
    },
    FEATURE
  );

  // ── Scenario 01 (outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^the config sets "master_main_reconcile_enabled" to "?([^"]+?)"?$/,
    (ctx, value) => {
      if (!(value in VALUE_TO_CONF_TEXT)) {
        throw new Error(`BL-1248: unrecognized config value "${value}"`);
      }
      ctx.bl1248 = { ...(ctx.bl1248 || {}), confText: VALUE_TO_CONF_TEXT[value] };
    },
    FEATURE
  );

  registry.defineScoped(
    /^the handoff daemon runs one cadence tick$/,
    (ctx) => {
      // Scenarios 02/03/05 drive the real daemon (handled by their own
      // Then-steps below, which memoize the real wiring fixture); scenario
      // 01 (the only remaining pure-decision-layer proof - BL-1256 retired
      // 05's own use of this path) evaluates the outcome here, once, so
      // repeated Then-steps for the same scenario share one run.
      if (ctx.bl1248.scenario !== '05' && ctx.bl1248.confText !== undefined && ctx.bl1248.tickOutcome === undefined) {
        ctx.bl1248.tickOutcome = runSweepDecision(ctx.bl1248.confText);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the master-main-reconcile sweep (runs|does not run)$/,
    (ctx, expected) => {
      const actual = ctx.bl1248.tickOutcome === 'RUNS' ? 'runs' : 'does not run';
      if (actual !== expected) {
        throw new Error(
          `BL-1248 scenario 01: config "${ctx.bl1248.confText}" expected the sweep to "${expected}", got "${actual}"`
        );
      }
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^local main is ahead of origin by a commit no other ref contains$/,
    (ctx) => {
      ctx.bl1248 = { ...(ctx.bl1248 || {}), scenario: '02' };
    },
    FEATURE
  );

  registry.defineScoped(
    /^no reconcile absorb, reset, or merge runs$/,
    (ctx) => {
      requireWiringPass(
        ctx,
        'with the switch off, a genuine two-way divergence is left alone entirely - no merge, reset, or absorb runs, and the local-only commit stays reachable from main (BL-1248 invariant 1, real-git half)'
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^that commit is still reachable from local main$/,
    (ctx) => {
      // Same PASS line covers both assertions - the fixture's own
      // rev-list/merge-base check is what makes "still reachable" real.
      requireWiringPass(
        ctx,
        'with the switch off, a genuine two-way divergence is left alone entirely - no merge, reset, or absorb runs, and the local-only commit stays reachable from main (BL-1248 invariant 1, real-git half)'
      );
      requireWiringPass(
        ctx,
        'flipping the switch back on reconciles this exact fixture - the off-case assertion above was not vacuously green (BL-1248 qa_e2e_procedure scenario 02)'
      );
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the daemon log records that the reconcile sweep was skipped by config$/,
    (ctx) => {
      requireWiringPass(ctx, 'switching the sweep off is visible in the daemon log (BL-1248 scenario 03)');
    },
    FEATURE
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the shipped "([^"]+)" is read$/,
    (ctx, relPath) => {
      const filePath = path.join(REPO_ROOT, relPath);
      ctx.bl1248 = { ...(ctx.bl1248 || {}), shippedConfText: fs.readFileSync(filePath, 'utf8') };
    },
    FEATURE
  );

  registry.defineScoped(
    /^it sets "master_main_reconcile_enabled" to "false" with BL-1236 named as the condition for turning it back on$/,
    (ctx) => {
      const text = ctx.bl1248.shippedConfText;
      const activeLine = /^config master_main_reconcile_enabled false$/m.test(text);
      if (!activeLine) {
        throw new Error('BL-1248 scenario 04: shipped conf does not ACTIVELY set the key to false (a commented-out line does not count)');
      }
      if (!text.includes('BL-1236')) {
        throw new Error('BL-1248 scenario 04: shipped conf does not name BL-1236 as the re-enable condition');
      }
    },
    FEATURE
  );

  // ── Scenario 05 ──────────────────────────────────────────────────────
  // BL-1256: re-pointed at the real daemon fixture (see file header) - the
  // Given no longer computes anything itself, matching scenario 02/03's own
  // lazy-memoized-on-first-Then posture below.
  registry.defineScoped(
    /^local main and origin have diverged with local changes blocking a merge$/,
    (ctx) => {
      ctx.bl1248 = { ...(ctx.bl1248 || {}), scenario: '05' };
    },
    FEATURE
  );

  registry.defineScoped(
    /^the drift between local main and origin is still recorded$/,
    (ctx) => {
      requireWiringPass(
        ctx,
        'with the switch off, a real daemon tick (--reconcile-sweep-once) still surfaces the divergence it declined to reconcile (BL-1256 scenario 01)'
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the divergence is still surfaced to a human$/,
    (ctx) => {
      requireWiringPass(
        ctx,
        'with the switch off, a real daemon tick (--reconcile-sweep-once) still surfaces the divergence it declined to reconcile (BL-1256 scenario 01)'
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
