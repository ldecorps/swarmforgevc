#!/usr/bin/env bb
;; BL-1801: TDD runner for local_model_window_gate_lib.bb's pure decision.
;; The CLI's own fact-gathering (curl to a fake Ollama, reading a composed
;; prompt file) is covered by test_local_model_window_gate_cli.sh and the
;; acceptance; this file is the decision alone.
(ns local-model-window-gate-lib-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "local_model_window_gate_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true* [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; ── estimate-tokens ───────────────────────────────────────────────────────
(assert= "6000 composed + 3000 overhead -> 3000 tokens" 3000 (local-model-window-gate-lib/estimate-tokens 6000 3000))
(assert= "15000 composed + 3000 overhead -> 6000 tokens" 6000 (local-model-window-gate-lib/estimate-tokens 15000 3000))
(assert= "rounds up (ceil), never down" 2 (local-model-window-gate-lib/estimate-tokens 4 0))
(assert= "exact division has no remainder to round" 2 (local-model-window-gate-lib/estimate-tokens 6 0))

;; ── window-outcome ────────────────────────────────────────────────────────
(defn outcome [window estimate override?]
  (local-model-window-gate-lib/window-outcome
   {:window window :estimate-tokens estimate :override? override? :role "coder" :model "ista-iq3s-coder:latest"}))

;; BL-1801 scenario 01 row 1: 32768 window, estimate 3000 (well under half) -> proceed
(let [{:keys [decision message]} (outcome 32768 3000 false)]
  (assert= "known window, well under half -> proceed" :proceed decision)
  (assert= "proceed carries no message" nil message))

;; row 2: 8192 window, estimate 6000 (over half, under the window) -> warn
(let [{:keys [decision message]} (outcome 8192 6000 false)]
  (assert= "known window, over half but under budget -> warn" :warn decision)
  (assert-true* "warn message names the seat" (clojure.string/includes? message "coder"))
  (assert-true* "warn message names the model" (clojure.string/includes? message "ista-iq3s-coder:latest")))

;; row 3: 4096 window, estimate 6000 (over budget) -> refuse
(let [{:keys [decision message]} (outcome 4096 6000 false)]
  (assert= "known window, over budget, no override -> refuse" :refuse decision)
  (assert-true* "refuse message names the override env var" (clojure.string/includes? message "SWARMFORGE_LOCAL_WINDOW_OVERRIDE")))

;; scenario 03: unknown window -> warn, regardless of estimate size, never refuse
(let [{:keys [decision message]} (outcome nil 21000 false)]
  (assert= "unknown window -> warn, never refuse" :warn decision)
  (assert-true* "unknown-window message says unknown" (clojure.string/includes? message "unknown")))

;; scenario 04: over budget + override -> warn, naming the override
(let [{:keys [decision message]} (outcome 4096 6000 true)]
  (assert= "over budget with override -> warn, not refuse" :warn decision)
  (assert-true* "override warn message names the override" (clojure.string/includes? message "SWARMFORGE_LOCAL_WINDOW_OVERRIDE"))
  (assert-true* "override warn message says it let the seat start" (clojure.string/includes? message "start")))

;; boundary: exactly half the window is NOT "more than half" -> proceed
(let [{:keys [decision]} (outcome 12000 6000 false)]
  (assert= "estimate exactly half the window -> proceed (not warn)" :proceed decision))

;; boundary: exactly the window size is NOT over it (not > window), but IS
;; over half of it -> warn, never refuse
(let [{:keys [decision]} (outcome 6000 6000 false)]
  (assert= "estimate exactly equal to the window -> warn (not refuse: not strictly over)" :warn decision))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
