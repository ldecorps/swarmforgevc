'use strict';

// BL-637: lifecycle script names state scope; stop path verifies survivors.
// Drives the REAL shell suite — never a parallel reimplementation.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SUITE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_lifecycle_script_scope.sh');
const FEATURE = 'lifecycle script names and the teardown path state their true scope';

function runSuite(ctx) {
  if (ctx.bl637) return ctx.bl637;
  const result = spawnSync('bash', [SUITE], {
    encoding: 'utf8',
    timeout: 120000,
    env: process.env,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  ctx.bl637 = { status: result.status, out };
  if (result.status !== 0) {
    throw new Error(`BL-637 lifecycle scope suite exited ${result.status}:\n${out}`);
  }
  return ctx.bl637;
}

function expectPass(ctx, fragment, label) {
  const { out } = runSuite(ctx);
  if (!out.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in suite output, got:\n${out}`);
  }
}

function registerSteps(registry) {
  // ── Scenario outline 01 ────────────────────────────────────────────────
  registry.defineScoped(
    // Outline expands to: runs "<entry point> --help" (help is inside the quotes).
    /^a reader who has never seen the repo runs "([^"]+) --help"$/,
    (ctx, entry) => {
      runSuite(ctx);
      ctx.bl637Entry = entry;
    },
    FEATURE,
  );

  registry.defineScoped(
    /^the output states "([^"]+)"$/,
    (ctx, scope) => {
      const entry = ctx.bl637Entry;
      expectPass(ctx, `PASS: 01: ${entry} --help states ${scope}`, `01-${entry}`);
    },
    FEATURE,
  );

  // ── Scenario 02 ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the flow-watchdog detects three consecutive NO_TASK chase observations$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^it invokes its configured hard-stop entry point$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^every role agent, handoffd, and its supervisor are terminated$/,
    (ctx) => {
      // Shim path exercises the same kill_pipeline body the watchdog calls
      // via kill_all_swarm.sh — proven by audit SUCCESS on an empty fixture.
      expectPass(ctx, 'PASS: 02: kill_all_swarm.sh shim writes kill-all-audit.log SUCCESS', '02');
    },
    FEATURE,
  );

  registry.defineScoped(
    /^"\.swarmforge\/daemon\/kill-all-audit\.log" is written$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 02: kill_all_swarm.sh shim writes kill-all-audit.log SUCCESS', '02-audit');
    },
    FEATURE,
  );

  // ── Scenario 03 ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a lifecycle component has a start_\* or launch_\* entry point$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^its --help is read$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^the corresponding stop entry point is named$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 03: every start_*/launch_* --help names a stop entry point', '03');
    },
    FEATURE,
  );

  // ── Scenario 04 ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the operator-launched babysitterd process is running$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^"\.\/stop-swarm\.sh" completes its teardown steps$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^it does not report a clean slate$/,
    (ctx) => {
      // Both survivor scenarios share this Then; accept either pass line.
      const { out } = runSuite(ctx);
      const ok =
        out.includes('PASS: 04: stop path refuses clean slate and names babysitterd') ||
        out.includes('PASS: 05: stop path refuses clean slate and names Operator');
      if (!ok) {
        throw new Error(`expected refuse-clean-slate pass for 04 or 05, got:\n${out}`);
      }
    },
    FEATURE,
  );

  registry.defineScoped(
    /^it names the surviving babysitter process$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 04: stop path refuses clean slate and names babysitterd', '04-name');
    },
    FEATURE,
  );

  // ── Scenario 05 ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the Operator remote-control agent process is running$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^it names the surviving Operator agent process$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 05: stop path refuses clean slate and names Operator', '05-name');
    },
    FEATURE,
  );
}

module.exports = { registerSteps };
