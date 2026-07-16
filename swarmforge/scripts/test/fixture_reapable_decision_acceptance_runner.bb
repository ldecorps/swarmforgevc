#!/usr/bin/env bb
;; Acceptance runner for BL-458: takes one JSON arg
;; {"knownFixturePrefix": bool, "stale": bool, "socketRoot": bool} and prints
;; fixture-reaper-lib/reapable?'s result as JSON. Exists so the Node
;; acceptance step handlers can drive the REAL pure decision function
;; without a Babashka<->JS FFI - the same pattern
;; sandbox_sweep_decision_acceptance_runner.bb (BL-413) already established.
;; The reaper's real kill+rm-rf wiring (fixture-process-leak-02/03) is proven
;; separately by a real subprocess - see bl458AcceptanceFixtureProcessLeakSteps.js
;; and swarmforge/scripts/test/test_operator_runtime_fixture_reaper_sweep.sh.
(ns fixture-reapable-decision-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "fixture_reaper_lib.bb")))

(def scenario (json/parse-string (first *command-line-args*) true))

(def result
  (fixture-reaper-lib/reapable?
   {:known-fixture-prefix? (boolean (:knownFixturePrefix scenario))
    :stale? (boolean (:stale scenario))
    :socket-root? (boolean (:socketRoot scenario))}))

(println (json/generate-string {:reapable result}))
