#!/usr/bin/env bb

(ns ready-for-next-batch
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))

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
  (let [inbox (handoff-lib/inbox-dir)
        new-dir (fs/path inbox "new")
        in-process-dir (fs/path inbox "in_process")
        completed-dir (fs/path inbox "completed")]
    (doseq [dir [new-dir in-process-dir completed-dir]]
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
        (let [new-files (handoff-lib/handoff-files new-dir)]
          (if (empty? new-files)
            (println "NO_TASK")
            (let [batch-priority (handoff-lib/header-value (first new-files) "priority" "50")
                  batch-dir (new-batch-dir in-process-dir)
                  selected-files (filter #(= batch-priority (handoff-lib/header-value % "priority" "50")) new-files)]
              (fs/create-dir batch-dir)
              (doseq [source-file selected-files]
                (let [target-file (fs/path batch-dir (fs/file-name source-file))]
                  (when (fs/exists? target-file)
                    (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: target batch file already exists: " target-file)))
                  (fs/move source-file target-file)
                  (handoff-lib/set-header! target-file "dequeued_at" (handoff-lib/timestamp))))
              (when (empty? selected-files)
                (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: no tasks selected for batch priority " batch-priority ".")))
              (print-batch batch-dir))))))))

(-main)
