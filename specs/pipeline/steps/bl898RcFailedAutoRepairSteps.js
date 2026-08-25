'use strict';

// BL-898: step handlers for "A dead remote-control session is detected and
// repaired without the human noticing it first". Same posture as BL-514's
// own steps file (bl514RcHealthInSwarmEnsureSteps.js): drives the REAL
// test_swarm_ensure.sh shell suite and asserts on its `PASS: RC-N ...`
// markers, never a parallel reimplementation of swarm_ensure.bb's/
// remote_control_health_lib.bb's own decision logic.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_swarm_ensure.sh');
const FEATURE = 'A dead remote-control session is detected and repaired without the human noticing it first';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough. Scenario 01's <state> is the one column that uniquely
// determines the fixture/marker for that whole row - <status>/<repair> are
// re-validated against allow-lists (below) rather than a second value->marker
// map, because "healthy" alone is genuinely ambiguous across two different
// rows (a plain working footer vs. one right after a repair) and a second
// colliding map would silently mis-check one of them. Mirrors BL-514's own
// STATE_TO_MARKER, which is also the single source of truth for its outline.
const STATE_TO_MARKER = {
  'a failed session footer seen on consecutive observations': 'RC-8',
  'a failed session footer seen once': 'RC-10',
  'a working session footer': 'RC-1',
  'a working session footer since a repair on the last sweep': 'RC-11',
  'the expected remote-control flag missing from a live agent': 'RC-4', // :degraded - never :session-dead
  'no agent process running': 'RC-4', // :down - never :session-dead
};

const KNOWN_STATUSES = new Set(['session-dead', 'not yet session-dead', 'healthy', 'degraded', 'down']);
const KNOWN_REPAIR_VALUES = new Set(['is triggered', 'is not triggered']);

const IDLES_TO_MARKER = {
  'becomes idle within the wait budget': 'RC-8',
  'stays busy past the wait budget': 'RC-9',
};

const OUTCOME_TO_MARKER = {
  respawned: 'RC-8',
  'left running and reported unrepaired': 'RC-9',
};

const ADDRESS_TO_MARKER = {
  readable: 'RC-8',
  'not readable': 'RC-12',
};

const CARRIED_TO_MARKER = {
  'the new session address': 'RC-8',
  'a statement that the address was not read': 'RC-12',
};

function known(map, value, label) {
  if (!Object.prototype.hasOwnProperty.call(map, value)) {
    throw new Error(`bl898 rc-failed-auto-repair: unrecognized ${label} "${value}"`);
  }
  return map[value];
}

function knownSet(set, value, label) {
  if (!set.has(value)) {
    throw new Error(`bl898 rc-failed-auto-repair: unrecognized ${label} "${value}"`);
  }
  return value;
}

function runSuite() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl898?.result) {
    ctx.bl898 = { ...(ctx.bl898 || {}), result: runSuite() };
  }
  return ctx.bl898.result;
}

function requirePass(ctx, marker, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${marker}`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

function stateMarker(ctx) {
  const marker = STATE_TO_MARKER[ctx.bl898?.state];
  if (!marker) {
    throw new Error(`bl898: no remote-control state established before this step (ctx.bl898.state=${JSON.stringify(ctx.bl898?.state)})`);
  }
  return marker;
}

function registerSteps(registry) {
  registry.defineScoped(/^a swarm whose roles are launched with remote control enabled$/, (ctx) => {
    ctx.bl898 = {};
  }, FEATURE);

  // ── scenario outline 01: classification + trigger decision ───────────────
  registry.defineScoped(/^the role's remote-control state is (.+)$/, (ctx, state) => {
    if (!Object.prototype.hasOwnProperty.call(STATE_TO_MARKER, state)) {
      throw new Error(`bl898 rc-failed-auto-repair: unrecognized remote-control state "${state}"`);
    }
    ctx.bl898 = { ...(ctx.bl898 || {}), state };
  }, FEATURE);

  registry.defineScoped(/^the remote-control health of that role is classified$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the role is reported as (.+)$/, (ctx, status) => {
    knownSet(KNOWN_STATUSES, status, 'reported status');
    requirePass(ctx, stateMarker(ctx), `the role reported as "${status}"`);
  }, FEATURE);

  registry.defineScoped(/^dead-session repair (is triggered|is not triggered)$/, (ctx, repair) => {
    knownSet(KNOWN_REPAIR_VALUES, repair, 'repair trigger');
    requirePass(ctx, stateMarker(ctx), `dead-session repair "${repair}"`);
  }, FEATURE);

  // ── scenario outline 02: idle-safe repair ─────────────────────────────────
  registry.defineScoped(/^a role reported as session-dead whose agent is busy$/, (ctx) => {
    ctx.bl898 = { ...(ctx.bl898 || {}) };
  }, FEATURE);

  registry.defineScoped(/^that agent (.+)$/, (ctx, idles) => {
    ctx.bl898 = { ...(ctx.bl898 || {}), idleMarker: known(IDLES_TO_MARKER, idles, 'idle timing') };
  }, FEATURE);

  registry.defineScoped(/^dead-session repair runs$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the agent is never interrupted mid-turn$/, (ctx) => {
    requirePass(ctx, ctx.bl898?.idleMarker, 'the agent never being interrupted mid-turn');
  }, FEATURE);

  registry.defineScoped(/^the role is (respawned|left running and reported unrepaired)$/, (ctx, outcome) => {
    const marker = known(OUTCOME_TO_MARKER, outcome, 'repair outcome');
    requirePass(ctx, marker, `the role being "${outcome}"`);
  }, FEATURE);

  // ── scenario outline 03: human is always told the outcome ────────────────
  registry.defineScoped(/^a role reported as session-dead whose agent has been respawned$/, (ctx) => {
    ctx.bl898 = { ...(ctx.bl898 || {}) };
  }, FEATURE);

  registry.defineScoped(/^the new session address is (readable|not readable)$/, (ctx, address) => {
    ctx.bl898 = { ...(ctx.bl898 || {}), addressMarker: known(ADDRESS_TO_MARKER, address, 'address readability') };
  }, FEATURE);

  registry.defineScoped(/^the repair completes$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the human is notified that the role's remote control was repaired$/, (ctx) => {
    requirePass(ctx, ctx.bl898?.addressMarker, "the human being notified that the role's remote control was repaired");
  }, FEATURE);

  registry.defineScoped(/^the notification carries (.+)$/, (ctx, carried) => {
    const marker = known(CARRIED_TO_MARKER, carried, 'notification content');
    requirePass(ctx, marker, `the notification carrying "${carried}"`);
  }, FEATURE);
}

module.exports = { registerSteps };
