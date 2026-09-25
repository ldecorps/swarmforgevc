'use strict';

// BL-1727's one declared invariant: "When ollama_ancillary_stop_pid returns
// success, the pid it was given is not alive."
//
// A small, fully enumerable space of real process behaviours - constructed
// exhaustively rather than fc-sampled (BL-1691/BL-1703's own precedent:
// random sampling over a handful of discrete categories can miss one
// entirely). The reach floor below is a construction guarantee, not a
// hoped-for one: every behaviour category the invariant quantifies over
// (a graceful exit, an escalation through KILL, an already-gone pid) is
// driven at least once by the loop itself.
//
// Non-vacuous, verified by hand: reverting ollama_ancillary_stop_pid to
// its pre-BL-1727 `kill "$pid" || true; return` (no wait) makes the
// "ignores-term" case fail this test - the function returns success while
// the process it named is still alive, which is exactly the race BL-1720
// caught in bl1703OllamaLaunchProbe.property.test.js.

const assert = require('node:assert/strict');
const { makeStopPidFixture } = require('./helpers/ollamaStopPidFixture');

const FAST_BOUNDS = {
  OLLAMA_ANCILLARY_STOP_TERM_GRACE_SECONDS: '1',
  OLLAMA_ANCILLARY_STOP_KILL_GRACE_SECONDS: '1',
  OLLAMA_ANCILLARY_STOP_POLL_INTERVAL_SECONDS: '1',
};

const BEHAVIOURS = ['exits-after-term', 'ignores-term', 'already-exited'];

test('invariant: a successful stop always leaves the pid not alive, across every process behaviour', () => {
  const reach = new Set();
  for (const behaviour of BEHAVIOURS) {
    reach.add(behaviour);
    const fx = makeStopPidFixture();
    try {
      const pid = fx.startProcess(behaviour);
      if (behaviour === 'already-exited') {
        assert.ok(fx.waitUntilGone(pid, 3000), `expected pid ${pid} to exit on its own before the stop call`);
      }
      const result = fx.runStopPid(pid, { envOverrides: FAST_BOUNDS });
      assert.equal(result.status, 0, `${behaviour}: expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.equal(fx.pidAlive(pid), false, `${behaviour}: expected pid ${pid} to be stopped after a successful call`);
    } finally {
      fx.cleanup();
    }
  }
  assert.equal(reach.size, BEHAVIOURS.length, 'reach floor: expected every behaviour category to be constructed');
});

test('a pid that cannot be signalled is never reported stopped (the failure path stays a failure, not a false success)', () => {
  const fx = makeStopPidFixture();
  try {
    const pid = fx.startProcess('ignores-term');
    const result = fx.runStopPid(pid, { envOverrides: FAST_BOUNDS, unsignallable: true });
    assert.notEqual(result.status, 0, `expected a nonzero exit for a pid this user cannot signal, got ${result.status}`);
    assert.ok(fx.pidAlive(pid), `expected pid ${pid} to still be alive - the failure must not lie about it`);
    fx.killReal(pid);
  } finally {
    fx.cleanup();
  }
});
