'use strict';

// BL-1066 invariant 3: "every git child this path spawns is reaped; a
// completed computation leaves no defunct git process behind".
//
// Scoped strictly to THIS process's own direct children (`pgrep -P <pid>`),
// never a pattern match over every process on the host - a broad `ps`/pgrep
// pattern would make the verdict depend on whatever else the machine is
// running, which is the opposite of what a test should measure.
//
// A zombie still has a process table entry, so it is listed by pgrep and
// carries state `Z` in ps - both of which this reports.

const { execFileSync } = require('node:child_process');

function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    // pgrep exits 1 with no output when nothing matches; ps exits non-zero
    // when a pid has already gone. Both are "nothing to report", not errors.
    return err.stdout || '';
  }
}

function childPids(pid = process.pid) {
  return run('pgrep', ['-P', String(pid)])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map(Number);
}

// [{ pid, state }] for this process's direct children. `state` is ps's STAT
// field; a leading 'Z' is a defunct (unreaped) child.
function childProcesses(pid = process.pid) {
  const pids = childPids(pid);
  if (pids.length === 0) {
    return [];
  }
  return run('ps', ['-o', 'pid=', '-o', 'state=', '-p', pids.join(',')])
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && /^\d+$/.test(cols[0]))
    .map(([childPid, state]) => ({ pid: Number(childPid), state }));
}

function defunctChildren(pid = process.pid) {
  return childProcesses(pid).filter((child) => child.state.startsWith('Z'));
}

module.exports = { childPids, childProcesses, defunctChildren };
