#!/usr/bin/env bb
;; BL-1806 coder pass (BL-654 Invariants): PROPERTY test encoding declared
;; invariant 1 ("land-plan over origin/main..commit still considers every
;; commit in the full ancestry (never --first-parent alone, never
;; parcel-own-base alone); a sibling absorbed before the parcel's last hop
;; still forces LAND_REPLAY exactly as BL-1461 requires") against the REAL
;; land-plan, never a reimplementation.
;;
;; QA bounce 7da54ebc76 (D1, 2026-09-29): the acceptance feature's own
;; scenario 02 places its sibling ONLY on the first-parent line, so a
;; regressed --first-parent-only walk would still pass it - it does not
;; discriminate against the exact regression this invariant guards.
;; land_step_lib_test_runner.bb:589 (BL-1308) is the fixed unit precedent
;; for a single second-parent-only sibling; this generalizes it: a
;; randomized number of siblings, each independently placed EITHER on the
;; first-parent line OR exclusively inside a merged side branch (a forward
;; merge whose subject names the landing ticket, mirroring the real shape a
;; cleaner/architect/hardener/documenter hop produces), interleaved with
;; randomized untagged filler merges so the *commit-meta* preload BL-1806
;; introduced (range-commit-meta, bound by land-plan as *commit-meta*) is
;; genuinely exercised on a tip with real merge-DAG shape, not a
;; single-merge fixture.
;;
;; Declared invariant 2 (the ten-second wall-clock floor) is NOT encoded
;; here: it quantifies over process (wall-clock time on a given machine),
;; not a pure testable module. A generated property re-measuring wall-clock
;; time would be flaky by construction (machine speed, not logic) and would
;; not encode anything beyond what the acceptance feature's own timed
;; scenario 01 already asserts end-to-end against the ticket's own named
;; fixture shape (>=1000 full / <20 first-parent ancestry). Stated reason
;; recorded per BL-654's allowance for a declared invariant with no
;; sensible fresh executable encoding - see
;; backlog/evidence/BL-1806-coder-20260929.md.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners (e.g. bl1431_one_land_plan_one_tip_property_runner.bb). Never
;; `rand`.
;;
;; Non-vacuity proven by hand at authoring time (mutant restored before
;; this commit; `git diff` against the pre-break copy confirmed exact
;; restoration): P1 was run against a deliberately broken `ancestry-commits`
;; (its "rev-list" args widened with "--first-parent") - failed on every
;; generated case carrying at least one second-parent-only sibling (each
;; such sibling vanished from :entangled while first-parent siblings and
;; the :land/:replay action for the zero-sibling case stayed correct,
;; confirming the property fails for exactly the regression it targets and
;; not from an unrelated fixture bug).

(ns bl1806-land-plan-fat-tip-detection-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 1806]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- mark-origin-main-here! [root]
  (sh! root "git" "update-ref" "refs/remotes/origin/main" (:out (sh! root "git" "rev-parse" "HEAD"))))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1806-prop-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

;; ── a deterministic shuffle of the operation sequence, from the same seed
;; stream the rest of the generator uses - a fixed phase order (filler,
;; then first-parent, then second-parent, then own) would never reach the
;; states where own work or filler noise lands BETWEEN two siblings, which
;; is the ordinary shape a real multi-hop pipeline branch produces.

