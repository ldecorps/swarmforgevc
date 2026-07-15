#!/usr/bin/env bb
;; Acceptance runner for BL-412: takes one JSON arg
;; {"readings": {"mnt-c": {"free_gb": N, "used_pct": N}, ...},
;;  "priorState": {"mnt-c": "healthy", ...}}
;; and prints disk-space-lib/disk-space-decision's result as JSON. Exists so
;; the Node acceptance step handlers can drive the REAL pure decision
;; function without a Babashka<->JS FFI - the same pattern
;; bl403_supervisor_kill_acceptance_runner.bb already established.
(ns disk-space-decision-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "disk_space_lib.bb")))

(def scenario (json/parse-string (first *command-line-args*) true))

(defn ->reading [m] {:free-gb (double (:free_gb m)) :used-pct (double (:used_pct m))})

(def readings (into {} (map (fn [[k v]] [(keyword k) (->reading v)]) (:readings scenario))))
(def prior-state (into {} (map (fn [[k v]] [(name k) v]) (:priorState scenario))))
(def th (disk-space-lib/thresholds))

(def result (disk-space-lib/disk-space-decision readings prior-state th))

(println (json/generate-string
          {:messages (mapv (fn [m] {:mount (name (:mount m)) :level (name (:level m)) :text (:text m)}) (:messages result))
           :nextState (:next-state result)}))
