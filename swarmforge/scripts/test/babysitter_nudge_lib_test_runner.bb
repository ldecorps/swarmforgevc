#!/usr/bin/env bb
;; TDD runner for babysitter_nudge_lib.bb — no live tmux.
(ns babysitter-nudge-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_nudge_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(assert-true "busy footer detected"
             (babysitter-nudge-lib/pane-busy?
              "  esc to interrupt · /rc"))

(assert-true "idle prompt not busy"
             (not (babysitter-nudge-lib/pane-busy? "❯ ")))

(assert= "nudged line"
         "NUDGED: coder via swarmforge-coder"
         (babysitter-nudge-lib/format-cli-line
          {:status :nudged :role "coder" :session "swarmforge-coder"}))

(assert= "skip busy line"
         "SKIP_BUSY: coder — pane mid-turn"
         (babysitter-nudge-lib/format-cli-line
          {:status :skip-busy :role "coder" :detail "pane mid-turn"}))

(assert= "empty message fails"
         :failed
         (:status (babysitter-nudge-lib/nudge-resident! "/nonexistent" "coder" "   ")))

(assert= "missing swarm is no-target"
         :no-target
         (:status (babysitter-nudge-lib/nudge-resident! "/nonexistent" "coder" "hello")))

(if (empty? @failures)
  (println "babysitter_nudge_lib_test_runner: ok")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
