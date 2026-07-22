#!/usr/bin/env bb
;; TDD runner for chase_sweep_lib/actively-processing? — pure, no tmux.

(ns actively-processing-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert-true [msg actual]
  (when-not (boolean actual)
    (swap! failures conj (str "FAIL: " msg))))

(defn assert-false [msg actual]
  (when (boolean actual)
    (swap! failures conj (str "FAIL: " msg))))

(assert-true "esc-to-interrupt footer is busy"
             (chase-sweep-lib/actively-processing? "  auto mode on · esc to interrupt"))

(assert-true "Whirlpooling spinner is busy"
             (chase-sweep-lib/actively-processing?
              "· Whirlpooling… (6m 10s · ↓ 14.4k tokens)"))

(assert-true "explore subagent footer is busy"
             (chase-sweep-lib/actively-processing?
              (str "❯ \n"
                   "  bypass permissions on\n"
                   "  ● main\n"
                   "  ◯ Explore  Explore BL-100/BL-511 cost tracking code  4m 47s")))

(assert-true "explore subagent body marker is busy"
             (chase-sweep-lib/actively-processing?
              "● Explore(Explore BL-100/BL-511 cost tracking code)\n  Running…"))

(assert-true "subagent Running… line is busy"
             (chase-sweep-lib/actively-processing?
              "  Bash(git status)\n     Running…\n"))

(assert-false "idle prompt with only permission chrome is not busy"
             (chase-sweep-lib/actively-processing?
              (str "❯ \n"
                   "  bypass permissions on (shift+tab to cycle)\n"
                   "  ● main")))

(assert-false "plain shell output is not busy"
             (chase-sweep-lib/actively-processing? "ls -la\ntotal 0\n❯ "))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "actively_processing_test_runner: ALL CHECKS PASSED")
