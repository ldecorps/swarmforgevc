#!/usr/bin/env bb
;; BL-677: applies a human-approved epic backfill mapping (BL-676's own
;; report, amended and approved) into backlog/done/. Usage:
;;   epic_backfill_apply.bb [project-root] [mapping-path]
;; mapping-path defaults to BL-676's own report path
;; (backlog/evidence/BL-676-epic-backfill-proposals-report.md).

(ns epic-backfill-apply
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "epic_backfill_apply_lib.bb")))

(defn -main []
  (let [project-root (or (first *command-line-args*) (System/getProperty "user.dir"))
        mapping-path (or (second *command-line-args*)
                          (epic-backfill-proposals-lib/report-path project-root))
        mapping-text (slurp mapping-path)
        result (epic-backfill-apply-lib/apply! project-root mapping-text {})]
    (if (:refused result)
      (do
        (binding [*out* *err*]
          (println (str "epic_backfill_apply: REFUSED (" (name (:reason result)) ") — " (:detail result))))
        (System/exit 1))
      (println (str "epic_backfill_apply: applied " (:applied result)
                     ", skipped-already-tagged " (:skipped-already-tagged result)
                     ", skipped-empty-proposal " (:skipped-empty-proposal result)
                     ", " (:batches result) " batch commit(s)")))))

(-main)
