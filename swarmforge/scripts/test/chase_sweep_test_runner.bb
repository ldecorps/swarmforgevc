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
(def calls-log (str (fs/path fixture-root "calls.log")))

(defn env-num [name default]
  (or (some-> (System/getenv name) parse-double) default))

(def config
  {:chaseIntervalSeconds (env-num "CHASE_INTERVAL_SECONDS" 5)
   :chaseTimeoutSeconds (env-num "CHASE_TIMEOUT_SECONDS" 30)
   :maxChases (long (env-num "MAX_CHASES" 3))
   :stuckInProcessTimeoutSeconds (env-num "STUCK_TIMEOUT_SECONDS" 60)
   :respawnCooldownSeconds (env-num "RESPAWN_COOLDOWN_SECONDS" 300)})

(defn log-call! [& parts]
  (spit calls-log (str (str/join " " parts) "\n") :append true))

(def adapters
  {:get-liveness (fn [_role] liveness)
   :send-wake-up! (fn [role] (log-call! "wake-up" role))
   :trigger-respawn! (fn [role] (log-call! "respawn" role))
   :log-dead-letter! (fn [role path] (log-call! "dead-letter" role (fs/file-name path)))
   :get-last-activity-ms (fn [_role] last-activity-ms)
   :on-stuck-escalation! (fn [role escalated] (log-call! "escalation" role (str escalated)))
   :log-telemetry! (fn [event _now-ms]
                      (log-call! "telemetry" (:type event) (:role event) (:handoffId event) (str (:count event))))})

(chase-sweep-lib/run-sweep! [{:role role :inbox-new-dir inbox-new-dir :in-process-dir in-process-dir}] now-ms config adapters)
