'use strict';

// BL-458: acceptance step files under specs/pipeline/steps/ launch DETACHED
// process trees (front-desk supervisor+bridge+bot via nohup, tmux servers
// via role_lifecycle.sh) that reparent to init and outlive the runner. Their
// only prior cleanup was inline teardown inside terminal Then steps, so any
// assertion that threw first - or the runner itself being killed by
// SIGTERM/SIGINT/timeout/OOM - leaked the whole tree permanently (four such
// mini-swarms survived ~18h and ~1.45 GB after a Jul-15 interrupted run).
//
// track(root) registers a fixture root for cleanup; reap(root) kills its
// process tree immediately (by pidfile/status/socket, never by waiting on
// child death - the tree DETACHES and outlives whichever process spawned
// it). 'exit'/'SIGINT'/'SIGTERM' handlers are installed ONCE, reaping every
// still-tracked root - reap() itself is idempotent (untracks first), so a
// scenario's own inline teardown calling reap() directly and then the
// process exiting normally never double-reaps.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const tracked = new Set();
let handlersInstalled = false;

function killPid(pid) {
  if (!pid) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already dead - fine, that's the point of cleanup
  }
}

function killTmuxServer(socketPath) {
  if (!socketPath || !fs.existsSync(socketPath)) {
    return;
  }
  try {
    execSync(`tmux -S ${JSON.stringify(socketPath)} kill-server`, { stdio: 'ignore' });
  } catch {
    // already dead / never started - fine
  }
}

// Kills the whole tree by pidfile/status/socket rather than by child-death -
// the DETACHED-SURVIVAL posture this ticket's own notes require. Every read
// is best-effort (a missing or corrupt file just means "nothing to kill
// there"), never a throw - reap() must never itself become the reason a
// scenario fails, especially when called from a signal handler.
function reap(root) {
  tracked.delete(root);
  const opDir = path.join(root, '.swarmforge', 'operator');

  const statusFile = path.join(opDir, 'front-desk-supervisor.status.json');
  if (fs.existsSync(statusFile)) {
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      killPid(status.bridge && status.bridge.pid);
      killPid(status.bot && status.bot.pid);
    } catch {
      // corrupt/partial status - fall through to the pidfile kill below
    }
  }

  const pidFile = path.join(opDir, 'front-desk-supervisor.pid');
  if (fs.existsSync(pidFile)) {
    try {
      killPid(Number(fs.readFileSync(pidFile, 'utf8').trim()));
    } catch {
      // unreadable pidfile - nothing more to do
    }
  }

  // role_lifecycle.sh -> swarmforge.sh create_role_session's own detached
  // tmux server, when this fixture root has one.
  const tmuxSocketFile = path.join(root, '.swarmforge', 'tmux-socket');
  if (fs.existsSync(tmuxSocketFile)) {
    try {
      killTmuxServer(fs.readFileSync(tmuxSocketFile, 'utf8').trim());
    } catch {
      // unreadable pointer file - nothing more to do
    }
  }
}

function reapAllTracked() {
  for (const root of [...tracked]) {
    reap(root);
  }
}

// process.on('exit', ...) handlers may only do SYNCHRONOUS work - every
// read/kill above already is. SIGINT/SIGTERM do NOT fire Node's 'exit'
// handlers on their own (the default action terminates the process
// immediately without unwinding) - registering an explicit handler is what
// makes reap-on-signal possible at all; it then re-raises the same outcome
// itself via process.exit().
function installHandlersOnce() {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;
  process.on('exit', reapAllTracked);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      reapAllTracked();
      process.exit(1);
    });
  }
}

function track(root) {
  installHandlersOnce();
  tracked.add(root);
}

module.exports = { track, reap };
