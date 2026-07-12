#!/usr/bin/env bb
;; TDD runner for coordinator_config_lib.bb (BL-314) - pure assertions over
;; provided conf text, mirroring backlog_depth_test_runner.bb's own shape.
(ns coordinator-config-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "coordinator_config_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── coordinator-model-01: a pack's declared model/effort are read ────────

(assert= "coordinator-model-01: a declared coordinator_model is read"
         "claude-opus-4-8"
         (coordinator-config-lib/coordinator-model "config coordinator_model claude-opus-4-8"))

(assert= "coordinator-model-01: a declared coordinator_effort is read"
         "xhigh"
         (coordinator-config-lib/coordinator-effort "config coordinator_effort xhigh"))

(assert= "ignores surrounding comment/blank lines and other config keys"
         "claude-sonnet-5"
         (coordinator-config-lib/coordinator-model "# a comment\n\nconfig active_backlog_max_depth 3\nconfig coordinator_model claude-sonnet-5\n"))

;; ── coordinator-model-02: absent/blank/malformed falls back to Sonnet/high ──

(assert= "coordinator-model-02: absent coordinator_model falls back to the Sonnet-tier default"
         coordinator-config-lib/default-coordinator-model
         (coordinator-config-lib/coordinator-model "config active_backlog_max_depth 3"))

(assert= "coordinator-model-02: absent coordinator_effort falls back to the default"
         coordinator-config-lib/default-coordinator-effort
         (coordinator-config-lib/coordinator-effort "config active_backlog_max_depth 3"))

(assert= "coordinator-model-02: nil conf text falls back to the default model"
         coordinator-config-lib/default-coordinator-model
         (coordinator-config-lib/coordinator-model nil))

(assert= "coordinator-model-02: empty conf text falls back to the default model"
         coordinator-config-lib/default-coordinator-model
         (coordinator-config-lib/coordinator-model ""))

(assert= "coordinator-model-02: a blank (whitespace-only) value falls back to the default, not an empty string"
         coordinator-config-lib/default-coordinator-model
         (coordinator-config-lib/coordinator-model "config coordinator_model   \n"))

(assert= "the default model is the Sonnet tier, not Opus (BL-314's own cost fix)"
         "claude-sonnet-5"
         coordinator-config-lib/default-coordinator-model)

(assert= "the default effort is high"
         "high"
         coordinator-config-lib/default-coordinator-effort)

;; ── coordinator-model-03: a pack may still explicitly opt into Opus ──────

(assert= "coordinator-model-03: an explicit claude-opus-4-8 is honored, not overridden by the default"
         "claude-opus-4-8"
         (coordinator-config-lib/coordinator-model "config coordinator_model claude-opus-4-8\nconfig coordinator_effort xhigh\n"))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: coordinator_config_lib.bb"))
