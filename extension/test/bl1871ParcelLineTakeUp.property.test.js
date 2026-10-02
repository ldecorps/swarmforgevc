'use strict';

// BL-1871 declared invariants (coder first authorship - BL-654):
//
// 1. Taking up a parcel never loses a commit: the head a role moves off
//    stays reachable from a ref, and a worktree with uncommitted tracked
//    changes is never moved.
// 2. Taking up a git_handoff never creates a commit: afterwards HEAD is the
//    cited commit or a commit the role made on top of it (or where it was),
//    never a merge of it with what the role held before.
// 3. The master checkout's branch and HEAD are never changed: parcel-intent
//    answers :skip for every master-resident parcel, whatever it holds.
//
// Invariants 1 and 2 run each generated op sequence against a real mkdtemp
// git fixture inside ONE bb process per draw (the lib loads once, BL-1865's
// per-spawn cost). Generator reach is asserted, not hoped for: across the
// draws the sequences must move, stay on work-on-top, and be blocked by a
// dirty tree. REACH_EXAMPLE runs first and reaches all three by itself:
// ten random draws missed work-on-top in about 1 run in 20, and that red
// held a parcel at QA on 2026-10-02. Invariant 3 batches every draw into
// one bb call.
//
// Non-vacuity: with take-up!'s dirty check removed (move-decision's
// (seq dirty-paths) clause), invariant 1 fails on the first blocked op; with
// :master? ignored in parcel-intent, invariant 3 fails. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'parcel_line_lib.bb');

