#!/usr/bin/env bb
;; BL-305: acceptance runner for operator_lib.bb's resolve-provider-state
;; (the fail-open cooldown decision) - drives the REAL pure function
;; against a fixture scenario + injected clock, no real tmux/process, no
;; real timer (de0991e). Mirrors
;; front_desk_giveup_recovery_acceptance_runner.bb's own "print the pure
;; decision as JSON" shape.
;;
;; Usage: operator_cooldown_resilience_acceptance_runner.bb <scenario-json>
;; scenario: {
;;   limitedText: string|null, parsedResetMs: number|null, resetRaw: string|null,
;;   existingResetMs: number|null, existingResetRaw: string|null,
;;   nowMs: number, boundedFallbackMs: number, plausibleMaxMs: number
;; }

(ns operator-cooldown-resilience-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_lib.bb")))

(def scenario (json/parse-string (nth *command-line-args* 0) true))

(def result
  (operator-lib/resolve-provider-state
   {:limited-text (:limitedText scenario)
    :parsed-reset-ms (:parsedResetMs scenario)
    :reset-raw (:resetRaw scenario)
    :existing-reset-ms (:existingResetMs scenario)
    :existing-reset-raw (:existingResetRaw scenario)
    :now-ms (:nowMs scenario)
    :bounded-fallback-ms (:boundedFallbackMs scenario)
    :plausible-max-ms (:plausibleMaxMs scenario)}))

(println (json/generate-string {:state (name (:state result))
                                 :resetMs (:reset-ms result)
                                 :resetRaw (:reset-raw result)}))
