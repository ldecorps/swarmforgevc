#!/usr/bin/env bb
;; BL-1433 coder pass (BL-654 Invariants): PROPERTY tests over
;; post_qa_branch_sweep_lib.bb's decide-role, encoding the ticket's three
;; declared invariants:
;;
;;   1. "A role whose HEAD contains the landed commit is never told it is
;;      behind, whatever else its worktree holds." P1 generates arbitrary
;;      dirty?/in-process?/can-ff? combinations with contains-landed? true
;;      and asserts decide-role ALWAYS returns {:action :holds-landed},
;;      regardless of the other three flags.
;;   2. "divergent-branch means exactly HEAD lacks the landed commit and
;;      cannot fast-forward to it; BL-1421's standing surfacing holds
;;      unchanged." P3 generates the same arbitrary combinations with
;;      contains-landed? false and asserts decide-role's result is
;;      IDENTICAL to an independent reference implementation of the
;;      PRE-BL-1433 decide-role (the exact cond this ticket's own diff
;;      preserved beneath the new branches) - proving the new fact changes
;;      nothing for a role that genuinely lacks the landed commit.
;;   3. "An unanswerable containment fact never produces a note: the role
;;      is skipped with a logged reason." P2 generates the same arbitrary
;;      combinations with contains-landed? nil (head-sha/landed-sha both
;;      present, so :missing-ref never fires) and asserts decide-role
;;      ALWAYS returns {:action :skip :reason :unknown-containment}.
;;
;; Same deterministic-seeded-LCG shape as bl1421_one_standing_surfacing_
;; property_runner.bb (BL-472: no mutation/property tooling wired for
;; Babashka).
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored
;; before this commit; `diff` against a pre-break backup confirmed exact
;; restoration - see backlog/evidence/BL-1433-coder-*.md for the
;; transcript):
;;   - P1 was run against decide-role with the contains-landed? branch
;;     removed - failed on every generated case, falling through to
;;     :surface/:settle instead of :holds-landed.
;;   - P2 was run the same way - failed on every generated case, falling
;;     through to :surface/:settle instead of :skip/:unknown-containment.
;;   - P3 was run against decide-role with the contains-landed? branches
;;     left IN but reordered to run AFTER in-process?/dirty?/can-ff? -
;;     failed wherever contains-landed? was false and one of the other
;;     branches would have fired differently under the reordering (it does
;;     not, since contains-landed? is false and inert in that position -
;;     confirming the reference/actual comparison is sensitive to ORDER
;;     bugs was the real target: reversing which of dirty?/in-process? is
;;     checked first in decide-role's own body did fail P3 immediately).

(ns bl1433-branch-holds-landed-commit-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "post_qa_branch_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(= 1 n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 29]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn gen-three-flags [s]
  (let [[dirty? s1] (gen-bool s)
        [in-process? s2] (gen-bool s1)
        [can-ff? s3] (gen-bool s2)]
    [{:dirty? dirty? :in-process? in-process? :can-ff? can-ff?} s3]))

;; ── P1 (invariant 1): holds-landed wins over everything else ─────────────

(check-all "P1: contains-landed? true always yields :holds-landed, whatever dirty?/in-process?/can-ff? are"
  gen-three-flags
  (fn [flags]
    (let [decision (post-qa-branch-sweep-lib/decide-role
                     (merge flags {:head-sha "ahead" :landed-sha "landed" :contains-landed? true}))]
      (or (= {:action :holds-landed} decision)
          (str "expected :holds-landed, got " (pr-str decision))))))

;; ── P2 (invariant 3): an unanswerable containment fact is a logged skip ──

(check-all "P2: contains-landed? nil always yields :skip/:unknown-containment (head/landed both present)"
  gen-three-flags
  (fn [flags]
    (let [decision (post-qa-branch-sweep-lib/decide-role
                     (merge flags {:head-sha "old" :landed-sha "new" :contains-landed? nil}))]
      (or (= {:action :skip :reason :unknown-containment} decision)
          (str "expected :skip/:unknown-containment, got " (pr-str decision))))))

;; ── P3 (invariant 2): contains-landed? false changes nothing - decide-role
;;    matches an independent reference of the PRE-BL-1433 logic exactly ────

(defn- reference-pre-bl1433-decide-role
  "The exact cond this ticket's own diff preserved beneath the new
   contains-landed? branches - kept as an independent copy, not a call
   into decide-role itself, so a regression IN decide-role's preserved
   branches has something to be caught against."
  [{:keys [head-sha landed-sha dirty? in-process? can-ff?]}]
  (cond
    (or (nil? landed-sha) (nil? head-sha)) {:action :skip :reason :missing-ref}
    (= head-sha landed-sha) {:action :already-settled}
    in-process? {:action :surface :reason :in-process-work}
    dirty? {:action :surface :reason :dirty-worktree}
    can-ff? {:action :settle}
    :else {:action :surface :reason :divergent-branch}))

(check-all "P3: contains-landed? false reproduces the pre-BL-1433 decision exactly"
  gen-three-flags
  (fn [flags]
    (let [facts (merge flags {:head-sha "old" :landed-sha "new" :contains-landed? false})
          actual (post-qa-branch-sweep-lib/decide-role facts)
          expected (reference-pre-bl1433-decide-role facts)]
      (or (= expected actual)
          (str "expected " (pr-str expected) ", got " (pr-str actual))))))

;; ── generator coverage (asserted reachability floors) ─────────────────────

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(let [dirty-vals (sweep-coverage 29 gen-three-flags :dirty?)
      in-process-vals (sweep-coverage 29 gen-three-flags :in-process?)
      can-ff-vals (sweep-coverage 29 gen-three-flags :can-ff?)
      floor (quot runs 10)
      buckets {:dirty-true (count (filter true? dirty-vals))
               :dirty-false (count (filter false? dirty-vals))
               :in-process-true (count (filter true? in-process-vals))
               :in-process-false (count (filter false? in-process-vals))
               :can-ff-true (count (filter true? can-ff-vals))
               :can-ff-false (count (filter false? can-ff-vals))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 29 buckets (str k " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1433 branch-holds-landed-commit properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
