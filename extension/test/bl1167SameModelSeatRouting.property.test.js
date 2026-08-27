'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'seat_difficulty_lib.bb');

function confLine(seat, model, tier) {
  return `window ${seat} claude ${seat} --model ${model} --seat-tier ${tier}`;
}

function claimDecision(conf, cost) {
  const script = `
(load-file ${JSON.stringify(LIB)})
(let [conf (slurp *in*)
      models (seat-difficulty-lib/parse-seat-models conf)
      seats (seat-difficulty-lib/parse-window-seats conf)
      tiers (seat-difficulty-lib/parse-seat-tiers conf)
      uniform? (seat-difficulty-lib/stage-models-uniform? models seats "coder")
      decision (seat-difficulty-lib/difficulty-claim-decision
        {:me "coder@cursor2" :my-tier "easy" :cost ${JSON.stringify(cost)} :stage "coder"
         :tiers tiers :models models :window-seats seats
         :sibling-states [{:role "coder" :tier "hard" :busy? true}]})]
  (println (str uniform? "|" (name decision))))
`;
  const res = spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    input: conf,
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const [uniform, decision] = res.stdout.trim().split('|');
  return { uniform: uniform === 'true', decision };
}

test('BL-1167 P1: identical models ⇒ uniform and easy may claim high', () => {
  fc.assert(
    fc.property(fc.constantFrom('auto', 'opus', 'sonnet'), (model) => {
      const conf = `${confLine('coder', model, 'hard')}\n${confLine('coder@cursor2', model, 'easy')}\n`;
      const { uniform, decision } = claimDecision(conf, 'high');
      assert.equal(uniform, true);
      assert.equal(decision, 'claim');
    }),
    { numRuns: 3 }
  );
});

test('BL-1167 P2: distinct models ⇒ not uniform and easy skips high', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('auto', 'opus', 'sonnet'),
      fc.constantFrom('auto', 'opus', 'sonnet'),
      (a, b) => {
        fc.pre(a !== b);
        const conf = `${confLine('coder', a, 'hard')}\n${confLine('coder@cursor2', b, 'easy')}\n`;
        const { uniform, decision } = claimDecision(conf, 'high');
        assert.equal(uniform, false);
        assert.equal(decision, 'skip-ineligible');
      }
    ),
    { numRuns: 6 }
  );
});
