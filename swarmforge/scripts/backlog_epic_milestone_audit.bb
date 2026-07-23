#!/usr/bin/env bb
;; backlog_epic_milestone_audit.bb — open-backlog hygiene:
;;   1. every non-epic live ticket has a non-empty epic:
;;   2. every type: epic tracker has a non-empty milestone:
;;
;; Usage:
;;   bb backlog_epic_milestone_audit.bb [project-root]
;; Exit 0 when clean; exit 1 when any violation.

(ns backlog-epic-milestone-audit
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_hygiene_lib.bb")))

(def project-root
  (or (first *command-line-args*)
      (System/getProperty "user.dir")))

(defn open-ticket-files [root]
  (->> ["active" "paused" "hold"]
       (map #(fs/path root "backlog" %))
       (filter fs/directory?)
       (mapcat #(fs/glob % "BL-*.yaml"))
       (sort-by str)))

(defn -main []
  (let [files (open-ticket-files project-root)
        violations (mapcat backlog-hygiene-lib/violations-for-file files)
        missing-epic (filter #(#{:missing-epic :missing-epic-on-epic} (:kind %)) violations)
        missing-ms (filter #(= :missing-milestone (:kind %)) violations)]
    (println (str "open tickets: " (count files)))
    (println (str "missing epic (non-epic): " (count missing-epic)))
    (doseq [v missing-epic]
      (println (str "  " (backlog-hygiene-lib/format-violation v))))
    (println (str "epics missing milestone: " (count missing-ms)))
    (doseq [v missing-ms]
      (println (str "  " (backlog-hygiene-lib/format-violation v))))
    (if (backlog-hygiene-lib/all-clean? violations)
      (do (println "backlog_epic_milestone_audit: ok")
          (System/exit 0))
      (do (println "backlog_epic_milestone_audit: FAIL")
          (System/exit 1)))))

(-main)
