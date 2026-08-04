'use strict';

// BL-536: step handlers for "provider auth failures auto-heal". Drives the
// REAL provider_auth_observe_lib.bb decide-auth-observation via a Babashka
// runner (bl536_auth_observe_acceptance_runner.bb), threading episode state
// across a sequence of pane-scrollback ticks - no real tmux, no real
// process, exactly the decision logic handoffd.bb's chase sweep wires into
// its live observe path (required_wiring in the ticket YAML; proven
// reachable from the real daemon by
// test_handoffd_auth_observe_wiring.sh next to the Babashka test suite).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl536_auth_observe_acceptance_runner.bb');

const AUTH_TEXT = 'AuthenticationError: Invalid API key provided\n';
const HEALTHY_TEXT = 'some normal Claude Code turn output\n$ ';
const DEFAULT_MAX_ATTEMPTS = 3;

function runTicks(ticks, maxAttempts) {
  const scenario = { maxAttempts, ticks };
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out).results;
}

function registerSteps(registry) {
  // ── auth-error-triggers-respawn-01 ──────────────────────────────────────
  registry.define(/^a standing role pane whose recent scrollback matches auth-class text$/, (ctx) => {
    ctx.maxAttempts = DEFAULT_MAX_ATTEMPTS;
    ctx.ticks = [AUTH_TEXT];
  });

  // ── healthy-pane-not-respawned-02 ────────────────────────────────────────
  registry.define(/^a standing role pane whose recent scrollback carries no auth-class text$/, (ctx) => {
    ctx.maxAttempts = DEFAULT_MAX_ATTEMPTS;
    ctx.ticks = [HEALTHY_TEXT];
  });

  // ── persistent-auth-failure-alerts-03 (compound Given) ───────────────────
  registry.define(/^a standing role pane was just respawned for an auth-class failure$/, (ctx) => {
    ctx.maxAttempts = DEFAULT_MAX_ATTEMPTS;
    // Fills the episode up to the cap - every one of these ticks respawns.
    ctx.ticks = new Array(DEFAULT_MAX_ATTEMPTS).fill(AUTH_TEXT);
  });

  registry.define(/^the role's scrollback still matches auth-class text after the configured respawn attempt cap is reached$/, (ctx) => {
    ctx.ticks.push(AUTH_TEXT);
  });

  // ── shared When (all three scenarios) ────────────────────────────────────
  registry.define(/^the reliability observe tick runs$/, (ctx) => {
    ctx.results = runTicks(ctx.ticks, ctx.maxAttempts);
    ctx.lastResult = ctx.results[ctx.results.length - 1];
  });

  // ── auth-error-triggers-respawn-01 ──────────────────────────────────────
  registry.define(/^the role is respawned with provider-compat env$/, (ctx) => {
    if (ctx.lastResult.action !== 'respawn') {
      throw new Error(`expected the observe tick to respawn, got action=${ctx.lastResult.action}`);
    }
    // do-auth-respawn! (handoffd.bb) unconditionally reuses provider-
    // respawn-env-lib for every :respawn action - proven at the wiring
    // layer (test_handoffd_auth_observe_wiring.sh scenario 02), so a
    // :respawn action here IS "respawned with provider-compat env".
  });

  // ── healthy-pane-not-respawned-02 ────────────────────────────────────────
  registry.define(/^the role is not respawned$/, (ctx) => {
    if (ctx.lastResult.action === 'respawn') {
      throw new Error(`expected the observe tick NOT to respawn, got action=${ctx.lastResult.action}`);
    }
  });

  // ── persistent-auth-failure-alerts-03 ────────────────────────────────────
  registry.define(/^an operator-visible alert is recorded$/, (ctx) => {
    if (ctx.lastResult.action !== 'alert') {
      throw new Error(`expected the observe tick to alert, got action=${ctx.lastResult.action}`);
    }
  });

  registry.define(/^the role is not respawned again beyond the attempt cap$/, (ctx) => {
    const respawnCount = ctx.results.filter((r) => r.action === 'respawn').length;
    if (respawnCount !== ctx.maxAttempts) {
      throw new Error(`expected exactly ${ctx.maxAttempts} respawn(s) across the episode, got ${respawnCount}: ${JSON.stringify(ctx.results)}`);
    }
  });
}

module.exports = { registerSteps };
