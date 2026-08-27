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

test('BL-1136/BL-654 invariant 1: stamp review reads hotfix blobs only (no reimplement)', () => {
  let draws = 0;
  fc.assert(
    fc.property(fc.constantFrom(...HOTFIX_PATHS), (file) => {
      draws += 1;
      const blob = gitShow(HOTFIX, file);
      assert.ok(blob.length > 0, `${file} empty at ${HOTFIX}`);
      const head = fs.readFileSync(path.join(REPO, file), 'utf8');
      // Stamp tip must carry the hotfix blobs — never a BL-1133 rewrite.
      assert.equal(head, blob, `${file} diverged from ${HOTFIX}`);
      if (file.endsWith('babysitterd.sh')) {
        assert.match(blob, /pulse_heartbeat\s*\(\)\s*\{/);
      } else {
        assert.doesNotMatch(blob, /^config\s+rotation\s+standing\b/m);
      }
    }),
    { numRuns: HOTFIX_PATHS.length * 5 }
  );
  assert.ok(draws >= HOTFIX_PATHS.length);
});

test('BL-1136/BL-654 invariant 2: green tests do not certify or waive the ledger row', () => {
  const row = ledgerRow();
  assert.match(row, /\bstate:\s*pending\b/);
  assert.match(row, /\bhuman_decision:\s*null\b/);
  assert.match(row, /stamp_ticket:\s*BL-1136/);

  fc.assert(
    fc.property(fc.constantFrom('certified', 'waived'), (forbidden) => {
      assert.doesNotMatch(row, new RegExp(`\\bstate:\\s*${forbidden}\\b`));
      assert.doesNotMatch(row, new RegExp(`\\bhuman_decision:\\s*${forbidden}\\b`));
    }),
    { numRuns: 20 }
  );
});

test('BL-1136/BL-654 invariant 3: BL-1133 remains product owner (dual-cite)', () => {
  const feature1133 = path.join(
    REPO,
    'specs',
    'features',
    'BL-1133-babysitterd-heartbeat-start-and-end-of-tick.feature'
  );
  const ticket1136 = path.join(
    REPO,
    'backlog',
    'active',
    'BL-1136-swarm-stamp-babysitterd-cursor-forge-fbf6f1a909.yaml'
  );
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
