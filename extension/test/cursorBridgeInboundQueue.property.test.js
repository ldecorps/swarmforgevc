const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  appendCursorBridgeInboundUpdate,
  drainCursorBridgeInboundUpdates,
} = require('../out/tools/cursorBridgeInboundQueue');

// BL-764 invariant #3: "Draining the inbound queue is idempotent under
// redelivery: an update drained once is not acted on twice, and a
// concurrent append is never lost by the drain." The naive read-then-
// truncate implementation has a window where a front-desk append landing
// between the read and the truncating write is silently destroyed (the
// truncate is an unconditional overwrite, not a conditional clear). This
// property drives an update through that exact window — appended right as
// drainCursorBridgeInboundUpdates performs its atomic hand-off step — for
// arbitrary pre-existing queue contents and either side of the race, and
// checks the update always surfaces exactly once across the two drains it
// could land in, never zero times and never twice.

function tmpOpDir() {
  return mkTmpDir('cursor-bridge-inbound-prop-');
}

test('property: an update appended right as drain hands off the file is drained exactly once, never lost', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), { minLength: 0, maxLength: 6 }),
      fc.integer({ min: 1001, max: 2000 }),
      fc.boolean(),
      (preExistingIds, racingId, raceBeforeHandoff) => {
        const opDir = tmpOpDir();
        const realRenameSync = fs.renameSync;
        try {
          for (const id of preExistingIds) {
            appendCursorBridgeInboundUpdate(opDir, { update_id: id });
          }

          let raced = false;
          fs.renameSync = function patchedRenameSync(...args) {
            if (raceBeforeHandoff && !raced) {
              raced = true;
              appendCursorBridgeInboundUpdate(opDir, { update_id: racingId });
            }
            // Inject the "after" race on the way out even if the real rename
            // throws (e.g. no queue file yet) — an appender racing the drain
            // doesn't know or care whether the drain found a file to move.
            let result;
            let thrown;
            try {
              result = realRenameSync.apply(fs, args);
            } catch (err) {
              thrown = err;
            }
            if (!raceBeforeHandoff && !raced) {
              raced = true;
              appendCursorBridgeInboundUpdate(opDir, { update_id: racingId });
            }
            if (thrown) {
              throw thrown;
            }
            return result;
          };

          const firstDrain = drainCursorBridgeInboundUpdates(opDir);
          fs.renameSync = realRenameSync;
          const secondDrain = drainCursorBridgeInboundUpdates(opDir);

          const allDrainedIds = [...firstDrain, ...secondDrain].map((u) => u.update_id);
          const expectedIds = [...preExistingIds, racingId];

          for (const id of expectedIds) {
            assert.ok(allDrainedIds.includes(id), `update ${id} was lost across the drain race`);
          }
          assert.equal(
            allDrainedIds.length,
            new Set(allDrainedIds).size,
            'an update was drained more than once'
          );
          assert.equal(allDrainedIds.length, expectedIds.length);

          if (raceBeforeHandoff) {
            assert.ok(
              firstDrain.some((u) => u.update_id === racingId),
              'an append that landed before the atomic hand-off must be in the same drain'
            );
          } else {
            assert.ok(
              secondDrain.some((u) => u.update_id === racingId),
              'an append that landed after the atomic hand-off must surface on the next drain'
            );
          }
        } finally {
          fs.renameSync = realRenameSync;
        }
      }
    )
  );
});
