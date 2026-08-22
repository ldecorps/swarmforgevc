'use strict';

// BL-796: step handlers for "Daemon and cron start paths resolve node as
// well as bb" - the 2026-08-03 nvm-node PATH follow-up (operator_path_lib.sh),
// adopted/reviewed under this ticket. Same BL-789-established pattern: every
// scenario drives the REAL swarmforge/scripts/test/test_daemon_log_freshness.sh
// suite (this very ticket extended it with the BL-796-0N checks these steps
// assert on) and greps its own PASS lines rather than reimplementing the
// fixtures a second time here.
//
// Every registration is scoped to FEATURE_NAME (registry.defineScoped) -
// several step phrasings here ("the freshness cron is installed" and
// similar) are plausible enough that an unscoped registration could collide
// with BL-675/BL-783/BL-789's own near-identical wording.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE_NAME = 'Daemon and cron start paths resolve node as well as bb';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SHELL_SUITE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_daemon_log_freshness.sh');

function runShellSuite(ctx) {
  if (ctx.suiteOutput !== undefined) return ctx.suiteOutput;
  const result = spawnSync('bash', [SHELL_SUITE], { encoding: 'utf8', timeout: 120000, env: process.env });
  ctx.suiteOutput = `${result.stdout || ''}${result.stderr || ''}`;
  ctx.suiteExit = result.status;
  return ctx.suiteOutput;
}

function expectFragment(ctx, fragment, label) {
  const output = runShellSuite(ctx);
  if (!output.includes(fragment)) {
    throw new Error(`BL-796: expected "${fragment}" (${label}) in test_daemon_log_freshness.sh output, got:\n${output}`);
  }
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  // Nothing to set up here - the shell suite builds its own project root
  // and fake nvm tree (make_root / make_fake_nvm_home) per scenario; real
  // driving happens in each scenario's own Then step below, matching the
  // codebase's established "collect Givens, assert in Then" convention for
  // multi-clause scenarios (see BL-789 steps).
  registry.defineScoped(/^a project root with a daemon state directory$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^a fake nvm tree containing node versions "([^"]+)" and "([^"]+)"$/, () => {}, FEATURE_NAME);

  // ── scenario 01: freshness restart resolves node ───────────────────────
  registry.defineScoped(/^the freshness check is invoked with PATH set to "([^"]+)"$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^the freshness check restarts a stale daemon$/, () => {}, FEATURE_NAME);
  registry.defineScoped(
    /^the restart command inherits a PATH on which "node" resolves$/,
    (ctx) => {
      expectFragment(
        ctx,
        'PASS: BL-796-01: a freshness restart hands the daemon a PATH that resolves node',
        'freshness restart resolves node'
      );
    },
    FEATURE_NAME
  );

  // ── scenario 02: daemon start script pins node before launching ────────
  registry.defineScoped(
    /^the daemon start script is invoked with a PATH that resolves "bb" but not "node"$/,
    () => {},
    FEATURE_NAME
  );
  registry.defineScoped(/^the daemon start script launches the daemon$/, () => {}, FEATURE_NAME);
  registry.defineScoped(
    /^the launched daemon inherits a PATH on which "node" resolves$/,
    (ctx) => {
      expectFragment(
        ctx,
        'PASS: BL-796-02: the daemon start script pins node before launching the daemon',
        'start script pins node before launch'
      );
    },
    FEATURE_NAME
  );

  // ── scenario 03: installer bakes node dir when node is nvm-only ────────
  registry.defineScoped(/^"node" is reachable only through the fake nvm tree$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^the freshness cron is installed$/, () => {}, FEATURE_NAME);
  registry.defineScoped(
    /^the crontab entry sets a PATH containing the resolved nvm node bin directory$/,
    (ctx) => {
      expectFragment(
        ctx,
        'PASS: BL-796-03: the installed crontab line bakes a node directory when node is nvm-only',
        'crontab bakes nvm node dir'
      );
    },
    FEATURE_NAME
  );

  // ── scenario 04/05: nvm resolver version ordering (shared Then step) ───
  registry.defineScoped(/^the nvm default alias names "([^"]+)"$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^no nvm default alias exists$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^the nvm node bin directory is resolved$/, () => {}, FEATURE_NAME);
  registry.defineScoped(
    /^the resolved bin directory belongs to version "([^"]+)"$/,
    (ctx, version) => {
      if (version === 'v9.11.2') {
        expectFragment(
          ctx,
          'PASS: BL-796-04: the nvm default alias wins over a newer installed version',
          'alias wins over newer version'
        );
      } else if (version === 'v22.1.0') {
        expectFragment(
          ctx,
          'PASS: BL-796-05: without an alias the newest version wins by version order',
          'no-alias picks newest by version order'
        );
      } else {
        throw new Error(`BL-796: unexpected version "${version}" in "the resolved bin directory belongs to version" Then step`);
      }
    },
    FEATURE_NAME
  );

  // ── scenario 06: caller's own node is never shadowed by the nvm fallback ─
  registry.defineScoped(/^"node" also resolves on the caller's PATH outside the nvm tree$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^the operator bins are prepended$/, () => {}, FEATURE_NAME);
  registry.defineScoped(
    /^"node" resolves to the caller's node and not to an nvm one$/,
    (ctx) => {
      expectFragment(
        ctx,
        'PASS: BL-796-06: a node already on the caller PATH is never shadowed by the nvm fallback',
        'caller node never shadowed'
      );
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
