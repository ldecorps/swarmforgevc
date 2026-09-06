#!/usr/bin/env bb
;; BL-676: generates the epic backfill proposal report. Usage:
;;   epic_backfill_proposals_report.bb [project-root]
;; Read-only over backlog/ except its own one report file.

(ns epic-backfill-proposals-report
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "epic_backfill_proposals_lib.bb")))

(defn -main []
  (let [project-root (or (first *command-line-args*) (System/getProperty "user.dir"))
        {:keys [rows path]} (epic-backfill-proposals-lib/generate-report! project-root)]
    (println (str "epic_backfill_proposals_report: " rows " row(s) written to " path))))

(-main)
