#!/usr/bin/env bb
;; BL-2049: thin CLI over property_runner_reach_lib.bb - the same pair
;; shape as bb_load_closure_lib.bb/bb_load_closure_cli.bb.
;;
;; Usage: property_runner_reach.bb <scripts-dir> <changed-path>...
;;   Changed paths are relative to the repository root
;;   (<scripts-dir>/../..). Prints, one per line in name order, the file
;;   names of the *_property_runner.{bb,sh,js} runners directly in
;;   <scripts-dir>/test that any changed path reaches. Prints nothing
;;   (exit 0) when none is reached, or when no changed path is given.

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "property_runner_reach_lib.bb")))

(let [[scripts-dir & changed-paths] *command-line-args*]
  (when (nil? scripts-dir)
    (binding [*out* *err*]
      (println "usage: property_runner_reach.bb <scripts-dir> <changed-path>..."))
    (System/exit 1))
  (doseq [r (property-runner-reach-lib/reached-runners scripts-dir changed-paths)]
    (println r)))
