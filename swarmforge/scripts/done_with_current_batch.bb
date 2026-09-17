#!/usr/bin/env bb

(ns done-with-current-batch
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (fs/parent *file*))

(load-file (str (fs/path script-dir "handoff_lib.bb")))
(load-file (str (fs/path script-dir "pipeline_stage_lib.bb")))
(load-file (str (fs/path script-dir "dispatch_lib.bb")))
;; BL-1609: the same forward gate the task path applies, per batch item -
;; see done_with_current_task.bb's own comment for the full rationale.
(load-file (str (fs/path script-dir "forward_evidence_lib.bb")))

(defn run-ready! []
  (process/exec (str (fs/path script-dir "ready_for_next_batch.sh")) "--idle-boundary"))

;; ── BL-1609: a forwarding git_handoff is not completed with nothing sent ──
;; Article 4.4's shape, per BL-1609's own direction: gather every batch
;; item's verdict first, refuse ONCE naming every unforwarded forwarding
;; item, rather than stopping at the first one found.
;; forwarding-inbound? and master-resident? live in forward_evidence_lib.bb,
;; shared with the task path's own forward-gate!.
(defn- forward-verdict [resident? source-file]
  (let [ticket-id (pipeline-stage-lib/extract-ticket-id (handoff-lib/header-field source-file "task"))
        since (or (handoff-lib/header-field source-file "dequeued_at") "1970-01-01T00:00:00Z")
        evidenced? (boolean (and ticket-id (forward-evidence-lib/sent-handoff-names-ticket-since? ticket-id since)))]
    {:file source-file
     :ticket-id ticket-id
     :decision (forward-evidence-lib/forward-completion-decision
                {:forwarding? (forward-evidence-lib/forwarding-inbound? source-file)
                 :master-resident? resident?
                 :evidenced? evidenced?
                 :reason (dispatch-lib/no-op-reason)})}))

(defn- forward-gate! [batch-files]
  (let [resident? (forward-evidence-lib/master-resident?)
        verdicts (mapv #(forward-verdict resident? %) batch-files)
        refusals (filterv #(= :refuse (:decision %)) verdicts)]
    (when (seq refusals)
      (handoff-lib/fail! 1
                         "FORWARD_NOT_SENT:"
                         (str/join "\n" (map #(str "- " (:ticket-id %) " (" (:file %) ")") refusals))
                         "Send the forward for each, or run: done_with_current.sh --no-op \"<reason>\""))
    verdicts))

(defn -main []
  ;; BL-652: family contract — direct helper invocation also refuses argv.
  (dispatch-lib/refuse-unexpected-args!)
  (let [in-process-dir (handoff-lib/my-mailbox-dir :in_process)
        completed-dir  (handoff-lib/my-mailbox-dir :completed)]
    (doseq [dir [in-process-dir completed-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          in-process-files   (handoff-lib/handoff-files in-process-dir)]
      (when (seq in-process-files)
        (handoff-lib/fail! 2
                           "CURRENT_WORK_IS_SINGLE_TASK: use done_with_current.sh."
                           (str/join "\n" (map #(str "- " %) in-process-files))))
      (when (empty? in-process-batches)
        (handoff-lib/fail! 1 "NO_CURRENT_BATCH"))
      (when (> (count in-process-batches) 1)
        (handoff-lib/fail! 2
                           "AMBIGUOUS_TASK_STATE: multiple batches are in process."
                           (str/join "\n" (map #(str "- " %) in-process-batches))))
      (let [source-dir  (first in-process-batches)
            batch-files (handoff-lib/handoff-files source-dir)
            target-dir  (fs/path completed-dir (fs/file-name source-dir))
            completed-at (handoff-lib/timestamp)]
        ;; BL-119: a batch dir holding only leftover chaser sidecars (its
        ;; real .handoff payloads already moved by an earlier, interrupted
        ;; completion) is a recoverable cleanup, not "no tasks" - only a
        ;; dir with nothing in it at all (no payload ever, no sidecar
        ;; either) is the genuinely malformed/empty batch that still fails.
        (when (and (empty? batch-files) (empty? (fs/list-dir source-dir)))
          (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: batch contains no tasks: " source-dir)))
        (when (seq batch-files)
          ;; BL-1609: refuses (exit, batch untouched) naming every
          ;; forwarding item with no forward queued since its own dequeue;
          ;; otherwise every verdict is :complete-plain or
          ;; :complete-with-reason (the reason, common to the whole batch,
          ;; stamped below on exactly the items that carried it).
          (let [verdicts (forward-gate! batch-files)
                with-reason (into #{} (comp (filter #(= :complete-with-reason (:decision %)))
                                             (map (comp str :file)))
                                   verdicts)
                no-op-reason (dispatch-lib/no-op-reason)]
            (when (fs/exists? target-dir)
              (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: completed batch already exists: " target-dir)))
            (fs/create-dir target-dir)
            (doseq [source-file batch-files]
              (handoff-lib/set-header! source-file "completed_at" completed-at)
              (when (contains? with-reason (str source-file))
                (handoff-lib/set-header! source-file "no_op_reason" no-op-reason)
                (handoff-lib/set-header! source-file "no_op_at" completed-at))
              (let [target-file (fs/path target-dir (fs/file-name source-file))]
                (when (fs/exists? target-file)
                  (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: completed batch file already exists: " target-file)))
                (fs/move source-file target-file)
                (handoff-lib/remove-sidecars-of! source-file)
                (println "COMPLETED:" (str target-file))))))
        (handoff-lib/clean-dir-sidecars-or-fail! source-dir)
        (fs/delete source-dir)
        (println "COMPLETED_BATCH:" (str target-dir))
        (run-ready!)))))

(-main)
