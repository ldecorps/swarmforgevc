#!/usr/bin/env bb
;; BL-411 acceptance test runner: executes check-one! with kill-pid! tracking
;; to verify the negotiation relay supervisor's restart decision kills the
;; old pid before spawning the replacement. Mirrors
;; bl403_supervisor_kill_acceptance_runner.bb exactly (same shared
;; front_desk_supervisor_lib.bb/check-one! - BL-411 is the SAME state
;; machine's other caller, not a new decision to prove) - called from
;; bl411NegotiationRelayKillsSupersededChildSteps.js with a JSON scenario.
(ns bl411-negotiation-relay-kill-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "front_desk_supervisor_lib.bb")))

(def scenario (json/parse-string (nth *command-line-args* 0) true))

;; Convert camelCase JSON to kebab-case Clojure
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

(def restart-config
  {:max-attempts (get-in scenario [:restartConfig :maxAttempts])
   :backoff-base-ms (get-in scenario [:restartConfig :backoffBaseMs])
   :backoff-max-ms (get-in scenario [:restartConfig :backoffMaxMs])
   :healthy-reset-ms (get-in scenario [:restartConfig :healthyResetMs])})

(def giveup-config
  {:giveup-cooldown-ms (get-in scenario [:giveupConfig :giveupCooldownMs])})

;; Track kill calls so we can verify the order and pids
(def kill-calls (atom []))
(defn kill-pid-tracking! [pid]
  (swap! kill-calls conj pid))

;; Fixed pid for spawn - always returns 5252 (distinct from BL-403's 4242
;; fixture, so a copy/paste mixup between the two runners is obvious)
(defn fixed-spawn! [] 5252)

;; Execute check-one! with the tracking kill-pid! function
(let [{:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              entry now-ms pid-alive? fixed-spawn! restart-config giveup-config false kill-pid-tracking!)]
  ;; Convert kebab-case back to camelCase for JSON output
  (defn ->entry-json [e]
    {:pid (:pid e)
     :attempts (:attempts e)
     :status (:status e)
     :crashedAtMs (:crashed-at-ms e)
     :startedAtMs (:started-at-ms e)
     :gaveUpAtMs (:gave-up-at-ms e)})

  ;; Return the result as JSON
  (println (json/generate-string {:entry (->entry-json entry)
                                  :event (some-> event name)
                                  :killCalls @kill-calls})))
