#!/usr/bin/env bb
;; BL-976 test-only harness: simulates ONE daemon generation's sweep cycles
;; over the REAL libraries - daemon_alarm_lib.bb's email-send-reason /
;; alert-keyless-if-needed! (the keyless Telegram alert decision, wired
;; exactly as handoffd.bb's email-keyless-alert-sweep! wires it, transport
;; swapped for a recording fixture) and briefing_email_lib.bb's
;; send-unsent-briefings! (with the same :send-reason! shape handoffd.bb's
;; briefing-send-reason! uses). No real network, no live daemon, no real
;; key. Prints a JSON result for acceptance step handlers.
;;
;; Usage: bl976_email_keyless_harness.bb <briefings-dir> generation \
;;          <keyless|keyed> <sweeps> <env-file-path> [today-str]
;;
;; The generation's key state is fixed for its lifetime (a real process
;; env cannot change under it); .sent.json in briefings-dir persists
;; ACROSS invocations, so scenario email-key-06 drives two generations as
;; two invocations against the same fixture dir.

(ns bl976-email-keyless-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_alarm_lib.bb")))

(def briefings-dir (nth *command-line-args* 0))
(def mode (nth *command-line-args* 1))
(def key-state (nth *command-line-args* 2))
(def sweeps (parse-long (nth *command-line-args* 3)))
(def env-file-path (nth *command-line-args* 4))
(def today-str (nth *command-line-args* 5 nil))

(when-not (= mode "generation")
  (binding [*out* *err*] (println "unknown mode:" mode))
  (System/exit 2))

(def to "operator@example.com")
;; BL976_FIXTURE_KEY lets the invariant-2 property runner drive a GENERATED
;; key value through the real sweep path and then scan for leaks of it.
(def api-key (case key-state
               "keyed" (or (System/getenv "BL976_FIXTURE_KEY") "bl976-fixture-key-value")
               "keyless" nil))

(def telegram-alerts (atom []))
(def logs (atom []))
(def emails-sent (atom 0))
(def alerted? (atom false))
(def warned? (atom false))
(def last-sent (atom []))

;; Mirrors handoffd.bb's briefing-send-reason!: the one-shot missing-key
;; log warning is owned by the caller's :send-reason! adapter via the
;; shared warn-missing-key-if-needed! and a per-process atom.
(defn send-reason! []
  (let [reason (daemon-alarm-lib/email-send-reason to api-key)]
    (when (= reason :missing-api-key)
      (daemon-alarm-lib/warn-missing-key-if-needed!
       {:reason reason}
       {:already-warned?! (fn [] @warned?)
        :log-warning! (fn [msg] (swap! logs conj ["email-misconfigured" msg]))
        :mark-warned! (fn [] (reset! warned? true))}))
    reason))

;; Mirrors handoffd.bb's email-keyless-alert-sweep!, fixture transport.
(defn keyless-alert-sweep! []
  (daemon-alarm-lib/alert-keyless-if-needed!
   (daemon-alarm-lib/email-send-reason to api-key)
   {:already-alerted?! (fn [] @alerted?)
    :send-alert! (fn []
                   (swap! telegram-alerts conj
                          (daemon-alarm-lib/format-keyless-alert env-file-path))
                   (swap! logs conj ["email-keyless-alert" env-file-path]))
    :mark-alerted! (fn [] (reset! alerted? true))}))

(def adapters
  (cond-> {:send-reason! send-reason!
           :read-briefing-content (fn [f] (slurp (str (fs/path briefings-dir f))))
           :send-email! (fn [_subject text & _]
                          (swap! emails-sent inc)
                          {:success true})
           :log! (fn [& parts] (swap! logs conj (vec parts)))}
    today-str (assoc :today-str today-str)))

(dotimes [_ sweeps]
  (keyless-alert-sweep!)
  (reset! last-sent (briefing-email-lib/send-unsent-briefings! briefings-dir adapters)))

(println (json/generate-string {:telegramAlerts @telegram-alerts
                                 :logs @logs
                                 :sent @last-sent
                                 :emailsSent @emails-sent}))
