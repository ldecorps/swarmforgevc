#!/usr/bin/env bb
;; BL-536 acceptance test runner: drives the REAL provider_auth_observe_lib.bb
;; decide-auth-observation over a JSON-supplied sequence of pane-scrollback
;; ticks, threading episode state across ticks. Called from
;; bl536ProviderAuthErrorAutoRespawnSteps.js with a JSON scenario.
(ns bl536-auth-observe-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "provider_auth_observe_lib.bb")))

(def scenario (json/parse-string (nth *command-line-args* 0) true))

(def max-attempts (or (:maxAttempts scenario) 3))
(def ticks (:ticks scenario))

(def results
  (loop [state nil remaining ticks acc []]
    (if (empty? remaining)
      acc
      (let [pane (first remaining)
            decision (provider-auth-observe-lib/decide-auth-observation
                      state pane {:max-attempts max-attempts})]
        (recur (:state decision) (rest remaining)
               (conj acc {:signal (name (:signal decision))
                          :action (name (:action decision))
                          :attempts (get-in decision [:state :attempts])
                          :alerted (get-in decision [:state :alerted])}))))))

(println (json/generate-string {:results results}))
