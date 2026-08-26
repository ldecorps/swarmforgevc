'use strict';

// BL-928: step handlers for "An onboarder supervisor start leaves exactly
// one live reconcile poll-loop for its own root". Drives the REAL
// test_onboarder_supervisor_tick.sh (real bb supervisor process, real
// orphaned Node.js poll-loop children via a genuine PPID-1 double-fork) -
// never a parallel reimplementation of the reap decision. Same one-full-
// run-memoized-per-scenario pattern as bl805/bl926's own step handlers,
// adapted to this file's own "ok   - <description>" / "FAIL - <description>"
// check() output shape (not the "PASS: <marker>" shape those two use).
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_onboarder_supervisor_tick.sh');
const FEATURE = 'An onboarder supervisor start leaves exactly one live reconcile poll-loop for its own root';

const KNOWN_CANDIDATES = new Set([
  'onboarder-reconcile poll-loop whose parent process is still alive',
  'onboarder-reconcile poll-loop for a different swarm repo root',
  'orphaned node process for that swarm repo root that is not a poll-loop',
]);

function runReapTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8', timeout: 120000 });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl928.result) {
    ctx.bl928.result = runReapTest();
  }
  return ctx.bl928.result;
}

function requireOk(ctx, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`ok   - ${description}`)) {
    throw new Error(`expected check to pass: "${description}"\n${stdout}`);
  }
}

// Explicit KNOWN_VALUES table: (scenario key) -> the shell script's own
// check description strings that prove it. Never a passthrough - an
// unrecognized ctx.bl928.scenario throws.
const SCENARIO_CHECKS = {
  'reap-01': {
    reaped: '04: both pre-existing orphaned poll-loops for this root are gone after startup',
    spawnedChild: '04: the supervisor spawned its own child (status running)',
    exactlyOne: '04: exactly one pid is recorded for the supervised child, and it is alive',
  },
  'parent-alive': {
    survives: "05: supervisor 1's own live child is still alive after supervisor 2's startup sweep",
    spawnedChild: '05: supervisor 2 also starts and spawns/adopts its own running child',
  },
  'different-root': {
    survives: '06: an orphaned poll-loop for a DIFFERENT fixture root is untouched',
    spawnedChild: '06: the supervisor still starts and spawns its own child',
  },
  'not-a-poll-loop': {
    survives: '08: an orphaned node process for this root that is NOT the poll-loop subcommand is untouched',
    spawnedChild: '08: the supervisor still starts and spawns its own child',
  },
  unreadable: {
    noReap: '07: a real orphaned poll-loop is NOT reaped when the process-table read is forced unreadable',
    spawnedChild: '07: the supervisor still starts and spawns its own child despite the unreadable table',
    logsFailure: '07: the log names the process-table read failure',
  },
  clean: {
    noReap: '07: a clean run reaps nothing (no reaped log line either)',
    spawnedChild: '07: the supervisor still starts and spawns its own child on a clean host',
    noFailureLogged: '07: a clean run with no siblings and a readable table never logs the unreadable-table line',
  },
};

function scenarioChecks(ctx) {
  const checks = SCENARIO_CHECKS[ctx.bl928.scenario];
  if (!checks) {
    throw new Error(`BL-928: no known scenario for ${JSON.stringify(ctx.bl928)}`);
  }
  return checks;
}

function registerSteps(registry) {
  registry.defineScoped(/^an onboarder supervisor about to start for a swarm repo root$/, (ctx) => {
    ctx.bl928 = {};
  }, FEATURE);

  registry.defineScoped(/^two orphaned onboarder-reconcile poll-loop processes for that swarm repo root$/, (ctx) => {
    ctx.bl928 = { ...(ctx.bl928 || {}), scenario: 'reap-01' };
  }, FEATURE);

  registry.defineScoped(/^one (.+) process$/, (ctx, candidate) => {
    if (!KNOWN_CANDIDATES.has(candidate)) {
      throw new Error(`BL-928: unrecognized candidate "${candidate}"`);
    }
    const scenario = {
      'onboarder-reconcile poll-loop whose parent process is still alive': 'parent-alive',
      'onboarder-reconcile poll-loop for a different swarm repo root': 'different-root',
      'orphaned node process for that swarm repo root that is not a poll-loop': 'not-a-poll-loop',
    }[candidate];
    ctx.bl928 = { ...(ctx.bl928 || {}), scenario };
  }, FEATURE);

  registry.defineScoped(/^the host process table cannot be enumerated$/, (ctx) => {
    ctx.bl928 = { ...(ctx.bl928 || {}), unreadable: true };
  }, FEATURE);

  registry.defineScoped(/^one orphaned onboarder-reconcile poll-loop process for that swarm repo root$/, (ctx) => {
    if (!ctx.bl928?.unreadable) {
      throw new Error('BL-928: expected the "process table cannot be enumerated" Given to precede this one');
    }
    ctx.bl928 = { ...(ctx.bl928 || {}), scenario: 'unreadable' };
  }, FEATURE);

  registry.defineScoped(/^no other onboarder-reconcile poll-loop process for that swarm repo root$/, (ctx) => {
    ctx.bl928 = { ...(ctx.bl928 || {}), scenario: 'clean' };
  }, FEATURE);

  registry.defineScoped(/^the onboarder supervisor starts$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^both orphaned poll-loop processes are dead$/, (ctx) => {
    requireOk(ctx, scenarioChecks(ctx).reaped);
  }, FEATURE);

  registry.defineScoped(/^the supervisor starts and spawns its own child$/, (ctx) => {
    requireOk(ctx, scenarioChecks(ctx).spawnedChild);
  }, FEATURE);

  registry.defineScoped(/^exactly one live onboarder-reconcile poll-loop process remains for that swarm repo root$/, (ctx) => {
    requireOk(ctx, scenarioChecks(ctx).exactlyOne);
  }, FEATURE);

  registry.defineScoped(/^the supervisor status file records exactly one live pid$/, (ctx) => {
    requireOk(ctx, scenarioChecks(ctx).exactlyOne);
  }, FEATURE);

  registry.defineScoped(/^that process is still alive$/, (ctx) => {
    requireOk(ctx, scenarioChecks(ctx).survives);
  }, FEATURE);

  registry.defineScoped(/^no process is reaped$/, (ctx) => {
    requireOk(ctx, scenarioChecks(ctx).noReap);
  }, FEATURE);

  registry.defineScoped(/^the supervisor log records that the sweep could not read the process table$/, (ctx) => {
    requireOk(ctx, scenarioChecks(ctx).logsFailure);
  }, FEATURE);

  registry.defineScoped(/^the supervisor log records no process-table read failure$/, (ctx) => {
    requireOk(ctx, scenarioChecks(ctx).noFailureLogged);
  }, FEATURE);
}

module.exports = { registerSteps };
