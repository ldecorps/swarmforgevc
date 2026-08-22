#!/usr/bin/env bb
;; BL-996: prints all three real consumers' verdicts for a pane capture, so
;; the acceptance step handlers can assert "one definition" without a
;; second, hand-rolled reimplementation of any of the three.
;;
;; Usage: bl996_classify_pane_runner.bb <pane-capture-file>
;; Prints one JSON object: {"wakeGate": bool, "babysitter": bool, "loop": "busy"|"progress"|"no-task-spin"|"quiet"}

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "chase_sweep_lib.bb")))
(load-file (str (fs/path script-dir ".." "babysitterd_sweep_lib.bb")))
(load-file (str (fs/path script-dir ".." "loop_detect_lib.bb")))

(def pane-file (or (first *command-line-args*)
                    (binding [*out* *err*]
                      (println "Usage: bl996_classify_pane_runner.bb <pane-capture-file>")
                      (System/exit 1))))

(def text (slurp pane-file))

(println
 (json/generate-string
  {:wakeGate (boolean (chase-sweep-lib/actively-processing? text))
   :babysitter (boolean (babysitterd-sweep-lib/classify-pane-busy? text))
   :loop (name (loop-detect-lib/classify-pane-loop-signal text))}))
