#!/usr/bin/env bb
;; Acceptance runner for BL-413: takes one JSON arg
;; {"knownSandboxPrefix": bool, "stale": bool, "hasLiveProcess": bool, "socketDir": bool}
;; and prints sandbox-sweep-lib/removable?'s result as JSON. Exists so the
;; Node acceptance step handlers can drive the REAL pure decision function
;; without a Babashka<->JS FFI - the same pattern
;; disk_space_decision_acceptance_runner.bb (BL-412) already established. The
;; sweep's real /tmp-listing/deletion wiring (the redirectable-root claim,
;; stale-sandbox-sweep-03) is proven separately by a real operator_runtime.bb
;; --tick-once subprocess - see bl413StaleSandboxSweepSteps.js and
;; swarmforge/scripts/test/test_operator_runtime_sandbox_sweep.sh.
(ns sandbox-sweep-decision-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "sandbox_sweep_lib.bb")))

(def scenario (json/parse-string (first *command-line-args*) true))

(def result
  (sandbox-sweep-lib/removable?
   {:known-sandbox-prefix? (boolean (:knownSandboxPrefix scenario))
    :stale? (boolean (:stale scenario))
    :has-live-process? (boolean (:hasLiveProcess scenario))
    :socket-dir? (boolean (:socketDir scenario))}))

(println (json/generate-string {:removable result}))
