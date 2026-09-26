'use strict';

// BL-1711's one declared invariant: "handoffd never signals a live ollama
// serve process, and it starts a new one only when the recorded server's
// process is gone, the endpoint stayed silent through the whole
// confirmation window, and fewer than 3 restarts happened in the last 30
// minutes."
//
// A small, fully enumerable space of real record/process states -
// constructed exhaustively (BL-1704/BL-1727's own precedent: random
// sampling over a handful of discrete categories can miss one entirely).
// The reach floor is a construction guarantee: every category the
// invariant quantifies over is driven at least once by the loop.
//
// Non-vacuous, verified by hand: with OLLAMA_ANCILLARY_RESTART_MAX_IN_WINDOW
// raised past the seeded history count, the "at-bound" category's own
// assertion (no RESTARTED, exactly one ESCALATED) fails - it restarts
// instead. Restoring the seeded count below the raised bound also fails
// the same assertion the other way (no ESCALATED). Both confirmed by
// hand and reverted before this file was committed.
//
// "at-bound" (count=3, blocked) and "confirmed-restart" (count=0,
// allowed) alone cannot catch an off-by-one that blocks one restart too
// EARLY (e.g. `-ge (MAX - 1)` instead of `-ge MAX`): count=3 blocks
// either way, count=0 allows either way, so neither discriminates.
// "just-below-bound" (count=2, the true boundary just under the cutoff)
// closes that gap - verified by hand: with the comparison changed to
// `-ge $((OLLAMA_ANCILLARY_RESTART_MAX_IN_WINDOW - 1))`, this category's
// own assertion fails (it escalates at count=2 instead of restarting),
// while "at-bound" and "confirmed-restart" both stay green throughout.
// Reverted before this file was committed.
//
// "restart-fails-to-come-up": ollama_ancillary_restart_if_crashed's own
// second failure branch - the replacement server is started but never
// answers within wait_seconds, so it is stopped and the sweep escalates
// instead of leaving an unreachable process running - had NO coverage
// anywhere (the acceptance feature's five scenarios and every category
// above use a binary whose `serve` always answers immediately). Verified
// non-vacuous the same way: this category's own assertion (no RESTARTED,
// one ESCALATED, the never-answering process actually gone) is exactly
// what would fail if `ollama_ancillary_stop_pid "$new_pid"` were ever
// dropped from that branch - confirmed by hand, removed that one line,
// reran (the process search found it still alive), restored, reran green.

const assert = require('node:assert/strict');
const { makeOllamaCrashRestartFixture } = require('./helpers/ollamaCrashRestartFixture');

const CATEGORIES = [
  'live-serve',
  'dead-but-answering',
  'first-missed-probe',
  'confirmed-restart',
  'just-below-bound',
  'at-bound',
  'no-record',
  'restart-fails-to-come-up',
];

