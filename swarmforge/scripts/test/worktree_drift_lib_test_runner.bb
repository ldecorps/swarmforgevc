#!/usr/bin/env bb
;; TDD runner for worktree_drift_lib.bb (BL-1195) - pure assertions, no git.
(ns worktree-drift-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "worktree_drift_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── unexplained-drift (feature scenarios 01/02/03) ──────────────────────────

(assert= "scenario 01: modified tracked paths with no in-progress task are ALL unexplained drift"
         #{"swarmforge/scripts/handoffd.bb"}
         (worktree-drift-lib/unexplained-drift
          {:modified-paths ["swarmforge/scripts/handoffd.bb"]
           :has-in-progress-task? false}))

(assert= "scenario 02: an in-progress task exempts every currently-modified path"
         #{}
         (worktree-drift-lib/unexplained-drift
          {:modified-paths ["swarmforge/scripts/handoffd.bb"]
           :has-in-progress-task? true}))

(assert= "scenario 03: a clean worktree (no modified paths) reports no drift regardless of task state"
         #{}
         (worktree-drift-lib/unexplained-drift
          {:modified-paths []
           :has-in-progress-task? false}))

(assert= "multiple modified paths, no in-progress task: every path is unexplained"
         #{"a.bb" "b.bb" "c.bb"}
         (worktree-drift-lib/unexplained-drift
          {:modified-paths ["a.bb" "b.bb" "c.bb"]
           :has-in-progress-task? false}))

(assert= "duplicate modified paths collapse to one entry"
         #{"a.bb"}
         (worktree-drift-lib/unexplained-drift
          {:modified-paths ["a.bb" "a.bb"]
           :has-in-progress-task? false}))

(assert= "blank/nil entries in modified-paths are dropped, never reported as a path"
         #{"a.bb"}
         (worktree-drift-lib/unexplained-drift
          {:modified-paths ["a.bb" "" nil]
           :has-in-progress-task? false}))

(assert= "nil modified-paths (git diff produced nothing) is treated as empty, never an error"
         #{}
         (worktree-drift-lib/unexplained-drift
          {:modified-paths nil
           :has-in-progress-task? false}))

;; ── drift-detected? ─────────────────────────────────────────────────────

(assert-true "drift-detected? is true for a non-empty drift set"
             (worktree-drift-lib/drift-detected? #{"a.bb"}))

(assert-true "drift-detected? is false for an empty drift set"
             (not (worktree-drift-lib/drift-detected? #{})))

;; ── drift-report ────────────────────────────────────────────────────────

(let [report (worktree-drift-lib/drift-report ["swarmforge/scripts/handoffd.bb" "swarmforge/scripts/briefing_email_lib.bb"])]
  (assert-true "the report names every drifted path"
               (and (str/includes? report "swarmforge/scripts/handoffd.bb")
                    (str/includes? report "swarmforge/scripts/briefing_email_lib.bb")))
  (assert-true "the report instructs preserving via stash, never discarding"
               (str/includes? report "stash"))
  (assert-true "the report is tagged for easy grep/alerting"
               (str/starts-with? report "WORKTREE_DRIFT_DETECTED:")))

;; ── report ────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: worktree_drift_lib.bb"))
