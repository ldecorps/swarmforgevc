#!/usr/bin/env bb

(ns done-with-current-task
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(def script-dir (fs/parent *file*))

(defn worktree-root
  "Handoff state lives at the worktree root even when invoked from a
   subdirectory; the daemon only delivers to worktree-root inboxes (BL-056).
   Falls back to the invocation cwd outside any git worktree."
  []
  (let [result (sh/sh "git" "rev-parse" "--show-toplevel")]
    (if (zero? (:exit result))
      (str/trim (:out result))
      (System/getProperty "user.dir"))))

(defn inbox-dir []
  (fs/path (worktree-root) ".swarmforge" "handoffs" "inbox"))

(defn timestamp []
  (.format java.time.format.DateTimeFormatter/ISO_INSTANT
           (java.time.Instant/now)))

(defn handoff-files [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")))
         (sort-by #(fs/file-name %))
         vec)
    []))

(defn batch-dirs [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir)
         (filter #(and (fs/directory? %) (str/starts-with? (fs/file-name %) "batch_")))
         (sort-by #(fs/file-name %))
         vec)
    []))

(defn header-field [file field]
  (let [prefix (str field ": ")]
    (some (fn [line]
            (when (str/starts-with? line prefix)
              (subs line (count prefix))))
          (take-while (complement str/blank?) (str/split-lines (slurp (str file)))))))

(defn current-role []
  (let [r (System/getenv "SWARMFORGE_ROLE")]
    (when-not (str/blank? r) r)))

(defn mine?
  "True when this handoff's recipient matches the current role. Roles that share
   a worktree (coordinator + specifier on master) share one physical inbox, so
   complete only the current role's in-process item. Untagged files and an unset
   role fall through unchanged."
  [file]
  (let [role (current-role)
        recipient (header-field file "recipient")]
    (or (nil? role) (nil? recipient) (= recipient role))))

(defn my-handoff-files [dir]
  (vec (filter mine? (handoff-files dir))))

(defn set-header! [file field value]
  (let [lines (str/split-lines (slurp (str file)))
        prefix (str field ": ")
        tmp (fs/create-temp-file {:dir (fs/parent file) :prefix ".headers."})
        result (loop [remaining lines
                      out []
                      inserted? false
                      replaced? false]
                 (if-let [line (first remaining)]
                   (cond
                     (and (not inserted?) (str/blank? line))
                     (recur (next remaining)
                            (conj (cond-> out (not replaced?) (conj (str prefix value))) line)
                            true
                            replaced?)

                     (and (not inserted?) (str/starts-with? line prefix))
                     (recur (next remaining) (conj out (str prefix value)) inserted? true)

                     :else
                     (recur (next remaining) (conj out line) inserted? replaced?))
                   (cond-> out
                     (and (not inserted?) (not replaced?)) (conj (str prefix value)))))]
    (spit (str tmp) (str (str/join "\n" result) "\n"))
    (fs/move tmp file {:replace-existing true})))

(defn fail! [status & lines]
  (binding [*out* *err*]
    (doseq [line lines]
      (println line)))
  (System/exit status))

(defn run-ready! []
  (process/exec (str (fs/path script-dir "ready_for_next_task.sh"))))

(defn -main []
  (let [inbox (inbox-dir)
        in-process-dir (fs/path inbox "in_process")
        completed-dir (fs/path inbox "completed")]
    (doseq [dir [in-process-dir completed-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (batch-dirs in-process-dir)
          in-process-files (my-handoff-files in-process-dir)]
      (when (seq in-process-batches)
        (fail! 2
               "CURRENT_WORK_IS_BATCH: use done_with_current.sh."
               (str/join "\n" (map #(str "- " %) in-process-batches))))
      (when (empty? in-process-files)
        (fail! 1 "NO_CURRENT_TASK"))
      (when (> (count in-process-files) 1)
        (fail! 2
               "AMBIGUOUS_TASK_STATE: multiple tasks are in process."
               (str/join "\n" (map #(str "- " %) in-process-files))))
      (let [source-file (first in-process-files)
            target-file (fs/path completed-dir (fs/file-name source-file))]
        (set-header! source-file "completed_at" (timestamp))
        (when (fs/exists? target-file)
          (fail! 2 (str "AMBIGUOUS_TASK_STATE: completed file already exists: " target-file)))
        (fs/move source-file target-file)
        (println "COMPLETED:" (str target-file))
        (run-ready!)))))

(-main)
