'use strict';

// BL-1692's one declared invariant (coder first authorship - BL-654):
//
// "Every case in test_build_freshness_cli.sh that launches a front-desk
// group and then reads a report or status waits for
// front-desk-supervisor.status.json to carry a build_sha for bridge and
// bot before the first read; a pid file alone is never the readiness
// signal."
//
// Encoded against the REAL, shared checkLaunchSitesGated
// (extension/test/helpers/frontDeskLaunchReadiness.js) - the same pure
// function specs/pipeline/steps/bl1692FreshnessTestWaitsForStatusSteps.js
// drives for its own scenario 02, never a reimplementation of the
// detection.
//
// Generator reach: property one draws across the THREE real launch sites
// in the real file (fc.constantFrom over their actual indices, computed
// once from the real source - BL-1445's own census-pin shape, applied to
// a source-text population instead of a handler-file population) and
// proves each is gated. Property two is the generality/non-vacuity
// proof the invariant's own "a pid file alone is never the readiness
// signal" clause demands: a generator over SYNTHETIC launch-then-read
// snippets, crossed with whether the readiness marker is present, absent,
// or present but placed AFTER the read, proves checkLaunchSitesGated
// classifies every shape correctly - not just the three shapes that
// happen to exist in the file today.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { checkLaunchSitesGated, findAllIndices } = require('./helpers/frontDeskLaunchReadiness');

const TEST_FILE = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'test', 'test_build_freshness_cli.sh');
const LAUNCH_MARKER = 'bash "$LAUNCH_FRONT_DESK"';
const READINESS_MARKER = 'wait_for_front_desk_ready';
const READ_MARKERS = ['bb "$CLI"', 'front-desk-supervisor.status.json'];

test('property (BL-1692 invariant): every real front-desk launch site in the file is gated by the readiness wait, over repeated independent draws', () => {
  const source = fs.readFileSync(TEST_FILE, 'utf8');
  const realLaunchIndices = findAllIndices(source, LAUNCH_MARKER);
  assert.equal(realLaunchIndices.length, 3, `expected exactly 3 real launch sites, got ${realLaunchIndices.length}`);

  const seen = new Set();
  fc.assert(
    fc.property(fc.constantFrom(...realLaunchIndices), (launchIdx) => {
      seen.add(launchIdx);
      const { violations } = checkLaunchSitesGated(source, {
        launchMarker: LAUNCH_MARKER,
        readinessMarker: READINESS_MARKER,
        readMarkers: READ_MARKERS,
      });
      const violatedIndices = new Set(violations.map((v) => v.launchIdx));
      assert.ok(
        !violatedIndices.has(launchIdx),
        `expected launch site at index ${launchIdx} to be gated, got violations: ${JSON.stringify(violations)}`
      );
    }),
    { numRuns: 20 }
  );
  assert.equal(seen.size, realLaunchIndices.length, `expected the generator to reach every real launch site, reached: ${JSON.stringify([...seen])}`);
});

// Synthetic snippet builder: a launch marker, optionally the readiness
// marker (before or after the read), then a read marker - the exact
// shape checkLaunchSitesGated scans for, built from filler text so a
// naive "readiness marker appears ANYWHERE in the file" check (rather
// than "before this read") would be caught by the 'after' placement.
function buildSnippet(placement) {
  const filler = 'echo filler line\n';
  const parts = [LAUNCH_MARKER, '\n', filler];
  if (placement === 'before') {
    parts.push(`${READINESS_MARKER} "$ROOT" || fail "unreachable"\n`, filler);
  }
  parts.push(`REPORT="$(bb "$CLI" "$ROOT" report)"\n`);
  if (placement === 'after') {
    parts.push(filler, `${READINESS_MARKER} "$ROOT" || fail "unreachable"\n`);
  }
  return parts.join('');
}

const placementArbitrary = fc.constantFrom('before', 'after', 'absent');

test('property (BL-1692 invariant) non-vacuity: checkLaunchSitesGated classifies every readiness-marker placement correctly, including "present but too late"', () => {
  const seenPlacements = new Set();
  fc.assert(
    fc.property(placementArbitrary, fc.integer({ min: 0, max: 4 }), (placement, fillerCount) => {
      seenPlacements.add(placement);
      const padding = 'echo pad\n'.repeat(fillerCount);
      const source = padding + buildSnippet(placement);
      const { launchCount, violations } = checkLaunchSitesGated(source, {
        launchMarker: LAUNCH_MARKER,
        readinessMarker: READINESS_MARKER,
        readMarkers: READ_MARKERS,
      });
      assert.equal(launchCount, 1, `expected exactly one launch site in the synthetic snippet, got ${launchCount}`);
      const expectGated = placement === 'before';
      assert.equal(
        violations.length === 0,
        expectGated,
        `placement=${placement}: expected gated=${expectGated}, got violations: ${JSON.stringify(violations)}`
      );
    }),
    { numRuns: 30 }
  );
  assert.equal(seenPlacements.size, 3, `expected all three placements drawn, got: ${JSON.stringify([...seenPlacements])}`);
});
