'use strict';

// BL-785: step handlers for "BL-785 freshness checker honours a deliberate
// stop". Drives the REAL shell suites (test_bl785_freshness_deliberate_stop.sh,
// test_freshness_stop_marker_lib.sh) with injected clock/paths/marker seams —
// never a parallel reimplementation of the POSIX checker/marker library.
// Greps the suites' own PASS lines per scenario, mirroring BL-675's step
// handler pattern (bl675DaemonLogFreshnessSteps.js).
//
// Every registration is scoped to FEATURE_NAME (registry.defineScoped): this
// feature reuses several step phrasings verbatim from BL-675's feature (e.g.
// "the freshness checker runs"), and an unscoped registration would let
// resolution order between step files decide which suite actually runs.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE_NAME = 'BL-785 freshness checker honours a deliberate stop';

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const MAIN_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_bl785_freshness_deliberate_stop.sh');
const MARKER_LIB_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_freshness_stop_marker_lib.sh');

const KNOWN_DAEMONS = new Set(['handoffd', 'babysitterd']);

function knownDaemon(value) {
  if (!KNOWN_DAEMONS.has(value)) {
    throw new Error(`BL-785: unrecognized daemon "${value}"`);
  }
  return value;
}

function runSuite(ctx, outputKey, exitKey, file) {
  if (ctx[outputKey] !== undefined) {
    return ctx[outputKey];
  }
  const result = spawnSync('bash', [file], {
    encoding: 'utf8',
    timeout: 120000,
    env: process.env,
  });
  ctx[outputKey] = `${result.stdout || ''}${result.stderr || ''}`;
  ctx[exitKey] = result.status;
  return ctx[outputKey];
}

function runMainSuite(ctx) {
  return runSuite(ctx, 'output', 'mainExit', MAIN_TEST);
}

function runMarkerLibSuite(ctx) {
  return runSuite(ctx, 'markerLibOutput', 'markerLibExit', MARKER_LIB_TEST);
}

