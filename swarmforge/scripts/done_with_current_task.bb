#!/usr/bin/env bb

(ns done-with-current-task
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (fs/parent *file*))

(load-file (str (fs/path script-dir "handoff_lib.bb")))

(defn run-ready! []
  (process/exec (str (fs/path script-dir "ready_for_next_task.sh")) "--idle-boundary"))

(defn -main []
  (let [inbox (handoff-lib/inbox-dir)
        in-process-dir (fs/path inbox "in_process")
        completed-dir (fs/path inbox "completed")]
    (doseq [dir [in-process-dir completed-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          in-process-files (handoff-lib/my-handoff-files in-process-dir)]
      (when (seq in-process-batches)
        (handoff-lib/fail! 2
               "CURRENT_WORK_IS_BATCH: use done_with_current.sh."
               (str/join "\n" (map #(str "- " %) in-process-batches))))
      (when (empty? in-process-files)
        (handoff-lib/fail! 1 "NO_CURRENT_TASK"))
      (when (> (count in-process-files) 1)
        (handoff-lib/fail! 2
               "AMBIGUOUS_TASK_STATE: multiple tasks are in process."
               (str/join "\n" (map #(str "- " %) in-process-files))))
      (let [source-file (first in-process-files)
            target-file (fs/path completed-dir (fs/file-name source-file))]
        (handoff-lib/set-header! source-file "completed_at" (handoff-lib/timestamp))
        (when (fs/exists? target-file)
          (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: completed file already exists: " target-file)))
        (fs/move source-file target-file)
        (println "COMPLETED:" (str target-file))
        (run-ready!)))))

(-main)
