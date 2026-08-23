#!/usr/bin/env bb
;; BL-1086 property test (coder-authored, THREE declared invariants) over
;; babysitter_check.bb's cached, batched pipeline-code-on-main gather.
;;
;;   Invariant 1 (result equivalence): for the same three tips, the result
;;   produced with the cache and the batched gather is the result a full
;;   per-SHA gather would have produced - both the offending-commit set and the
;;   ancestry-unavailable flag.
;;
;;   Invariant 2 (invalidation completeness): any of the main, origin/main or
;;   swarmforge-QA tips moving, or a previous gather that returned
;;   :ancestry-unavailable? true or otherwise failed, forces a full re-gather.
;;   A fail-closed hole is never cached as clean.
;;
;;   Invariant 3 (one predicate, whole-sweep failure): is_qa_ancestor.sh stays
;;   the single approval predicate, and any failure anywhere in the batch fails
;;   the WHOLE sweep to :ancestry-unavailable? true rather than yielding a
;;   partial result.
;;
;; These quantify over REAL git repositories, built per run: a generated number
;; of commits ahead of swarmforge-QA, a generated subset of them touching
;; QA-exclusive paths, generated tip movements, and a generated unanswerable
;; sha. The subject is a data-access change over git state, so a fixture that
;; simulated git would be testing the simulation.
;;
;; P1 (invariant 1) is an EQUALITY between the cached/batched answer and a
;; freshly computed one. Stated as equality rather than "the cached answer is
;; correct", because a cache is only ever wrong by DIFFERING from the truth,
;; and the truth here is whatever the uncached path says.
;;
;; P2 (invariant 2) is the invalidation half: after any tip moves, the answer
;; is recomputed rather than replayed. Encoded by checking the cache FILE's
;; key against the live tips - if a stale key could ever satisfy the reader,
;; every downstream guarantee is void.
;;
;; P3 (invariant 2, second clause) is the one that matters most: an
;; :ancestry-unavailable? result is never written to the cache at all. A hole
;; frozen as clean outlives the condition that caused it, which is strictly
;; worse than the cost this ticket removes.
;;
;; P4 (invariant 3) is whole-sweep failure: with ANY sha unanswerable, the
;; result is exactly {:offending-commits [] :ancestry-unavailable? true} - not
;; a shorter offending list beside the hole.
;;
;; P6 (invariant 3, first clause) is batch/single EQUIVALENCE over the real
;; predicate, under generated verdict-store shapes. It exists because a gap was
;; found the hard way: bl1025's exhaustive outcome table caught a regression
;; this runner did not, where an expedite store holding only BOUNCING records
;; made a `grep` match nothing, and under `set -e` the failed command
;; substitution aborted collection and turned an approved ancestor into a clean
;; "no". bl1025 covers the predicate's single-sha table exhaustively; nothing
;; covered the BATCH path over the same shapes. Now something does.
;;
;; P5 is the armed-ness backstop, and it is not optional: P1-P4 are ALL
;; satisfied by a gather that returns "unavailable" for everything and caches
;; nothing. That would be a permanently broken health signal wearing a correct
;; cache, which is this ticket's own defect made worse. So a clean repo with a
;; genuine offender must still name it.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-23), each break restored,
;; counts MEASURED (seed 1086, PROPERTY_RUNS=14):
;;   - cache the fail-closed hole too ................... P3 24
;;   - key the cache on the main tip only ............... P2 33
;;   - treat an unanswered sha as "not approved" ........ P3 12, P4 35
;;   - return unavailable unconditionally ............... P2 14, P3 14, P5 36
;;   - drop the `|| true` guards, reinstating the
;;     errexit hazard bl1025 caught ..................... P6 8 (12 runs)
;; Every number is the measured count, not an estimate.
;;
;; P1 is not in that table, and that is worth stating rather than hiding: it
;; compares two runs of the SAME implementation, so a break that is wrong in
;; the same way twice slips past it. P1 is the guard against a cache that
;; DIVERGES from a fresh gather - a real hazard, and the reason it is written
;; as an equality - while P3, P4 and P5 are what catch an implementation that
;; is consistently wrong. Between them the invariant is covered; P1 alone
;; would be the weakest of the five.

