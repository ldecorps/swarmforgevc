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

;; ── BL-1840: qwen-compaction-trigger / dead-zone-outcome ───────────────────

;; Scenario 01's own table, verbatim.
(assert= "trigger at 32768 (the reference window)" 27852 (local-model-window-gate-lib/qwen-compaction-trigger 32768))
(assert= "trigger at 49152 (coder@iq3's incident window)" 16152 (local-model-window-gate-lib/qwen-compaction-trigger 49152))
(assert= "trigger at 60852 (the dead zone's own upper bound)" 27852 (local-model-window-gate-lib/qwen-compaction-trigger 60852))
(assert= "trigger at 65536" 32536 (local-model-window-gate-lib/qwen-compaction-trigger 65536))

(assert= "32768 does not flag (it is the reference window itself)" false (local-model-window-gate-lib/in-dead-zone? 32768))
(assert= "49152 flags" true (local-model-window-gate-lib/in-dead-zone? 49152))
(assert= "60852 does not flag (back up to the reference trigger)" false (local-model-window-gate-lib/in-dead-zone? 60852))
(assert= "65536 does not flag" false (local-model-window-gate-lib/in-dead-zone? 65536))

;; boundary: just inside the dead zone at both edges.
(assert= "33001 flags (one past the reference window)" true (local-model-window-gate-lib/in-dead-zone? 33001))
(assert= "33000 does not flag (the pct branch still applies there)" false (local-model-window-gate-lib/in-dead-zone? 33000))

(assert= "dead-zone-upper-window is derived, not hardcoded" 60852 local-model-window-gate-lib/dead-zone-upper-window)

(defn dz-outcome [window override?]
  (local-model-window-gate-lib/dead-zone-outcome
   {:window window :override? override? :role "coder" :model "ista-iq3s-coder:latest"}))

;; scenario 01: a window outside the dead zone proceeds, no message.
(let [{:keys [decision message]} (dz-outcome 32768 false)]
  (assert= "outside the dead zone -> proceed" :proceed decision)
  (assert= "proceed carries no message" nil message))

;; scenario 02: a dead-zone window is refused, naming the window, its
;; trigger, and the two windows that avoid it.
(let [{:keys [decision message]} (dz-outcome 49152 false)]
  (assert= "dead-zone window, no override -> refuse" :refuse decision)
  (assert-true* "refusal names the window" (clojure.string/includes? message "49152"))
  (assert-true* "refusal names the trigger" (clojure.string/includes? message "16152"))
  (assert-true* "refusal names 32768" (clojure.string/includes? message "32768"))
  (assert-true* "refusal names 60852" (clojure.string/includes? message "60852"))
  (assert-true* "refusal names the override env var" (clojure.string/includes? message "SWARMFORGE_LOCAL_WINDOW_OVERRIDE")))

;; a dead-zone window WITH the override warns instead, naming the override.
(let [{:keys [decision message]} (dz-outcome 49152 true)]
  (assert= "dead-zone window with override -> warn, not refuse" :warn decision)
  (assert-true* "override warn names the override" (clojure.string/includes? message "SWARMFORGE_LOCAL_WINDOW_OVERRIDE"))
  (assert-true* "override warn names the window" (clojure.string/includes? message "49152")))

;; a window the gate cannot learn is never flagged (item 1).
(let [{:keys [decision message]} (dz-outcome nil false)]
  (assert= "unknown window -> proceed, never flagged" :proceed decision)
  (assert= "proceed carries no message" nil message))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
