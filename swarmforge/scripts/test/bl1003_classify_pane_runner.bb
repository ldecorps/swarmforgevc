#!/usr/bin/env bb
;; BL-1003: prints the REAL Babashka busy-classifier's verdicts for a BATCH
;; of pane captures read from stdin as a JSON array of strings, so the
;; extension-host property test (Node, no path to a .bb lib) can compare
;; the ported TypeScript classifier against the real swarm-side one without
;; a second, hand-mirrored copy of the matching logic - and without paying
;; a fresh bb process startup (measured ~4s, dominated by load-file'ing
;; chase_sweep_lib.bb) per individual draw, which made a one-call-per-draw
;; design impractically slow for a many-draw property sweep.
;;
;; Usage: echo '["pane one", "pane two"]' | bl1003_classify_pane_runner.bb
;; Prints a JSON array of booleans, one per input string, in order.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "chase_sweep_lib.bb")))

(def panes (json/parse-string (slurp *in*)))

(println (json/generate-string (mapv #(boolean (chase-sweep-lib/actively-processing? %)) panes)))
