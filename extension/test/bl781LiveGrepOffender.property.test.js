'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { isLiveGrepOffender } = require('../../specs/pipeline/steps/lib/bl781LiveGrepOffender');

// BL-781 declared invariants (coder-authored first, BL-654):
// 1. Scenario 15 "no wake runtime remains" is by absence, not allowlist exemption.
// 2. Salvaged assess_lib / nudge_lib / nudge_resident remain live.

const REPO_ROOT = path.join(__dirname, '..', '..');
const BL611_STEPS = path.join(
  REPO_ROOT,
  'specs',
  'pipeline',
  'steps',
  'bl611BabysitterdLifecycleSteps.js'
);

const DELETED_WAKE = [
  'swarmforge/scripts/babysitter_lib.bb',
  'swarmforge/scripts/babysitter_enqueue_wake.sh',
  'swarmforge/scripts/babysitter_assess.bb',
];

const SALVAGED = [
  'swarmforge/scripts/babysitter_assess_lib.bb',
  'swarmforge/scripts/babysitter_nudge_lib.bb',
  'swarmforge/scripts/babysitter_nudge_resident.bb',
];

const featureRelArb = fc
  .stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}\.feature$/)
  .map((name) => `specs/features/${name}`);

const productRelArb = fc
  .stringMatching(/^[a-z][a-z0-9_-]{0,20}\.(js|bb|sh)$/)
  .map((name) => `swarmforge/scripts/${name}`);

test('invariant: every specs/features hit is non-live (generator reaches feature paths)', () => {
  fc.assert(
    fc.property(featureRelArb, (rel) => {
      assert.equal(isLiveGrepOffender(rel), false);
    }),
    { numRuns: 50 }
  );
});

test('invariant: product script hits stay live (paired collision-style counterpart)', () => {
  fc.assert(
    fc.property(productRelArb, (rel) => {
      // Exclude salvaged/deleted basenames that are subject matter of other checks.
      const base = path.basename(rel);
      if (DELETED_WAKE.some((p) => path.basename(p) === base)) return;
      if (SALVAGED.some((p) => path.basename(p) === base)) return;
      assert.equal(isLiveGrepOffender(rel), true);
    }),
    { numRuns: 50 }
  );
});

test('invariant: BL-611 allowlist does not exempt deleted wake-runtime paths', () => {
  const src = fs.readFileSync(BL611_STEPS, 'utf8');
  const allowblock = src.match(/function isAllowedBabysitterMatch[\s\S]*?^}/m);
  assert.ok(allowblock, 'isAllowedBabysitterMatch must exist');
  for (const dead of DELETED_WAKE) {
    assert.equal(
      allowblock[0].includes(`'${dead}'`),
      false,
      `allowlist must not name ${dead}`
    );
  }
});

test('invariant: salvaged babysitter libraries remain on disk', () => {
  for (const rel of SALVAGED) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `missing salvaged lib ${rel}`);
  }
});

test('non-vacuous: omitting specs/features exclusion would flag a feature path', () => {
  const broken = (rel) => {
    const norm = String(rel || '').replace(/^\.\//, '');
    if (norm.startsWith('backlog/') || norm.startsWith('docs/')) return false;
    if (norm.startsWith('specs/pipeline/steps/')) return false;
    if (norm.startsWith('swarmforge/scripts/test/')) return false;
    return norm.length > 0;
  };
  const feature =
    'specs/features/BL-781-retire-dead-babysitter-files-keep-list-preserved.feature';
  assert.equal(broken(feature), true);
  assert.equal(isLiveGrepOffender(feature), false);
});
