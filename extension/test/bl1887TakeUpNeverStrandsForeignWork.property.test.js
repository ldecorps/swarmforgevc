'use strict';

// BL-1887 declared invariant (coder first authorship - BL-654):
//   "A take-up never leaves a role on a line that carries another ticket's
//    unlanded work."
//
// Each draw is a shift: a sequence of parcels for random tickets, each one a
// route (git_handoff at a commit already on origin/main), a build
// (git_handoff at a commit of that ticket off origin/main) or a coordinator
// Work note, taken up with the REAL parcel_line_lib.bb parcel-intent +
// take-up!, after which the role commits 0-2 commits of its own ticket.
// Ticket changes are built in: consecutive parcels draw from three tickets,
// so the line usually carries a previous ticket's work at the next take-up
// (the state the invariant quantifies over), and the reach floor asserts it.
// The whole draw runs in ONE bb process on a mkdtemp repo with a bare origin.
//
// Non-vacuity: with BL-1887's route clause removed from resolve-target (a
// take-up at a main commit falling through to the at-or-past stay), the
// route draws fail. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'parcel_line_lib.bb');

const parcel = fc.record({
  ticket: fc.constantFrom('BL-9001', 'BL-9002', 'BL-9003'),
  kind: fc.constantFrom('route', 'build', 'work-note'),
  work: fc.nat({ max: 2 }),
});

function runShift(parcels) {
  const steps = parcels.map((p) => `{:ticket "${p.ticket}" :kind :${p.kind} :work ${p.work}}`).join(' ');
  const program = `
(require '[babashka.fs :as fs] '[babashka.process :as p] '[clojure.string :as str])
(load-file ${JSON.stringify(LIB)})
(defn g [d & a] (let [r (apply p/sh "git" "-c" "user.email=t@t" "-c" "user.name=t" "-C" (str d) a)]
  (when-not (zero? (:exit r)) (throw (ex-info (str a (:err r)) {}))) (str/trim (:out r))))
(defn cmt [d f msg] (spit (str (fs/path d f)) (str msg (rand) "\\n")) (g d "add" f) (g d "commit" "-q" "-m" msg) (g d "rev-parse" "HEAD"))
(let [work (str (fs/create-temp-dir {:prefix "bl1887prop-"}))
      origin (str (fs/path work "origin.git")) root (str (fs/path work "repo"))]
  (try
    (p/sh "git" "init" "-q" "--bare" "-b" "main" origin)
    (p/sh "git" "init" "-q" "-b" "main" root)
    (assert (= (str (fs/path root ".git")) (str (fs/absolutize (fs/path root (g root "rev-parse" "--git-common-dir"))))))
    (spit (str (fs/path root ".gitignore")) ".worktrees/\\n.swarmforge/\\n")
    (g root "add" ".gitignore") (g root "commit" "-q" "-m" "seed")
    (g root "remote" "add" "origin" origin) (g root "push" "-q" "origin" "main") (g root "fetch" "-q" "origin")
    (let [wt (str (fs/path root ".worktrees" "coder")) side (str (fs/path root ".worktrees" "side"))]
      (g root "worktree" "add" "-q" "-b" "swarmforge-coder" wt "origin/main")
      (g root "worktree" "add" "-q" "--detach" side "origin/main")
      (doseq [[i {:keys [ticket kind work]}] (map-indexed vector [${steps}])]
        (let [before (str/split-lines (g wt "log" "--format=%s" "origin/main..HEAD"))
              foreign? (some #(not (parcel-line-lib/subject-names-only? % ticket)) (remove str/blank? before))
              intent (case kind
                       :route (parcel-line-lib/parcel-intent {:master? false :role "coder" :type "git_handoff"
                                                              :commit (g root "rev-parse" "origin/main") :task (str ticket "-x")})
                       :build (do (g side "checkout" "-q" "--detach" "origin/main")
                                  (parcel-line-lib/parcel-intent {:master? false :role "coder" :type "git_handoff"
                                                                  :commit (cmt side (str "b" i ".txt") (str ticket ": build " i))
                                                                  :task (str ticket "-x")}))
                       :work-note (parcel-line-lib/parcel-intent {:master? false :role "coder" :type "note" :work-ticket ticket}))]
          (with-out-str (parcel-line-lib/take-up! {:root wt :project-root root :role "coder" :intent intent}))
          (let [after (remove str/blank? (str/split-lines (g wt "log" "--format=%s" "origin/main..HEAD")))]
            (println "STEP" (name kind) (if foreign? "foreign" "clean")
                     (if (every? #(parcel-line-lib/subject-names-only? % ticket) after) "ok" (str "VIOLATION " ticket " " (pr-str after)))))
          (dotimes [k work] (cmt wt (str "w" i "-" k ".txt") (str ticket ": role work " i "-" k))))))
    (finally (fs/delete-tree work))))`;
  return execFileSync('bb', ['-e', program], { encoding: 'utf8' });
}

test(
  "BL-1887/BL-654 invariant: a take-up never leaves a role on another ticket's unlanded work",
  () => {
    const reach = { route: 0, build: 0, 'work-note': 0 };
    fc.assert(
      fc.property(fc.array(parcel, { minLength: 3, maxLength: 7 }), (parcels) => {
        const out = runShift(parcels);
        for (const line of out.split('\n').filter((l) => l.startsWith('STEP'))) {
          assert.ok(!line.includes('VIOLATION'), `${line}\n${JSON.stringify(parcels)}`);
          const [, kind, state] = line.split(' ');
          if (state === 'foreign') reach[kind] += 1;
        }
      }),
      { numRuns: 25 }
    );
    // Each kind of take-up was reached while the line carried another
    // ticket's work - the state the invariant is about.
    for (const k of Object.keys(reach)) assert.ok(reach[k] >= 5, `foreign-line take-ups by kind: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
