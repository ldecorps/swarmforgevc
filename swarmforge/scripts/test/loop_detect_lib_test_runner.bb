#!/usr/bin/env bb
;; TDD runner for loop_detect_lib.bb — pure, no filesystem / tmux / network.

(ns loop-detect-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "loop_detect_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(assert= "classify: empty pane is :quiet"
         :quiet (loop-detect-lib/classify-pane-loop-signal ""))

(assert= "classify: a single NO_TASK is healthy idle, not a spin"
         :quiet (loop-detect-lib/classify-pane-loop-signal
                 "> ! ./swarmforge/scripts/ready_for_next.sh\n\nNO_TASK\n>"))

(assert= "classify: two NO_TASK + two ready_for_next in a short window is :no-task-spin"
         :no-task-spin
         (loop-detect-lib/classify-pane-loop-signal
          (str "> ! ./swarmforge/scripts/ready_for_next.sh\nNO_TASK\n"
               "> ! ./swarmforge/scripts/ready_for_next.sh\nNO_TASK\n>")))

(assert= "classify: TASK line means :progress even if older NO_TASK present"
         :progress
         (loop-detect-lib/classify-pane-loop-signal
          (str "NO_TASK\nNO_TASK\nNO_TASK\n"
               "TASK: /tmp/x.handoff\nFROM: coordinator\n")))

(assert= "classify: Claude esc-to-interrupt footer is :busy"
         :busy
         (loop-detect-lib/classify-pane-loop-signal
          "NO_TASK\nNO_TASK\nNO_TASK\nready_for_next.sh\nready_for_next.sh\nesc to interrupt\n"))

(assert= "classify: aider Waiting-for-openai during a spin is still :no-task-spin"
         :no-task-spin
         (loop-detect-lib/classify-pane-loop-signal
          (str "> ! ready_for_next.sh\nNO_TASK\n"
               "> ! ready_for_next.sh\nNO_TASK\n"
               "> ! ready_for_next.sh\nNO_TASK\n"
               "Waiting for openai/sonar-pro\n")))

(assert= "next: first spin strike=1"
         {:strikes 1 :last-signal :no-task-spin}
         (loop-detect-lib/next-loop-state nil :no-task-spin))

(assert= "next: second spin strike=2"
         {:strikes 2 :last-signal :no-task-spin}
         (loop-detect-lib/next-loop-state {:strikes 1 :last-signal :no-task-spin} :no-task-spin))

(assert-false "halt?: two strikes is not enough (default threshold 3)"
              (loop-detect-lib/should-halt-for-loop? {:strikes 2}))

(assert-true "halt?: three strikes hits default threshold"
             (loop-detect-lib/should-halt-for-loop? {:strikes 3}))

(assert= "next: :quiet clears strikes (healthy post-NO_TASK idle)"
         {:strikes 0 :last-signal :quiet}
         (loop-detect-lib/next-loop-state {:strikes 2 :last-signal :no-task-spin} :quiet))

(assert= "next: :progress clears strikes"
         {:strikes 0 :last-signal :progress}
         (loop-detect-lib/next-loop-state {:strikes 2 :last-signal :no-task-spin} :progress))

(let [spin (str "> ! ready_for_next.sh\nNO_TASK\n"
                "> ! ready_for_next.sh\nNO_TASK\n>")
      r1 (loop-detect-lib/decide-loop-action nil spin)
      r2 (loop-detect-lib/decide-loop-action (:state r1) spin)
      r3 (loop-detect-lib/decide-loop-action (:state r2) spin)]
  (assert= "decide: first spin observation continues" :continue (:action r1))
  (assert= "decide: second spin observation continues" :continue (:action r2))
  (assert= "decide: third consecutive spin observation halts" :halt (:action r3)))

(let [quiet "> ! ready_for_next.sh\nNO_TASK\n>"
      r (loop-detect-lib/decide-loop-action {:strikes 1 :last-signal :no-task-spin} quiet)]
  (assert= "decide: quiet after a strike continues and clears" :continue (:action r))
  (assert= "decide: quiet clears strikes" 0 (get-in r [:state :strikes])))

(assert-true "format-halt-reason names the role"
             (boolean (re-find #"coder" (loop-detect-lib/format-halt-reason "coder" {:strikes 2}))))

(assert-true "format-telegram-alert names the role and HALTED"
             (let [s (loop-detect-lib/format-telegram-alert "coder" {:strikes 3})]
               (boolean (and (re-find #"coder" s) (re-find #"(?i)halted" s)))))

(assert-true "format-email-subject names the role"
             (boolean (re-find #"coder" (loop-detect-lib/format-email-subject "coder"))))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))
(println "PASS loop_detect_lib assertions")
