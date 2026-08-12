#!/usr/bin/env bb
;; Thin CLI over boot_prefix_budget_gate_lib (BL-859).
;; Usage: boot_prefix_budget_gate.bb [<constitution-tree-root>]
;; With no argument, measures the real repo. An argument points the SAME
;; prompt_engine_lib composer at a synthetic tree root instead (used by this
;; gate's own acceptance/unit tests, never by a production run).

(ns boot-prefix-budget-gate
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "boot_prefix_budget_gate_lib.bb")))

(defn -main []
  (let [root (first *command-line-args*)
        size (if root
               (boot-prefix-budget-gate-lib/measure root)
               (boot-prefix-budget-gate-lib/measure))
        result (boot-prefix-budget-gate-lib/verdict size)]
    (println (boot-prefix-budget-gate-lib/format-report result))
    (System/exit (:exit-code result))))

(-main)
