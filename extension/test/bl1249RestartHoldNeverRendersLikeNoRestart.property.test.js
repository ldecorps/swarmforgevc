'use strict';

// BL-1249 declared invariant 1 (coder first authorship — BL-654):
//
//   "A restart the expeditor declines is never silent and is never reported
//    as --no-restart was: the run report names the hold and the marker that
//    caused it, so a still-down swarm can never be read as one that came up."
//
// Drives the REAL expedite_cli.bb --restart-only path (no stubbed
// restart-hold-verdict) against a real control-pause.json fixture, over
// generated marker shapes, and compares each report against the report a
// --no-restart invocation of the SAME script produces.
//
// The malformed-marker cases are not drawn independently: each one is a
// TRUNCATION of a genuinely active marker's own JSON text (the collision
// construction the invariants contract calls for), so every "malformed" row
// is guaranteed to be a corrupted active marker rather than an accidental
// coincidence that happens to also parse.
//
// Runs ONLY via `npm run test:properties`.
//
// Non-vacuity: reverting restart-stack! to ignore the hold marker entirely
// makes every "held" scenario report {outcome: "degraded", ...} (the
// fixture root has no real swarm to start) with a sentinel file created —
// identical in shape to the report an unheld run under the same fixture
// would produce, and this test fails on both the outcome-field assertion
// and the sentinel assertion.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');

function markerPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'control-pause.json');
}

function buildFixtureRoot() {
  const root = fs.realpathSync(mkTmpDir('bl1249-restart-hold-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function runRestartOnly(root, extraArgs, sentinel) {
  const res = spawnSync(
    'bb',
    [CLI, '--restart-only', root, ...extraArgs],
    {
      encoding: 'utf8',
      env: { ...process.env, EXPEDITE_START_CMD: `touch ${sentinel}` },
      timeout: 30_000,
    }
  );
  assert.equal(res.status, 0, `--restart-only exited nonzero:\n${res.stdout}${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

// A "genuinely active" marker's exact JSON text — the seed every malformed
// case truncates from, per the collision-construction requirement.
function activeMarkerText(untilMs) {
  return untilMs == null
    ? JSON.stringify({ active: true })
    : JSON.stringify({ active: true, untilMs });
}

const scenario = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ kind: 'absent' }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'active-no-timer' }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('active-future'), deltaMs: fc.integer({ min: 60_000, max: 3_600_000 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('active-past'), deltaMs: fc.integer({ min: 60_000, max: 3_600_000 }) }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'explicitly-inactive' }) },
  // Malformed: truncate a genuinely active marker's own text to some prefix
  // length short of its full length, so it is a corruption of a real hold,
  // never an independently-drawn string that might accidentally parse.
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('truncated-active'), untilMs: fc.option(fc.integer({ min: 1, max: 10_000_000 }), { nil: null }), cutPercent: fc.integer({ min: 0, max: 90 }) }) }
);

function materializeMarker(root, s) {
  const p = markerPath(root);
  const nowMs = Date.now();
  switch (s.kind) {
    case 'absent':
      return { expectHeld: false };
    case 'active-no-timer':
      fs.writeFileSync(p, activeMarkerText(null));
      return { expectHeld: true };
    case 'active-future':
      fs.writeFileSync(p, activeMarkerText(nowMs + s.deltaMs));
      return { expectHeld: true };
    case 'active-past':
      fs.writeFileSync(p, activeMarkerText(nowMs - s.deltaMs));
      return { expectHeld: false };
    case 'explicitly-inactive':
      fs.writeFileSync(p, JSON.stringify({ active: false }));
      return { expectHeld: false };
    case 'truncated-active': {
      const full = activeMarkerText(s.untilMs);
      const cutLen = Math.max(0, Math.min(full.length - 1, Math.floor((full.length * s.cutPercent) / 100)));
      fs.writeFileSync(p, full.slice(0, cutLen));
      return { expectHeld: true };
    }
    default:
      throw new Error(`bl1249 property: unhandled scenario kind ${s.kind}`);
  }
}

test('BL-1249/BL-654 invariant 1: a held restart report never matches a --no-restart report', async () => {
  await fc.assert(
    fc.asyncProperty(scenario, async (s) => {
      const root = buildFixtureRoot();
      const sentinel = path.join(root, 'sentinel');
      const noRestartSentinel = path.join(root, 'no-restart-sentinel');
      try {
        const { expectHeld } = materializeMarker(root, s);

        const noRestartReport = runRestartOnly(root, ['--no-restart'], noRestartSentinel);
        assert.deepEqual(noRestartReport, { outcome: 'not-attempted' });
        assert.equal(fs.existsSync(noRestartSentinel), false);

        const report = runRestartOnly(root, [], sentinel);

        if (expectHeld) {
          assert.equal(report.outcome, 'held', `expected held for ${s.kind}, got ${JSON.stringify(report)}`);
          assert.equal(typeof report['marker-path'], 'string');
          assert.equal(fs.existsSync(sentinel), false, 'start command must not run while held');
        } else {
          assert.notEqual(report.outcome, 'held', `expected not-held for ${s.kind}, got ${JSON.stringify(report)}`);
          assert.equal(fs.existsSync(sentinel), true, 'start command must run when not held');
        }

        // The core invariant: a held report and a --no-restart report are
        // never the same shape, so a reader can always tell them apart.
        assert.notDeepEqual(report, noRestartReport);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 25 }
  );
});
