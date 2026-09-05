'use strict';

// BL-1416: step handlers for "the auth-class observer never counts a busy
// pane, and skipped respawns never reach the persist alert". Drives the
// REAL provider_auth_observe_lib.bb decide-auth-observation (plus
// matched-auth-line/format-alert-reason for the persist-alert scenario) via
// a Babashka runner (bl1416_busy_pane_never_auth_dead_acceptance_runner.bb),
// threading episode state across a sequence of {pane, busy} ticks - the
// same shape as bl536ProviderAuthErrorAutoRespawnSteps.js, extended with an
// explicit busy flag per tick (qa_e2e_procedure item 2's own "with busy
// true" wording - the busy predicate itself, chase-sweep-lib/actively-
// processing?, is real tmux pane text and is proven wired into the live
// daemon by test_handoffd_auth_observe_wiring.sh next to it; QA's own
// live procedure, item 3, is the read-only host observation).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(
  REPO_ROOT, 'swarmforge', 'scripts', 'test',
  'bl1416_busy_pane_never_auth_dead_acceptance_runner.bb',
);

const DEFAULT_MAX_ATTEMPTS = 3;
const ROLE = 'hardender';

// The runtime's own busy footer (chase_sweep_lib.bb's live-status-frame-
// pattern: a spinner glyph, a verb, an ellipsis, then "(<elapsed>").
const BUSY_FOOTER = '✻ Mutating… (1834s · ⚒ 12.4k tokens · esc to interrupt)';
const IDLE_PROMPT = '$ ';

// A trimmed excerpt of the hardener's real 2026-09-05 05:39Z pane (ticket
// description): providerChatSeat.test.js assertions printing the runtime's
// own auth-error text, with the busy footer in the tail.
const HARDENER_2026_09_05_PANE = [
  ' ✓ answered 401: invalid api key (3 ms)',
  ' ✓ matches /invalid api key/ (2 ms)',
  BUSY_FOOTER,
].join('\n');

