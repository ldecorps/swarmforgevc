#!/usr/bin/env bb
;; Acceptance runner for BL-481: drives the REAL pure decision logic
;; operator_lib.bb exposes for -main's out-of-cycle poll loop
;; (next-poll-decision, resolve-poll-interval-ms, and the pre-existing
;; timer-due? the swarm-check cadence already used) - the same
;; JSON-in/JSON-out Babashka-runner pattern
;; disk_space_decision_acceptance_runner.bb already established, so the
;; Node acceptance step handlers never reimplement this decision in JS.
;;
;; Takes one JSON arg discriminated by "op":
;;   {"op":"decision", "input": {...next-poll-decision keys, camelCase...}}
;;   {"op":"pollSequence", "swarmCheckMs":N, "pollIntervalMs":N, "pollCount":N}
;;   {"op":"resolvePollInterval", "configuredMs": N-or-null}
(ns operator-out-of-cycle-wake-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_lib.bb")))

(def scenario (json/parse-string (first *command-line-args*) true))

(defn- kw-state [s] (when s (keyword s)))

(defmulti run :op)

(defmethod run "decision" [{:keys [input]}]
  (let [{:keys [launch? launch-front-desk? wait-ms]}
        (operator-lib/next-poll-decision
         {:llm-running? (boolean (:llmRunning input))
          :front-desk-running? (boolean (:frontDeskRunning input))
          :provider-state (kw-state (:providerState input))
          :pending-count (or (:pendingCount input) 0)
          :front-desk-pending-count (or (:frontDeskPendingCount input) 0)
          :poll-interval-ms (:pollIntervalMs input)})]
    {:launch launch? :launchFrontDesk launch-front-desk? :waitMs wait-ms}))

(defmethod run "pollSequence" [{:keys [swarmCheckMs pollIntervalMs pollCount]}]
  ;; Simulates pollCount successive out-of-cycle poll wakes, each spaced
  ;; pollIntervalMs apart, threading last-fired-ms through the SAME
  ;; timer-due? gate the runtime's own swarm-check cadence already used -
  ;; proves the health sweep fires at most once per swarmCheckMs window,
  ;; not once per poll.
  (let [wake-times (map #(* % pollIntervalMs) (range pollCount))
        state (atom {:last-ms nil :fire-count 0 :fired-at-index []})]
    (doseq [[idx now] (map-indexed vector wake-times)]
      (when (operator-lib/timer-due? (:last-ms @state) now swarmCheckMs)
        (swap! state (fn [s] (-> s (update :fire-count inc)
                                  (update :fired-at-index conj idx)
                                  (assoc :last-ms now))))))
    {:fullSweepFireCount (:fire-count @state)
     :firedAtIndex (:fired-at-index @state)}))

(defmethod run "resolvePollInterval" [{:keys [configuredMs]}]
  {:resolvedMs (operator-lib/resolve-poll-interval-ms configuredMs)})

(println (json/generate-string (run scenario)))
