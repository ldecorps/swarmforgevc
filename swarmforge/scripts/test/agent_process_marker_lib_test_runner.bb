#!/usr/bin/env bb
;; Unit runner for agent_process_marker_lib.bb — shared token→argv needles
;; used by babysitter_check and swarm_ensure (BL-1108 / BL-1052).
(ns agent-process-marker-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "agent_process_marker_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(require '[agent-process-marker-lib :as m])

(assert= "claude needle" "claude " (m/agent-process-marker "claude"))
(assert= "cursor needle is cursor-agent binary" "cursor-agent" (m/agent-process-marker "cursor"))
(assert= "local-model needle is qwen binary" "qwen" (m/agent-process-marker "local-model"))
(assert= "nil agent defaults to claude" "claude " (m/agent-process-marker nil))
(assert= "unknown token falls back to token+space" "weirdagent "
         (m/agent-process-marker "weirdagent"))
(assert= "map exposes local-model" "qwen" (get m/agent-process-markers "local-model"))
(assert= "map exposes cursor" "cursor-agent" (get m/agent-process-markers "cursor"))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "OK agent_process_marker_lib_test_runner"))
