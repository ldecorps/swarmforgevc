#!/usr/bin/env bb
;; Test-only harness for daemon_alarm_lib.bb (BL-144): exercises the pure
;; failure-log/email builders directly, and drives alarm-and-halt! with
;; fake adapters that log every call to files instead of touching a real
;; clock, the filesystem in daemon-shaped ways, tmux, or the network - no
;; live daemon, no real timers, matching the non-behavioral gate.
;;
;; Usage: daemon_alarm_test_runner.bb <fixture-root>

(ns daemon-alarm-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_alarm_lib.bb")))

(def fixture-root (nth *command-line-args* 0))
(def calls-log (str (fs/path fixture-root "calls.log")))
(def failure-log-path (str (fs/path fixture-root "failure.log")))
(def status-file (str (fs/path fixture-root "status.json")))

(defn log-call! [& parts]
  (spit calls-log (str (str/join " " parts) "\n") :append true))

(def fake-status {:restart_history [1 2 3] :last_incident {:reason "dead" :at "2026-07-01T00:00:00Z"}})

(def adapters
  {:reason :dead
   :status fake-status
   :now-iso! (fn [] "2026-07-07T08:00:00Z")
   :log-tail! (fn [] ["line one" "line two"])
   :role-counts! (fn [] [{:role "coder" :inbox-new 2 :outbox 1}])
   :write-failure-log! (fn [content]
                          (spit failure-log-path content)
                          failure-log-path)
   :send-email! (fn [subject text]
                  (log-call! "send-email" subject)
                  (spit (str (fs/path fixture-root "email-text.txt")) text)
                  {:success true})
   :halt-swarm! (fn [] (log-call! "halt-swarm"))
   :write-status! (fn [status]
                     (spit status-file (json/generate-string status)))})

(daemon-alarm-lib/alarm-and-halt! adapters)
