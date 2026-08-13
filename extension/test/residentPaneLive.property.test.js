const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const fs = require('node:fs');
const path = require('node:path');
const { installInProcessTmux } = require('./helpers/fakeTmux');
const {
  captureMonoRouterLiveScreen,
  clearResidentPaneLiveCache,
  RESIDENT_PANE_CACHE_TTL_MS,
} = require('../out/bridge/residentPaneLive');

// BL-881 (coder, invariants): captureMonoRouterLiveScreen wraps a synchronous
// tmux + filesystem walk in a TTL cache keyed by targetPath. Declared
// invariants:
//   1. Overlapping polls for the same targetPath within the TTL share one
//      walk - they must not each start a fresh capture.
//   2. After the TTL expires, or after clearResidentPaneLiveCache, the next
//      capture performs a fresh walk.
// Both collapse into one property: for ANY sequence of poll instants (not
// just the two hand-picked cases residentPaneLive.test.js pins - "just
// under the TTL", "at the TTL boundary"), the number of real walks the
// implementation performs must equal what a plain greedy TTL model predicts
// (a fresh walk exactly when the gap since the last real walk is >= the
// TTL). This is the "counting/conservation" shape: every poll instant is
// accounted for as either a cache hit or a fresh walk, never neither.
//
// Generator reach: deltas are drawn from [0, 2*TTL], so both cache-hit
// (delta < TTL, includes delta=0) and cache-miss (delta >= TTL, up to
// 2*TTL) paths are reachable by construction, not just probable - this
// property fails against a broken implementation (see NON-VACUOUS note
// below), not just against implausible edge cases.
//
// This also covers the mechanism behind the ticket's 3rd invariant ("the
// Mini App poll interval does not routinely queue overlapping synchronous
// captures on the bridge event loop"): delta=0 is the worst conceivable
// poll cadence (requests arriving back-to-back with no gap at all, far
// faster than the real ~4s poll), and the model above proves even THAT
// cadence collapses to one real walk per TTL window, never one walk per
// poll. residentPaneLive.test.js separately pins the real production
// wiring (poll interval 4s, TTL 5s) structurally; the acceptance feature
// (specs/features/BL-881-*.feature) checks the same two constants via the
// served HTML and the exported TTL constant. There is no separate property
// test for invariant 3 alone - the poll-interval string itself has no
// input to generate over, so a property test would just restate a fixed
// assertion; the actual protective mechanism is the walk-count bound this
// property already establishes for arbitrary (including adversarial)
// arrival cadences.

function seedSingleRoleFixture(tmp) {
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
  fs.writeFileSync(path.join(launchDir, 'coder.claude-settings.json'), JSON.stringify({ model: 'claude-sonnet-5' }));
}

// Mirrors the implementation's own cache-hit test exactly (nowMs -
// capturedAtMs < TTL => hit), so this model is a spec of the intended
// behavior, not a restatement of the implementation's source lines.
function predictWalkCount(pollDeltasMs, ttlMs) {
  let walks = 0;
  let lastWalkAtMs;
  let elapsedMs = 0;
  for (const delta of pollDeltasMs) {
    elapsedMs += delta;
    if (walks === 0 || elapsedMs - lastWalkAtMs >= ttlMs) {
      walks += 1;
      lastWalkAtMs = elapsedMs;
    }
  }
  return walks;
}

const CALLS_PER_WALK = 2; // tryCaptureRolePane makes 2 capture-pane calls per role; fixture has exactly 1 role.

const deltaArb = fc.integer({ min: 0, max: RESIDENT_PANE_CACHE_TTL_MS * 2 });
const pollDeltasArb = fc.array(deltaArb, { minLength: 1, maxLength: 15 });

test('property: real walk count matches the greedy TTL model, for any sequence of poll instants', () => {
  const tmp = mkTmpDir('sfvc-mono-live-cache-prop-');
  seedSingleRoleFixture(tmp);
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'SwarmForge Coder\n> working' },
  ]);
  try {
    fc.assert(
      fc.property(pollDeltasArb, (pollDeltasMs) => {
        clearResidentPaneLiveCache();
        const callsBefore = fake.calls().filter((args) => args.includes('capture-pane')).length;

        let elapsedMs = 0;
        for (const delta of pollDeltasMs) {
          elapsedMs += delta;
          captureMonoRouterLiveScreen(tmp, elapsedMs);
        }

        const callsAfter = fake.calls().filter((args) => args.includes('capture-pane')).length;
        const actualWalks = (callsAfter - callsBefore) / CALLS_PER_WALK;
        const expectedWalks = predictWalkCount(pollDeltasMs, RESIDENT_PANE_CACHE_TTL_MS);
        assert.equal(
          actualWalks,
          expectedWalks,
          `deltas=${JSON.stringify(pollDeltasMs)} expected ${expectedWalks} walks, got ${actualWalks}`
        );
      }),
      { numRuns: 200 }
    );
  } finally {
    fake.restore();
    clearResidentPaneLiveCache();
  }
});

// NON-VACUOUS check (BL-654): confirmed this property fails against a
// deliberately broken implementation before landing it. Breaking the cache
// to always re-walk (dropping the TTL comparison entirely, i.e. treating
// every call as a miss) makes actualWalks == pollDeltasMs.length for every
// input with length > 1 and any delta < TTL, which the model above rejects
// whenever a delta < TTL occurs - fast-check found a minimal failing case
// (a single [0] delta pair collapsing to 2 actual vs 1 expected walk)
// immediately. Restored to the real implementation afterward; this comment
// is the durable record since the broken variant was never committed.
