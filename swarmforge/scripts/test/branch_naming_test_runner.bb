#!/usr/bin/env bb
;; TDD runner for branch_naming_lib.bb (BL-106) - pure assertions, no git.
(ns branch-naming-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "branch_naming_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── derive-branch-name ────────────────────────────────────────────────────
(assert= "branch-ns-01: derives <swarm_name>/<role>"
         "alpha/coder"
         (branch-naming-lib/derive-branch-name "alpha" "coder"))

(assert= "the default primary swarm derives the same shape"
         "primary/coordinator"
         (branch-naming-lib/derive-branch-name "primary" "coordinator"))

;; ── validate-branch ───────────────────────────────────────────────────────
(assert= "a matching branch validates ok"
         {:ok true}
         (branch-naming-lib/validate-branch "alpha/coder" "alpha" "coder"))

(assert= "branch-ns-03: a mismatched branch reports the expected name"
         {:ok false :expected "alpha/coder"}
         (branch-naming-lib/validate-branch "swarmforge-coder" "alpha" "coder"))

(assert= "branch-ns-02: a branch matching a DIFFERENT swarm's namespace is still a mismatch for this swarm"
         {:ok false :expected "alpha/coder"}
         (branch-naming-lib/validate-branch "beta/coder" "alpha" "coder"))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: branch_naming_lib.bb"))
