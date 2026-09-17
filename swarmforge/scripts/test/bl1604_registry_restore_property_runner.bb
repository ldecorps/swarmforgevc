#!/usr/bin/env bb
;; BL-1604: prints the REAL Babashka registry-row-restore decision for a
;; BATCH of trials read from stdin as a JSON array, so the extension-host
;; property test (Node, no path to a .bb lib) can drive land_step_lib.bb's
;; own registry-rows-to-restore generatively without a second, hand-mirrored
;; copy of the matching logic - and without paying a fresh bb process
;; startup per draw.
;;
;; Usage: echo '[{"origin-rows":[...],"replay-rows":[...],
;;                "landing-id":"BL-1","open-ids":["BL-2"]}, ...]' | \
;;          bl1604_registry_restore_property_runner.bb
;; Each row is {"file":"...","owner":"...","raw":"..."}. Prints a JSON array
;; of restored-row arrays, one per trial, in order.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "land_step_lib.bb")))

(defn- ->row [m]
  {:file (get m "file") :owner (get m "owner") :raw (get m "raw")})

(def trials (json/parse-string (slurp *in*)))

(println
 (json/generate-string
  (mapv (fn [t]
          (land-step-lib/registry-rows-to-restore
           {:origin-rows (mapv ->row (get t "origin-rows"))
            :replay-rows (mapv ->row (get t "replay-rows"))
            :landing-id (get t "landing-id")
            :open-ids (set (get t "open-ids"))}))
        trials)))
