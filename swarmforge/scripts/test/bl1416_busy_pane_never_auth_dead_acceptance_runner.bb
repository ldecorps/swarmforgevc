#!/usr/bin/env bb
;; BL-1416 acceptance test runner: drives the REAL provider_auth_observe_lib.bb
;; decide-auth-observation over a JSON-supplied sequence of {pane, busy}
;; ticks, threading episode state across ticks, exactly the decision logic
;; handoffd.bb's observe-pane-auth! wires into its live tick. For a tick
;; that lands on :alert, also computes matched-auth-line/format-alert-reason
;; over that tick's own pane text (the same values observe-pane-auth! would
;; compute) so the JS step handlers can assert on the persist alert's text.
;; Called from bl1416BusyPaneNeverAuthDeadSteps.js with a JSON scenario.
(ns bl1416-busy-pane-never-auth-dead-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "provider_auth_observe_lib.bb")))

(def scenario (json/parse-string (nth *command-line-args* 0) true))

(def role (or (:role scenario) "hardender"))
(def max-attempts (or (:maxAttempts scenario) 3))
(def ticks (:ticks scenario))

(def results
  (loop [state nil remaining ticks acc []]
    (if (empty? remaining)
      acc
      (let [{:keys [pane busy]} (first remaining)
            decision (provider-auth-observe-lib/decide-auth-observation
                      state pane {:max-attempts max-attempts :busy? (boolean busy)})
            matched-line (provider-auth-observe-lib/matched-auth-line pane)
            performed-count (get-in decision [:state :attempts])
            row {:signal (name (:signal decision))
                 :action (name (:action decision))
                 :attempts (get-in decision [:state :attempts])
                 :alerted (get-in decision [:state :alerted])
                 :matchedLine matched-line
                 :reason (when (= :alert (:action decision))
                           (provider-auth-observe-lib/format-alert-reason
                            role matched-line performed-count))}]
        (recur (:state decision) (rest remaining) (conj acc row))))))

(println (json/generate-string {:results results}))
