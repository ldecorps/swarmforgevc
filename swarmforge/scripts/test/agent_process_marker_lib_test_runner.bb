#!/usr/bin/env bb
;; Unit runner for agent_process_marker_lib.bb — shared token→argv needles
;; (BL-1108 / BL-1052) and under-pane descendant matching (BL-1070).
(ns agent-process-marker-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "agent_process_marker_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg))))

(defn assert-nil [msg actual]
  (when (some? actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected nil, got: " (pr-str actual)))))

(require '[agent-process-marker-lib :as m])

(assert= "claude needle" "claude " (m/agent-process-marker "claude"))
(assert= "cursor needle is cursor-agent binary" "cursor-agent" (m/agent-process-marker "cursor"))
(assert= "local-model needle is qwen binary" "qwen" (m/agent-process-marker "local-model"))
(assert= "nil agent defaults to claude" "claude " (m/agent-process-marker nil))
(assert= "unknown token falls back to token+space" "weirdagent "
         (m/agent-process-marker "weirdagent"))
(assert= "map exposes local-model" "qwen" (get m/agent-process-markers "local-model"))
(assert= "map exposes cursor" "cursor-agent" (get m/agent-process-markers "cursor"))

;; ── BL-1070: depth under the pane ───────────────────────────────────────────

(defn ps-tree
  "Build a ps -eo pid=,ppid=,args= fixture. Rows are [pid ppid args]."
  [rows]
  (str/join "\n" (map (fn [[pid ppid args]] (str "  " pid "  " ppid " " args)) rows)))

(def pane 1000)

(assert= "depth 1: direct child claude is found"
         "claude --remote-control"
         (m/agent-process-line pane
                               (ps-tree [[1001 pane "claude --remote-control"]])
                               "claude"))

(assert= "depth 2: grandchild claude (wrapper shell) is found"
         "claude --model opus"
         (m/agent-process-line pane
                               (ps-tree [[1001 pane "zsh /path/coder.sh"]
                                         [1002 1001 "claude --model opus"]])
                               "claude"))

(assert= "depth 3: great-grandchild claude is found"
         "claude "
         (m/agent-process-line pane
                               (ps-tree [[1001 pane "sh"]
                                         [1002 1001 "zsh /path/role.sh"]
                                         [1003 1002 "claude "]])
                               "claude"))

(assert-nil "nowhere under the pane: absent"
            (m/agent-process-line pane
                                  (ps-tree [[1001 pane "zsh /path/role.sh"]
                                            [1002 1001 "sleep 999"]])
                                  "claude"))

(assert-nil "sibling pane's claude never stands in (invariant 2)"
            (m/agent-process-line pane
                                  (ps-tree [[1001 pane "zsh /path/role.sh"]
                                            [2000 1 "sh"]
                                            [2001 2000 "zsh /path/other.sh"]
                                            [2002 2001 "claude --remote-control"]])
                                  "claude"))

(assert-nil "nil ps-output is nil (gather failure — never absence claim here)"
            (m/agent-process-line pane nil "claude"))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "OK agent_process_marker_lib_test_runner"))
