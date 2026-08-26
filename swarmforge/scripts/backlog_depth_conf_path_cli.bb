#!/usr/bin/env bb

;; BL-853: the one shell-callable entry point for backlog_depth_lib.bb's
;; conf-file-path - the EFFECTIVE active_backlog_max_depth config file for
;; the swarm actually running (a persisted .swarmforge/swarm-identity
;; override, or the tracked default swarmforge/swarmforge.conf). Exists so
;; promote_and_route_next.sh's backlog_depth_cli.bb fallback (used only when
;; effective_backlog_depth_cli.bb itself cannot be run at all) can pass the
;; CONFIG FILE PATH that CLI documents, instead of re-deriving the
;; swarm-identity lookup a second time in bash - the exact kind of divergent
;; copy BL-216/BL-313 already fought to consolidate away.
;;
;; Usage: backlog_depth_conf_path_cli.bb <project-root>
;; Prints the resolved config file path and exits 0.

(ns backlog-depth-conf-path-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: backlog_depth_conf_path_cli.bb <project-root>"))
  (System/exit 1))

(defn -main [& args]
  (when (not= 1 (count args))
    (usage))
  (let [[project-root] args]
    (println (str (backlog-depth-lib/conf-file-path project-root)))))

(apply -main *command-line-args*)
