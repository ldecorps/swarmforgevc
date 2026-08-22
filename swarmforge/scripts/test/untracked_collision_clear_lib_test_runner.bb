#!/usr/bin/env bb
;; BL-924: TDD runner for untracked_collision_clear_lib.bb's pure
;; plan-untracked-collision-clear decision. No real git, no real
;; filesystem - just data, so every case is deterministic and instant.
;; Babashka has no property-test framework wired in this repo
;; (engineering.prompt's Startup Tools note) - this example-based runner
;; is the invariant-authorship obligation's satisfying form for this
;; language boundary, same as sync_worktree_scripts_lib_test_runner.bb.

(ns untracked-collision-clear-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "untracked_collision_clear_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── invariant 1: identical copies never block ───────────────────────────

(assert= "no candidates at all clears trivially, nothing to remove"
         {:ok? true :clear-paths []}
         (untracked-collision-clear-lib/plan-untracked-collision-clear []))

(assert= "a single identical candidate clears"
         {:ok? true :clear-paths ["a.sh"]}
         (untracked-collision-clear-lib/plan-untracked-collision-clear
          [{:path "a.sh" :identical? true}]))

(assert= "several identical candidates all clear, in the order given"
         {:ok? true :clear-paths ["a.sh" "b.sh" "c.sh"]}
         (untracked-collision-clear-lib/plan-untracked-collision-clear
          [{:path "a.sh" :identical? true}
           {:path "b.sh" :identical? true}
           {:path "c.sh" :identical? true}]))

;; ── invariant 1/2: a genuine difference refuses, all-or-nothing ────────

(assert= "a single differing candidate refuses and names it"
         {:ok? false :blocking-paths ["a.sh"]}
         (untracked-collision-clear-lib/plan-untracked-collision-clear
          [{:path "a.sh" :identical? false}]))

(assert= "one differing candidate among several identical ones still refuses the WHOLE plan - nothing is cleared"
         {:ok? false :blocking-paths ["b.sh"]}
         (untracked-collision-clear-lib/plan-untracked-collision-clear
          [{:path "a.sh" :identical? true}
           {:path "b.sh" :identical? false}
           {:path "c.sh" :identical? true}]))

;; ── every-collision-reported-at-once-02: no elision ─────────────────────

(assert= "several differing candidates are ALL named in one report - no elision, no partial list"
         {:ok? false :blocking-paths ["a.sh" "b.sh"]}
         (untracked-collision-clear-lib/plan-untracked-collision-clear
          [{:path "a.sh" :identical? false}
           {:path "b.sh" :identical? false}
           {:path "c.sh" :identical? true}]))

(if (empty? @failures)
  (println "untracked_collision_clear_lib (BL-924): ALL TESTS PASSED")
  (do (println (str "untracked_collision_clear_lib (BL-924): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
