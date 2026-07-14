#!/usr/bin/env bb

(ns ready-for-next-batch
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))

(def idle-boundary?
  "Set only when invoked from done_with_current_batch.bb, right after it
   completed the current batch (BL-089): a plain standalone ready_for_next.sh
   run while already idle must never trigger a clear."
  (some #{"--idle-boundary"} *command-line-args*))

(defn maybe-clear-at-idle-boundary! []
  (when (and idle-boundary?
             (handoff-lib/idle-clear-enabled? (handoff-lib/current-role)))
    (handoff-lib/respawn-self! (handoff-lib/current-role))))

(defn print-batch [batch-dir]
  (let [files (handoff-lib/handoff-files batch-dir)]
    (when (empty? files)
      (binding [*out* *err*]
        (println "AMBIGUOUS_TASK_STATE: batch contains no tasks:" (str batch-dir)))
      (System/exit 2))
    (println "BATCH:" (str batch-dir))
    (println "COUNT:" (count files))
    (println "PRIORITY:" (handoff-lib/header-value (first files) "priority" "50"))
    (doseq [[index file] (map-indexed vector files)]
      (println)
      (println "BATCH_ITEM:" (inc index))
      (handoff-lib/print-task file))))

(defn new-batch-dir [in-process-dir]
  (loop [suffix 1]
    (let [dir (fs/path in-process-dir (format "batch_%s_%06d" (handoff-lib/id-timestamp) suffix))]
      (if (fs/exists? dir)
        (recur (inc suffix))
        dir))))

(defn -main []
  (let [new-dir (handoff-lib/my-mailbox-dir :new)
        in-process-dir (handoff-lib/my-mailbox-dir :in_process)
        completed-dir (handoff-lib/my-mailbox-dir :completed)
        abandoned-dir (handoff-lib/my-mailbox-dir :abandoned)]
    (doseq [dir [new-dir in-process-dir completed-dir abandoned-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          in-process-files (handoff-lib/handoff-files in-process-dir)]
      (when (seq in-process-files)
        (handoff-lib/fail! 2
               "TASK_IN_PROCESS_IS_SINGLE: use ready_for_next.sh or done_with_current.sh."
               (str/join "\n" (map #(str "- " %) in-process-files))))
      (when (> (count in-process-batches) 1)
        (handoff-lib/fail! 2
               "AMBIGUOUS_TASK_STATE: multiple batches are already in process."
               (str/join "\n" (map #(str "- " %) in-process-batches))))
      (if (= 1 (count in-process-batches))
        (print-batch (first in-process-batches))
        (if (handoff-lib/draining?)
          (println "DRAINING")
          (let [new-files (handoff-lib/handoff-files new-dir)
                completed-basenames (map fs/file-name (handoff-lib/handoff-files completed-dir))
                abandoned-basenames (map fs/file-name (handoff-lib/handoff-files abandoned-dir))
                ;; BL-365: same corrupt-candidate quarantine-and-skip as
                ;; ready_for_next_task.bb (shared via
                ;; resolve-dequeueable-candidates) - a corrupt file must
                ;; never be promoted into a batch as work.
                dequeueable (handoff-lib/resolve-dequeueable-candidates new-files completed-basenames abandoned-basenames)]
            (if (empty? dequeueable)
              (do
                (println "NO_TASK")
                (maybe-clear-at-idle-boundary!))
              (let [batch-priority (handoff-lib/header-value (first dequeueable) "priority" "50")
                    batch-dir (new-batch-dir in-process-dir)
                    selected-files (filter #(= batch-priority (handoff-lib/header-value % "priority" "50")) dequeueable)]
                (fs/create-dir batch-dir)
                (doseq [source-file selected-files]
                  (let [target-file (fs/path batch-dir (fs/file-name source-file))]
                    (when (fs/exists? target-file)
                      (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: target batch file already exists: " target-file)))
                    (fs/move source-file target-file)
                    ;; BL-232: same sidecar drop as the task-mode dequeue path.
                    (handoff-lib/remove-sidecars-of! source-file)
                    (handoff-lib/set-header! target-file "dequeued_at" (handoff-lib/timestamp))))
                (when (empty? selected-files)
                  (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: no tasks selected for batch priority " batch-priority ".")))
                (print-batch batch-dir)))))))))

(-main)
