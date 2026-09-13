'use strict';

// BL-1460's declared invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  Every data frame a connected /events client receives after
//                its connect snapshot differs from the previous data frame
//                it received - the server never sends a client two
//                identical consecutive snapshots, whatever the timer phase.
//   invariant 2  Liveness is untouched: an open /events connection is still
//                written to within the keepalive interval whether or not
//                anything changed (BL-1350 invariant 1), and a keepalive
//                frame still changes no consumer state (BL-1350 invariant
//                2).
//
// Invariant 2 is UNCHANGED by this ticket - the fix touches only the /events
// connect path's `lastSnapshot` seed, never the keepalive timer or
// writeSseKeepalive - and already has a first-authored, coder-written
// property test at bl1350KeepaliveInvariants.property.test.js. Re-authoring
// it here would be a second copy of the same claim, not a second invariant;
// this file states that instead of duplicating it (BL-654: authorship, not
// re-verification, is what the rule requires - invariant 2 was already
// authored by the coder role, on BL-1350, and this ticket's diff carries no
// path that could silently un-author it).
//
// Invariant 1 drives a REAL bridge (startBridge) over a real target, because
// resolveEventsSnapshot/broadcastSnapshotIfChanged are private to
// bridgeServer.ts (not exported) - the only way to observe their combined
// behavior is the real /events route end to end, same precedent as
// BL-1351/BL-1350's own behavioral halves.
//
// GENERATOR REACH: the boolean sequence is generated, but the two shapes
// that matter each get their own reach counter below - a run of ticks with
// NO change at all, and a run with two changes back to back (no idle tick
// between them) - so both are reached by construction, not by luck.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const {
  makeFixture,
  removeFixture,
  touchActiveItem,
  startFixtureBridge,
  connectEvents,
  sleep,
} = require('../../specs/pipeline/steps/lib/bl1460IdleEventsFixture');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BRIDGE_SRC = path.join(REPO_ROOT, 'extension', 'src', 'bridge', 'bridgeServer.ts');

test('BL-1460/BL-654 invariant 1 (structural): the connect path seeds lastSnapshot from the connect frame it just built', () => {
  const source = fs.readFileSync(BRIDGE_SRC, 'utf8');
  assert.match(
    source,
    /const snapshot = resolveEventsSnapshot\(lastSnapshot, targetPath, runLogPath\);\s*\n\s*lastSnapshot = snapshot;/,
    'the /events connect path no longer assigns lastSnapshot from its own connect frame - the first poll tick would compare against undefined again',
  );
});

test('BL-1460/BL-654 invariant 1 (behavioural): no two consecutive data frames a client receives are identical, whatever the change/no-change schedule', async () => {
  const fx = makeFixture();
  const handle = await startFixtureBridge(fx);
  const reach = { allIdle: false, backToBackChanges: false };
  let counter = 0;

  async function runSchedule(changeFlags) {
    const client = await connectEvents(handle);
    try {
      await client.waitForCount('data', 1, 5000);
      let expected = 1;
      let sawBackToBack = false;
      let previousWasChange = false;
      for (const changed of changeFlags) {
        if (changed) {
          counter += 1;
          touchActiveItem(fx, `bl1460-property-${counter}`);
          expected += 1;
          await client.waitForCount('data', expected, 5000);
          if (previousWasChange) sawBackToBack = true;
          previousWasChange = true;
        } else {
          // Give a tick a real chance to fire wrongly before moving on.
          await sleep(30);
          previousWasChange = false;
        }
      }
      // A trailing settle: an unchanged target must not gain a further frame
      // after the schedule ends either.
      await sleep(30);
      assert.equal(client.countOf('data'), expected, `expected ${expected} data frame(s), saw ${client.countOf('data')}`);
      const dataFrames = client.frames.filter((f) => f.kind === 'data').map((f) => f.payload);
      for (let i = 1; i < dataFrames.length; i += 1) {
        assert.notEqual(dataFrames[i], dataFrames[i - 1], `frames ${i - 1} and ${i} were identical consecutive snapshots`);
      }
      if (changeFlags.every((c) => !c)) reach.allIdle = true;
      if (sawBackToBack) reach.backToBackChanges = true;
      return true;
    } finally {
      await client.close();
    }
  }

  try {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }), runSchedule),
      { numRuns: 8 },
    );
    // Reach floor: force the two shapes fc's draw is not guaranteed to hit -
    // an all-idle run and a back-to-back-changes run - rather than hope for
    // them (the failure shape this repo has seen before: a generator
    // technically covering a state while never actually landing on it).
    await runSchedule([false, false]);
    reach.allIdle = true;
    await runSchedule([true, true]);
    reach.backToBackChanges = true;
  } finally {
    await handle.stop();
    removeFixture(fx);
  }

  assert.ok(reach.allIdle, 'never exercised an all-idle schedule');
  assert.ok(reach.backToBackChanges, 'never exercised two changes back to back with no idle tick between them');
}, 60000);
