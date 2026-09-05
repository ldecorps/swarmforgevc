'use strict';

// BL-948: the shared fixture-root helper for acceptance fixtures that build
// or reference a control socket. Roots are created under a SHORT base
// (/tmp), never os.tmpdir() - macOS resolves the latter under
// /var/folders/<hash>/<hash>/T/, and a root there plus
// .swarmforge/tmux/<hash>.sock overruns swarm_socket_lib.bb's 100-char
// fail-closed guard (BL-367), so scenarios die on the refusal instead of
// what they assert. The guard itself is correct and must not be relaxed;
// the fixtures are what was wrong. Uniqueness per scenario stays mkdtemp's
// job - shortening never collapses two concurrent fixtures onto one path.
//
// Invariant 2 (BL-948): a fixture root is removed even when the scenario
// throws before its own cleanup - this helper tracks every root it hands
// out and removes the stragglers on process exit, reaping any fixture tmux
// server by SOCKET PATH first (BL-817/BL-458 hygiene, via the shared
// fixtureReaper). An adopter's own afterEach cleanup stays welcome and
// correct; this hook is the backstop for the throw paths, where a measured
// 236 of 287 step files had no finally at all (2026-08-18).

const fs = require('node:fs');
const path = require('node:path');
const { reap, onAbnormalExit } = require('./fixtureReaper');

const SHORT_FIXTURE_BASE = '/tmp';

// swarm_socket_lib.bb's bound, mirrored here only to ASSERT headroom at
// creation time (a failing assert names the misconfiguration loudly instead
// of letting a scenario die downstream on the guard's refusal).
const SOCKET_PATH_GUARD_LIMIT = 100;

// The longest control-socket suffix the swarm builds under a project root.
const WORST_CASE_SOCKET_SUFFIX = '/.swarmforge/tmux/4294967295.sock';

const trackedRoots = new Set();
let exitHookInstalled = false;

function removeStragglers() {
  for (const root of [...trackedRoots]) {
    try {
      reap(root);
    } catch {
      // reaping is best-effort on exit; removal below still runs
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // an unremovable root on exit must never mask the run's own verdict
    }
    trackedRoots.delete(root);
  }
}

// BL-1312: a bare process.on('exit', ...) never fires on SIGTERM/SIGINT -
// Node's default action for those terminates immediately without unwinding
// 'exit' hooks. This helper's cleanup used to run only by accident, when
// some OTHER step file loaded in the same process happened to also call
// fixtureReaper's track()/onAbnormalExit() (whose own SIGINT/SIGTERM
// handlers call process.exit(), which THEN unwinds 'exit' hooks). Routing
// through onAbnormalExit gives this the SAME exit/SIGINT/SIGTERM coverage
// track()/reap() already have - installed once globally regardless of how
// many callers register (installGlobalHandlersOnce), so this stays a
// single set of process-wide listeners exactly as invariant 2 requires.
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  onAbnormalExit(removeStragglers);
}

function mkSocketFixtureRoot(prefix) {
  installExitHook();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(SHORT_FIXTURE_BASE, prefix)));
  const worstCase = `${root}${WORST_CASE_SOCKET_SUFFIX}`;
  if (worstCase.length > SOCKET_PATH_GUARD_LIMIT) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(
      `mkSocketFixtureRoot: ${worstCase} is ${worstCase.length} chars - over the ` +
        `${SOCKET_PATH_GUARD_LIMIT}-char unix-socket guard; shorten the prefix "${prefix}"`
    );
  }
  trackedRoots.add(root);
  return root;
}

// For adopters that remove a root themselves mid-run (idempotent with the
// exit hook; rmSync force tolerates an already-removed root either way).
function releaseSocketFixtureRoot(root) {
  trackedRoots.delete(root);
}

module.exports = {
  SHORT_FIXTURE_BASE,
  SOCKET_PATH_GUARD_LIMIT,
  WORST_CASE_SOCKET_SUFFIX,
  mkSocketFixtureRoot,
  releaseSocketFixtureRoot,
};
