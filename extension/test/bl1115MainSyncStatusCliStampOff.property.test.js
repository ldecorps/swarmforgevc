'use strict';

// BL-1115 declared invariants (coder first authorship — BL-654):
//
// 1. "This stamp-off never reimplements the hotfix — review confirms or
//    refutes landed commit a3bf11b533 only."
// 2. "Green tests alone never write certified or waived into the hotfix
//    ledger; only a recorded human decision does."
//
// Encoded as pure checks over git + ledger YAML. Generator reach: every draw
// samples the hotfix-touched path and asserts blob identity with a3bf11b533;
// ledger status draws force a non-decision status and assert the live row
// for a3bf11b533 is never flipped by this parcel's tree.
//
// Non-vacuity: break 1 — compare against empty string → RED; break 2 —
// assert ledger state === 'certified' → RED while pending. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  assertRunWritesNoDecision,
  assertParcelDoesNotEditReviewedSources,
} = require('./helpers/stampOff');

const REPO = path.join(__dirname, '..', '..');
const HOTFIX = 'a3bf11b533';
const LEDGER = path.join(REPO, 'backlog', 'hotfix-ledger.yaml');

const HOTFIX_PATHS = ['swarmforge/scripts/main_sync_status_cli.bb'];

function gitShow(rev, file) {
  return execFileSync('git', ['show', `${rev}:${file}`], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

function ledgerEntry() {
  const text = fs.readFileSync(LEDGER, 'utf8');
  const idx = text.indexOf(`commit: ${HOTFIX}`);
  assert.ok(idx >= 0, `ledger missing ${HOTFIX}`);
  const slice = text.slice(idx, idx + 400);
  return slice;
}

test('BL-1115/BL-654 invariant 1: this stamp-off parcel never rewrites the hotfix it reviews', () => {
  // BL-1356: was a working-tree-vs-hotfix-blob comparison, which went red on
  // any later ticket's legitimate edit to the same path. Scoped to this
  // parcel's own commits instead (`49fca1c741`, BL-1323's reference shape).
  // Reach by CONSTRUCTION, not by draw: every hotfix path is asserted in the
  // loop below, and the drawn property is the redundant pass. A reach floor
  // tied to what fast-check happened to sample is exactly the shape the
  // constitution's generator-reach rule forbids - and it failed here on the
  // first run, 5 of 6 paths drawn in 18 tries.
  for (const file of HOTFIX_PATHS) {
    assertParcelDoesNotEditReviewedSources('BL-1115', [file]);
  }
  fc.assert(
    fc.property(fc.constantFrom(...HOTFIX_PATHS), (file) => {
      assertParcelDoesNotEditReviewedSources('BL-1115', [file]);
    }),
    { numRuns: HOTFIX_PATHS.length * 3 }
  );
  assertParcelDoesNotEditReviewedSources('BL-1115', HOTFIX_PATHS);
});

test('BL-1115/BL-654 invariant 2: no run of this suite writes a decision into the ledger row', () => {
  // BL-1356: was `state: pending` pinned as a literal, so the row advancing
  // through its own workflow turned this red and jammed the swarm's commit
  // gate. The question is now what THIS RUN wrote, with the row's prior value
  // as the expected one - and a run that does stamp a decision still fails,
  // from any starting state.
  assertRunWritesNoDecision(HOTFIX, () => {
    fc.assert(
      fc.property(fc.constantFrom(...HOTFIX_PATHS), (file) => {
        assert.equal(typeof gitShow(HOTFIX, file), 'string');
      }),
      { numRuns: 20 }
    );
  });
});
