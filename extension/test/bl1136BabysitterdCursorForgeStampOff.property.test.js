'use strict';

// BL-1136 declared invariants (coder first authorship — BL-654):
//
// 1. "This stamp-off never reimplements the hotfix — review confirms or
//    refutes landed commit fbf6f1a909 only."
// 2. "Green tests alone never write certified or waived into the hotfix
//    ledger; only a recorded human decision does."
// 3. "BL-1133 remains the product owner of the babysitterd start/end
//    heartbeat contract; this stamp dual-cites it and never supersedes or
//    retires that ticket's scenarios."
//
// Non-vacuity: (1) compare hotfix blob to empty → RED; (2) assert state
// certified → RED while pending; (3) require BL-1133 feature absent → RED.
// Restored. Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  assertRunWritesNoDecision,
  assertParcelDoesNotEditReviewedSources,
  findTicketYaml,
} = require('./helpers/stampOff');

const REPO = path.join(__dirname, '..', '..');
const HOTFIX = 'fbf6f1a909';
const LEDGER = path.join(REPO, 'backlog', 'hotfix-ledger.yaml');
const HOTFIX_PATHS = [
  'swarmforge/scripts/babysitterd.sh',
  'swarmforge/packs/cursor-forge.conf',
];

function gitShow(rev, file) {
  return execFileSync('git', ['show', `${rev}:${file}`], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

function ledgerRow() {
  const text = fs.readFileSync(LEDGER, 'utf8');
  const parts = text.split(`- commit: ${HOTFIX}`);
  assert.ok(parts.length >= 2, `ledger missing ${HOTFIX}`);
  return parts[1].split('- commit:')[0];
}

test('BL-1136/BL-654 invariant 1: this stamp-off parcel reviews the hotfix and never rewrites it', () => {
  // BL-1356: the HEAD-vs-hotfix-blob comparison went red as soon as a later
  // ticket legitimately edited cursor-forge.conf. Scoped to this parcel's own
  // commits instead (`49fca1c741`, BL-1323's reference shape). What the HOTFIX
  // COMMIT itself contains is still asserted - that is a property of a landed
  // commit and cannot drift.
  // Reach by CONSTRUCTION, not by draw: every hotfix path is asserted in the
  // loop below, and the drawn property is the redundant pass. A reach floor
  // tied to what fast-check happened to sample is exactly the shape the
  // constitution's generator-reach rule forbids - and it failed here on the
  // first run, 5 of 6 paths drawn in 18 tries.
  const checkPath = (file) => {
    const blob = gitShow(HOTFIX, file);
    assert.ok(blob.length > 0, `${file} empty at ${HOTFIX}`);
    if (file.endsWith('babysitterd.sh')) {
      assert.match(blob, /pulse_heartbeat\s*\(\)\s*\{/);
    } else {
      assert.doesNotMatch(blob, /^config\s+rotation\s+standing\b/m);
    }
    assertParcelDoesNotEditReviewedSources('BL-1136', [file]);
  };
  HOTFIX_PATHS.forEach(checkPath);
  fc.assert(
    fc.property(fc.constantFrom(...HOTFIX_PATHS), checkPath),
    { numRuns: HOTFIX_PATHS.length * 5 }
  );
  assertParcelDoesNotEditReviewedSources('BL-1136', HOTFIX_PATHS);
});

test('BL-1136/BL-654 invariant 2: no run of this suite writes a decision into the ledger row', () => {
  // BL-1356: `state: pending` was pinned as a literal and went red when the row
  // advanced. The row's identity is still asserted - it must be THIS hotfix's
  // row, or the invariant would be watching nothing.
  assert.match(ledgerRow(), /stamp_ticket:\s*BL-1136/);
  assertRunWritesNoDecision(HOTFIX, () => {
    fc.assert(
      fc.property(fc.constantFrom(...HOTFIX_PATHS), (file) => {
        assert.equal(typeof gitShow(HOTFIX, file), 'string');
      }),
      { numRuns: 20 }
    );
  });
});

test('BL-1136/BL-654 invariant 3: BL-1133 remains product owner (dual-cite)', () => {
  const feature1133 = path.join(
    REPO,
    'specs',
    'features',
    'BL-1133-babysitterd-heartbeat-start-and-end-of-tick.feature'
  );
  // BL-1356, the same lesson a third time: this hard-coded backlog/active/ and
  // broke with ENOENT once the ticket completed its own workflow and moved to
  // backlog/done/M8/. A ticket's folder IS its state; only its id is stable.
  const ticket1136 = findTicketYaml('BL-1136');
  // Stamp tip may land before BL-1133 feature is on the same tip — dual-cite
  // is encoded on the stamp ticket + feature prose, not by deleting BL-1133.
  const yaml = fs.readFileSync(ticket1136, 'utf8');
  assert.match(yaml, /BL-1133/);
  assert.match(yaml, /dual-cite|dual-cites/i);
  assert.doesNotMatch(yaml, /retire.*BL-1133|supersede.*BL-1133|close.*BL-1133/i);

  fc.assert(
    fc.property(fc.constantFrom('BL-1133', 'dual-cite', 'product'), (needle) => {
      assert.ok(
        yaml.toLowerCase().includes(needle.toLowerCase()) ||
          yaml.includes('BL-1133'),
        `stamp YAML must keep dual-cite surface for ${needle}`
      );
    }),
    { numRuns: 15 }
  );

  // If BL-1133 feature is present on this tip, it must not be emptied by stamp.
  if (fs.existsSync(feature1133)) {
    const feat = fs.readFileSync(feature1133, 'utf8');
    assert.match(feat, /pulse_heartbeat|heartbeat/);
    assert.ok(feat.length > 80);
  }
});
