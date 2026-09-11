'use strict';

// BL-1526 declared invariant (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   The closure walk never silently drops a spawn edge - every
//   bb/bash/sh/zsh spawn vector in a reached file is either resolved to a
//   file, recorded as a non-bb script, or reported as unresolved by name
//   (BL-1022, restated for the shapes this ticket adds: a bare-symbol
//   target the file DECLARES dynamic resolves via the declaration instead
//   of being reported unresolved).
//
// GENERATOR REACH (BL-654): the acceptance feature's scenarios pin FIXED
// fixtures (one hand-written mystery/runner name each). This property test
// instead draws the spawned basename, the declared-dynamic symbol name and
// its reason at random for EVERY resolvable/non-bb/declared-dynamic shape
// the resolver supports, and re-derives the spawn form and (where relevant)
// the `daemon-spawn-declared-dynamic-targets` declaration FROM the drawn
// names - so every generated case exercises a genuinely distinct spawn site
// by construction, not a hoped-for one, and no single shape dominates the
// run (each shape's floor is asserted below, not just an aggregate count).
//
//   inv1 (positive, one case per shape): for each of the resolver's shapes -
//        bb bare literal, bb literal-in-path-plumbing, bb zero-arg helper,
//        bash literal-in-path-plumbing, bb declared-dynamic, bash
//        declared-dynamic - extract-spawn-targets places the ONE spawn form
//        in EXACTLY the shape's own category and no other.
//   inv2 (negative, the ticket's own "never earned by accident" clause): a
//        bare symbol the file does NOT declare is always :unresolved, even
//        when the SAME file declares a DIFFERENT name dynamic - declaring
//        one target can never launder an unrelated one.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WALK_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_checkout_drift_lib.bb');

const BASENAME = fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/);
const REASON = fc.stringMatching(/^[a-z][a-z0-9_ ]{2,20}$/);

function extractSpawnTargets(content) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file ${JSON.stringify(WALK_LIB)})
(let [r (master-checkout-drift-lib/extract-spawn-targets ${JSON.stringify(content)})]
  (println (json/generate-string
    {:resolved (vec (:resolved r))
     :unresolved (vec (:unresolved r))
     :non-bb (vec (:non-bb r))
     :declared-dynamic (vec (:declared-dynamic r))})))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 }
  );
  return JSON.parse(out.trim());
}

// Every category empty except the one named, which holds exactly `values`.
function assertOnlyCategory(result, category, values) {
  const categories = ['resolved', 'unresolved', 'non-bb', 'declared-dynamic'];
  for (const c of categories) {
    const expected = c === category ? values : [];
    assert.deepEqual(
      result[c].sort(),
      [...expected].sort(),
      `category ${c}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(result[c])} (full result ${JSON.stringify(result)})`
    );
  }
}

describe('BL-1526 declared invariant: the closure walk never silently drops a spawn edge', () => {
  it('inv1: a bb bare literal .bb target is :resolved to that script', () => {
    fc.assert(
      fc.property(BASENAME, (name) => {
        const target = `${name}.bb`;
        assertOnlyCategory(extractSpawnTargets(`(sh! ["bb" ${JSON.stringify(target)} x])`), 'resolved', [target]);
      }),
      { numRuns: 15 }
    );
  }, 60000);

  it('inv1: a bb literal wrapped in path plumbing is :resolved to that script', () => {
    fc.assert(
      fc.property(BASENAME, (name) => {
        const target = `${name}.bb`;
        assertOnlyCategory(
          extractSpawnTargets(`(sh! ["bb" (str (fs/path dir ${JSON.stringify(target)})) x])`),
          'resolved',
          [target]
        );
      }),
      { numRuns: 15 }
    );
  }, 60000);

  it('inv1: a bb zero-arg same-file helper resolves through its body to :resolved', () => {
    fc.assert(
      fc.property(BASENAME, BASENAME, (helperName, fileName) => {
        const helper = `helper_${helperName}`;
        const target = `${fileName}.bb`;
        const content = `(defn ${helper} []\n  (str (fs/path dir ${JSON.stringify(target)})))\n(sh! ["bb" (${helper}) x])`;
        assertOnlyCategory(extractSpawnTargets(content), 'resolved', [target]);
      }),
      { numRuns: 15 }
    );
  }, 60000);

  it('inv1: a bash literal wrapped in path plumbing is recorded :non-bb, never :resolved', () => {
    fc.assert(
      fc.property(BASENAME, (name) => {
        const target = `${name}.sh`;
        assertOnlyCategory(
          extractSpawnTargets(`(sh! ["bash" (str (fs/path dir ${JSON.stringify(target)})) root])`),
          'non-bb',
          [target]
        );
      }),
      { numRuns: 15 }
    );
  }, 60000);

  it('inv1: a bb bare symbol the file declares dynamic is :declared-dynamic, never :unresolved', () => {
    fc.assert(
      fc.property(BASENAME, REASON, (sym, reason) => {
        const content = `(def daemon-spawn-declared-dynamic-targets\n  {${JSON.stringify(sym)} ${JSON.stringify(reason)}})\n(sh! ["bb" ${sym} x])`;
        assertOnlyCategory(extractSpawnTargets(content), 'declared-dynamic', [`${sym} — ${reason}`]);
      }),
      { numRuns: 15 }
    );
  }, 60000);

  it('inv1: a bash bare symbol the file declares dynamic is :declared-dynamic, never :unresolved', () => {
    fc.assert(
      fc.property(BASENAME, REASON, (sym, reason) => {
        const content = `(def daemon-spawn-declared-dynamic-targets\n  {${JSON.stringify(sym)} ${JSON.stringify(reason)}})\n(sh! ["bash" ${sym} x])`;
        assertOnlyCategory(extractSpawnTargets(content), 'declared-dynamic', [`${sym} — ${reason}`]);
      }),
      { numRuns: 15 }
    );
  }, 60000);

  it('inv2: declaring one name never launders a DIFFERENT bare symbol in the same file - still :unresolved', () => {
    fc.assert(
      fc.property(BASENAME, BASENAME, REASON, (declaredSym, otherSym, reason) => {
        fc.pre(declaredSym !== otherSym);
        const content = `(def daemon-spawn-declared-dynamic-targets\n  {${JSON.stringify(declaredSym)} ${JSON.stringify(reason)}})\n(sh! ["bb" ${otherSym} x])`;
        assertOnlyCategory(extractSpawnTargets(content), 'unresolved', [otherSym]);
      }),
      { numRuns: 15 }
    );
  }, 60000);
});
