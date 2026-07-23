#!/usr/bin/env bb
;; Test-only harness for chase_sweep_lib.bb (BL-146): runs run-sweep! once
;; against a single role/fixture with an EXPLICIT fake now-ms and fake
;; adapters that log every call to a file instead of touching tmux - no live
;; tmux, no real timers, matching the sweep-decision non-behavioral gate.
;;
;; Usage: chase_sweep_test_runner.bb <fixture-root> <now-ms> <liveness> <last-activity-ms>
;;
;; Config tunables via env (all optional, sensible test defaults):
;;   CHASE_TIMEOUT_SECONDS, MAX_CHASES, STUCK_TIMEOUT_SECONDS,
;;   RESPAWN_COOLDOWN_SECONDS
;;
;; BL-528 tunables:
;;   CLAIM_IDLE_TIMEOUT_MS    — default 1200000 (20 min)
;;   CLAIM_HEAD_COMMIT        — fake HEAD commit for :get-role-head-commit
;;                              (omit to disable BL-528 check, as before)

(ns chase-sweep-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def fixture-root (nth *command-line-args* 0))
(def now-ms (parse-long (nth *command-line-args* 1)))
(def liveness (nth *command-line-args* 2))
(def last-activity-ms (parse-long (nth *command-line-args* 3)))

(def role "coder")
(def inbox-new-dir (str (fs/path fixture-root "inbox" "new")))
(def in-process-dir (str (fs/path fixture-root "inbox" "in_process")))
;; BL-499: completed/abandoned - the terminal-basename dirs run-sweep! now
;; reads to reap an already-processed new/ duplicate. Absent from a
;; fixture that never created them degrades to [] (terminal-basenames'
;; own fs/exists? guard, mirroring handoff-lib/handoff-files).
(def completed-dir (str (fs/path fixture-root "inbox" "completed")))
(def abandoned-dir (str (fs/path fixture-root "inbox" "abandoned")))
(def calls-log (str (fs/path fixture-root "calls.log")))

(defn env-num [name default]
  (or (some-> (System/getenv name) parse-double) default))

(def config
  {:chaseIntervalSeconds (env-num "CHASE_INTERVAL_SECONDS" 5)
   :chaseTimeoutSeconds (env-num "CHASE_TIMEOUT_SECONDS" 30)
   :maxChases (long (env-num "MAX_CHASES" 3))
   :stuckInProcessTimeoutSeconds (env-num "STUCK_TIMEOUT_SECONDS" 60)
   :respawnCooldownSeconds (env-num "RESPAWN_COOLDOWN_SECONDS" 300)
   ;; BL-528 tunables:
   :claim-idle-timeout-ms (long (env-num "CLAIM_IDLE_TIMEOUT_MS" (* 20 60 1000)))
   :probe-grace-ms (long (env-num "CLAIM_PROBE_GRACE_MS" (* 10 60 1000)))
   :nudge-threshold (long (env-num "CLAIM_NUDGE_THRESHOLD" 1))
   :bounce-threshold (long (env-num "CLAIM_BOUNCE_THRESHOLD" 6))
   :halt-threshold (long (env-num "CLAIM_HALT_THRESHOLD" 10))})

(defn log-call! [& parts]
  (spit calls-log (str (str/join " " parts) "\n") :append true))

;; BL-209: the shared rate-limit cooldown file lives directly in
;; fixture-root - a test pre-populates fixture-root/rate-limit-cooldown.json
;; to simulate an existing cooldown; absent (the common case for this
;; harness's existing scenarios) reads as "not cooling down", preserving
;; every prior test's behavior unchanged.
(def rate-limit-state-dir fixture-root)

(def adapters
  {:get-liveness (fn [_role] liveness)
   :send-wake-up! (fn [role]
                    (when-not (= "1" (System/getenv "CHASE_WAKE_SKIP"))
                      (log-call! "wake-up" role))
                    (not= "1" (System/getenv "CHASE_WAKE_SKIP")))
   :trigger-respawn! (fn [role] (log-call! "respawn" role))
   :log-dead-letter! (fn [role path] (log-call! "dead-letter" role (fs/file-name path)))
   :get-last-activity-ms (fn [_role] last-activity-ms)
   :on-stuck-escalation! (fn [role escalated] (log-call! "escalation" role (str escalated)))
   :log-telemetry! (fn [event _now-ms]
                      (log-call! "telemetry" (:type event) (:role event) (:handoffId event) (str (:count event))))
   :get-rate-limit-cooldown-until-ms
   (fn [role] (chase-sweep-lib/read-rate-limit-cooldown-until-ms rate-limit-state-dir role))
   :get-rate-limit-cooldown-woken-marker
   (fn [role] (chase-sweep-lib/read-rate-limit-cooldown-woken-marker rate-limit-state-dir role))
   :mark-rate-limit-cooldown-woken!
   (fn [role until-ms] (chase-sweep-lib/mark-rate-limit-cooldown-woken! rate-limit-state-dir role until-ms))
   ;; BL-528: claim-progress adapters. CLAIM_HEAD_COMMIT env var must be set
   ;; to enable the check; absent = disabled (backward compat for old tests).
   :get-role-head-commit
   (when-let [h (System/getenv "CLAIM_HEAD_COMMIT")]
     (fn [_role] h))
   :role-agent-busy?
   (when (= "1" (System/getenv "CLAIM_AGENT_BUSY"))
     (fn [_role] true))
   :role-worktree-dirty?
   (when (= "1" (System/getenv "CLAIM_WORKTREE_DIRTY"))
     (fn [_role] true))
   :claim-idle-context
   (fn [_role]
     (cond-> {}
       (= "1" (System/getenv "CLAIM_RESIDENT_BUSY")) (assoc :resident-busy? true)
       (= "1" (System/getenv "CLAIM_ROTATION_ROUTER")) (assoc :rotation-router? true)
       (System/getenv "CLAIM_ACTIVE_ROLE") (assoc :active-role (System/getenv "CLAIM_ACTIVE_ROLE"))))
   :send-claim-idle-probe!
   (fn [role message]
     (log-call! "claim-idle-probe" role (subs message 0 (min 40 (count message)))))
   :on-claim-idle-bounce!
   (fn [role _fp progress]
     (log-call! "claim-bounce" role (str (:reclaims progress))))
   :on-claim-idle-halt!
   (fn [role _fp progress]
     (log-call! "claim-halt" role (str (:reclaims progress))))})

(chase-sweep-lib/run-sweep!
 [{:role role :inbox-new-dir inbox-new-dir :in-process-dir in-process-dir
   :completed-dir completed-dir :abandoned-dir abandoned-dir}]
 now-ms config adapters)
