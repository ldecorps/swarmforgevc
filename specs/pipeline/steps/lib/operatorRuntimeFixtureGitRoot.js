'use strict';

// BL-1738: the shared fixture-root helper for every acceptance step handler
// that spawns swarmforge/scripts/operator_runtime.bb (or another CLI gated
// by project_root_arg_lib.bb's default :repository strictness) against a
// fixture project root. Since BL-1517 (2026-09-22, 3252212a66) that CLI
// refuses a root that is not itself a git checkout - `git -C <root>
// rev-parse --git-common-dir` must succeed. Fourteen handlers built their
// roots with a bare mkdtemp and never git-init'd them, so 43 of their
// scenarios failed with "REFUSED project-root ...: not inside a git
// checkout" (specifier census, 2026-09-25, backlog/active/BL-1738-...yaml).
//
// Two entry points, so a handler that already builds its root through
// ANOTHER shared helper (mkSocketFixtureRoot's short-base/socket-length
// guard, BL-948) still routes through this one too: mkFixtureGitRoot(prefix)
// for the common case (a fresh mkdtemp under os.tmpdir()), and
// gitifyFixtureRoot(root) to turn an ALREADY-BUILT directory into the same
// isolated git checkout, so a handler can compose it with mkSocketFixtureRoot
// without losing that helper's own guarantees.
//
// BL-1390: proven isolated (git-common-dir resolves inside the root) BEFORE
// any other git command ever runs against it - the same posture
// bl1563FixtureHelpers.js's own proveFixtureIsolated/initFixtureRoot
// established; this is a SEPARATE module (not a reach into BL-1563's own
// helper file) since these are an unrelated ticket's fixtures and the
// pattern is small enough that a second small copy costs less than coupling
// fifteen unrelated step files to one ticket's private helper.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

function proveFixtureIsolated(root) {
  // BL-1390: a fresh mkdtemp dir - `git init` here can never touch the live
  // checkout - proven BEFORE any further mutating git command.
  const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

// Turns an already-built directory into an isolated git checkout: `git
// init`, proven isolated, then one empty commit so HEAD resolves (a bare,
// commit-less repo is still a valid :repository per project_root_arg_lib.bb,
// but several fixtures go on to read/diff HEAD, so every root gets one).
function gitifyFixtureRoot(root) {
  execFileSync('git', ['init', '-q', root]);
  proveFixtureIsolated(root);
  execFileSync('git', ['-C', root, '-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

// The common case: a fresh mkdtemp root, already an isolated git checkout.
function mkFixtureGitRoot(prefix, base) {
  const root = fs.mkdtempSync(path.join(base || os.tmpdir(), prefix));
  return gitifyFixtureRoot(root);
}

module.exports = { proveFixtureIsolated, gitifyFixtureRoot, mkFixtureGitRoot };
