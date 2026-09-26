#!/usr/bin/env bb
;; BL-1711: the one shell-callable entry point for
;; orphan-janitor-sweep-lib/sweep! - used by ollama_ancillary_lib.sh's
;; restart-if-crashed (bash) to reap a crashed ollama server's orphaned
;; runners before starting its replacement, without re-implementing
;; BL-1705's ghost classification in bash. Every other caller of sweep!
;; (operator_runtime.bb) stays bb-native and unaffected by this file.
;;
;; Usage: orphan_janitor_sweep_cli.bb <project-root>

(ns orphan-janitor-sweep-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "orphan_janitor_sweep_lib.bb")))

(defn -main [project-root]
  (orphan-janitor-sweep-lib/sweep!
   project-root
   (assoc (orphan-janitor-sweep-lib/default-adapters project-root)
          :log! (fn [msg] (println (str "orphan-janitor-sweep: " msg))))))

(apply -main *command-line-args*)
