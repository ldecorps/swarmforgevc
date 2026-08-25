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

test('BL-1115/BL-654 invariant 1: stamp-off tree keeps hotfix blobs for landed paths', () => {
  let draws = 0;
  fc.assert(
    fc.property(fc.constantFrom(...HOTFIX_PATHS), (file) => {
      draws += 1;
      const hotfixBlob = gitShow(HOTFIX, file);
      const headBlob = fs.readFileSync(path.join(REPO, file), 'utf8');
      assert.equal(headBlob, hotfixBlob, `${file} diverged from ${HOTFIX}`);
    }),
    { numRuns: HOTFIX_PATHS.length * 5 }
  );
  assert.ok(draws >= HOTFIX_PATHS.length);
});

test('BL-1115/BL-654 invariant 2: green tests do not certify or waive the ledger row', () => {
  const entry = ledgerEntry();
  assert.match(entry, /\bstate:\s*pending\b/);
  assert.match(entry, /\bhuman_decision:\s*null\b/);
  assert.doesNotMatch(entry, /\bstate:\s*certified\b/);
  assert.doesNotMatch(entry, /\bstate:\s*waived\b/);
  assert.doesNotMatch(entry, /\bhuman_decision:\s*certified\b/);
  assert.doesNotMatch(entry, /\bhuman_decision:\s*waived\b/);

  fc.assert(
    fc.property(fc.constantFrom('certified', 'waived'), (forbidden) => {
      assert.doesNotMatch(
        entry,
        new RegExp(`\\bstate:\\s*${forbidden}\\b`),
        `ledger must not show state ${forbidden} without a human decision`
      );
      assert.doesNotMatch(
        entry,
        new RegExp(`\\bhuman_decision:\\s*${forbidden}\\b`),
        `ledger must not show human_decision ${forbidden} from green tests alone`
      );
    }),
    { numRuns: 20 }
  );
});