function expectLine(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in BL-785 suite output, got:\n${output}`);
  }
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a fixture swarm root with handoffd and babysitterd watched by the freshness checker$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      if (ctx.mainExit !== 0) {
        throw new Error(`BL-785 freshness-deliberate-stop suite exited ${ctx.mainExit}:\n${output}`);
      }
      expectLine(output, 'BL-785 freshness-deliberate-stop: ALL CHECKS PASSED', 'suite-green');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the daemons' start scripts and binaries are stubbed on PATH$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      // Proof the background claim is real: 04 stubs `bb` for handoffd's
      // start script, 04-babysitterd runs the real plain-bash
      // start_babysitterd.sh — both go through PATH-resolved binaries.
      expectLine(output, 'PASS: 04: real start_handoff_daemon.sh re-arms watching', '04-stubbed-handoffd');
      expectLine(output, 'PASS: 04-babysitterd: real start_babysitterd.sh re-arms watching', '04-stubbed-babysitterd');
    },
    FEATURE_NAME
  );

  // ── 01 / 04 shared Given ─────────────────────────────────────────────────
  registry.defineScoped(
    /^the fixture swarm was stopped by the full-stack stop path$/,
    (ctx) => {
      ctx.stopPath = 'full-stack';
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  // ── 01 / 06 shared Given ─────────────────────────────────────────────────
  registry.defineScoped(
    /^both watched daemons' heartbeat logs are stale$/,
    (ctx) => {
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  // ── shared When (every scenario) ────────────────────────────────────────
  registry.defineScoped(/^the freshness checker runs$/, (ctx) => {
    runMainSuite(ctx);
  }, FEATURE_NAME);

  // ── 01 / 05 / 06 shared Then ─────────────────────────────────────────────
  registry.defineScoped(
    /^neither watched daemon is restarted$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      if (ctx.durableOnly) {
        expectLine(
          output,
          'PASS: 05: suppression holds from durable state alone, no live process required',
          '05'
        );
      } else if (ctx.stopHistory) {
        expectLine(output, 'PASS: 06: repeated stops (including stopping nothing) stay idempotent', '06');
      } else {
        expectLine(output, 'PASS: 01: full-stack stop suppresses restart for both watched daemons', '01');
      }
    },
    FEATURE_NAME
  );

  // ── 01 ───────────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^no watched daemon process is running afterwards$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      expectLine(output, 'PASS: 01: full-stack stop suppresses restart for both watched daemons', '01');
    },
    FEATURE_NAME
  );

  // ── 02 ───────────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the fixture swarm was stopped by the pipeline-only stop path$/,
    (ctx) => {
      ctx.stopPath = 'pipeline-only';
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^babysitterd was left running and its heartbeat log then goes stale$/,
    (ctx) => {
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^handoffd is not restarted$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      expectLine(output, 'PASS: 02: pipeline-only stop scopes suppression to handoffd alone', '02');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^babysitterd is killed and restarted by that same run$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      expectLine(output, 'PASS: 02: pipeline-only stop scopes suppression to handoffd alone', '02');
    },
    FEATURE_NAME
  );

  // ── 03 ───────────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^no deliberate stop has been requested$/,
    (ctx) => {
      ctx.stopPath = 'none';
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a watched daemon's heartbeat log is stale$/,
    (ctx) => {
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the daemon is killed via its pid file and restarted via its own start script$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      expectLine(
        output,
        'PASS: 03: unconditional-suppression regression scenario — no marker, no suppression',
        '03'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the incident record is appended before the announce$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      expectLine(output, 'ok   - 03: incident record appended before announce', '03-incident');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the announce carries the existing FRESHNESS_VIOLATION text$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      expectLine(output, 'ok   - 03: announce carries the existing FRESHNESS_VIOLATION text', '03-announce');
    },
    FEATURE_NAME
  );

  // ── 04 (Outline) — also covers scenario 02's literal "handoffd's heartbeat
  // log is stale" (BL-785's IR-DRY review: intentionally the same step shape) ──
  registry.defineScoped(
    /^(\w+)'s start script has been run again$/,
    (ctx, daemon) => {
      knownDaemon(daemon);
      ctx.rearmDaemon = daemon;
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^(\w+)'s heartbeat log is stale$/,
    (ctx, daemon) => {
      knownDaemon(daemon);
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^(\w+) is killed and restarted$/,
    (ctx, daemon) => {
      knownDaemon(daemon);
      const output = runMainSuite(ctx);
      if (daemon === 'handoffd') {
        expectLine(
          output,
          'PASS: 04: real start_handoff_daemon.sh re-arms watching; the proof is the restart happening',
          '04-handoffd'
        );
      } else {
        expectLine(
          output,
          'PASS: 04-babysitterd: real start_babysitterd.sh re-arms watching; the proof is the restart happening',
          '04-babysitterd'
        );
      }
    },
    FEATURE_NAME
  );

  // ── 05 ───────────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the fixture root's durable state records a deliberate stop of both watched daemons$/,
    (ctx) => {
      ctx.durableOnly = true;
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no handoffd, babysitterd, bb, or node process is running$/,
    (ctx) => {
      // Static proof (invariant #2): the verdict function itself never
      // shells out to ask a live process, so scenario 05's behavioural pass
      // (below, via "neither watched daemon is restarted") isn't a
      // coincidence of the fixture never happening to need one.
      const libOutput = runMarkerLibSuite(ctx);
      expectLine(libOutput, 'PASS: 07: deliberate-stop verdict never asks a live process', '07-static');
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the checker exits successfully$/,
    (ctx) => {
      runMainSuite(ctx);
      if (ctx.mainExit !== 0) {
        throw new Error(`expected the BL-785 suite (checker run) to exit 0, got ${ctx.mainExit}`);
      }
    },
    FEATURE_NAME
  );

  // ── 06 (Outline) ─────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the full-stack stop path was run twice in a row$/,
    (ctx) => {
      ctx.stopHistory = 'repeat';
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the full-stack stop path was run when nothing was running$/,
    (ctx) => {
      ctx.stopHistory = 'empty';
      runMainSuite(ctx);
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
