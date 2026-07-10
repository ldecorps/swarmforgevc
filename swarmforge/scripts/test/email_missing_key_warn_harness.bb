#!/usr/bin/env bb
;; Test-only harness for daemon_alarm_lib.bb's BL-215 email-misconfiguration
;; warning gate: drives the real send-alarm-email!/warn-missing-key-if-needed!
;; with fake post/log adapters (no real network, no real timers) and prints a
;; JSON result to stdout - lets the acceptance step handlers assert against
;; the real library logic instead of re-implementing it in JS.
;;
;; Usage: email_missing_key_warn_harness.bb <to> <api-key-or-empty> [repeat-count]
;;
;; repeat-count simulates the daemon's send path running many times across a
;; long-lived process (BL-215 warn-04) - one process, repeated attempts,
;; matching how handoffd_supervisor.bb's own missing-key-warned? atom persists
;; for the life of the daemon, not a fresh atom per attempt.

(ns email-missing-key-warn-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_alarm_lib.bb")))

(def to (nth *command-line-args* 0))
(def api-key (let [v (nth *command-line-args* 1 "")] (when (seq v) v)))
(def repeat-count (parse-long (nth *command-line-args* 2 "1")))

(def sent (atom 0))
(def warnings (atom []))
(def warned? (atom false))

(defn attempt! []
  (let [result (daemon-alarm-lib/send-alarm-email!
                api-key to "onboarding@resend.dev" "subj" "text"
                (fn [_api-key _msg] (swap! sent inc) {:success true}))]
    (daemon-alarm-lib/warn-missing-key-if-needed!
     result
     {:already-warned?! (fn [] @warned?)
      :log-warning! (fn [msg] (swap! warnings conj msg))
      :mark-warned! (fn [] (reset! warned? true))})
    result))

(def last-result (last (repeatedly repeat-count attempt!)))

(println (json/generate-string {:success (boolean (:success last-result))
                                 :reason (some-> (:reason last-result) name)
                                 :emailsSent @sent
                                 :warnings @warnings}))
