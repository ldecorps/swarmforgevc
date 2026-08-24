'use strict';

// BL-1001 declared invariants (coder-authored). Runs via npm run test:properties.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'seat_difficulty_lib.bb');

function edn(expr) {
  const res = spawnSync(
    'bb',
    [
      '-e',
      `(load-file ${JSON.stringify(LIB)}) (require '[cheshire.core :as json]) (println (json/generate-string ${expr}))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  assert.equal(res.status, 0, res.stderr || res.stdout);
  return JSON.parse(res.stdout.trim());
}

const costs = ['low', 'medium', 'high'];
const tiers = ['easy', 'hard'];

test('BL-1001 invariant 1: easy never accepts medium/high however idle', () => {
  let reached = 0;
  fc.assert(
    fc.property(fc.constantFrom('medium', 'high'), (cost) => {
      reached += 1;
      const d = edn(
        `(seat-difficulty-lib/difficulty-claim-decision {:me "coder@sonnet2" :my-tier "easy" :cost ${JSON.stringify(cost)} :stage "coder" :tiers {"coder" "hard" "coder@sonnet2" "easy"} :sibling-states [{:role "coder" :tier "hard" :busy? true}]})`
      );
      assert.equal(d, 'skip-ineligible');
    }),
    { numRuns: 8 }
  );
  assert.ok(reached >= 2);
});

test('BL-1001 invariant 2: exchanging declared tiers exchanges routing for high', () => {
  let reached = 0;
  fc.assert(
    fc.property(fc.boolean(), (swap) => {
      reached += 1;
      const coderTier = swap ? 'easy' : 'hard';
      const sonnetTier = swap ? 'hard' : 'easy';
      const tiersMap = `{"coder" ${JSON.stringify(coderTier)} "coder@sonnet2" ${JSON.stringify(sonnetTier)}}`;
      const dCoder = edn(
        `(seat-difficulty-lib/difficulty-claim-decision {:me "coder" :my-tier ${JSON.stringify(coderTier)} :cost "high" :stage "coder" :tiers ${tiersMap} :sibling-states [{:role "coder@sonnet2" :tier ${JSON.stringify(sonnetTier)} :busy? false}]})`
      );
      const dSonnet = edn(
        `(seat-difficulty-lib/difficulty-claim-decision {:me "coder@sonnet2" :my-tier ${JSON.stringify(sonnetTier)} :cost "high" :stage "coder" :tiers ${tiersMap} :sibling-states [{:role "coder" :tier ${JSON.stringify(coderTier)} :busy? false}]})`
      );
      if (swap) {
        assert.equal(dCoder, 'skip-ineligible');
        assert.equal(dSonnet, 'claim');
      } else {
        assert.equal(dCoder, 'claim');
        assert.equal(dSonnet, 'skip-ineligible');
      }
    }),
    { numRuns: 8 }
  );
  assert.ok(reached >= 2);
});

test('BL-1001: no declared tiers leaves BL-983 claim path unchanged', () => {
  const d = edn(
    `(seat-difficulty-lib/difficulty-claim-decision {:me "coder" :my-tier nil :cost "high" :stage "coder" :tiers {} :sibling-states []})`
  );
  assert.equal(d, 'claim');
});