test('invariant: a new server starts only for a confirmed, unbounded crash - never a live serve, never before the window, never past the bound', async () => {
  const reach = new Set();

  for (const category of CATEGORIES) {
    reach.add(category);
    const fixture = makeOllamaCrashRestartFixture();
    try {
      let result;
      if (category === 'live-serve') {
        const pid = fixture.startServer();
        fixture.writeRecord('swarm-owned', pid);
        result = fixture.tick();
        assert.equal(result.stdout, '', `${category}: expected no action against a live ollama serve process`);
        assert.ok(fixture.pidAlive(pid), `${category}: expected the live server left untouched`);
        fixture.killReal(pid);
      } else if (category === 'dead-but-answering') {
        const pid = fixture.startServer();
        fixture.killReal(pid);
        assert.ok(fixture.waitUntilGone(pid), `${category}: expected the stand-in to actually exit`);
        fixture.startEndpointResponder();
        fixture.writeRecord('swarm-owned', pid);
        result = fixture.tick();
        assert.equal(result.stdout, '', `${category}: an answering endpoint is never a crash, whatever the recorded pid`);
      } else if (category === 'first-missed-probe') {
        const pid = fixture.startServer();
        fixture.killReal(pid);
        assert.ok(fixture.waitUntilGone(pid), `${category}: expected the stand-in to actually exit`);
        fixture.writeRecord('swarm-owned', pid);
        result = fixture.tick();
        assert.equal(result.stdout, '', `${category}: one missed probe must not itself trigger a restart`);
      } else if (category === 'confirmed-restart') {
        const pid = fixture.startServer();
        fixture.killReal(pid);
        assert.ok(fixture.waitUntilGone(pid), `${category}: expected the stand-in to actually exit`);
        fixture.writeRecord('swarm-owned', pid);
        const results = fixture.runUntilWindowPassed();
        const restarted = results.map((r) => r.stdout).filter((s) => s.startsWith('RESTARTED'));
        assert.equal(
          restarted.length,
          1,
          `${category}: expected exactly one restart once the window passed, got: ${JSON.stringify(results.map((r) => r.stdout))}`
        );
      } else if (category === 'just-below-bound') {
        const pid = fixture.startServer();
        fixture.killReal(pid);
        assert.ok(fixture.waitUntilGone(pid), `${category}: expected the stand-in to actually exit`);
        fixture.writeRecord('swarm-owned', pid);
        fixture.seedRestartHistory(2);
        const results = fixture.runUntilWindowPassed();
        const lines = results.map((r) => r.stdout).filter(Boolean);
        assert.equal(
          lines.filter((l) => l.startsWith('RESTARTED')).length,
          1,
          `${category}: expected exactly one restart with 2 prior restarts (still under the bound of 3), got: ${JSON.stringify(lines)}`
        );
        assert.deepEqual(
          lines.filter((l) => l.startsWith('ESCALATED')),
          [],
          `${category}: expected no escalation with 2 prior restarts, got: ${JSON.stringify(lines)}`
        );
      } else if (category === 'at-bound') {
        const pid = fixture.startServer();
        fixture.killReal(pid);
        assert.ok(fixture.waitUntilGone(pid), `${category}: expected the stand-in to actually exit`);
        fixture.writeRecord('swarm-owned', pid);
        fixture.seedRestartHistory(3);
        const results = fixture.runUntilWindowPassed();
        const lines = results.map((r) => r.stdout).filter(Boolean);
        assert.deepEqual(
          lines.filter((l) => l.startsWith('RESTARTED')),
          [],
          `${category}: expected no restart once the bound is reached, got: ${JSON.stringify(lines)}`
        );
        assert.equal(
          lines.filter((l) => l.startsWith('ESCALATED')).length,
          1,
          `${category}: expected exactly one escalation, got: ${JSON.stringify(lines)}`
        );
      } else if (category === 'restart-fails-to-come-up') {
        const pid = fixture.startServer();
        fixture.killReal(pid);
        assert.ok(fixture.waitUntilGone(pid), `${category}: expected the stand-in to actually exit`);
        fixture.writeRecord('swarm-owned', pid);
        const results = fixture.runUntilWindowPassed(6, fixture.fakeOllamaNeverServes);
        const lines = results.map((r) => r.stdout).filter(Boolean);
        assert.deepEqual(
          lines.filter((l) => l.startsWith('RESTARTED')),
          [],
          `${category}: expected no RESTARTED line when the replacement never answers, got: ${JSON.stringify(lines)}`
        );
        // BL-1711 QA bounce D2 (2026-09-25): a single failed restart is
        // its own RESTART_FAILED token now, never ESCALATED (that token
        // is reserved for the bound being exhausted - D2's whole point
        // was that a human alert must tell the two apart).
        assert.equal(
          lines.filter((l) => l.startsWith('ESCALATED')).length,
          0,
          `${category}: expected no ESCALATED line for a single failed restart, got: ${JSON.stringify(lines)}`
        );
        assert.equal(
          lines.filter((l) => l.startsWith('RESTART_FAILED')).length,
          1,
          `${category}: expected exactly one RESTART_FAILED when the replacement never answers, got: ${JSON.stringify(lines)}`
        );
        assert.ok(
          !fixture.anyProcessMatching('fake-ollama-never-serves'),
          `${category}: expected the never-answering replacement to have been stopped, not left running`
        );
      } else if (category === 'no-record') {
        fixture.deleteRecord();
        result = fixture.tick();
        assert.equal(result.stdout, '', `${category}: expected no action with no record at all`);
      }
    } finally {
      fixture.cleanup();
    }
  }

  assert.equal(reach.size, CATEGORIES.length, 'reach floor: expected every category to be constructed');
});