function bb(expr) {
  return execFileSync('bb', ['-e', `(load-file ${JSON.stringify(LIB)})\n${expr}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const RUN_OPS = `
(require '[babashka.fs :as fs] '[babashka.process :as p] '[clojure.string :as str] '[cheshire.core :as json])
(defn g [d & a] (let [r (apply p/sh "git" "-c" "user.email=t@t" "-c" "user.name=t" "-C" (str d) a)]
  (when-not (zero? (:exit r)) (throw (ex-info (str a (:err r)) {}))) (str/trim (:out r))))
(defn g? [d & a] (zero? (:exit (apply p/sh "git" "-C" (str d) a))))
(defn cmt [d f msg] (spit (str (fs/path d f)) (str msg (rand) "\\n")) (g d "add" f) (g d "commit" "-q" "-m" msg) (g d "rev-parse" "HEAD"))
(defn run-ops [ops]
  (let [root (str (fs/create-temp-dir {:prefix "bl1871prop-"}))
        reach (atom {:move 0 :stay-on-top 0 :blocked 0})]
    (try
      (g root "init" "-q" "-b" "main")
      (assert (= (str (fs/path root ".git")) (str (fs/absolutize (fs/path root (g root "rev-parse" "--git-common-dir"))))))
      (cmt root "a.txt" "init")
      (g root "update-ref" "refs/remotes/origin/main" "HEAD")
      (let [wt (str (fs/path root "wt"))
            _ (g root "worktree" "add" "-q" "-b" "swarmforge-architect" wt)
            _ (cmt wt "o.txt" "BL-9000: other")
            lines (vec (for [i (range 3)]
                         (do (g root "checkout" "-q" "--detach" "origin/main")
                             (cmt root (str "l" i ".txt") (str "BL-900" (inc i) ": line")))))]
        (doseq [op ops]
          (case (first op)
            "on-top" (cmt wt "top.txt" "BL-9001: role work")
            "dirty" (spit (str (fs/path wt "a.txt")) (str "dirty" (rand) "\\n"))
            "clean" (g wt "checkout" "--" "a.txt")
            "take-up"
            (let [cited (nth lines (second op))
                  before (g wt "rev-parse" "HEAD")
                  dirty? (seq (parcel-line-lib/dirty-tracked-paths wt))
                  _ (with-out-str (parcel-line-lib/take-up! {:root wt :role "architect"
                                                             :intent {:intent :take-up :commit cited}}))
                  after (g wt "rev-parse" "HEAD")
                  backups (str/split-lines (g wt "for-each-ref" "--format=%(objectname)" "refs/swarmforge/parcel-backup/"))]
              ;; invariant 1
              (when dirty? (assert (= before after) (str "dirty worktree moved " before " -> " after)))
              (assert (or (= before after) (some #{before} backups)) (str "left head unreachable " before))
              ;; invariant 2
              (assert (or (= after before) (= after cited)) (str "HEAD " after " is neither held nor cited"))
              (assert (not (g? wt "rev-parse" "-q" "--verify" (str after "^2"))) "HEAD is a merge")
              (cond
                (not= before after) (swap! reach update :move inc)
                dirty? (swap! reach update :blocked inc)
                (and (not= after cited) (g? wt "merge-base" "--is-ancestor" cited after)) (swap! reach update :stay-on-top inc))))))
      (println (json/generate-string @reach))
      (finally (fs/delete-tree root)))))
`;

const op = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 0, max: 2 }).map((i) => ['take-up', i]) },
  { weight: 2, arbitrary: fc.constant(['on-top']) },
  { weight: 1, arbitrary: fc.constant(['dirty']) },
  { weight: 1, arbitrary: fc.constant(['clean']) }
);

// Six moves, one dirty-tree block, one stay on the role's own work on top.
const REACH_EXAMPLE = [
  ['take-up', 0], ['on-top'], ['take-up', 0],
  ['dirty'], ['take-up', 1], ['clean'],
  ['take-up', 1], ['take-up', 2], ['take-up', 0], ['take-up', 1], ['take-up', 2],
];

test(
  'BL-1871/BL-654 invariants 1 and 2: a take-up loses no commit, never moves a dirty tree, never makes a commit',
  () => {
    const total = { move: 0, 'stay-on-top': 0, blocked: 0 };
    fc.assert(
      fc.property(fc.array(op, { minLength: 8, maxLength: 16 }), (ops) => {
        const out = bb(`${RUN_OPS}\n(run-ops (json/parse-string ${JSON.stringify(JSON.stringify(ops))}))`);
        const reach = JSON.parse(out.split('\n').pop());
        for (const k of Object.keys(total)) total[k] += reach[k];
      }),
      { numRuns: 10, examples: [[REACH_EXAMPLE]] }
    );
    // Generator reach floor: every state the invariants quantify over occurred.
    assert.ok(total.move >= 5, `moves reached: ${JSON.stringify(total)}`);
    assert.ok(total.blocked >= 1, `blocked reached: ${JSON.stringify(total)}`);
    assert.ok(total['stay-on-top'] >= 1, `work-on-top reached: ${JSON.stringify(total)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1871/BL-654 invariant 3: a master-resident parcel is always skipped, whatever it holds',
  () => {
    const facts = fc.record({
      master: fc.boolean(),
      role: fc.constantFrom('specifier', 'coordinator', 'coder', 'coder@2', 'architect'),
      type: fc.constantFrom('git_handoff', 'note'),
      nonForwarding: fc.boolean(),
      commit: fc.constantFrom('', 'abc1234567'),
      work: fc.constantFrom(null, 'BL-9002'),
    });
    const draws = fc.sample(facts, 200);
    const edn = draws
      .map(
        (f) =>
          `{:master? ${f.master} :role ${JSON.stringify(f.role)} :type ${JSON.stringify(f.type)} :non-forwarding? ${
            f.nonForwarding
          } :commit ${JSON.stringify(f.commit)} :work-ticket ${f.work ? JSON.stringify(f.work) : 'nil'}}`
      )
      .join(' ');
    const out = bb(`(doseq [f [${edn}]] (println (name (:intent (parcel-line-lib/parcel-intent f)))))`).split('\n');
    assert.equal(out.length, draws.length);
    let movable = 0;
    draws.forEach((f, i) => {
      if (f.master) assert.equal(out[i], 'skip', `master parcel ${JSON.stringify(f)} answered ${out[i]}`);
      else if (out[i] !== 'skip') movable += 1;
    });
    // Reach: non-master draws that do move exist, so the skip is not universal.
    assert.ok(movable >= 10, `movable non-master draws: ${movable}`);
    assert.ok(draws.filter((f) => f.master && f.type === 'git_handoff' && f.commit && !f.nonForwarding).length >= 5);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
