'use strict';

// BL-459: step handlers for "shell and babashka test harnesses clean up the
// temp dirs they create". Scenario 01 drives REAL demonstration harnesses
// (bl459ShellHarness.sh / bl459BbHarness.bb) that source/use the SAME real
// shared cleanup mechanisms (swarmforge/scripts/test/lib/tmp_cleanup.sh's
// EXIT trap; the JVM shutdown-hook pattern) the 26 shell + 11 babashka real
// test harnesses were migrated onto - never a hand-rolled substitute for
// the actual mechanism. Scenario 02 drives the REAL pure regression guard
// (specs/pipeline/steps/lib/tempDirTrapGuard.js) against the real
// swarmforge/scripts tree.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scanForTempDirTrapViolations } = require('./lib/tempDirTrapGuard');

const SHELL_HARNESS = path.join(__dirname, 'lib', 'bl459ShellHarness.sh');
const BB_HARNESS = path.join(__dirname, 'lib', 'bl459BbHarness.bb');
const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_HARNESS_RUNNERS = {
  shell: (mode) => execFileSync('bash', [SHELL_HARNESS, mode], { encoding: 'utf8' }),
  babashka: (mode) => execFileSync('bb', [BB_HARNESS, mode], { encoding: 'utf8' }),
};

const KNOWN_EXIT_MODES = new Set(['clean', 'failing']);

function registerSteps(registry) {
  // ── tempdir-cleanup-trap-01 (Scenario Outline) ──────────────────────────
  registry.define(/^a "([^"]+)" test harness that creates a temp root under \/tmp$/, (ctx, harnessKind) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_HARNESS_RUNNERS, harnessKind)) {
      throw new Error(`tempdir-cleanup-trap-01: unrecognized <harness_kind> example value "${harnessKind}"`);
    }
    ctx.harnessKind = harnessKind;
  });

  registry.define(/^the harness exits "([^"]+)"$/, (ctx, exitMode) => {
    if (!KNOWN_EXIT_MODES.has(exitMode)) {
      throw new Error(`tempdir-cleanup-trap-01: unrecognized <exit_mode> example value "${exitMode}"`);
    }
    const run = KNOWN_HARNESS_RUNNERS[ctx.harnessKind];
    try {
      ctx.output = run(exitMode);
    } catch (err) {
      // A "failing" exit mode deliberately makes the harness exit non-zero -
      // execFileSync throws in that case, but its stdout (the created
      // root's path, printed BEFORE the forced failure) is still on the
      // error object.
      ctx.output = (err.stdout || '').toString();
    }
    ctx.createdRoot = ctx.output.trim().split('\n')[0];
    if (!ctx.createdRoot) {
      throw new Error(`expected the harness to print its created temp root, got: ${JSON.stringify(ctx.output)}`);
    }
  });

  registry.define(/^its temp root is removed$/, (ctx) => {
    if (fs.existsSync(ctx.createdRoot)) {
      throw new Error(`expected ${ctx.createdRoot} to be removed after the harness exited, but it still exists`);
    }
  });

  // ── tempdir-cleanup-trap-02 ──────────────────────────────────────────────
  registry.define(/^the shell and babashka test harnesses under swarmforge\/scripts$/, (ctx) => {
    ctx.scriptsDir = SCRIPTS_DIR;
  });

  registry.define(/^each harness that creates a mktemp or create-temp-dir root is inspected$/, (ctx) => {
    ctx.violations = scanForTempDirTrapViolations(ctx.scriptsDir);
  });

  registry.define(/^it registers a cleanup trap that removes that root on exit$/, (ctx) => {
    if (ctx.violations.length > 0) {
      throw new Error(
        `expected zero harnesses without a cleanup trap, found:\n${ctx.violations.map((v) => `${v.file}: ${v.reason}`).join('\n')}`
      );
    }
  });
}

module.exports = { registerSteps };
