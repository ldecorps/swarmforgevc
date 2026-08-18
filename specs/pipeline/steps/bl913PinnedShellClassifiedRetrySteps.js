'use strict';

// BL-913 (epic tool-miss-auto-heal, slice A): step handlers for "a
// recoverable tool miss is healed once from the pinned execution
// environment, and a real failure is returned honestly". Drives the REAL
// pure decision (tool_miss_heal_lib.bb's build-healing-wrapper-command) via
// tool_miss_heal_acceptance_runner.bb - the same Babashka-runner pattern
// bl412DiskSpaceEarlyWarningAlertSteps.js already established - never a
// hand-rolled JS reimplementation of the classify/heal logic. The runner
// executes the REAL generated bash wrapper against a scripted fixture, so
// this proves the actual product's own bash-level behavior, not a JS model
// of it. The PreToolUse hook's own I/O boundary (stdin/stdout JSON,
// SWARMFORGE_ROLE_WORKTREE) is proven separately by
// swarmforge/scripts/test/test_tool_miss_heal_hook_wiring.sh.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'tool_miss_heal_acceptance_runner.bb');

// The Scenario Outline's own <miss> -> <healed environment> mapping,
// validated against explicit KNOWN_VALUES rather than branching on scenario
// shape - a mutated Examples cell fails loudly here (engineering article's
// own Scenario Outline rule).
const KNOWN_MISS_ENVIRONMENTS = new Map([
  ['wrong-cwd', "the role's own worktree"],
  ['wrong-surface', 'the extension directory'],
  ['missing-root-argv', 'the same place, with the project root supplied'],
]);

function knownEnvironment(miss) {
  if (!KNOWN_MISS_ENVIRONMENTS.has(miss)) {
    throw new Error(`tool-miss-heal: unrecognized miss class "${miss}"`);
  }
  return KNOWN_MISS_ENVIRONMENTS.get(miss);
}

function runScenario(miss, healOutcome) {
  const out = execFileSync('bb', [RUNNER, JSON.stringify({ miss, healOutcome })], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^a role whose pinned execution environment is its own worktree$/, (ctx) => {
    ctx.healOutcome = null;
  });

  // ── a-recoverable-miss-is-healed-once-01 (Scenario Outline) ─────────
  registry.define(/^a command that misses because of "([^"]+)"$/, (ctx, miss) => {
    ctx.miss = miss;
    ctx.healOutcome = 'succeeds';
  });

  registry.define(/^the role runs that command$/, (ctx) => {
    ctx.result = runScenario(ctx.miss, ctx.healOutcome);
  });

  registry.define(/^the command is re-run once from "([^"]+)"$/, (ctx, healedEnv) => {
    const expected = knownEnvironment(ctx.miss);
    if (healedEnv !== expected) {
      throw new Error(
        `tool-miss-heal: Examples table names "${healedEnv}" for miss "${ctx.miss}", but KNOWN_VALUES says "${expected}"`
      );
    }
    if (!ctx.result.reRun || ctx.result.invocationCount !== 2) {
      throw new Error(`expected exactly one re-run, got invocationCount=${ctx.result.invocationCount}`);
    }
    if (ctx.miss === 'wrong-cwd' && !ctx.result.healedFromRoleWorktree) {
      throw new Error(`expected the re-run from the role's own worktree, got: ${ctx.result.finalOutput}`);
    }
    if (ctx.miss === 'wrong-surface' && !ctx.result.healedFromExtensionDir) {
      throw new Error(`expected the re-run from the extension directory, got: ${ctx.result.finalOutput}`);
    }
    if (ctx.miss === 'missing-root-argv' && !ctx.result.gotProjectRootArg) {
      throw new Error(`expected the re-run to receive the project root as an argument, got: ${ctx.result.finalOutput}`);
    }
  });

  registry.define(/^the model receives only the healed result$/, (ctx) => {
    if (!ctx.result.finalOutput.startsWith('HEALED-OK')) {
      throw new Error(`expected the model to receive only the healed result, got: ${ctx.result.finalOutput}`);
    }
  });

  // ── a-real-failure-is-returned-as-it-happened-02 ─────────────────────
  registry.define(/^a command that fails for a reason outside the recoverable classes$/, (ctx) => {
    ctx.miss = 'real-failure';
    ctx.healOutcome = null;
  });

  registry.define(/^the command is not re-run$/, (ctx) => {
    if (ctx.result.reRun) {
      throw new Error(`expected the command not to be re-run, got invocationCount=${ctx.result.invocationCount}`);
    }
  });

  registry.define(/^the model receives that failure exactly once$/, (ctx) => {
    if (ctx.result.invocationCount !== 1) {
      throw new Error(`expected exactly one invocation, got ${ctx.result.invocationCount}`);
    }
    if (ctx.result.finalExit === 0) {
      throw new Error('expected the real failure to be returned as a failure, got exit 0');
    }
  });

  // ── one-retry-then-stop-03 ────────────────────────────────────────────
  registry.define(/^the healed re-run misses the same way$/, (ctx) => {
    ctx.healOutcome = 'fails-again';
  });

  registry.define(/^the command is not re-run a second time$/, (ctx) => {
    if (ctx.result.invocationCount !== 2) {
      throw new Error(`expected exactly two invocations (the miss + one heal, never a third), got ${ctx.result.invocationCount}`);
    }
  });

  registry.define(/^the model receives the failure of the healed re-run$/, (ctx) => {
    if (ctx.result.finalExit === 0) {
      throw new Error('expected the healed re-run to have failed too, got exit 0');
    }
    if (ctx.result.finalOutput.includes('HEALED-OK')) {
      throw new Error('expected the healed re-run to have failed, not succeeded');
    }
  });

  // ── a-command-that-works-is-left-alone-04 ────────────────────────────
  registry.define(/^a command that succeeds as issued$/, (ctx) => {
    ctx.miss = 'succeeds';
    ctx.healOutcome = null;
  });

  registry.define(/^the model receives the result of the command as issued$/, (ctx) => {
    if (ctx.result.invocationCount !== 1 || !ctx.result.finalOutput.startsWith('FIRST-OK')) {
      throw new Error(`expected the untouched result of the command as issued, got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
