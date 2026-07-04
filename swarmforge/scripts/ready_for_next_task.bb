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
  (let [inbox (handoff-lib/inbox-dir)
        new-dir (fs/path inbox "new")
        in-process-dir (fs/path inbox "in_process")
        completed-dir (fs/path inbox "completed")]
    (doseq [dir [new-dir in-process-dir completed-dir]]
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
          (let [new-files (handoff-lib/my-handoff-files new-dir)]
            (if (empty? new-files)
              (do
                (println "NO_TASK")
                (maybe-clear-at-idle-boundary!))
              (let [source-file (first new-files)
                    target-file (fs/path in-process-dir (fs/file-name source-file))]
                (when (fs/exists? target-file)
                  (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: target in-process file already exists: " target-file)))
                (fs/move source-file target-file)
                (handoff-lib/set-header! target-file "dequeued_at" (handoff-lib/timestamp))
                (handoff-lib/print-task target-file)))))))))

(-main)
