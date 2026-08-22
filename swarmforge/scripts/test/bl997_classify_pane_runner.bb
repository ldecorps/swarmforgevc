#!/usr/bin/env bb
;; BL-997/BL-897: prints the REAL Babashka busy-classifier's verdict for a
;; pane capture, so the extension-host test suite (Node, no path to a .bb
;; lib) can compare behavior against it without a second, hand-mirrored
;; copy of the classification logic. Deliberately a thin CLI over the real
;; chase_sweep_lib.bb/actively-processing? - never a reimplementation.
;;
;; Usage: bl997_classify_pane_runner.bb <pane-capture-file>
;; Prints exactly "true" or "false" on stdout.

(require '[babashka.fs :as fs])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "chase_sweep_lib.bb")))

(def pane-file (or (first *command-line-args*)
                    (binding [*out* *err*]
                      (println "Usage: bl997_classify_pane_runner.bb <pane-capture-file>")
                      (System/exit 1))))

(println (str (boolean (chase-sweep-lib/actively-processing? (slurp pane-file)))))
