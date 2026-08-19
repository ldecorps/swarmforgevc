'use strict';

// BL-817: a standalone harness (not a step file - a separate Node process
// the acceptance step spawns and terminates in one of three ways) standing
// in for "a step handler has started a REAL fixture tmux server and
// registered it with the shared reaper" - proving track()/reap() actually
// cover every ending BL-817's own scenario 01 names, not just the one
// fixtureReaperAbnormalExitHarness.js (BL-458) already proves (SIGTERM).
// Mirrors that harness's shape (real tmux server, track() registered
// BEFORE anything else, READY line once up) for the two endings that
// harness doesn't cover:
//   - 'terminal': the scenario reaches its own terminal Then step, which
//     calls reap() itself and exits normally (the happy path).
//   - 'throw': an uncaught exception ends the process before any inline
//     cleanup runs - the SAME real mechanism whether the cause is "a
//     thrown assertion mid-scenario" or "a mutant failing early" (both are,
//     from track()'s own perspective, indistinguishable: an uncaught JS
//     exception that fires Node's 'exit' event exactly like a clean exit
//     does - verified directly before building this harness, not assumed).
//   - 'sigterm': neither - the harness waits to be killed externally,
//     exactly fixtureReaperAbnormalExitHarness.js's own posture.
//
// Usage: node fixtureReaperTmuxOnlyHarness.js <root> <sock> <mode>
// Prints "READY" to stdout once the fixture tmux server is up and tracked.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { track, reap } = require('./fixtureReaper');

const [, , root, sock, mode] = process.argv;

function main() {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });

  // track() registered BEFORE the server is spawned, matching the ordering
  // a real step file's Given must follow (fixtureReaperAbnormalExitHarness.js's
  // own established ordering) - even a crash mid-launch is covered.
  track(root);

  // Session name deliberately identical to the live swarm's own -
  // reinforcing this ticket's own guardrail framing even in this scenario:
  // the reaper must decide by socket path, never by this name.
  execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', 'swarmforge-coder', '-n', 'agent']);
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);

  process.stdout.write('READY\n');

  if (mode === 'terminal') {
    reap(root);
    process.exit(0);
  } else if (mode === 'throw') {
    throw new Error('BL-817 harness: simulated thrown assertion / early-failing mutant');
  } else if (mode === 'sigterm') {
    // Deliberately never reaps itself - waits to be killed, simulating the
    // runner receiving SIGTERM before its own inline teardown ever runs.
    setInterval(() => {}, 1000);
  } else {
    throw new Error(`BL-817 harness: unknown mode "${mode}"`);
  }
}

main();
