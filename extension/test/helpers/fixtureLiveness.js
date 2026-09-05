'use strict';

// BL-1292: a bare `process.kill(pid, 0)` answers "does SOME process with
// this pid exist and can I signal it?", not "is THIS fixture still
// running?" - a zombie awaiting its reaper (SIGKILLed, corpse not yet
// collected) and a pid reused by an unrelated process both answer the
// bare form's question `true` while the fixture itself is gone. Identity
// is confirmed by requiring the pid's own command line still carries this
// fixture's unique tunnel name: `ps -o args=` is POSIX and works on both
// supported OSes (the same portability lesson BL-1061 already paid for in
// bl857TunnelOwnershipInvariants.property.test.js; `/proc/<pid>/cmdline`
// is Linux-only). A zombie's `ps -o args=` output is empty/`<defunct>`,
// never the original argv, and an unrelated process at a reused pid is
// running a different command entirely - both correctly fail the
// identity check.
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');

function isAlive(pid, name) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const args = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
    return args.includes(name);
  } catch {
    return false;
  }
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

// A genuine zombie: the outer bash stays alive (its own trailing `sleep`)
// as the backgrounded child's parent, deliberately never calling `wait` on
// it, so the child - which exits almost immediately - remains an unreaped
// zombie until the outer bash itself exits or is killed. Confirmed via
// /proc/<pid>/status's own `State: Z` line, never inferred from timing
// alone. Linux-only (/proc); every current caller runs in CI/dev Linux
// containers, matching this repo's own "macOS and Linux only" target.
function spawnZombie(name, { confirmTimeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const outer = spawn('bash', ['-c', `exec -a "$1" sleep 0.05 & echo $!; sleep 5`, '_', name], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    outer.stdout.on('data', (d) => {
      out += d.toString();
    });
    outer.stdout.once('data', () => {
      setTimeout(() => {
        const zombiePid = Number(out.trim());
        if (!zombiePid) {
          reject(new Error(`failed to capture zombie pid from output: ${JSON.stringify(out)}`));
          return;
        }
        let confirmed = false;
        const start = Date.now();
        while (Date.now() - start < confirmTimeoutMs) {
          try {
            const status = fs.readFileSync(`/proc/${zombiePid}/status`, 'utf8');
            const m = status.match(/State:\s*(\S+)/);
            if (m && m[1].startsWith('Z')) {
              confirmed = true;
              break;
            }
          } catch {
            break;
          }
        }
        resolve({ pid: zombiePid, confirmedZombie: confirmed, cleanup: () => killPid(outer.pid) });
      }, 60);
    });
  });
}

module.exports = { isAlive, spawnZombie };
