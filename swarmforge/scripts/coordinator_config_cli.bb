#!/usr/bin/env bb

;; BL-314: the one shell-callable entry point for coordinator_config_lib.bb.
;; swarmforge.sh's provision_coordinator shells out to this to resolve the
;; coordinator's model/effort from the effective config file, rather than
;; re-implementing the parse in bash.
;;
;; Usage: coordinator_config_cli.bb <conf-path>
;; Prints "<model>\t<effort>" (falling back to the shared Sonnet/high
;; defaults when the conf file is absent/unparseable) and exits 0.

(ns coordinator-config-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "coordinator_config_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: coordinator_config_cli.bb <conf-path>"))
  (System/exit 1))

(defn -main [& args]
  (when (not= 1 (count args))
    (usage))
  (let [[conf-path] args
        conf-text (try (slurp conf-path) (catch Exception _ nil))]
    (println (str (coordinator-config-lib/coordinator-model conf-text)
                   "\t"
                   (coordinator-config-lib/coordinator-effort conf-text)))))

(apply -main *command-line-args*)
