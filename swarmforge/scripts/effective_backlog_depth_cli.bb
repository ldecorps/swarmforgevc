#!/usr/bin/env bb

;; BL-432 (epic BL-429 slice 3 - ACT, the mandatory wiring slice): the ONE
;; shell-callable entry point the coordinator's own promotion decision calls
;; to get the EFFECTIVE active-depth cap = min(configured, recommended) -
;; closing the observe (BL-430) -> diagnose (BL-431) -> act loop Article 3.5
;; already sanctions but nothing previously automated.
;;
;; Refreshes the throttle recommendation FRESH on every call (shells to
;; extension/out/tools/emit-throttle-recommendation.js - Babashka has no way
;; to import compiled TS) rather than trusting a periodic sweep that might be
;; stale between coordinator wake-ups - the same "compute at decision time"
;; posture backlog_depth_cli.bb's own sibling scripts use. A failed refresh
;; (CLI not yet compiled, node missing, etc.) degrades to a logged skip and
;; falls through to whatever recommendation is already on disk (or none) -
;; never crashes the caller, mirroring handoffd.bb's own fleet-status-sweep!/
;; drain-answer-files-sweep! shell-and-degrade convention.
;;
;; Usage: effective_backlog_depth_cli.bb <project-root>
;; Prints the resolved EFFECTIVE active_backlog_max_depth and exits 0.

(ns effective-backlog-depth-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: effective_backlog_depth_cli.bb <project-root>"))
  (System/exit 1))

(defn refresh-recommendation! [project-root]
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "emit-throttle-recommendation.js"))
          {:keys [exit err]} (process/sh ["node" cli-path (str project-root)] {:dir (str project-root)})]
      (when-not (zero? exit)
        (binding [*out* *err*]
          (println (str "effective_backlog_depth_cli: throttle-recommendation refresh failed, exit=" exit " " (str/trim (or err "")))))))
    (catch Exception e
      (binding [*out* *err*]
        (println (str "effective_backlog_depth_cli: throttle-recommendation refresh error: " (.getMessage e)))))))

(defn -main [& args]
  (when (not= 1 (count args))
    (usage))
  (let [[project-root] args]
    (refresh-recommendation! project-root)
    (println (backlog-depth-lib/read-effective-max-depth project-root))))

(apply -main *command-line-args*)
