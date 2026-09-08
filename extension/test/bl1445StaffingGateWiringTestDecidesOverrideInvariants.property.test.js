'use strict';

// BL-1445's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  Every environment variable the launcher's gate path or the
//                gate CLI reads (PACK_STAFFING_SKIP_GATE,
//                MODEL_STEWARD_STATE_DIR) is set or unset explicitly by
//                each case of the wiring test; none is inherited from the
//                pane, so the test decides identically under every launch
//                environment.
//   invariant 2  The wiring test's own override case (03) stays the only
//                place the override is on, and it turns it on explicitly
//                for that case alone.
//
// Drives the REAL swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh
// as a real child process under a controlled environment - never a
// JavaScript restatement of its cases.
//
// GENERATOR REACH (the asserted floor, never a hoped-for one). The 2026-09-06
// incident needed the pane to export PACK_STAFFING_SKIP_GATE=1 specifically
// (`.swarmforge/swarm.env`'s own default), so every one of 1, 0, an unset
// pane, and an arbitrary garbage string must be exercised, crossed
// independently against a garbage vs. unset pane MODEL_STEWARD_STATE_DIR -
// 4*2 = 8 combinations, small and fully enumerable. This is a DETERMINISTIC
// exhaustive sweep over that Cartesian product, not fc.property sampling:
// `fc.constantFrom(...PANE_GATE_VALUES)` drawn i.i.d. across `numRuns` only
// GUARANTEES reach statistically, and at the 4-way/numRuns:12 shape this file
// originally used, missing any one value has a (3/4)^12 ~ 3.2% chance per
// value, ~13% summed across all four - confirmed empirically (BL-1445/
// BL-654 hardening, 2026-09-08): 4 of 5 consecutive real runs failed the
// reach assertion below on `reach.zero`/`reach.garbage`, contradicting this
// very comment's "GUARANTEES ... on every run". A finite, small domain like
// this one gets full coverage from enumeration, not from hoping fast-check's
// RNG lands on every constant within a handful of runs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WIRING_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_pack_staffing_gate_wiring.sh');

const PANE_GATE_VALUES = [undefined, '1', '0', 'banana-garbage'];

function runWiringTest(gateValue, staleStateDir) {
  const env = { ...process.env };
  if (gateValue === undefined) {
    delete env.PACK_STAFFING_SKIP_GATE;
  } else {
    env.PACK_STAFFING_SKIP_GATE = gateValue;
  }
  if (staleStateDir) {
    // A garbage pane-level MODEL_STEWARD_STATE_DIR - if any case failed to
    // override it explicitly, the gate's steward lookups would read this
    // nonexistent directory instead of the fixture's own STATE_DIR/
    // FRESH_STATE and every case would fail closed for the wrong reason.
    env.MODEL_STEWARD_STATE_DIR = path.join(os.tmpdir(), 'bl1445-nonexistent-pane-state-dir');
  } else {
    delete env.MODEL_STEWARD_STATE_DIR;
  }
  const r = spawnSync('bash', [WIRING_TEST], { encoding: 'utf8', env });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const STALE_STATE_DIR_VALUES = [false, true];

test('BL-1445/BL-654 invariant 1: the wiring test decides PACK_STAFFING_SKIP_GATE and MODEL_STEWARD_STATE_DIR itself, never inheriting either from the pane', () => {
  const reach = { unset: 0, one: 0, zero: 0, garbage: 0, staleStateDir: 0, freshStateDir: 0 };

  for (const gateValue of PANE_GATE_VALUES) {
    for (const staleStateDir of STALE_STATE_DIR_VALUES) {
      if (gateValue === undefined) reach.unset += 1;
      else if (gateValue === '1') reach.one += 1;
      else if (gateValue === '0') reach.zero += 1;
      else reach.garbage += 1;
      if (staleStateDir) reach.staleStateDir += 1;
      else reach.freshStateDir += 1;

      const { status, out } = runWiringTest(gateValue, staleStateDir);
      assert.equal(
        status,
        0,
        `the wiring test must pass regardless of the pane's own PACK_STAFFING_SKIP_GATE=${JSON.stringify(gateValue)} / stale-state-dir=${staleStateDir}:\n${out}`
      );
      assert.match(out, /ALL CHECKS PASSED/, `expected every case to pass:\n${out}`);
    }
  }

  assert.ok(reach.unset > 0, 'never exercised an unset pane export');
  assert.ok(reach.one > 0, 'never exercised the real incident value (PACK_STAFFING_SKIP_GATE=1)');
  assert.ok(reach.zero > 0, 'never exercised PACK_STAFFING_SKIP_GATE=0');
  assert.ok(reach.garbage > 0, 'never exercised an arbitrary non-canonical value');
  assert.ok(reach.staleStateDir > 0, 'never exercised a garbage pane MODEL_STEWARD_STATE_DIR');
  assert.ok(reach.freshStateDir > 0, 'never exercised an unset pane MODEL_STEWARD_STATE_DIR');
});

// invariant 2 is static (a property of the source text, not of any
// generated input): non-vacuous in the ordinary sense (fails if a second
// case turns the override on, or if case 03's own line is removed/altered)
// but has no random dimension to generate over, so it is asserted directly
// rather than through fc.property - still lives here, in the property-test
// file that is BL-654's coder-authored first pass over this ticket's
// declared invariants, never folded into the acceptance suite.
test('BL-1445/BL-654 invariant 2: case 03 is the only place the wiring test turns the override on', () => {
  const content = fs.readFileSync(WIRING_TEST, 'utf8');
  const assignmentLines = content.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return false;
    if (/\b(fail|pass)\s*"/.test(trimmed)) return false;
    return /PACK_STAFFING_SKIP_GATE=1\b/.test(trimmed);
  });
  assert.equal(
    assignmentLines.length,
    1,
    `expected exactly one place turning the override on (case 03), got ${assignmentLines.length}: ${JSON.stringify(assignmentLines)}`
  );
  assert.match(assignmentLines[0], /^OUT3=/, `expected the one override assignment to be case 03's own OUT3= line, got: ${assignmentLines[0]}`);
});
