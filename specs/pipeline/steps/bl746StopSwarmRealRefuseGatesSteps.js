'use strict';

// BL-746: every scenario here drives the REAL repo-root stop-swarm.sh (a
// byte-identical runtime copy in a fixture root, its helpers resolved via
// its own SCRIPT_DIR seam) and asserts on its actual stdout/stderr/exit
// status - never a reimplementation of its refuse-gate branching. Fixture
// construction lives in lib/bl746StopSwarmFixture.js, shared with
// swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js
// so the two never drift.

const path = require('node:path');
const fixtureLib = require(path.join(__dirname, 'lib', 'bl746StopSwarmFixture'));

const FEATURE = 'The real stop-swarm.sh owns its refuse gates and success line';

// Fixture is built once per scenario (fresh ctx each run, per runtime.js),
// re-invoked idempotently by every Background/Given step that needs it.
function fixture(ctx) {
  if (!ctx.bl746) {
    ctx.bl746 = fixtureLib.buildFixture();
  }
  return ctx.bl746;
}

function runStopSwarm(ctx) {
  if (!ctx.bl746Result) {
    ctx.bl746Result = fixtureLib.runStopSwarm(fixture(ctx));
  }
  return ctx.bl746Result;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a fixture root holding a runtime copy of the real stop-swarm\.sh$/,
    (ctx) => { fixture(ctx); },
    FEATURE,
  );

  registry.defineScoped(
    /^the fixture's swarmforge\/scripts holds the real stack_survivor_scan\.sh and stubbed ancillary and pipeline-kill scripts$/,
    (ctx) => { fixture(ctx); },
    FEATURE,
  );

  registry.defineScoped(
    /^the fixture process table is injected via SWARMFORGE_SURVIVOR_PS_FILE$/,
    (ctx) => { fixture(ctx); },
    FEATURE,
  );

  // ── Givens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the injected process table shows a running "([^"]*)"$/,
    (ctx, argv) => { fixtureLib.setSurvivor(fixture(ctx), argv); },
    FEATURE,
  );

  registry.defineScoped(
    /^the injected process table shows no supervised survivors$/,
    (ctx) => { fixtureLib.setNoSurvivors(fixture(ctx)); },
    FEATURE,
  );

  registry.defineScoped(
    /^the stubbed pipeline kill exits (\d+)$/,
    (ctx, code) => { fixtureLib.writeKillStub(fixture(ctx).root, Number(code)); },
    FEATURE,
  );

  // ── When ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the fixture's stop-swarm\.sh runs against the fixture root$/,
    (ctx) => { runStopSwarm(ctx); },
    FEATURE,
  );

  // ── Then ──────────────────────────────────────────────────────────────
  // Every Then step below is a potential scenario-terminal assertion (each
  // scenario chains several via And - see the feature file), so each calls
  // cleanupFixtureRoot itself, before the assertion can throw: mirrors
  // bl886SupervisorFixture.js's own terminal-step cleanup pattern. Safe to
  // call more than once per scenario - fs.rmSync(..., {force: true}) is a
  // no-op on an already-removed root, and runStopSwarm(ctx) only ever
  // reads the already-captured ctx.bl746Result, never the fixture root
  // itself, after the process has run.
  registry.defineScoped(
    /^its exit status is non-zero$/,
    (ctx) => {
      const result = runStopSwarm(ctx);
      fixtureLib.cleanupFixtureRoot(fixture(ctx));
      if ((result.status || 0) === 0) {
        throw new Error(`expected a non-zero exit status, got 0. stdout=${result.stdout} stderr=${result.stderr}`);
      }
    },
    FEATURE,
  );

  registry.defineScoped(
    /^its exit status is (\d+)$/,
    (ctx, code) => {
      const result = runStopSwarm(ctx);
      fixtureLib.cleanupFixtureRoot(fixture(ctx));
      if (result.status !== Number(code)) {
        throw new Error(`expected exit status ${code}, got ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
      }
    },
    FEATURE,
  );

  registry.defineScoped(
    /^its stderr names "([^"]+)" as a survivor$/,
    (ctx, named) => {
      const result = runStopSwarm(ctx);
      fixtureLib.cleanupFixtureRoot(fixture(ctx));
      if (!(result.stderr || '').includes(named)) {
        throw new Error(`expected stderr to name "${named}" as a survivor, got: ${result.stderr}`);
      }
    },
    FEATURE,
  );

  registry.defineScoped(
    /^its output does not contain "([^"]+)"$/,
    (ctx, text) => {
      const result = runStopSwarm(ctx);
      fixtureLib.cleanupFixtureRoot(fixture(ctx));
      const combined = `${result.stdout || ''}${result.stderr || ''}`;
      if (combined.includes(text)) {
        throw new Error(`expected output to NOT contain "${text}", got: ${combined}`);
      }
    },
    FEATURE,
  );

  registry.defineScoped(
    /^its stdout contains the line "([^"]+)"$/,
    (ctx, line) => {
      const result = runStopSwarm(ctx);
      fixtureLib.cleanupFixtureRoot(fixture(ctx));
      if (!(result.stdout || '').includes(line)) {
        throw new Error(`expected stdout to contain "${line}", got: ${result.stdout}`);
      }
    },
    FEATURE,
  );

  registry.defineScoped(
    /^its stderr contains "([^"]+)"$/,
    (ctx, text) => {
      const result = runStopSwarm(ctx);
      fixtureLib.cleanupFixtureRoot(fixture(ctx));
      if (!(result.stderr || '').includes(text)) {
        throw new Error(`expected stderr to contain "${text}", got: ${result.stderr}`);
      }
    },
    FEATURE,
  );
}

module.exports = { registerSteps };
