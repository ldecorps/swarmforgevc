'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO = path.join(__dirname, '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env },
  });
}

// I1: successful rematch-then-FF land → behind 0, no operator absorb.
test('property (invariant 1): rematch-then-FF land outcome is behind=0 proceed without operator absorb', () => {
  fc.assert(
    fc.property(fc.constantFrom(':ff-absorb', ':noop'), (absorb) => {
      const r = runBb(`
(load-file "${LIB}")
(def out (master-main-reconcile-lib/land-pipeline-outcome
          {:prepublish-plan :already-contains-origin
           :absorb-plan ${absorb}
           :mid-merge? false}))
(println (:behind out) (:ok? out) (:designed-recovery-operator-absorb? out) (name (:sync-action out)))
`);
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.match(r.stdout || '', /0 true false proceed/);
    }),
    { numRuns: 4 }
  );
});

// I2: conflict → rematch owner, never operator absorb page wording.
test('property (invariant 2): rematch outcomes never design operator absorb recovery', () => {
  const outcomes = fc.constantFrom(':rematch-bookkeeping', ':refuse-rematch');
  fc.assert(
    fc.property(outcomes, (outcome) => {
      const r = runBb(`
(load-file "${LIB}")
(assert (master-main-reconcile-lib/rematch-owner-recovery?
         (master-main-reconcile-lib/merge-failure-reason ${outcome})))
(def tg (master-main-reconcile-lib/escalation-telegram-text
         (master-main-reconcile-lib/merge-failure-reason ${outcome}) 2 3))
(assert (not (re-find #"(?i)needs a human|complete origin/main merge" tg)))
(println "OK")
`);
      assert.equal(r.status, 0, r.stderr || r.stdout);
    }),
    { numRuns: 6 }
  );
});

// I3: BL-1130 — refuse clean, no MERGE_HEAD left by may-abort false for foreign.
test('property (invariant 3): may-abort-failed-merge? is false when this tick did not start the merge', () => {
  const r = runBb(`
(load-file "${LIB}")
(assert (not (master-main-reconcile-lib/may-abort-failed-merge? false)))
(assert (master-main-reconcile-lib/may-abort-failed-merge? true))
(println "OK")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

// I4: live sweep with rematch-bookkeeping merge! never escalates Operator.
test('property (invariant 4): rematch-bookkeeping sweep surfaces rematch and never escalates', () => {
  const ticksArb = fc.integer({ min: 1, max: 5 });
  fc.assert(
    fc.property(ticksArb, (runs) => {
      const tmp = mkTmpDir('bl1135-prop-');
      const daemonDir = path.join(tmp, 'daemon');
      fs.mkdirSync(daemonDir, { recursive: true });
      const r = runBb(`
(load-file "${LIB}")
(def surfaces (atom []))
(def escalations (atom []))
(dotimes [_ ${runs}]
  (master-main-reconcile-lib/sweep!
   "${daemonDir}"
   3
   {:rev-counts! (fn [] {:ahead 1 :behind 2})
    :dirty-paths! (fn [] #{})
    :merge-changed-paths! (fn [] #{})
    :merge! (fn [] {:success false :outcome :rematch-bookkeeping :error "rematch-bookkeeping"})
    :surface! (fn [m] (swap! surfaces conj m))
    :escalate! (fn [m] (swap! escalations conj m))
    :log! (fn [& _])}))
(println "SURFACES" (count @surfaces))
(println "ESCALATIONS" (count @escalations))
(when (some #(re-find #"(?i)needs a human|complete origin/main merge" (str %)) @surfaces)
  (println "BAD"))
`);
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.match(r.stdout || '', /ESCALATIONS 0/);
      assert.doesNotMatch(r.stdout || '', /BAD/);
      assert.match(r.stdout || '', /SURFACES 1/);
    }),
    { numRuns: 5 }
  );
});
