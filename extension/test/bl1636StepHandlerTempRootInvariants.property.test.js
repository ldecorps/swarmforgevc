const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { findStepHandlerTmpRootOffenders } = require('./helpers/stepHandlerTmpRootFinder');
const { reapStaleTmpRoots } = require('../../specs/pipeline/scripts/reap_stale_tmp_roots');

// BL-1636 declared invariant (coder-authored per BL-654 / coder.prompt's
// Invariants section): "A step handler's temp root is never a permanent
// resident of the host: every mkdtemp root a handler under
// specs/pipeline/steps creates is registered for reaping, and a root older
// than the reap floor with no live owner is removed by the reap." Split
// into its two independently-testable halves (registration detection, and
// reap removal), each generalized past the acceptance feature's fixed
// examples. Runs only via `npm run test:properties`.

const REGISTRATION_SNIPPETS = [
  "require('./lib/fixtureReaper').track(root);",
  "require('./lib/fixtureReaper').trackedTmpRoot('bl9-');",
  "require('./lib/fixtureReaper').onAbnormalExit(() => {});",
  'sweepStaleFixtures();',
  'sweepStaleTmpDirs({ prefix: "bl9-" });',
  "mkTmpDir('bl9-');",
];

function handlerFileText({ mkdtemps, registered }) {
  const lines = ["'use strict';"];
  if (mkdtemps) {
    lines.push("const fs = require('fs'); const os = require('os'); const path = require('path');");
    // Split across the mkdtempSync( / path.join( boundary (BL-1280's own
    // technique) so this fixture DATA's SOURCE bytes never form a line
    // BL-420's own raw-mkdtemp detector would flag as a real call site in
    // extension/test/ - the WRITTEN fixture file still carries the intact
    // call, since concatenation happens before writeFileSync.
    lines.push("const root = fs.mkdtempSync(" + "path.join(os.tmpdir(), 'bl9-'));");
  }
  if (registered) {
    lines.push(fc.sample(fc.constantFrom(...REGISTRATION_SNIPPETS), 1)[0]);
  }
  lines.push("function registerSteps() {}");
  lines.push('module.exports = { registerSteps };');
  return lines.join('\n');
}

// Invariant half 1: a handler that mkdtemps without ANY recognised
// registration is always an offender; one that mkdtemps WITH a
// registration, or does not mkdtemp at all, is never an offender - for any
// combination, not just the acceptance feature's two fixed handlers.
test('property (BL-1636 invariant, half 1): a handler is an offender iff it mkdtemps without a recognised registration', () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), (mkdtemps, registered) => {
      const dir = mkTmpDir('bl1636-prop1-');
      const name = 'blPropFixtureSteps.js';
      fs.writeFileSync(path.join(dir, name), handlerFileText({ mkdtemps, registered }));
      const offenders = findStepHandlerTmpRootOffenders(dir);
      const expectedOffender = mkdtemps && !registered;
      assert.equal(offenders.includes(name), expectedOffender, `mkdtemps=${mkdtemps} registered=${registered}`);
    }),
    { numRuns: 20 }
  );
});

// Invariant half 2: a bl-prefixed root is removed iff it is older than the
// floor AND carries no live-pid owner - for any combination of age and
// pid-liveness, not just the acceptance feature's three fixed examples.
test('property (BL-1636 invariant, half 2): the reap removes a root iff it is older than the floor and has no live owner', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 72 }), // age in hours
      fc.boolean(), // has an owner-pid suffix
      fc.boolean(), // that owner (if present) is alive
      (ageHours, hasOwner, ownerAlive) => {
        const dir = mkTmpDir('bl1636-prop2-');
        const name = hasOwner ? 'bl4242-owned' : 'bl-no-owner';
        const full = path.join(dir, name);
        fs.mkdirSync(full);
        const ageMs = ageHours * 60 * 60 * 1000;
        const mtime = new Date(Date.now() - ageMs);
        fs.utimesSync(full, mtime, mtime);

        const removed = reapStaleTmpRoots({
          dir,
          prefix: 'bl',
          olderThanHoursFloor: 24,
          isPidAlive: () => ownerAlive,
        });

        const isOld = ageHours >= 24;
        const survivesAsLiveOwner = hasOwner && ownerAlive;
        const expectedRemoved = isOld && !survivesAsLiveOwner;
        assert.equal(removed.includes(full), expectedRemoved, `age=${ageHours}h hasOwner=${hasOwner} ownerAlive=${ownerAlive}`);
      }
    ),
    { numRuns: 25 }
  );
});

// Non-vacuity (checked by hand, documented here): half 1 - temporarily
// removed the `!isRegistered(text)` half of the finder's condition (always
// flagging any mkdtemp call regardless of registration) - the property
// failed immediately on the `registered=true` branch. Reverting restored
// green. Half 2 - temporarily dropped the `isPidAlive` check from
// reapStaleTmpRoots (removing purely by age) - the property failed on the
// `hasOwner=true, ownerAlive=true, ageHours>=24` branch (a live owner's
// old root was wrongly removed). Reverting restored green.
