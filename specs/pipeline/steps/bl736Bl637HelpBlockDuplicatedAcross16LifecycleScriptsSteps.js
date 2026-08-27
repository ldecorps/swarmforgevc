'use strict';

// BL-736: lifecycle scripts share one sourced print_lifecycle_help helper.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SUITE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_bl736_lifecycle_help.sh');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'lifecycle_help_lib.sh');
const FEATURE = 'lifecycle scripts share one sourced help helper instead of duplicate heredocs';

function runSuite(ctx) {
  if (ctx.bl736) return ctx.bl736;
  const result = spawnSync('bash', [SUITE], {
    encoding: 'utf8',
    timeout: 120000,
    env: process.env,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  ctx.bl736 = { status: result.status, out };
  if (result.status !== 0) {
    throw new Error(`BL-736 lifecycle help suite exited ${result.status}:\n${out}`);
  }
  return ctx.bl736;
}

function expectPass(ctx, fragment, label) {
  const { out } = runSuite(ctx);
  if (!out.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in suite output, got:\n${out}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(
    /^the BL-637 lifecycle scripts that embed the shared twelve-line help block$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^the lifecycle script tree is scanned for embedded help heredocs$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^no duplicate --help heredoc bodies remain across the affected scripts$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 01: no affected script embeds a duplicate --help heredoc body', '01');
    },
    FEATURE,
  );

  registry.defineScoped(
    /^each affected script is run with --help after the helper refactor$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^its output matches the pre-refactor --help output for that script$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 02: every affected script --help matches pre-refactor golden output', '02');
    },
    FEATURE,
  );

  registry.defineScoped(
    /^test_lifecycle_script_scope and sibling lifecycle shell tests run$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^they pass with the same behavior as before the refactor$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 03: test_lifecycle_script_scope and siblings pass unchanged', '03');
    },
    FEATURE,
  );

  registry.defineScoped(
    /^the shared lifecycle help helper under swarmforge\/scripts$/,
    (ctx) => {
      if (!require('node:fs').existsSync(LIB)) {
        throw new Error(`missing lifecycle help lib: ${LIB}`);
      }
      ctx.bl736LibReady = true;
    },
    FEATURE,
  );

  registry.defineScoped(
    /^each affected script handles -h or --help$/,
    (ctx) => {
      runSuite(ctx);
    },
    FEATURE,
  );

  registry.defineScoped(
    /^it sources and calls the helper with its script name and scope line$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 04: every affected script sources and calls the shared help helper', '04');
    },
    FEATURE,
  );

  registry.defineScoped(
    /^no script embeds the twelve-line heredoc locally$/,
    (ctx) => {
      expectPass(ctx, 'PASS: 01: no affected script embeds a duplicate --help heredoc body', '01-repeat');
    },
    FEATURE,
  );
}

module.exports = { registerSteps };
