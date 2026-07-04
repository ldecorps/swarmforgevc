#!/usr/bin/env bb

(ns done-with-current-batch
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (fs/parent *file*))

(load-file (str (fs/path script-dir "handoff_lib.bb")))

(defn run-ready! []
  (process/exec (str (fs/path script-dir "ready_for_next_batch.sh")) "--idle-boundary"))

(defn -main []
  (let [inbox (handoff-lib/inbox-dir)
        in-process-dir (fs/path inbox "in_process")
        completed-dir (fs/path inbox "completed")]
    (doseq [dir [in-process-dir completed-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          in-process-files (handoff-lib/handoff-files in-process-dir)]
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
      (let [source-dir (first in-process-batches)
            batch-files (handoff-lib/handoff-files source-dir)
            target-dir (fs/path completed-dir (fs/file-name source-dir))
            completed-at (handoff-lib/timestamp)]
        (when (empty? batch-files)
          (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: batch contains no tasks: " source-dir)))
        (when (fs/exists? target-dir)
          (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: completed batch already exists: " target-dir)))
        (fs/create-dir target-dir)
        (doseq [source-file batch-files]
          (handoff-lib/set-header! source-file "completed_at" completed-at)
          (let [target-file (fs/path target-dir (fs/file-name source-file))]
            (when (fs/exists? target-file)
              (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: completed batch file already exists: " target-file)))
            (fs/move source-file target-file)
            (println "COMPLETED:" (str target-file))))
        (fs/delete source-dir)
        (println "COMPLETED_BATCH:" (str target-dir))
        (run-ready!)))))

(-main)
