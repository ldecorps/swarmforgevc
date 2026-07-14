#!/usr/bin/env bb

(ns ready-for-next-task
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))

(def idle-boundary?
  "Set only when invoked from done_with_current_task.bb, right after it
   completed the current task (BL-089): a plain standalone ready_for_next.sh
   run while already idle must never trigger a clear."
  (some #{"--idle-boundary"} *command-line-args*))

(defn maybe-clear-at-idle-boundary! []
  (when (and idle-boundary?
             (handoff-lib/idle-clear-enabled? (handoff-lib/current-role)))
    (handoff-lib/respawn-self! (handoff-lib/current-role))))

(defn -main []
  (let [new-dir (handoff-lib/my-mailbox-dir :new)
        in-process-dir (handoff-lib/my-mailbox-dir :in_process)
        completed-dir (handoff-lib/my-mailbox-dir :completed)
        abandoned-dir (handoff-lib/my-mailbox-dir :abandoned)]
    (doseq [dir [new-dir in-process-dir completed-dir abandoned-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          in-process-files (handoff-lib/my-handoff-files in-process-dir)]
      (when (seq in-process-batches)
        (handoff-lib/fail! 2
               "TASK_IN_PROCESS_IS_BATCH: use ready_for_next.sh or done_with_current.sh."
               (str/join "\n" (map #(str "- " %) in-process-batches))))
      (when (> (count in-process-files) 1)
        (handoff-lib/fail! 2
               "AMBIGUOUS_TASK_STATE: multiple tasks are already in process."
               (str/join "\n" (map #(str "- " %) in-process-files))))
      (if (= 1 (count in-process-files))
        (handoff-lib/print-task (first in-process-files))
        (if (handoff-lib/draining?)
          (println "DRAINING")
          (let [new-files (handoff-lib/my-handoff-files new-dir)
                completed-basenames (map fs/file-name (handoff-lib/handoff-files completed-dir))
                abandoned-basenames (map fs/file-name (handoff-lib/handoff-files abandoned-dir))
                {:keys [skipped dequeueable]} (handoff-lib/dedup-new-candidates new-files completed-basenames abandoned-basenames)
                ;; BL-365: a corrupt candidate must never be promoted into
                ;; in_process/ as a task - quarantine-and-skip it (renamed
                ;; to *.handoff.dead in place, the same suffix the existing
                ;; dead-letter sweep already scans and alerts a human on)
                ;; and fall through to the next genuinely-dequeueable file.
                {:keys [corrupt valid]} (handoff-lib/partition-corrupt dequeueable)
                dequeueable valid]
            (doseq [f skipped]
              (println "SKIPPED already-processed:" (fs/file-name f)))
            (doseq [f corrupt]
              (println "QUARANTINED corrupt-handoff:" (fs/file-name f)))
            (if (empty? dequeueable)
              (do
                (println "NO_TASK")
                (maybe-clear-at-idle-boundary!))
              (let [source-file (first dequeueable)
                    target-file (fs/path in-process-dir (fs/file-name source-file))]
                (when (fs/exists? target-file)
                  (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: target in-process file already exists: " target-file)))
                (fs/move source-file target-file)
                ;; BL-232: drops any .chase.json/.nudge sidecar left behind
                ;; at source-file's now-stale new/ location - it only ever
                ;; described state about this handoff waiting in new/, and
                ;; must not outlive it there.
                (handoff-lib/remove-sidecars-of! source-file)
                (handoff-lib/set-header! target-file "dequeued_at" (handoff-lib/timestamp))
                (handoff-lib/print-task target-file)))))))))

(-main)
