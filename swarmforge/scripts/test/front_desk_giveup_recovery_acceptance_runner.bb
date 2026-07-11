#!/usr/bin/env bb
;; BL-303: acceptance runner for front_desk_supervisor_lib.bb's check-one!
;; (the healthy-uptime reset + give-up cooldown re-arm decision) - drives
;; the REAL pure state machine against a fixture entry/clock/config, no
;; real process spawn, no real clock (de0991e). Mirrors
;; linked_ticket_status_acceptance_runner.bb's own "print the pure
;; decision as JSON" shape.
;;
;; Usage: front_desk_giveup_recovery_acceptance_runner.bb <scenario-json>
;; scenario: {
;;   entry: {pid, attempts, status, crashedAtMs, startedAtMs, gaveUpAtMs},
;;   nowMs: number,
;;   pidAlive: boolean,
;;   restartConfig: {maxAttempts, backoffBaseMs, backoffMaxMs, healthyResetMs},
;;   giveupConfig: {giveupCooldownMs}
;; }

(ns front-desk-giveup-recovery-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))

(def scenario (json/parse-string (nth *command-line-args* 0) true))

(defn ->entry [e]
  {:pid (:pid e)
   :attempts (:attempts e)
   :status (:status e)
   :crashed-at-ms (:crashedAtMs e)
   :started-at-ms (:startedAtMs e)
   :gave-up-at-ms (:gaveUpAtMs e)})

(def entry (->entry (:entry scenario)))
(def now-ms (:nowMs scenario))
(def pid-alive? (constantly (boolean (:pidAlive scenario))))
(def next-pid (atom 9000))
(def spawn-pid! (fn [] (swap! next-pid inc)))

(def restart-config
  {:max-attempts (get-in scenario [:restartConfig :maxAttempts])
   :backoff-base-ms (get-in scenario [:restartConfig :backoffBaseMs])
   :backoff-max-ms (get-in scenario [:restartConfig :backoffMaxMs])
   :healthy-reset-ms (get-in scenario [:restartConfig :healthyResetMs])})
(def giveup-config {:giveup-cooldown-ms (get-in scenario [:giveupConfig :giveupCooldownMs])})

(def result (front-desk-supervisor-lib/check-one! entry now-ms pid-alive? spawn-pid! restart-config giveup-config))

(defn ->entry-json [e]
  {:pid (:pid e)
   :attempts (:attempts e)
   :status (:status e)
   :crashedAtMs (:crashed-at-ms e)
   :startedAtMs (:started-at-ms e)
   :gaveUpAtMs (:gave-up-at-ms e)})

(println (json/generate-string {:entry (->entry-json (:entry result))
                                 :event (some-> (:event result) name)}))
