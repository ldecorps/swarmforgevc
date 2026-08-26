#!/usr/bin/env bb
;; Acceptance runner for BL-486: takes one JSON arg {"inLiveWindowSet": bool,
;; "cwdInsideRoot": bool, "remoteControlAgent": bool, "hasChildren": bool,
;; "stale": bool} and prints orphan-agent-reaper-lib/reapable?'s result as
;; JSON. Exists so the Node acceptance step handlers can drive the REAL pure
;; decision function without a Babashka<->JS FFI - the same pattern
;; fixture_reapable_decision_acceptance_runner.bb (BL-458) already
;; established. The reaper's real kill+audit wiring
;; (reap-orphaned-agent-processes-02/03) is proven separately by a real
;; sweep subprocess - see bl486ReapOrphanedAgentProcessesSteps.js.
(ns orphan-agent-reapable-decision-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "orphan_agent_reaper_lib.bb")))

(def scenario (json/parse-string (first *command-line-args*) true))

(def result
  (orphan-agent-reaper-lib/reapable?
   {:in-live-window-set? (boolean (:inLiveWindowSet scenario))
    :cwd-inside-root? (boolean (:cwdInsideRoot scenario))
    :remote-control-agent? (boolean (:remoteControlAgent scenario))
    :has-children? (boolean (:hasChildren scenario))
    :stale? (boolean (:stale scenario))}))

(println (json/generate-string {:reapable result}))
