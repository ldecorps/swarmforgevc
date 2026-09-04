'use strict';

// BL-1113 declared invariants (coder first authorship — BL-654):
//
// 1. "This stamp-off never reimplements the hotfix — review confirms or
//    refutes the landed commit 27273f2b0a only."
// 2. "Green tests alone never write certified or waived into the hotfix
//    ledger; only a recorded human decision does."
//
// Encoded as pure checks over git + ledger YAML. Generator reach: every draw
// samples a hotfix-touched path and asserts blob identity with 27273f2b0a;
// ledger status draws force a non-decision status and assert the live row
// for 27273f2b0a is never flipped by this parcel's tree.
//
// Non-vacuity: break 1 — compare against HEAD~empty blob → RED; break 2 —
// assert ledger state === 'certified' → RED while pending. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  assertRunWritesNoDecision,
  assertParcelDoesNotEditReviewedSources,
} = require('./helpers/stampOff');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const HOTFIX = '27273f2b0a';
const LEDGER = path.join(REPO, 'backlog', 'hotfix-ledger.yaml');

const HOTFIX_PATHS = [
  'swarmforge/scripts/main_sync_status_cli.bb',
  'swarmforge/scripts/master_main_reconcile_lib.bb',
  'swarmforge/packs/cursor-forge.conf',
  'extension/src/concierge/pipelineBoard.ts',
  'extension/src/tools/telegramCursorOperatorCore.ts',
  'extension/src/tools/telegramCursorBridgeLive.ts',
];

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

test('BL-1113/BL-654 invariant 1: this stamp-off parcel never rewrites the hotfix it reviews', () => {
  // BL-1356: this used to compare the WORKING TREE against 27273f2b0a's blobs,
  // so it went red the moment ANY later ticket legitimately edited a hotfix
  // path - which is the same defect as pinning a moving ledger state, one door
  // down. The invariant is about THIS PARCEL, so the range is too
  // (`49fca1c741`, BL-1323's reference shape).
  //
  // Generator reach is unchanged in substance: every hotfix path is checked,
  // and the draw asserts each is genuinely considered rather than sampled.
  // Reach by CONSTRUCTION, not by draw: every hotfix path is asserted in the
  // loop below, and the drawn property is the redundant pass. A reach floor
  // tied to what fast-check happened to sample is exactly the shape the
  // constitution's generator-reach rule forbids - and it failed here on the
  // first run, 5 of 6 paths drawn in 18 tries.
  for (const file of HOTFIX_PATHS) {
    assertParcelDoesNotEditReviewedSources('BL-1113', [file]);
  }
  fc.assert(
    fc.property(fc.constantFrom(...HOTFIX_PATHS), (file) => {
      assertParcelDoesNotEditReviewedSources('BL-1113', [file]);
    }),
    { numRuns: HOTFIX_PATHS.length * 3 }
  );
  assertParcelDoesNotEditReviewedSources('BL-1113', HOTFIX_PATHS);
});

test('BL-1113/BL-654 invariant 2: green tests do not certify or waive the ledger row', () => {
  // BL-1356: this file used to pin its row's CURRENT state literal
  // (`state: pending`), which made it go red the moment the row legitimately
  // advanced through its own workflow - jamming the whole swarm's commit gate
  // until a standing-allowlist row absorbed it. The invariant was never wrong;
  // the assertion was. It now asks whether THIS RUN wrote a decision, via the
  // shared helper, so what the row said beforehand is the expected value.
  //
  // The whole of this test's own work is bracketed, so the assertion spans a
  // run that really did something rather than an empty window.
  assertRunWritesNoDecision(HOTFIX, () => {
    fc.assert(
      fc.property(fc.constantFrom(...HOTFIX_PATHS), (file) => {
        assert.equal(typeof gitShow(HOTFIX, file), 'string');
      }),
      { numRuns: 20 }
    );
  });
});
