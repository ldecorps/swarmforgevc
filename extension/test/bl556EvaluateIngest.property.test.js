'use strict';

// BL-556 has no ticket-declared `invariants:` block. This property file still
// locks two Slice-2 contracts the feature scenarios name (non-vacuous):
//   - missing scorecard_id always refuses (never invents an id)
//   - regression-diff only reports pass→fail flips
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO, 'swarmforge', 'scripts');

function bb(expr) {
  return execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${path.join(SCRIPTS, 'model_steward_lib.bb')}")
       (load-file "${path.join(SCRIPTS, 'model_steward_evaluate_lib.bb')}")
       ${expr}`,
    ],
    { encoding: 'utf8' }
  ).trim();
}

test('BL-556: missing scorecard_id refuses rather than inventing an id', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 12 }), (model) => {
      const edn = `{:model "${model}" :entries [] :overall "x"}`;
      let threw = false;
      try {
        bb(`(model-steward-evaluate-lib/require-scorecard-id ${edn})`);
      } catch {
        threw = true;
      }
      assert.equal(threw, true);
    }),
    { numRuns: 40 }
  );
});

test('BL-556: regression-diff reports only pass→fail gate flips', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.constantFrom('receive', 'send', 'tool', 'proto'), {
        minLength: 1,
        maxLength: 4,
      }),
      (gates) => {
        const prior = gates.map((g) => `{:gate "${g}" :passed? true :status "pass"}`).join(' ');
        const current = gates
          .map((g, i) =>
            `{:gate "${g}" :passed? ${i === 0 ? 'false' : 'true'} :status "${i === 0 ? 'fail' : 'pass'}"}`
          )
          .join(' ');
        const out = bb(
          `(println (pr-str (model-steward-evaluate-lib/regression-diff {:gates [${prior}]} [${current}])))`
        );
        assert.match(out, new RegExp(`:gate "${gates[0]}"`));
        assert.match(out, /:from "pass"/);
        assert.match(out, /:to "fail"/);
        assert.equal((out.match(/:gate "/g) || []).length, 1);
      }
    ),
    { numRuns: 30 }
  );
});
