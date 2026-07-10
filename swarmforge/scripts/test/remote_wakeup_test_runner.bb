#!/usr/bin/env bb
;; TDD runner for remote_wakeup_lib.bb (BL-092) - pure assertions, no live
;; GitHub, no live tmux.
(ns remote-wakeup-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "remote_wakeup_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── read-swarm-field ───────────────────────────────────────────────────────

(assert= "reads an explicit swarm: field"
         "second"
         (remote-wakeup-lib/read-swarm-field "id: BL-1\ntitle: \"demo\"\nswarm: second\n"))

(assert= "absent swarm: field reads as nil (primary)"
         nil
         (remote-wakeup-lib/read-swarm-field "id: BL-1\ntitle: \"demo\"\n"))

(assert= "tolerates leading/trailing whitespace around the field"
         "second"
         (remote-wakeup-lib/read-swarm-field "id: BL-1\n  swarm:   second  \n"))

(assert= "nil yaml text reads as nil"
         nil
         (remote-wakeup-lib/read-swarm-field nil))

;; ── backlog-yaml-path? ─────────────────────────────────────────────────────

(assert= "matches a backlog/active/*.yaml path" true (remote-wakeup-lib/backlog-yaml-path? "backlog/active/BL-217-demo.yaml"))
(assert= "matches a backlog/paused/*.yml path" true (remote-wakeup-lib/backlog-yaml-path? "backlog/paused/BL-9.yml"))
(assert= "does not match backlog/done/ (terminal, never re-assigned)" false (remote-wakeup-lib/backlog-yaml-path? "backlog/done/BL-1-demo.yaml"))
(assert= "does not match an unrelated path" false (remote-wakeup-lib/backlog-yaml-path? "extension/src/foo.ts"))
(assert= "does not match a nested subdirectory (done/'s own milestone subfolders, e.g.)" false (remote-wakeup-lib/backlog-yaml-path? "backlog/active/sub/BL-1.yaml"))

;; ── should-nudge? ────────────────────────────────────────────────────────

(assert= "wakeup-bridge-01: a changed item assigned to the target swarm nudges"
         true
         (remote-wakeup-lib/should-nudge? [{:path "backlog/active/BL-1.yaml" :swarm "second"}] "second"))

(assert= "wakeup-bridge-02: a changed item assigned only to the primary (nil) swarm does not nudge the second swarm"
         false
         (remote-wakeup-lib/should-nudge? [{:path "backlog/active/BL-1.yaml" :swarm nil}] "second"))

(assert= "a changed item assigned to a DIFFERENT named swarm does not nudge this one"
         false
         (remote-wakeup-lib/should-nudge? [{:path "backlog/active/BL-1.yaml" :swarm "third"}] "second"))

(assert= "no changed backlog files at all does not nudge"
         false
         (remote-wakeup-lib/should-nudge? [] "second"))

(assert= "a mix of irrelevant and relevant changes still nudges (any match is enough)"
         true
         (remote-wakeup-lib/should-nudge? [{:path "a" :swarm nil} {:path "b" :swarm "second"} {:path "c" :swarm "third"}] "second"))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: remote_wakeup_lib.bb"))
