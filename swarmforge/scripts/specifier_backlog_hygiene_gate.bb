#!/usr/bin/env bb
;; Per-file epic/milestone gate for the specifier (BL-544).
;; Usage: bb specifier_backlog_hygiene_gate.bb <yaml-path> [<yaml-path> ...]

(ns specifier-backlog-hygiene-gate
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_hygiene_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: specifier_backlog_hygiene_gate.bb <yaml-path> [<yaml-path> ...]"))
  (System/exit 2))

(defn -main []
  (let [paths (seq *command-line-args*)]
    (when (empty? paths) (usage))
    (let [violations (mapcat (fn [p]
                               (when-not (fs/exists? p)
                                 (binding [*out* *err*]
                                   (println (str "specifier_backlog_hygiene_gate: no such file: " p)))
                                 (System/exit 2))
                               (backlog-hygiene-lib/violations-for-file (fs/path p)))
                             paths)]
      (doseq [v violations]
        (println (backlog-hygiene-lib/format-violation v)))
      (if (backlog-hygiene-lib/all-clean? violations)
        (do (println "specifier_backlog_hygiene_gate: ok")
            (System/exit 0))
        (do (println "specifier_backlog_hygiene_gate: FAIL — assign epic: on slices; set milestone: on type: epic trackers before handoff")
            (System/exit 1))))))

(-main)
