#!/usr/bin/env bb
;; BL-657: pure tests for harness_env_scrub_lib.bb

(ns harness-env-scrub-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "harness_env_scrub_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg cond]
  (when-not cond
    (swap! failures conj (str "FAIL: " msg))))

(let [env {"CLAUDE_CODE_CHILD_SESSION" "1"
           "CLAUDECODE" "1"
           "CLAUDE_CODE_SESSION_ID" "abc"
           "CLAUDE_CODE_SSE_PORT" "9"
           "CLAUDE_CODE_EXECPATH" "/x"
           "CLAUDE_CODE_ENTRYPOINT" "cli"
           "CURSOR_AGENT" "1"
           "CURSOR_CONVERSATION_ID" "c"
           "CURSOR_LAYOUT" "l"
           "__CURSOR_SANDBOX_ENV_RESTORE" "r"
           "CLAUDE_CODE_MAX_OUTPUT_TOKENS" "64000"
           "CLAUDE_CODE_OAUTH_TOKEN" "tok"
           "PATH" "/usr/bin"
           "HOME" "/home/op"}
      scrubbed (harness-env-scrub-lib/scrub-map env)]
  (doseq [k harness-env-scrub-lib/scrub-vars]
    (assert= (str "scrubs " k) nil (get scrubbed k)))
  (assert= "keeps CLAUDE_CODE_MAX_OUTPUT_TOKENS"
           "64000"
           (get scrubbed "CLAUDE_CODE_MAX_OUTPUT_TOKENS"))
  (assert= "keeps CLAUDE_CODE_OAUTH_TOKEN"
           "tok"
           (get scrubbed "CLAUDE_CODE_OAUTH_TOKEN"))
  (assert= "keeps PATH" "/usr/bin" (get scrubbed "PATH"))
  (assert= "keeps HOME" "/home/op" (get scrubbed "HOME")))

;; Shell script list must match the bb set (structural drift guard).
(let [sh-path (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "harness_env_scrub.sh"))
      body (slurp sh-path)
      listed (->> (re-seq #"(?m)^\s+([A-Z0-9_]+)\s*$" body)
                  (map second)
                  set)
      ;; Filter to names that look like env vars in the array block only:
      ;; take lines between HARNESS_ENV_SCRUB_VARS=( and closing )
      block (second (re-find #"(?s)HARNESS_ENV_SCRUB_VARS=\((.*?)\)" body))
      from-sh (->> (str/split-lines (or block ""))
                   (map str/trim)
                   (filter #(re-matches #"[A-Z0-9_]+" %))
                   set)]
  (assert= "shell scrub list matches bb scrub-vars"
           harness-env-scrub-lib/scrub-vars
           from-sh)
  (assert-true "shell defines scrub_harness_env"
               (str/includes? body "scrub_harness_env()"))
  (assert-true "shell defines scrub_tmux_harness_env"
               (str/includes? body "scrub_tmux_harness_env()")))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "ALL PASS: harness_env_scrub_lib.bb"))
