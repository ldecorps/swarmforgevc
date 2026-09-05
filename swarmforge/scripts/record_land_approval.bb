#!/usr/bin/env bb
;; BL-1405: thin CLI over land_step_lib.bb's record-land-approval! for QA's
;; hand-built tip-pure land recipe (BL-1376/BL-1386 adjudication route 1),
;; which has no CLI reachable from land_step_cli.bb's own -main to call the
;; same recorder the ordinary land step already uses. Without this record,
;; a hand-built replay reads as unapproved to is_qa_ancestor.sh's every
;; consumer (the babysitter's Article 4.2 sweep, the push-sweep gate, the
;; commit-time guard) until an unrelated later merge closes the window -
;; six such false-positive CRITs on 2026-09-04 alone.
;;
;; Usage: record_land_approval.bb <project-root> <replay-commit> <approved-source> [<ticket-id>]
;;
;; The testable core (short/already-recorded?) lives in
;; land_approval_cli_lib.bb - this file's own -main runs as a load-time
;; side effect, like every *_cli.bb entry script in this family, so nothing
;; may load-file THIS file directly from a test or property runner.
;;
;; Exit 0: the record was written (or an identical one already existed).
;; Exit non-zero: either sha was missing, or the writer itself refused
;; (shared-target-root unresolvable) - nothing is written either way.

(ns record-land-approval-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "land_approval_cli_lib.bb")))

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: record_land_approval.bb <project-root> <replay-commit> <approved-source> [<ticket-id>]"))
  (System/exit 2))

(defn- print-verdict! [root replay-commit]
  ;; BL-1405: print the SAME predicate every other consumer calls, never a
  ;; reimplementation of "approved" - so QA sees it before closing the land.
  (let [script (str (fs/path script-dir "is_qa_ancestor.sh"))
        {:keys [exit]} (process/sh ["bash" script replay-commit] {:dir root})]
    (println (str "VERDICT " replay-commit " "
                  (case exit 0 "approved" 1 "not approved" "undeterminable")))))

(defn -main [args]
  (when (< (count args) 3) (usage!))
  (let [[root replay-commit approved-source ticket-id] args
        c (land-approval-cli-lib/short replay-commit)
        src (land-approval-cli-lib/short approved-source)]
    (when (or (nil? c) (nil? src))
      (binding [*out* *err*]
        (println "record_land_approval.bb: both a replay commit and an approved source are required"))
      (System/exit 2))
    (if (land-approval-cli-lib/already-recorded? root c src)
      (println (str "LAND_APPROVAL_ALREADY_RECORDED " c " <- " src))
      (let [result (land-step-lib/record-land-approval!
                    {:root root :commit c :source src :task-ticket-id ticket-id})]
        (if (:ok? result)
          (println (str "LAND_APPROVAL_RECORDED " c " <- " src
                        (when (seq ticket-id) (str " (" ticket-id ")"))))
          (do
            (binding [*out* *err*]
              (println (str "LAND_APPROVAL_UNRECORDED " (:reason result))))
            (System/exit 1)))))
    (print-verdict! root c)))

(-main *command-line-args*)
