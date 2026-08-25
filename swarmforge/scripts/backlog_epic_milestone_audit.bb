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

(defn- print-bucket [label vs]
  (println (str label (count vs)))
  (doseq [v vs]
    (println (str "  " (backlog-hygiene-lib/format-violation v)))))

(defn -main []
  (let [files (open-ticket-files project-root)
        backlog-root (str (fs/path project-root "backlog"))
        violations (mapcat (fn [f]
                             (backlog-hygiene-lib/violations-for-file
                              f
                              {:repo-root project-root
                               :resolve-children? true
                               :backlog-root backlog-root}))
                           files)
        by-kind (group-by :kind violations)
        pick (fn [kinds] (mapcat #(get by-kind % []) kinds))]
    (println (str "open tickets: " (count files)))
    (print-bucket "missing epic (non-epic): " (pick [:missing-epic :missing-epic-on-epic]))
    (print-bucket "epics missing milestone: " (pick [:missing-milestone]))
    (print-bucket "unreadable acceptance (block scalar hiding a feature pointer): "
                  (pick [:unreadable-acceptance]))
    (print-bucket "dangling acceptance (pointer missing on working tree): "
                  (pick [:dangling-acceptance]))
    (print-bucket "untracked acceptance (on disk, not ls-files): "
                  (pick [:untracked-acceptance]))
    (print-bucket "epic wiring exit checklist failures: " (pick [:epic-wiring-missing]))
    (print-bucket "retired ticket type (type: bug): " (pick [:retired-ticket-type]))
    (if (backlog-hygiene-lib/all-clean? violations)
      (do (println "backlog_epic_milestone_audit: ok")
          (System/exit 0))
      (do (println "backlog_epic_milestone_audit: FAIL")
          (System/exit 1)))))

(-main)
