'use strict';

// BL-934: step handlers for "a heal wrapper for rm of non-worktree paths
// does not look like rm of the worktree". Drives the REAL
// build-healing-wrapper-command (tool_miss_heal_lib.bb) via
// bl934_heal_wrapper_source_runner.bb - same JSON-bridge pattern
// tool_miss_heal_acceptance_runner.bb (BL-913) already established - never
// a hand-rolled JS reimplementation of the classify/heal logic. Scenario
// 03's steps ("the role runs that command" / "the command is re-run once
// from..." / "the model receives only the healed result") are the exact
// text bl913PinnedShellClassifiedRetrySteps.js already registers
// (unscoped) - this file only sets up ctx.miss/ctx.healOutcome the same
// way that file's own equivalent Given does, and lets resolve()'s
// scoped-then-unscoped fallback find BL-913's existing registrations for
// the rest, rather than re-registering identical step text a second time.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SOURCE_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl934_heal_wrapper_source_runner.bb');

const FEATURE_NAME = 'a heal wrapper for rm of non-worktree paths does not look like rm of the worktree';

const PINNED_WORKTREE = '/Users/ldecorps/projects/swarmforgevc';

function generateWrapper(original, worktree) {
  const out = execFileSync('bb', [SOURCE_RUNNER, JSON.stringify({ original, worktree })], { encoding: 'utf8' });
  return JSON.parse(out).wrapper;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a pinned worktree used by the Bash PreToolUse heal wrapper$/,
    (ctx) => {
      ctx.worktree = PINNED_WORKTREE;
    },
    FEATURE_NAME
  );

  // ── heal-wrapper-must-not-look-like-rm-of-the-worktree-01 ───────────
  registry.defineScoped(
    /^an original command that removes a relative temp file$/,
    (ctx) => {
      ctx.original = 'rm -f tmp/bl934-probe.json';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the PreToolUse heal wrapper is generated for that command$/,
    (ctx) => {
      ctx.wrapper = generateWrapper(ctx.original, ctx.worktree);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the wrapper source does not present the pinned worktree as an extra argument to that command$/,
    (ctx) => {
      const forbidden = `${ctx.original} '${ctx.worktree}'`;
      if (ctx.wrapper.includes(forbidden)) {
        throw new Error(
          `bl934: expected the wrapper to never concatenate the original command with the pinned worktree, but found: ${JSON.stringify(forbidden)}\nwrapper:\n${ctx.wrapper}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── heal-wrapper-must-not-look-like-rm-of-the-worktree-02 ───────────
  registry.defineScoped(
    /^an original command that removes the pinned worktree$/,
    (ctx) => {
      ctx.original = `rm -rf ${ctx.worktree}`;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the original command still appears as a command in the wrapper source$/,
    (ctx) => {
      if (!ctx.wrapper.includes(ctx.original)) {
        throw new Error(
          `bl934: expected the original command to remain visible verbatim in the wrapper, got:\n${ctx.wrapper}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── heal-wrapper-must-not-look-like-rm-of-the-worktree-03 ────────────
  // Sets up ctx exactly as bl913PinnedShellClassifiedRetrySteps.js's own
  // `^a command that misses because of "([^"]+)"$` Given does - the
  // remaining steps in this scenario resolve to THAT file's unscoped
  // registrations (stepRegistry's scoped-then-unscoped fallback).
  registry.defineScoped(
    /^an original command that misses because of "missing-root-argv" and is not an rm$/,
    (ctx) => {
      ctx.miss = 'missing-root-argv';
      ctx.healOutcome = 'succeeds';
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
