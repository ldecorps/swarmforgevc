'use strict';

// BL-514: step handlers for "swarm ensure verifies and repairs remote-control
// health". Drives the REAL test_swarm_ensure.sh shell suite (which exercises
// swarm_ensure.bb's remote-control component against a fixture tmux/launch
// setup) and asserts on its `PASS: RC-N ...` markers - same posture as
// specs/pipeline/steps/bl805RotateGateOnUnfinishedInProcessParcelSteps.js,
// never a parallel reimplementation of swarm_ensure.bb's own decision logic.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_swarm_ensure.sh');
const FEATURE = 'BL-514 swarm ensure verifies and repairs remote-control health';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough. "degraded" is not an Outline example value (scenarios 03/04
// spell it out literally) but is included here so all three states share one
// step definition/marker map instead of three near-duplicate step texts.
const STATE_TO_MARKER = {
  healthy: 'RC-1',
  down: 'RC-4',
  degraded: null, // scenario 03/04 pick the marker themselves (repair outcome differs)
  'no-flag': 'RC-6', // scenario 05: launch script declares no --remote-control flag
};

function knownState(value) {
  if (!Object.prototype.hasOwnProperty.call(STATE_TO_MARKER, value)) {
    throw new Error(`bl514 rc-health-in-swarm-ensure: unrecognized remote-control state "${value}"`);
  }
  return value;
}

function runSuite() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl514?.result) {
    ctx.bl514 = { ...(ctx.bl514 || {}), result: runSuite() };
  }
  return ctx.bl514.result;
}

function requirePass(ctx, marker, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${marker}`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^a fixture swarm whose remote-control probe is substituted by a fake$/, (ctx) => {
    ctx.bl514 = {};
  }, FEATURE);

  // ── scenario 01: rc:<role> line beside its agent:<role> line -> RC-5 ─────
  registry.defineScoped(/^swarm ensure runs$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^a remote-control component line is reported for every configured role$/, (ctx) => {
    requirePass(ctx, 'RC-5', 'a remote-control component line for every configured role');
  }, FEATURE);

  registry.defineScoped(
    /^each role's remote-control line immediately follows that role's own agent pane line$/,
    (ctx) => {
      requirePass(ctx, 'RC-5', "the remote-control line immediately following its role's agent pane line");
    },
    FEATURE
  );

  // ── scenario outline 02 / scenario 05 shared Given: remote-control state ─
  registry.defineScoped(/^a role whose remote-control state is (healthy|down|degraded)$/, (ctx, state) => {
    ctx.bl514 = { ...(ctx.bl514 || {}), state: knownState(state) };
  }, FEATURE);

  registry.defineScoped(/^that role's remote-control component reports HEALTHY$/, (ctx) => {
    const marker = STATE_TO_MARKER[ctx.bl514?.state];
    if (!marker) {
      throw new Error(`bl514: no HEALTHY marker known for state ${JSON.stringify(ctx.bl514?.state)}`);
    }
    requirePass(ctx, marker, `that role's remote-control component reporting HEALTHY`);
  }, FEATURE);

  registry.defineScoped(/^the remote-control component respawns no pane for that role$/, (ctx) => {
    const marker = STATE_TO_MARKER[ctx.bl514?.state];
    requirePass(ctx, marker, 'the remote-control component respawning no pane for that role');
  }, FEATURE);

  // ── scenario 03: degraded, repair restores the flag -> FIXED (RC-2) ──────
  registry.defineScoped(/^respawning its pane from its launch script restores the flag$/, (ctx) => {
    ctx.bl514 = { ...(ctx.bl514 || {}), repairOutcome: 'restores' };
  }, FEATURE);

  registry.defineScoped(/^that role's pane is respawned from its launch script$/, (ctx) => {
    requirePass(ctx, 'RC-2', "that role's pane being respawned from its launch script");
  }, FEATURE);

  registry.defineScoped(/^that role's remote-control component reports FIXED$/, (ctx) => {
    requirePass(ctx, 'RC-2', "that role's remote-control component reporting FIXED");
  }, FEATURE);

  // ── scenario 04: degraded, repair does not restore the flag -> FAILED ────
  registry.defineScoped(/^respawning its pane does not restore the flag$/, (ctx) => {
    ctx.bl514 = { ...(ctx.bl514 || {}), repairOutcome: 'does-not-restore' };
  }, FEATURE);

  registry.defineScoped(/^that role's remote-control component reports FAILED$/, (ctx) => {
    requirePass(ctx, 'RC-3', "that role's remote-control component reporting FAILED");
  }, FEATURE);

  registry.defineScoped(/^the remaining components are still checked and reported$/, (ctx) => {
    requirePass(ctx, 'RC-3', 'the remaining components still being checked and reported after a FAILED remote-control repair');
  }, FEATURE);

  registry.defineScoped(/^swarm ensure exits non-zero$/, (ctx) => {
    requirePass(ctx, 'RC-3', 'swarm ensure exiting non-zero after a FAILED remote-control repair');
  }, FEATURE);

  // ── scenario 05: no --remote-control flag declared -> HEALTHY, no probe ──
  registry.defineScoped(/^a role whose launch script declares no remote-control flag$/, (ctx) => {
    ctx.bl514 = { ...(ctx.bl514 || {}), state: 'no-flag' };
  }, FEATURE);

  registry.defineScoped(/^that role's live process is never probed$/, (ctx) => {
    requirePass(ctx, 'RC-6', "that role's live process never being probed when no --remote-control flag is declared");
  }, FEATURE);

  // ── scenario 06: rotated mono-router resident judged against its active
  //    role's launch script, never forced back onto its home role ─────────
  registry.defineScoped(/^a mono-router resident rotated onto a role other than its home role$/, (ctx) => {
    ctx.bl514 = { ...(ctx.bl514 || {}), rotated: true };
  }, FEATURE);

  registry.defineScoped(
    /^its live agent carries the rotated role's expected remote-control flag$/,
    () => {
      // Fixture background, established by test_swarm_ensure.sh's own RC-7
      // case (rotated resident's live process reports the ACTIVE role's flag).
    },
    FEATURE
  );

  registry.defineScoped(/^the resident's remote-control component reports HEALTHY$/, (ctx) => {
    requirePass(ctx, 'RC-7', "the rotated resident's remote-control component reporting HEALTHY");
  }, FEATURE);

  registry.defineScoped(/^the resident is not respawned back onto its home role$/, (ctx) => {
    requirePass(ctx, 'RC-7', 'the rotated resident not being forcibly respawned back onto its home role');
  }, FEATURE);
}

module.exports = { registerSteps };
