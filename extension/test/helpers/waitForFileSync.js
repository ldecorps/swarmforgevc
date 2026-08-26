'use strict';

// BL-1063: a bounded, SYNCHRONOUS wait for a file a backgrounded child writes.
//
// start_handoff_daemon.sh backgrounds the daemon and returns immediately, so
// spawnSync returning says nothing about whether the child has run. Reading the
// child's marker on the next line is a race - real on an idle host, wider under
// contention.
//
// A fixed sleep is explicitly NOT the fix: it trades a fast race for a slow
// one, is still wrong under enough load, and taxes every passing run for the
// worst case. This polls and returns the instant the file is ready, with a
// declared maximum deadline so a child that never writes fails fast and by
// name rather than hanging out the lane's whole budget.
//
// SYNCHRONOUS on purpose: fast-check's property callbacks here are sync, and
// making them async to reach test/helpers/boundedWatchWait.js would change the
// shape of three unrelated properties. That helper is also await-based (it
// races a promise, it does not poll a path) and BL-1008 records a defect in its
// inner deadline, so reuse would have been a change, not a shortcut.
//
// The sleep between polls is Atomics.wait on a SharedArrayBuffer - a real
// blocking wait with no child process, so a 25ms poll costs 25ms rather than a
// process spawn.

const fs = require('node:fs');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_POLL_MS = 25;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function describeWaitTimeout(filePath, timeoutMs, label) {
  return (
    `${label ? `${label}: ` : ''}${filePath} did not appear (or was not complete) within ${timeoutMs}ms` +
    ' — the backgrounded child never wrote it'
  );
}

/**
 * Polls until `filePath` exists AND `ready(contents)` holds, or the deadline
 * elapses. Returns { ok, contents, waitedMs }.
 *
 * `ready` matters as much as existence: the child writes through a shell
 * redirect, so the file can exist while still empty or half-written. Waiting on
 * existence alone would swap one race for a subtler one.
 */
function waitForFileSync(filePath, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const ready = options.ready ?? ((text) => text.trim().length > 0);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? sleepSync;

  const startedAt = now();
  for (;;) {
    let contents = null;
    try {
      contents = fs.readFileSync(filePath, 'utf8');
    } catch {
      contents = null;
    }
    if (contents !== null && ready(contents)) {
      return { ok: true, contents, waitedMs: now() - startedAt };
    }
    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      return { ok: false, contents, waitedMs: elapsed };
    }
    // Never overshoot the deadline just because a poll interval straddles it.
    sleep(Math.min(pollMs, timeoutMs - elapsed));
  }
}

module.exports = { waitForFileSync, describeWaitTimeout, DEFAULT_TIMEOUT_MS, DEFAULT_POLL_MS };
