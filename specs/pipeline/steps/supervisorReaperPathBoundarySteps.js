'use strict';

// BL-321: step handlers for "The handoffd supervisor reaps only its own
// project root's daemon". The pure "which pid is a genuine same-root
// orphan" decision lives entirely inside handoffd_supervisor.bb's own
// process-table scan (handoffd-pids-for-root) - there is no separate pure
// lib to unit-test against fixture strings the way e.g.
// closing_context_clear_lib.bb is (BL-309/BL-316's own pattern), so this
// - like the BL-320/BL-316 daemon-wiring tests before it - drives the
// REAL shell test (test_handoffd_supervisor_reaper_path_boundary.sh,
// real processes, real ps, real kill) as a subprocess, mirroring
// contextClearAllRolesSteps.js's own "drive the real daemon test" pattern
// rather than re-implementing its process-table fixture here.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const REAPER_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_handoffd_supervisor_reaper_path_boundary.sh');

function runReaperTest(ctx) {
  if (ctx.reaperTestOutput) {
    return ctx.reaperTestOutput;
  }
  const result = spawnSync('bash', [REAPER_TEST], { encoding: 'utf8', timeout: 60000 });
  ctx.reaperTestOutput = (result.stdout || '') + (result.stderr || '');
  return ctx.reaperTestOutput;
}

// The Scenario Outline's own <daemon_root>/<outcome> pairs, mapped to the
// exact PASS-line fragment test_handoffd_supervisor_reaper_path_boundary.sh
// prints for that example (its own "01 [<root> -> <outcome>]: ..." prefix).
const EXAMPLE_LABELS = {
  '/srv/swarm': '/srv/swarm -> is reaped',
  '/srv/swarm/tmp/fx': '/srv/swarm/tmp/fx -> is left alive',
  '/srv/swarm/target': '/srv/swarm/target -> is left alive',
  '/srv/swarm-2': '/srv/swarm-2 -> is left alive',
  '/srv/swarmforge': '/srv/swarmforge -> is left alive',
  '/srv/other': '/srv/other -> is left alive',
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a supervisor supervising the project root "([^"]+)"$/, (ctx, root) => {
    // Narrative only - the real shell test's own fixture supervises
    // "/srv/swarm" under a fresh mktemp base, matching this root exactly;
    // captured for the Then steps' own lookups below.
    ctx.supervisedRoot = root;
  });

  // ── supervisor-reaper-path-boundary-01 (Scenario Outline) ───────────
  registry.define(/^an untracked handoffd\.bb daemon started with the root "([^"]+)"$/, (ctx, daemonRoot) => {
    ctx.daemonRoot = daemonRoot;
  });

  registry.define(/^the supervisor runs its orphan reap check$/, (ctx) => {
    ctx.output = runReaperTest(ctx);
  });

  registry.define(/^the daemon (is reaped|is left alive)$/, (ctx, outcome) => {
    const label = EXAMPLE_LABELS[ctx.daemonRoot];
    if (!label) {
      throw new Error(`no known example for daemon root "${ctx.daemonRoot}"`);
    }
    const expectedLine = `PASS: 01 [${label}]`;
    if (!ctx.output.includes(expectedLine)) {
      throw new Error(`expected "${expectedLine}" (daemon ${outcome}) in the real reaper test output, got:\n${ctx.output}`);
    }
  });

  // ── supervisor-reaper-path-boundary-02 ──────────────────────────────
  registry.define(/^a reap-orphan entry is written for that daemon$/, (ctx) => {
    const output = ctx.output || runReaperTest(ctx);
    if (!output.includes('PASS: 02: reaping a genuine orphan records a reap-orphan entry')) {
      throw new Error(`expected the reap-orphan log-entry assertion to pass, got:\n${output}`);
    }
  });

  // ── supervisor-reaper-path-boundary-03 ──────────────────────────────
  registry.define(/^no reap-orphan entry is written for that daemon$/, (ctx) => {
    const output = ctx.output || runReaperTest(ctx);
    if (!output.includes('PASS: 03: a sibling-root daemon is never reaped, no reap-orphan entry written')) {
      throw new Error(`expected the spared-daemon-no-log assertion to pass, got:\n${output}`);
    }
  });

  registry.define(/^that daemon remains able to deliver handoffs$/, (ctx) => {
    const output = ctx.output || runReaperTest(ctx);
    if (!output.includes('PASS: 03: the spared sibling-root daemon remains able to deliver handoffs')) {
      throw new Error(`expected the spared-daemon-still-delivers assertion to pass, got:\n${output}`);
    }
  });

  // ── supervisor-reaper-path-boundary-04 ──────────────────────────────
  registry.define(/^the running handoffd_supervisor\.bb process names the root "([^"]+)"$/, (ctx, root) => {
    ctx.supervisedRoot = root;
  });

  registry.define(/^the supervisor process is left alive$/, (ctx) => {
    const output = ctx.output || runReaperTest(ctx);
    if (!output.includes('PASS: 04: the supervisor never reaps itself')) {
      throw new Error(`expected the never-reaps-itself assertion to pass, got:\n${output}`);
    }
    if (!/ALL PASS/.test(output)) {
      throw new Error(`expected the real reaper test to pass in full, got:\n${output}`);
    }
  });
}

module.exports = { registerSteps };
