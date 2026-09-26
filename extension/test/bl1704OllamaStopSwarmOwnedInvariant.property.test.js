'use strict';

// BL-1704's one declared invariant: "A stop path signals an ollama
// process only when the ollama record names it swarm-owned and the pid's
// live command line is still ollama serve, or it is a runner child of
// that same server."
//
// A small, fully enumerable space of real record/process states -
// constructed exhaustively (BL-1691/BL-1703/BL-1727's own precedent:
// random sampling over a handful of discrete categories can miss one
// entirely). The reach floor is a construction guarantee: every category
// the invariant quantifies over is driven at least once by the loop.
//
// Non-vacuous, verified by hand: deleting the `ollama_ancillary_pid_is_ollama_serve`
// guard in ollama_ancillary_stop_swarm_owned (so it signals ANY recorded
// pid unconditionally) makes the "reused pid" category below fail - the
// unrelated process it must leave untouched gets killed instead.

const assert = require('node:assert/strict');
const { makeOllamaStopPathsFixture } = require('./helpers/ollamaStopPathsFixture');

const CATEGORIES = ['external', 'dead-pid', 'reused-pid', 'live-ollama-serve'];

test('invariant: a process is signalled only for a swarm-owned record naming a live ollama serve (or its runner), across every record/process state', async () => {
  const reach = new Set();

  for (const category of CATEGORIES) {
    reach.add(category);
    const fixture = makeOllamaStopPathsFixture();
    try {
      const { serverPid, runnerPid } = await fixture.startServerAndRunner();

      let expectServerSignalled;
      let expectRunnerSignalled;

      if (category === 'external') {
        fixture.writeRecord('external', undefined);
        expectServerSignalled = false;
        expectRunnerSignalled = false;
      } else if (category === 'dead-pid') {
        fixture.killReal(serverPid);
        assert.ok(fixture.waitUntilGone(serverPid), 'expected the stand-in server to actually exit first');
        fixture.writeRecord('swarm-owned', serverPid);
        expectServerSignalled = false; // already dead - nothing TO signal
        expectRunnerSignalled = false; // never named by the record
      } else if (category === 'reused-pid') {
        const unrelatedPid = fixture.startUnrelatedProcess();
        fixture.writeRecord('swarm-owned', unrelatedPid);
        expectServerSignalled = false; // real server left running, untouched
        expectRunnerSignalled = false;
        fixture._unrelatedPid = unrelatedPid;
      } else {
        fixture.writeRecord('swarm-owned', serverPid);
        expectServerSignalled = true;
        expectRunnerSignalled = true;
      }

      const result = fixture.runStopSwarmOwned();
      assert.equal(result.status, 0, `${category}: unexpected exit ${result.status}: ${result.stderr}`);

      if (category === 'reused-pid') {
        assert.ok(
          fixture.pidAlive(fixture._unrelatedPid),
          `${category}: expected the unrelated process (reused pid) to be left untouched`
        );
        fixture.killReal(fixture._unrelatedPid);
      }

      if (category !== 'dead-pid' && category !== 'reused-pid') {
        assert.equal(
          fixture.pidAlive(serverPid),
          !expectServerSignalled,
          `${category}: expected server signalled=${expectServerSignalled}, got alive=${fixture.pidAlive(serverPid)}`
        );
      }

      // The runner is never independently named by the record - it is
      // only ever reached (or not) as a consequence of what happens to
      // the server it is a real child of.
      assert.equal(
        fixture.pidAlive(runnerPid),
        !expectRunnerSignalled,
        `${category}: expected runner signalled=${expectRunnerSignalled}, got alive=${fixture.pidAlive(runnerPid)}`
      );

      assert.equal(fixture.recordExists(), category === 'external', `${category}: unexpected record persistence`);
    } finally {
      fixture.cleanup();
    }
  }

  assert.equal(reach.size, CATEGORIES.length, 'reach floor: expected every category to be constructed');
});
