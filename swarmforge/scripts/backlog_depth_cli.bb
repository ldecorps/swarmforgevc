#!/usr/bin/env bb

;; BL-313: the one shell-callable entry point for backlog_depth_lib.bb's
;; parse-max-depth. swarmforge.sh needs to resolve + display the effective
;; active_backlog_max_depth for the launch banner and to persist alongside
;; the resolved config path in .swarmforge/swarm-identity - shelling out to
;; this instead of re-implementing the parse in bash guarantees the banner
;; can never drift from what backlog_depth_lib.bb's own read-max-depth
;; actually enforces (one parser, every caller).
;;
;; Usage: backlog_depth_cli.bb <conf-path>
;; Prints the resolved active_backlog_max_depth (falling back to
;; backlog_depth_lib.bb's own default when the file is absent/unparseable)
;; and exits 0.

(ns backlog-depth-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: backlog_depth_cli.bb <conf-path>"))
  (System/exit 1))

(defn -main [& args]
  (when (not= 1 (count args))
    (usage))
  (let [[conf-path] args]
    (println (backlog-depth-lib/parse-max-depth
              (try (slurp conf-path) (catch Exception _ nil))))))

(apply -main *command-line-args*)
