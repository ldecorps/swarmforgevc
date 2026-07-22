#!/usr/bin/env bb
;; TDD runner for mono_router_lib.bb
(ns mono-router-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def roles ["coder" "specifier" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(assert-true "conf detects rotation router"
             (mono-router-lib/conf-rotation-router?
              "config active_backlog_max_depth 1\nconfig rotation router\nwindow coder aider\n"))
(assert-true "conf without rotation is false"
             (not (mono-router-lib/conf-rotation-router?
                   "config active_backlog_max_depth -1\nwindow coder aider\n")))

(assert= "coder is resident" :resident (mono-router-lib/classify-role roles "coder"))
(assert= "coordinator stands" :coordinator (mono-router-lib/classify-role roles "coordinator"))
(assert= "QA dormant" :dormant (mono-router-lib/classify-role roles "QA"))
(assert= "specifier dormant" :dormant (mono-router-lib/classify-role roles "specifier"))

(assert-true "resident should stand"
             (mono-router-lib/should-have-standing-session? roles "coder"))
(assert-true "QA should not stand"
             (not (mono-router-lib/should-have-standing-session? roles "QA")))

(assert= "illicit standing QA"
         :teardown-illicit
         (mono-router-lib/topology-action roles "QA" true))
(assert= "missing resident"
         :ensure-standing
         (mono-router-lib/topology-action roles "coder" false))
(assert= "dormant missing ok"
         :dormant-ok
         (mono-router-lib/topology-action roles "specifier" false))
(assert= "coordinator ok"
         :ok
         (mono-router-lib/topology-action roles "coordinator" true))

(let [sum (mono-router-lib/summarize-topology
           roles
           [{:role "coder" :alive? false}
            {:role "QA" :alive? true}
            {:role "coordinator" :alive? true}])]
  (assert= "one illicit" 1 (count (:illicit sum)))
  (assert= "one missing standing" 1 (count (:missing-standing sum))))

(assert-true "identity rotation=router"
             (mono-router-lib/rotation-router-from-identity?
              "swarm_name\tprimary\nrotation\trouter\n"))

;; Dormant-mailbox chase: never false-wake the resident as the wrong identity
(assert= "own session wakes itself"
         :wake-own-session
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? true
           :resident-session-exists? true
           :active-role "coder"
           :target-role "cleaner"}))
(assert= "dormant + wrong identity → rotate"
         :rotate
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "coder"
           :target-role "cleaner"}))
(assert= "dormant + already that role → wake resident"
         :wake-resident
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "cleaner"
           :target-role "cleaner"}))
(assert= "no resident degrades to own-session wake"
         :wake-own-session
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? false
           :active-role "coder"
           :target-role "cleaner"}))

(assert= "ensure restores cleaner when marker says cleaner"
         "cleaner"
         (mono-router-lib/resident-launch-role "coder" "cleaner"))
(assert= "ensure falls back to home when marker empty"
         "coder"
         (mono-router-lib/resident-launch-role "coder" "  "))
(assert= "ensure falls back to home when marker nil"
         "coder"
         (mono-router-lib/resident-launch-role "coder" nil))

(assert-true "clearing stuck email always ok"
             (mono-router-lib/should-send-stuck-escalation-email?
              {:escalated? false :session-exists? false}))
(assert-true "standing role may get stuck email"
             (mono-router-lib/should-send-stuck-escalation-email?
              {:escalated? true :session-exists? true}))
(assert-true "dormant escalate skips email"
             (not (mono-router-lib/should-send-stuck-escalation-email?
                   {:escalated? true :session-exists? false})))

(assert-true "in_process mail is actionable"
             (mono-router-lib/actionable-mail? {:in-process-count 1 :git-handoff-count 0}))
(assert-true "git_handoff in new is actionable"
             (mono-router-lib/actionable-mail? {:in-process-count 0 :git-handoff-count 1}))
(assert-true "empty mailbox is not actionable"
             (not (mono-router-lib/actionable-mail? {:in-process-count 0 :git-handoff-count 0})))

(assert= "newest actionable role wins"
         "architect"
         (mono-router-lib/preferred-rotate-target
          [{:role "coder" :newest-created-at "2026-07-22T01:00:00Z" :actionable? false}
           {:role "cleaner" :newest-created-at "2026-07-22T02:00:00Z" :actionable? true}
           {:role "architect" :newest-created-at "2026-07-22T03:00:00Z" :actionable? true}]))

(assert= "busy resident blocks rotate"
         :busy
         (mono-router-lib/should-rotate-resident?
          {:active-role "coder" :target-role "cleaner" :resident-busy? true
           :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
(assert= "cooldown blocks rotate"
         :cooldown
         (mono-router-lib/should-rotate-resident?
          {:active-role "coder" :target-role "cleaner" :resident-busy? false
           :last-rotate-at-ms 90000 :now-ms 100000 :cooldown-ms 30000}))
(assert= "ready to rotate"
         :rotate
         (mono-router-lib/should-rotate-resident?
          {:active-role "coder" :target-role "cleaner" :resident-busy? false
           :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))

;; ── BL-550: parse-rotation-home / rotate-home? ────────────────────────────
(assert= "reads config rotation_home"
         "documenter"
         (mono-router-lib/parse-rotation-home
          "config rotation router\nconfig rotation_home documenter\n"))
(assert= "defaults to coder when the line is absent"
         "coder"
         (mono-router-lib/parse-rotation-home "config rotation router\n"))
(assert= "defaults to coder on nil conf text"
         "coder"
         (mono-router-lib/parse-rotation-home nil))

(assert-true "non-home role, empty mailbox, mono-router -> rotate home"
             (mono-router-lib/rotate-home?
              {:rotation-router? true :role "documenter" :home-role "coder"
               :mailbox-empty? true}))
(assert-true "home role never rotates to itself"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role "coder" :home-role "coder"
                    :mailbox-empty? true})))
(assert-true "non-home role with mail stays put"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role "cleaner" :home-role "coder"
                    :mailbox-empty? false})))
(assert-true "outside mono-router, no rotation at all"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? false :role "documenter" :home-role "coder"
                    :mailbox-empty? true})))
(assert-true "a different home role is honored, not hard-coded"
             (mono-router-lib/rotate-home?
              {:rotation-router? true :role "cleaner" :home-role "documenter"
               :mailbox-empty? true}))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "mono_router_lib_test_runner: ok")