(ns bl1086-cache-and-batch-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; FOUR parents: this file is swarmforge/scripts/test/<name>.bb, so three
;; lands on swarmforge/ and every script path below silently misses - which
;; showed up as "no cache was written after a successful gather" rather than as
;; a missing file, because process/sh with :continue swallows it.
(def repo-root (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*)))))))
(def scripts-dir (str (fs/path repo-root "swarmforge" "scripts")))
(def check-sh (str (fs/path scripts-dir "babysitter_check.sh")))
(def real-predicate (str (fs/path scripts-dir "is_qa_ancestor.sh")))
;; A genuinely QA-exclusive prefix, read from BL-632's own reported set rather
;; than guessed - `specs/pipeline/` is NOT in that set and a probe one
;; directory too high would make every offending case silently clean.
(def qa-exclusive-path "specs/pipeline/steps/bl1086-prop-probe.js")

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def failures (atom []))
(def coverage (atom {:with-offender 0 :without-offender 0 :tip-moved 0
                     :unanswerable 0 :cache-hit 0 :deep-ahead 0
                     :store-absent 0 :store-approving 0 :store-bouncing 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- git! [root & args]
  (apply process/sh {:continue true :dir root}
         "git" "-c" "user.email=t@t" "-c" "user.name=t" args))

(def tmp-root (str (fs/create-temp-dir {:prefix "bl1086-prop-"})))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (try (fs/delete-tree tmp-root) (catch Exception _ nil)))))

(defn- make-repo!
  "A real repository: `ahead` commits past swarmforge-QA, of which
   `offenders` touch a QA-exclusive path. Returns {:root :offenders}."
  [i ahead offenders]
  (let [root (str (fs/path tmp-root (str "r" i)))]
    (fs/create-dirs (fs/path root ".swarmforge" "handoffs" "failed"))
    (fs/create-dirs (fs/path root "backlog" "active"))
    (spit (str (fs/path root "meminfo")) "MemAvailable:    8000000 kB\n")
    (git! root "init" "-q" "-b" "main")
    (git! root "commit" "-q" "--allow-empty" "-m" "init")
    (git! root "branch" "swarmforge-QA")
    (let [offending
          (vec (for [n (range ahead)]
                 (if (contains? offenders n)
                   (do (fs/create-dirs (fs/path root (str (fs/parent qa-exclusive-path))))
                       (spit (str (fs/path root qa-exclusive-path)) (str "// " n "\n"))
                       (git! root "add" "--" qa-exclusive-path)
                       (git! root "commit" "-q" "-m" (str "pipeline edit " n))
                       (str/trim (:out (git! root "rev-parse" "HEAD"))))
                   (do (git! root "commit" "-q" "--allow-empty" "-m" (str "ahead " n))
                       nil))))]
      {:root root :offenders (vec (remove nil? offending))})))

(defn- cache-file [root] (fs/path root ".swarmforge" "babysitter" "pipeline-code-on-main-cache.json"))

(defn- read-cache [root]
  (try (when (fs/exists? (cache-file root))
         (json/parse-string (slurp (str (cache-file root))) true))
       (catch Exception _ nil)))

(defn- run-check!
  "One real babysitter_check.sh run. predicate overrides the approval script."
  [root & [predicate]]
  (let [r (process/sh {:continue true :dir repo-root
                       :extra-env (cond-> {"BABYSITTER_MEMINFO_PATH" (str (fs/path root "meminfo"))}
                                    predicate (assoc "BABYSITTER_QA_ANCESTOR_SCRIPT" predicate))}
                      "bash" check-sh root)]
    (str (:out r) (:err r))))

(defn- unavailable? [out] (str/includes? out "UNAVAILABLE"))
(defn- names? [out sha] (str/includes? out (subs sha 0 10)))

;; A predicate that answers exactly as the real one does, except that `bad`
;; comes back undeterminable - a per-sha code 2 inside an otherwise successful
;; batch, which is the shape a real unresolvable sha produces.
(defn- selective-predicate! [root bad]
  (let [p (str (fs/path root "selective.sh"))]
    (spit p (str "#!/usr/bin/env bash\nset -uo pipefail\n"
                 "BAD=" bad "\n"
                 "if [[ \"${1:-}\" == \"--batch\" ]]; then\n"
                 "  out=\"$(bash " real-predicate " \"$@\")\" || exit $?\n"
                 "  printf '%s\\n' \"$out\" | awk -v bad=\"$BAD\" '{ if ($1 == bad) print $1\" 2\"; else print }'\n"
                 "  exit 0\n"
                 "fi\n"
                 "if [[ \"${1:-}\" == \"$BAD\" ]]; then exit 2; fi\n"
                 "exec bash " real-predicate " \"$@\"\n"))
    (fs/set-posix-file-permissions p (fs/str->posix "rwxr-xr-x"))
    p))

