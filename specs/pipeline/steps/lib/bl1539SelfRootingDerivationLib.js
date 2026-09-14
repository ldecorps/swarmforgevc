'use strict';

// BL-1539: the guard-invocation helpers shared between the feature's step
// handlers (bl1539DispatchIsolationDerivationSteps.js) and the ticket's
// declared-invariant property test (extension/test/bl1539SelfRootingDerivationStability.property.test.js,
// coder Invariants contract, BL-654). Both need "run the REAL guard and
// read its step-1 self-rooting derivation" - kept here once so neither
// reimplements the `bash -x` trace parse, and no third copy can drift from
// what the guard actually does.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GUARD_NAME = 'test_shell_fixture_dispatch_isolation.sh';
const REAL_GUARD = path.join(REAL_SCRIPTS_DIR, 'test', GUARD_NAME);

// Runs the guard under `bash -x` and reads the FIRST `SELF_ROOTING=` trace -
// step 1's derivation (self_rooting_scripts()), before step 1b's closure
// loop mutates it further. bash -x only quotes the traced value when it
// needs quoting: a single-entry set prints `+ SELF_ROOTING=name` with no
// quotes, a multi-line set prints `+ SELF_ROOTING='name1\nname2\n...'` -
// both shapes are matched. maxBuffer is generous: tracing the guard's own
// offence scan over a real test/ dir produces well over 1 MB of -x output.
function deriveSelfRooting(guardPath) {
  const { stdout, stderr } = spawnSync('bash', ['-x', guardPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const trace = `${stdout}\n${stderr}`;
  const match = trace.match(/\n\+ SELF_ROOTING=(?:'([^']*)'|(\S+))/);
  if (!match) {
    throw new Error(
      `could not find the guard's self-rooting derivation in its -x trace (first/last 2000 chars):\n${trace.slice(0, 2000)}\n...\n${trace.slice(-2000)}`
    );
  }
  const raw = match[1] !== undefined ? match[1] : match[2];
  return raw.split('\n').filter(Boolean);
}

// A synthetic `scripts/` dir holding only the REAL guard (copied into its
// own `test/` subdir, matching production layout) - callers add whichever
// real or synthetic scripts they want the derivation to see.
function synthScriptsDir(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.copyFileSync(REAL_GUARD, path.join(root, 'test', GUARD_NAME));
  return root;
}

module.exports = {
  REPO_ROOT,
  REAL_SCRIPTS_DIR,
  GUARD_NAME,
  REAL_GUARD,
  deriveSelfRooting,
  synthScriptsDir,
};
