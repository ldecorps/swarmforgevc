'use strict';

// BL-1248: step handlers for "the master-main-reconcile sweep can be
// switched off from config, and is off until BL-1236 lands". Two of the
// five scenarios (02, the real-git "one that matters", and 03, the daemon
// log line) drive the REAL test_handoffd_master_main_reconcile_wiring.sh
// fixture (real git, real bare remote, real handoffd process) added by this
// ticket, memoized once per ctx like bl925's own steps - never a parallel
// reimplementation of that fixture's git plumbing. Scenarios 01 and 05 are
// pure-decision-layer proofs (no real git needed for what they assert) and
// drive master_main_reconcile_lib.bb directly via a `bb -e` one-liner, the
// same pure adapters-injected posture as this lib's own unit test runner.
// Scenario 04 reads the actually-shipped conf file straight off disk.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');
const WIRING_SCRIPT = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_handoffd_master_main_reconcile_wiring.sh'
);
const SHIPPED_CONF = path.join(REPO_ROOT, 'swarmforge', 'swarmforge.conf');
const FEATURE =
  'BL-1248 the master-main-reconcile sweep can be switched off from config, and is off until BL-1236 lands';

const VALUE_TO_CONF_TEXT = {
  true: 'config master_main_reconcile_enabled true',
  false: 'config master_main_reconcile_enabled false',
  'an absent key': '',
  'an empty value': 'config master_main_reconcile_enabled',
  'the word banana': 'config master_main_reconcile_enabled banana',
};

function runWiringFixture() {
  const result = spawnSync('bash', [WIRING_SCRIPT], { encoding: 'utf8', timeout: 180000 });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureWiringResult(ctx) {
  ctx.bl1248 = ctx.bl1248 || {};
  if (!ctx.bl1248.wiringResult) {
    ctx.bl1248.wiringResult = runWiringFixture();
  }
  return ctx.bl1248.wiringResult;
}

function requireWiringPass(ctx, description) {
  const { stdout } = ensureWiringResult(ctx);
  if (!stdout.includes(`PASS: ${description}`)) {
    throw new Error(`expected wiring fixture check to pass: "${description}"\n${stdout}`);
  }
}

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

// Runs sweep! against a diverged, blocked (overlapping-dirty) scenario with
// the switch off, and reports whether the drift log line and the surfaced
// divergence note both still fired - the observable meaning of "the drift
// is still recorded" / "the divergence is still surfaced" (scenario 05).
function runDivergenceStillSurfaced() {
  const script = `
(load-file "${LIB_BB.replace(/\\/g, '\\\\')}")
(require '[babashka.fs :as fs])
(def logs (atom []))
(def surface-calls (atom 0))
(def adapters {:rev-counts! (fn [] {:ahead 0 :behind 5})
               :dirty-paths! (fn [] #{"seed.txt"})
               :merge-changed-paths! (fn [] #{"seed.txt"})
               :merge! (fn [] {:success true})
               :surface! (fn [_] (swap! surface-calls inc))
               :escalate! (fn [_] nil)
               :log! (fn [& parts] (swap! logs conj (clojure.string/join " " parts)))})
(master-main-reconcile-lib/sweep! (str (fs/create-temp-dir)) 100 false adapters)
(def drift-recorded? (boolean (some #(clojure.string/includes? % "drift ahead=0 behind=5") @logs)))
(println (str "drift=" drift-recorded? " surfaced=" (pos? @surface-calls)))
`;
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) {
    throw new Error(`bb divergence-still-surfaced script failed: ${result.stdout}\n${result.stderr}`);
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
      // Scenarios 02/03 drive the real daemon (handled by their own
      // Then-steps below, which memoize the real wiring fixture); scenarios
      // 01/05 evaluate the pure-decision-layer outcome here, once, so
      // repeated Then-steps for the same scenario share one run.
      if (ctx.bl1248.confText !== undefined && ctx.bl1248.tickOutcome === undefined) {
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
  registry.defineScoped(
    /^local main and origin have diverged with local changes blocking a merge$/,
    (ctx) => {
      ctx.bl1248 = { ...(ctx.bl1248 || {}), scenario: '05' };
      ctx.bl1248.divergenceOutcome = runDivergenceStillSurfaced();
    },
    FEATURE
  );

  registry.defineScoped(
    /^the drift between local main and origin is still recorded$/,
    (ctx) => {
      if (!/drift=true/.test(ctx.bl1248.divergenceOutcome)) {
        throw new Error(`BL-1248 scenario 05: expected drift to still be recorded, got "${ctx.bl1248.divergenceOutcome}"`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the divergence is still surfaced to a human$/,
    (ctx) => {
      if (!/surfaced=true/.test(ctx.bl1248.divergenceOutcome)) {
        throw new Error(`BL-1248 scenario 05: expected the divergence to still be surfaced, got "${ctx.bl1248.divergenceOutcome}"`);
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