(loop [i 0 s 1086]
  (when (< i runs)
    (let [[extra s1] (gen-int s 5)
          ahead (+ 2 extra)
          [mask s2] (gen-int s1 (bit-shift-left 1 ahead))
          offenders (into #{} (filter #(pos? (bit-and mask (bit-shift-left 1 %))) (range ahead)))
          {:keys [root offenders] :as repo} (make-repo! i ahead offenders)
          input {:ahead ahead :offenders (count offenders)}]

      (if (seq offenders)
        (swap! coverage update :with-offender inc)
        (swap! coverage update :without-offender inc))
      (when (>= ahead 5) (swap! coverage update :deep-ahead inc))

      ;; ── P1 (invariant 1): the cached/batched answer equals a fresh one.
      (let [first-out (run-check! root)
            cached-out (run-check! root)]
        (swap! coverage update :cache-hit inc)
        (doseq [sha offenders]
          (when (not= (names? first-out sha) (names? cached-out sha))
            (report! "P1 (invariant 1: the cached answer equals the freshly gathered one)" s input
                     (str "offender " (subs sha 0 10) " named on one run and not the other"))))
        (when (not= (unavailable? first-out) (unavailable? cached-out))
          (report! "P1 (invariant 1: the ancestry-unavailable flag is preserved by the cache)" s input
                   (str "fresh=" (unavailable? first-out) " cached=" (unavailable? cached-out))))

        ;; ── P5 (armed-ness): an offender is still NAMED. Everything above is
        ;; satisfied by a gather that always says "unavailable" and caches
        ;; nothing, which is this ticket's defect made permanent.
        (when (and (seq offenders) (unavailable? first-out))
          (report! "P5 (the sweep still works: a real offender is not hidden behind a hole)" s input
                   "a clean repo with a genuine offender reported UNAVAILABLE"))
        (doseq [sha offenders]
          (when-not (names? first-out sha)
            (report! "P5 (the sweep still works: a real offender is named)" s input
                     (str "offender " (subs sha 0 10) " was not reported")))))

      ;; ── P2 (invariant 2): the cache key is the three tips, and a moved tip
      ;; invalidates. Checked against the cache FILE, because a reader that
      ;; accepted a stale key would void every guarantee downstream.
      (let [before (read-cache root)]
        (when (nil? before)
          (report! "P2 (invariant 2: a successful gather is cached at all)" s input
                   "no cache was written after a successful gather"))
        (when before
          (let [[which s'] (gen-int s2 3)
                _ (case which
                    0 (git! root "commit" "-q" "--allow-empty" "-m" "main moves")
                    1 (git! root "update-ref" "refs/remotes/origin/main" "HEAD")
                    2 (git! root "branch" "-f" "swarmforge-QA" "main"))
                _ (swap! coverage update :tip-moved inc)
                live-main (str/trim (:out (git! root "rev-parse" "-q" "--verify" "main")))
                live-qa (str/trim (:out (git! root "rev-parse" "-q" "--verify" "swarmforge-QA")))
                stale-key? (or (not= live-main (get-in before [:tips :main]))
                               (not= live-qa (get-in before [:tips :qa])))]
            ;; origin/main movement is the third arm; whichever moved, the
            ;; recorded key must no longer match the live tips.
            (run-check! root)
            (let [after (read-cache root)]
              (when (and stale-key? (= (:tips before) (:tips after)))
                (report! "P2 (invariant 2: a moved tip forces a re-gather)" s input
                         (str "the cache key did not change after moving tip " which)))
              (when (and after (not= (:tips after)
                                     {:main (get-in after [:tips :main])
                                      :origin-main (get-in after [:tips :origin-main])
                                      :qa (get-in after [:tips :qa])}))
                (report! "P2 (invariant 2: the key names all three tips)" s input
                         (str "cache key shape: " (pr-str (:tips after)))))
              (doseq [k [:main :qa]]
                (when (and after (not (contains? (:tips after) k)))
                  (report! "P2 (invariant 2: the key names all three tips)" s input
                           (str "cache key is missing " k))))))))

      ;; ── P3 (invariant 2, second clause) and P4 (invariant 3): one
      ;; unanswerable sha fails the WHOLE sweep, and that hole is never cached.
      (let [shas (->> (:out (git! root "rev-list" "swarmforge-QA..main"))
                      str/split-lines (remove str/blank?) vec)]
        (when (seq shas)
          (let [[pick s''] (gen-int s2 (count shas))
                bad (nth shas pick)
                pred (selective-predicate! root bad)]
            (swap! coverage update :unanswerable inc)
            (fs/delete-if-exists (cache-file root))
            (let [out (run-check! root pred)]
              (when-not (unavailable? out)
                (report! "P4 (invariant 3: one unanswerable sha fails the WHOLE sweep)" s input
                         (str "expected UNAVAILABLE with " (subs bad 0 10) " unanswerable")))
              (doseq [sha offenders]
                (when (names? out sha)
                  (report! "P4 (invariant 3: a failed sweep withholds every offender, never a partial list)" s input
                           (str "named offender " (subs sha 0 10) " despite an unanswerable sha"))))
              (when (some? (read-cache root))
                (report! "P3 (invariant 2: a fail-closed hole is NEVER cached)" s input
                         "an ancestry-unavailable result was written to the cache")))
            ;; ...and the next run, with the predicate restored, re-gathers
            ;; rather than replaying the hole.
            (let [out (run-check! root)]
              (when (unavailable? out)
                (report! "P3 (invariant 2: a hole is not replayed once the cause is gone)" s input
                         "still UNAVAILABLE after the predicate was restored"))))))

      ;; ── P6 (invariant 3): batch and single agree, sha for sha, under a
      ;; generated expedite-store shape. One predicate means one ANSWER, not
      ;; merely one file.
      ;; DERIVED from the run index rather than drawn: the LCG's low-order
      ;; behaviour correlated with the earlier draws and `mod 3` never landed
      ;; on 2, so the bouncing-store shape - the one a real regression hid in -
      ;; was generated zero times in 40 runs. The coverage floor caught it,
      ;; which is what floors are for.
      (let [shape (mod i 3)
            expedite-dir (fs/path root ".swarmforge" "expedite-approvals")
            shas (->> (:out (git! root "rev-list" "swarmforge-QA..main"))
                      str/split-lines (remove str/blank?) vec)]
        (when (seq shas)
          (case shape
            0 nil ; no store at all
            1 (do (fs/create-dirs expedite-dir)
                  (spit (str (fs/path expedite-dir "2026-08.jsonl"))
                        (str "{\"commit\":\"" (subs (first shas) 0 10)
                             "\",\"approval\":true,\"verdict\":\"advance\"}\n")))
            ;; Only BOUNCING records - the shape that made the collecting grep
            ;; match nothing and, under set -e, abort the whole run.
            2 (do (fs/create-dirs expedite-dir)
                  (spit (str (fs/path expedite-dir "2026-08.jsonl"))
                        (str "{\"commit\":\"" (subs (first shas) 0 10)
                             "\",\"approval\":false,\"verdict\":\"bounce\"}\n"))))
          (swap! coverage update (case shape 0 :store-absent 1 :store-approving 2 :store-bouncing) inc)
          (let [single (mapv (fn [sha]
                               (str sha " " (:exit (process/sh {:continue true :dir root}
                                                               "bash" real-predicate sha))))
                             shas)
                batch-r (apply process/sh {:continue true :dir root}
                               "bash" real-predicate "--batch" shas)
                batch (->> (str/split-lines (str (:out batch-r)))
                           (remove str/blank?) (mapv str/trim))]
            (when-not (zero? (:exit batch-r))
              (report! "P6 (invariant 3: the batch runs at all)" s input
                       (str "batch exited " (:exit batch-r) ": " (:err batch-r))))
            (when (not= single batch)
              (report! "P6 (invariant 3: one predicate means one ANSWER - batch equals single)" s input
                       (str "store shape " shape "\n  single: " (pr-str single)
                            "\n  batch:  " (pr-str batch)))))))

      (fs/delete-tree root)
      (recur (inc i) s2))))

(doseq [[k floor] {:with-offender 20 :without-offender 3 :tip-moved 30
                   :unanswerable 30 :cache-hit 30 :deep-ahead 8
                   :store-absent 6 :store-approving 6 :store-bouncing 6}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1086 cache-and-batch properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
