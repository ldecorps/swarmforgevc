'use strict';

// BL-1652: unit coverage for the REAL lane_process_lib.bb detection (never
// the fake env-var seam chase_sweep_test_runner.bb/the acceptance feature
// use to drive the pure decision) - a real child process, its real cwd,
// scoped through the real process-table scan. Bounded and always killed in
// `finally`, never left running past the test.

const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LANE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'lane_process_lib.bb');

function laneRunning(worktree) {
  const script = `(load-file "${LANE_LIB}")\n(println (lane-process-lib/lane-running? "${worktree}"))`;
  return execFileSync('bb', ['-e', script], { encoding: 'utf8' }).trim() === 'true';
}

test('lane-process-lib/lane-running? detects a real matching process scoped to its cwd, and only that cwd', () => {
  const worktree = mkTmpDir('bl1652-lane-worktree-');
  const otherRoot = mkTmpDir('bl1652-lane-other-');
  // argv0 renamed to a recognised lane pattern (run_acceptance.sh); the
  // real program is just `sleep`, cwd pinned to the fixture worktree.
  const child = spawn('bash', ['-c', 'exec -a run_acceptance.sh sleep 30'], { cwd: worktree, stdio: 'ignore' });
  try {
    // Give /proc a moment to reflect the new process's cmdline/cwd.
    execFileSync('sleep', ['0.3']);
    assert.equal(laneRunning(worktree), true, 'expected a real run_acceptance.sh-named process under this cwd to be detected');
    assert.equal(laneRunning(otherRoot), false, 'expected an unrelated worktree path to read no lane running (scope boundary)');
  } finally {
    if (child.pid) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // already dead - fine
      }
    }
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(otherRoot, { recursive: true, force: true });
  }
});

test('lane-process-lib/lane-running? reads false when no lane process is running under the worktree', () => {
  const worktree = mkTmpDir('bl1652-lane-quiet-');
  try {
    assert.equal(laneRunning(worktree), false);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// BL-1673: the scanning bb process's own argv can satisfy lane-running?'s
// own two conditions - the `-e` form below names the worktree literally,
// and a trailing arg simulates the .stryker-tmp/ load-file path a real
// sandboxed probe carries - without lane-running? excluding its own pid,
// this reads true for an otherwise-quiet worktree (probe B,
// unowned-red-bl1652-role-lane-running-adjudication-specifier-20260921.md).
test('the scan never counts its own process', () => {
  const worktree = mkTmpDir('bl1652-lane-self-');
  try {
    const script = `(load-file "${LANE_LIB}")\n(println (lane-process-lib/lane-running? "${worktree}"))`;
    const out = execFileSync('bb', ['-e', script, '--', '/x/.stryker-tmp/sandbox-abc'], { encoding: 'utf8' }).trim();
    assert.equal(
      out,
      'false',
      'expected the scanning process itself - argv naming the worktree and carrying a .stryker-tmp/ token - to never count as a lane process running for that worktree'
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
