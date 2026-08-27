#!/usr/bin/env bb
;; BL-1195: PROPERTY test over worktree_drift_lib.bb's unexplained-drift,
;; covering the ticket YAML's one declared invariant (coder-authored first,
;; per BL-654):
;;
;;   "A role worktree's tracked-file content is never silently forwarded
;;    (committed, handed off, or acted on) when it differs from that
;;    worktree's own HEAD for a reason the role's current task does not
;;    explain."
;;
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.
;; Follows the established .bb property-runner precedent (see
;; bl640_reference_freshness_property_runner.bb).
;;
;;   P1 no-task-means-every-modified-path-is-drift - whenever the role has
;;      NO in-progress task, unexplained-drift names EXACTLY the set of
;;      currently-modified tracked paths - nothing is silently waved
;;      through. This is the invariant's core: a role with no task in
;;      flight can never act on tracked drift without it being reported.
;;
;;   P2 an-in-progress-task-exempts-everything-currently-modified - whenever
;;      the role DOES have an in-progress task, unexplained-drift is always
;;      empty, regardless of how many paths are modified or what they are -
;;      the "zero false positives against genuine WIP" half of the bound
;;      outcome (BL-1195 scenario 02), and what stops this guard from
;;      refusing every legitimate mid-task turn.
;;
;; BL-654 generator-reach: modified-paths count is swept from 0 up through
;; a double-digit count, and has-in-progress-task? is an independent coin
;; flip each run, so both P1 and P2 are demonstrably exercised across many
;; path-set sizes, not just whichever shape a narrow draw happens to hit.

(ns worktree-drift-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "worktree_drift_lib.bb")))

(def failures (atom []))

(defn- assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 1195))
(defn- rint [bound] (.nextInt rng (int bound)))

(defn- rand-path [] (str "swarmforge/scripts/file-" (rint 1000000000) ".bb"))

(def branches-hit (atom #{}))

(dotimes [_ 100]
  (let [n (rint 12)
        modified-paths (vec (repeatedly n rand-path))
        has-task? (.nextBoolean rng)
        drift (worktree-drift-lib/unexplained-drift
               {:modified-paths modified-paths :has-in-progress-task? has-task?})]
    (swap! branches-hit conj (cond has-task? :has-task (zero? n) :no-mods :else :no-task-some-mods))
    (if has-task?
      (assert-true (str "P2: an in-progress task always exempts every currently-modified path "
                        "(n=" n ")")
                   (empty? drift))
      (assert-true (str "P1: no in-progress task means unexplained-drift names EXACTLY the "
                        "modified paths, no more no fewer (n=" n ")")
                   (= (set modified-paths) drift)))
    (assert-true "drift-detected? agrees with whether the drift set is non-empty"
                 (= (boolean (seq drift)) (worktree-drift-lib/drift-detected? drift)))))

(assert-true "the generator reached both has-task and no-task branches, and both zero and nonzero modification counts"
             (and (contains? @branches-hit :has-task)
                  (contains? @branches-hit :no-mods)
                  (contains? @branches-hit :no-task-some-mods)))

;; ── non-vacuousness: a broken "always trust WIP" implementation must fail P1 ─
;; The exact class of bug this invariant exists to prevent: a guard that
;; NEVER reports drift once any task exists, even for paths that task could
;; not plausibly explain, silently waving through exactly the incident this
;; ticket is about.
(defn- broken-always-clean [_facts] #{})

(let [modified ["swarmforge/scripts/handoffd.bb"]]
  (assert-true "non-vacuousness: a broken always-clean guard WOULD wrongly report no drift"
               (empty? (broken-always-clean {:modified-paths modified :has-in-progress-task? false})))
  (assert-true "non-vacuousness: the REAL unexplained-drift correctly flags it with no task in flight"
               (= (set modified)
                  (worktree-drift-lib/unexplained-drift
                   {:modified-paths modified :has-in-progress-task? false})))
  (assert-true "non-vacuousness: the REAL drift-detected? correctly refuses"
               (worktree-drift-lib/drift-detected?
                (worktree-drift-lib/unexplained-drift
                 {:modified-paths modified :has-in-progress-task? false}))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " property failure(s)"))
  (System/exit 1))
(println (str "ALL PROPERTIES HOLD: worktree_drift_lib.bb (100 runs)"))