function runTicks(ticks, maxAttempts, role) {
  const scenario = { maxAttempts, role: role || ROLE, ticks };
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out).results;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a role whose pane text is fed to the auth-class observer tick by tick$/, (ctx) => {
    ctx.maxAttempts = DEFAULT_MAX_ATTEMPTS;
    ctx.ticks = [];
  });

  // ── busy-pane-is-healthy-01 (Scenario Outline) ───────────────────────────
  registry.define(/^the pane shows the runtime's busy footer and its text contains "([^"]+)"$/, (ctx, text) => {
    ctx.ticks = [{ pane: `${text}\n${BUSY_FOOTER}`, busy: true }];
  });

  // ── idle-auth-error-still-respawns-02 ────────────────────────────────────
  registry.define(/^the pane is idle at the prompt and shows the runtime's own line "([^"]+)"$/, (ctx, line) => {
    ctx.ticks = [{ pane: `${line}\n${IDLE_PROMPT}`, busy: false }];
  });

  // ── shared When: a single observer tick (scenarios 01, 02, 05) ───────────
  registry.define(/^the observer tick runs$/, (ctx) => {
    ctx.results = runTicks(ctx.ticks, ctx.maxAttempts, ctx.role);
    ctx.lastResult = ctx.results[ctx.results.length - 1];
  });

  // ── busy-pane-is-healthy-01 ───────────────────────────────────────────────
  registry.define(/^the classification is healthy$/, (ctx) => {
    if (ctx.lastResult.signal !== 'healthy') {
      throw new Error(`expected signal=healthy, got ${ctx.lastResult.signal}: ${JSON.stringify(ctx.lastResult)}`);
    }
  });

  registry.define(/^no respawn is attempted and no attempt is counted$/, (ctx) => {
    if (ctx.results.some((r) => r.action === 'respawn')) {
      throw new Error(`expected no respawn, got: ${JSON.stringify(ctx.results)}`);
    }
    if (ctx.lastResult.attempts !== 0) {
      throw new Error(`expected attempts=0, got ${ctx.lastResult.attempts}`);
    }
  });

  // ── idle-auth-error-still-respawns-02 ────────────────────────────────────
  registry.define(/^the classification is auth$/, (ctx) => {
    if (ctx.lastResult.signal !== 'auth') {
      throw new Error(`expected signal=auth, got ${ctx.lastResult.signal}: ${JSON.stringify(ctx.lastResult)}`);
    }
  });

  registry.define(/^a respawn is attempted and counted$/, (ctx) => {
    if (ctx.lastResult.action !== 'respawn') {
      throw new Error(`expected action=respawn, got ${ctx.lastResult.action}`);
    }
    if (ctx.lastResult.attempts !== 1) {
      throw new Error(`expected attempts=1, got ${ctx.lastResult.attempts}`);
    }
  });

  // ── skipped-attempts-never-reach-the-alert-03 ────────────────────────────
  registry.define(/^the pane text would classify auth if the pane were idle$/, (ctx) => {
    ctx.authText = 'AuthenticationError: Invalid API key provided\n';
  });

  registry.define(/^(\d+) observer ticks run while the pane shows the busy footer$/, (ctx, n) => {
    ctx.ticks = new Array(Number(n)).fill({ pane: `${ctx.authText}${BUSY_FOOTER}`, busy: true });
    ctx.results = runTicks(ctx.ticks, ctx.maxAttempts, ctx.role);
    ctx.lastResult = ctx.results[ctx.results.length - 1];
  });

  registry.define(/^no respawn is attempted$/, (ctx) => {
    if (ctx.results.some((r) => r.action === 'respawn')) {
      throw new Error(`expected no respawn across any tick, got: ${JSON.stringify(ctx.results)}`);
    }
  });

  registry.define(/^no persist alert is sent$/, (ctx) => {
    if (ctx.results.some((r) => r.action === 'alert')) {
      throw new Error(`expected no alert across any tick, got: ${JSON.stringify(ctx.results)}`);
    }
  });

  // ── the-alert-names-what-it-matched-04 ───────────────────────────────────
  registry.define(/^(\d+) idle-pane auth observations have each respawned the role$/, (ctx, n) => {
    const idleAuthPane = 'AuthenticationError: Invalid API key provided\n$ ';
    ctx.idleAuthPane = idleAuthPane;
    ctx.ticks = new Array(Number(n)).fill({ pane: idleAuthPane, busy: false });
    ctx.results = runTicks(ctx.ticks, ctx.maxAttempts, ctx.role);
    if (ctx.results.some((r) => r.action !== 'respawn')) {
      throw new Error(`setup expected every one of the first ${n} ticks to respawn, got: ${JSON.stringify(ctx.results)}`);
    }
  });

  registry.define(/^the next idle-pane auth observation runs$/, (ctx) => {
    ctx.ticks = [...ctx.ticks, { pane: ctx.idleAuthPane, busy: false }];
    ctx.results = runTicks(ctx.ticks, ctx.maxAttempts, ctx.role);
    ctx.lastResult = ctx.results[ctx.results.length - 1];
  });

  registry.define(/^the persist alert is sent once$/, (ctx) => {
    const alerts = ctx.results.filter((r) => r.action === 'alert');
    if (alerts.length !== 1) {
      throw new Error(`expected exactly one alert, got ${alerts.length}: ${JSON.stringify(ctx.results)}`);
    }
    if (ctx.lastResult.action !== 'alert') {
      throw new Error(`expected the LAST tick to be the alert, got ${ctx.lastResult.action}`);
    }
  });

  registry.define(/^it names the matched line and the number of real respawns$/, (ctx) => {
    const { reason, matchedLine, attempts } = ctx.lastResult;
    if (!matchedLine || !reason || !reason.includes(matchedLine)) {
      throw new Error(`expected the persist alert reason to name the matched line, got: ${JSON.stringify(ctx.lastResult)}`);
    }
    if (!reason.includes(String(attempts))) {
      throw new Error(`expected the persist alert reason to name the performed count (${attempts}), got: ${reason}`);
    }
  });

  // ── the-2026-09-05-hardender-pane-is-healthy-05 ──────────────────────────
  registry.define(/^the hardener's pane text as captured on 2026-09-05 during its BL-1383 mutation run$/, (ctx) => {
    ctx.ticks = [{ pane: HARDENER_2026_09_05_PANE, busy: true }];
  });
}

module.exports = { registerSteps };
