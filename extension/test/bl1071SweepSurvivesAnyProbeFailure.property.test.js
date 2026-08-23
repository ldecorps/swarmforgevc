'use strict';

// BL-1071 declared invariants 1 and 3 (property authorship rests with the
// coder, first pass - BL-654):
//
//   1. "A sweep never dies on one gather: any single probe that fails - a
//      missing binary, an unreadable file, a library call that throws -
//      degrades that one check and leaves every other check, and every repair
//      already due, still running."
//   3. "A probe that cannot be read is reported unavailable, which is its own
//      answer - never reported as a healthy reading and never as an absence."
//
// The acceptance scenarios pin invariant 1 on four fixed rows. This sweeps the
// whole SUBSET LATTICE instead - every combination of the three probes broken
// or not, all eight of them - because the incident was a COMPOUND failure and
// that is what made it fatal. `slurp` on /proc/meminfo failing was survivable;
// `vm_stat` missing was survivable; the two together threw, and the throw
// happened before assemble-findings, so nothing else in the sweep ever ran
// again. A property that only ever broke one probe at a time would have
// reproduced neither half of that.
//
// Every draw runs the REAL sweep over a REAL fixture repo, with the probe
// broken the way the live incident broke it - a missing binary that cannot be
// spawned at all, not a stub returning an error. The distinction is the whole
// defect: `{:continue true}` softens a non-zero exit, and a binary that cannot
// be spawned throws IOException out of ProcessBuilder before any exit code
// exists.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - babysitter_check.bb's sh! catch removed, restoring the exact
//     pre-hotfix shape: RED on the first draw that breaks the memory probe,
//     "the sweep DIED on a failing probe".
//   break 2 - the observe! catch narrowed back to {:classification :unknown}
//     (the landed hotfix's own shape): RED on the first draw that breaks the
//     control-plane probe, "reported no finding at all for a probe it could
//     not read" - it printed OK all checks green instead.
//   break 3 - check-control-plane's :unavailable branch returning a CRIT
//     rather than UNAVAILABLE: RED, "reported no finding at all for a probe it
//     could not read (control-plane)" - it trips the UNAVAILABLE assertion
//     first, before reaching the never-an-absence one, which is the right
//     order: a severity that is not UNAVAILABLE already fails the invariant.
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  makeSweepFixture,
  breakProbes,
  runSweep,
  died,
  reachedFindings,
  reachedRepair,
} = require('./helpers/bl1071SweepFixture');

const PROBES = ['memory', 'ps', 'control-plane'];
const mkdir = () => mkTmpDir('bl1071-prop-');

// All 2^3 subsets, smallest first. Deliberately exhaustive rather than random:
// the space is eight points, and sampling eight points at random would leave
// the all-three case - the one the incident actually hit - to chance.
function subsets(xs) {
  const out = [[]];
  for (const x of xs) for (const s of [...out]) out.push([...s, x]);
  return out.sort((a, b) => a.length - b.length);
}

test('BL-1071/BL-654 invariant 1: no combination of failing probes stops the sweep reaching its findings or its repairs', () => {
  const combos = subsets(PROBES);
  assert.equal(combos.length, 8, 'the lattice must be all eight subsets, or this is not exhaustive');

  const reached = { none: 0, one: 0, two: 0, all: 0 };

  for (const broken of combos) {
    const fixture = breakProbes(makeSweepFixture(mkdir), broken);
    const r = runSweep(fixture);
    const label = broken.length ? broken.join('+') : 'nothing broken';

    assert.ok(!died(r.output), `the sweep DIED on a failing probe (${label}):\n${r.output}`);
    assert.ok(reachedFindings(r.output), `the sweep produced no finding at all (${label}):\n${r.output}`);
    assert.ok(
      reachedRepair(r.output),
      `the sweep reached its findings but never acted on the repair that was due (${label}):\n${r.output}`
    );

    // "and NOTHING ELSE": a check whose probe was not broken still reports
    // normally. This is the half that a sweep degrading everything at the
    // first sign of trouble would fail.
    if (!broken.includes('memory')) {
      assert.ok(
        !/UNAVAILABLE \[memory\]/.test(r.output),
        `an unrelated probe's failure degraded the memory check too (${label}):\n${r.output}`
      );
    }
    if (!broken.includes('control-plane')) {
      assert.ok(
        !/UNAVAILABLE \[control-plane\]/.test(r.output),
        `an unrelated probe's failure degraded the plane observation too (${label}):\n${r.output}`
      );
    }

    const key = ['none', 'one', 'two', 'all'][broken.length];
    reached[key] += 1;
  }

  // Reach is exhaustive by construction; asserted anyway so a future edit to
  // `subsets` that quietly drops a cardinality fails here rather than silently
  // narrowing the sweep.
  assert.deepEqual(reached, { none: 1, one: 3, two: 3, all: 1 }, `lattice coverage was not exhaustive: ${JSON.stringify(reached)}`);
});

test('BL-1071/BL-654 invariant 3: an unreadable probe is reported unavailable - not healthy, not absent', () => {
  // Only the probes that always have something to say about themselves. The
  // process gather is left to invariant 1's sweep and the acceptance scenario:
  // it is reportable only when there was a pane to gather for, so asserting it
  // here would be asserting against a check that legitimately had nothing to
  // say rather than against a silence.
  const cases = [
    { probe: 'memory', key: 'memory' },
    { probe: 'control-plane', key: 'control-plane' },
    { probe: 'memory+control-plane', key: 'control-plane', broken: ['memory', 'control-plane'] },
  ];

  for (const { probe, key, broken } of cases) {
    const fixture = breakProbes(makeSweepFixture(mkdir), broken ?? [probe]);
    const r = runSweep(fixture);

    // Its own answer: present, and named UNAVAILABLE.
    assert.match(
      r.output,
      new RegExp(`UNAVAILABLE \\[${key}\\]`),
      `reported no finding at all for a probe it could not read (${probe}):\n${r.output}`
    );
    // Never a healthy reading: an all-clear line would fold an unread probe
    // into the green, which is the silence the incident was made of.
    assert.ok(
      !/OK all checks green/.test(r.output),
      `an unread probe was folded into the all-clear (${probe}):\n${r.output}`
    );
    // Never an absence: an unreadable probe is not evidence the thing it
    // probes is gone, and a CRIT saying so is a cry-wolf a human learns to
    // stop reading.
    assert.ok(
      !new RegExp(`CRIT \\[${key}\\]`).test(r.output),
      `an unreadable probe was reported as an absence (${probe}):\n${r.output}`
    );
  }

  // The other direction, so "report everything unavailable" cannot pass: with
  // nothing broken, neither probe claims to be unreadable.
  const healthy = runSweep(breakProbes(makeSweepFixture(mkdir), []));
  assert.ok(
    !/UNAVAILABLE \[(memory|control-plane)\]/.test(healthy.output),
    `a healthy sweep reported a probe unavailable:\n${healthy.output}`
  );
  // Nor does a working `ps` report its own gather as unavailable. (The live
  // role does draw a half-launch CRIT here, and correctly so: the fixture's
  // tmux reports a pane pid that no real process sits under. That is the
  // check working, not a probe failing to read, which is why the assertion is
  // about the gather's availability rather than about the role being quiet.)
  assert.ok(
    !/UNAVAILABLE \[proc-gather-/.test(healthy.output),
    `a healthy sweep reported the process gather unavailable:\n${healthy.output}`
  );
});