(defn- shuffle-with-seed [s coll]
  (loop [items (vec coll) s s acc []]
    (if (empty? items)
      [acc s]
      (let [[idx s'] (gen-int s (count items))]
        (recur (into (subvec items 0 idx) (subvec items (inc idx) (count items)))
               s'
               (conj acc (nth items idx)))))))

;; ── P1 (invariant 1): every sibling detected regardless of first-parent vs
;; second-parent-only placement, on a tip fattened with untagged noise ────

(defn gen-p1 [s]
  (let [[n-first s1] (gen-int s 3)    ; 0..2 first-parent-line siblings
        [n-second s2] (gen-int s1 3)  ; 0..2 second-parent-only siblings
        [n-filler s3] (gen-int s2 4)  ; 0..3 untagged noise merges
        [n-own s4] (gen-int s3 3)]    ; 1..3 own commits
    [{:n-first n-first :n-second n-second :n-filler n-filler :n-own (inc n-own)} s4]))

(defn- p1-case [{:keys [n-first n-second n-filler n-own]}]
  (with-fixture [root]
    (mark-origin-main-here! root)
    (let [ops (concat
               (for [i (range n-first)] {:kind :first :i i})
               (for [j (range n-second)] {:kind :second :i j})
               (for [k (range n-filler)] {:kind :filler :i k})
               (for [o (range n-own)] {:kind :own :i o}))
          [ops _] (shuffle-with-seed (+ 7 n-first n-second n-filler n-own) ops)]
      (doseq [{:keys [kind i]} ops]
        (case kind
          :first
          (commit! root (str "backlog/active/BL-93" i "0-sib.yaml") (str "id: BL-93" i "0\n")
                   (str "BL-93" i "0: sibling first-parent work"))

          :second
          (do (sh! root "git" "checkout" "-q" "-b" (str "bl1806-sib2-" i "-" (System/nanoTime)))
              (commit! root (str "backlog/active/BL-94" i "0-sib.yaml") (str "id: BL-94" i "0\n")
                       (str "BL-94" i "0: sibling second-parent work"))
              (let [branch (:out (sh! root "git" "rev-parse" "--abbrev-ref" "HEAD"))]
                (sh! root "git" "checkout" "-q" "main")
                (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9001: forward merge" branch)))

          :filler
          (do (sh! root "git" "checkout" "-q" "-b" (str "bl1806-filler-" i "-" (System/nanoTime)))
              (commit! root (str "misc/filler-" i ".txt") (str "filler " i "\n")
                       (str "chore: unrelated filler " i))
              (let [branch (:out (sh! root "git" "rev-parse" "--abbrev-ref" "HEAD"))]
                (sh! root "git" "checkout" "-q" "main")
                (sh! root "git" "merge" "--no-ff" "-q" "-m" (str "chore: merge filler " i) branch)))

          :own
          (commit! root (str "backlog/active/BL-9001-own-" i ".yaml") "id: BL-9001\n"
                   (str "BL-9001: own work " i))))
      (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
            expected (into (set (for [i (range n-first)] (str "BL-93" i "0")))
                           (for [j (range n-second)] (str "BL-94" j "0")))
            plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
        (cond
          (not= expected (:entangled plan))
          (str "expected entangled " expected ", got " (:entangled plan)
               " (n-first=" n-first " n-second=" n-second " n-filler=" n-filler ")")

          (and (seq expected) (not= :replay (:action plan)))
          (str "expected :replay with siblings present, got " (:action plan))

          (and (empty? expected) (not= :land (:action plan)))
          (str "expected :land with no siblings, got " (:action plan))

          :else true)))))

(check-all "P1: every sibling detected regardless of first-parent vs second-parent-only placement"
           gen-p1 p1-case)

;; ── generator coverage (asserted reachability floors) ──────────────────
;; Both placement kinds, together AND alone, and the zero-sibling case, all
;; occur often enough that a placement-specific regression cannot hide in
;; an under-sampled corner - the exact failure shape BL-654 names: a
;; property that technically reaches a state so rarely it passes hundreds
;; of runs against a live defect.

(let [p1-inputs (sweep-coverage 1806 gen-p1 identity)
      floor (quot runs 10)
      buckets {:only-first (count (filter #(and (pos? (:n-first %)) (zero? (:n-second %))) p1-inputs))
               :only-second (count (filter #(and (zero? (:n-first %)) (pos? (:n-second %))) p1-inputs))
               :both (count (filter #(and (pos? (:n-first %)) (pos? (:n-second %))) p1-inputs))
               :neither (count (filter #(and (zero? (:n-first %)) (zero? (:n-second %))) p1-inputs))
               :with-filler (count (filter #(pos? (:n-filler %)) p1-inputs))
               :no-filler (count (filter #(zero? (:n-filler %)) p1-inputs))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 1806 buckets (str k " barely exercised: " v " <= floor " floor)))))

;; ── report ──────────────────────────────────────────────────────────────

(println (str "bl1806 land-plan fat-tip detection properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
