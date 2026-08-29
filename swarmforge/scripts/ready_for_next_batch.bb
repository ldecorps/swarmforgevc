#!/usr/bin/env bb

(ns ready-for-next-batch
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "backlog_depth_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "mono_router_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "batch_claim_progress_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "idle_clear_fullness_cli.bb")))

(def idle-boundary?
  "Set only when invoked from done_with_current_batch.bb, right after it
   completed the current batch (BL-089): a plain standalone ready_for_next.sh
   run while already idle must never trigger a clear."
  (some #{"--idle-boundary"} *command-line-args*))

(defn maybe-clear-at-idle-boundary! []
  ;; BL-1238: this file's own copy of the same gate - batch roles (cleaner,
  ;; hardener) never touch ready_for_next_task.bb, so the fullness check
  ;; has to be wired independently here too. See that file's comment for
  ;; the full rationale.
  (when (and idle-boundary?
             (idle-clear-fullness-cli/should-respawn? (handoff-lib/current-role)))
    (handoff-lib/respawn-self! (handoff-lib/current-role))))

;; ── BL-550: non-home resident strands after a merge-up note (batch mode) ──
;; The cleaner/hardender run in batch mode and strand the same way as a
;; task-mode role - same decision as ready_for_next_task.bb.

(defn- mono-router-conf-text []
  (try (slurp (str (backlog-depth-lib/conf-file-path (handoff-lib/target-root))))
       (catch Exception _ nil)))

(defn report-no-task-or-rotate! []
  (let [conf-text (mono-router-conf-text)
        home-role (mono-router-lib/parse-rotation-home conf-text)]
    (if (mono-router-lib/rotate-home?
         {:rotation-router? (mono-router-lib/conf-rotation-router? conf-text)
          :role (handoff-lib/current-role)
          :home-role home-role
          :mailbox-empty? true})
      (do
        (println "ROTATE_HOME")
        (println (str "HOME_ROLE: " home-role)))
      (do
        (println "NO_TASK")
        (maybe-clear-at-idle-boundary!)))))

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

;; ── BL-678: claim-time batch-claim-progress sidecar ─────────────────────────

(defn- current-head-commit-10
  "10-char HEAD of THIS role's own worktree (the cwd this script runs from) -
   never a remote/other role's worktree. \"\" on error, mirroring handoffd.
   bb's worktree-head-commit-10 error posture."
  []
  (try
    (let [result (process/sh ["git" "rev-parse" "--short=10" "HEAD"])]
      (if (zero? (:exit result)) (str/trim (:out result)) ""))
    (catch Exception _ "")))

(defn- claimed-parcel-id
  "Task header (git_handoff) if present, else message header (note) - both
   conventionally lead with the ticket id (mirrors chase_sweep_lib.bb's own
   dispatch-ticket-ref); falls back to the bare filename when neither header
   is present, so the sidecar always names SOMETHING."
  [file]
  (handoff-lib/header-value
   file "task"
   (handoff-lib/header-value file "message" (fs/file-name file))))

(defn write-batch-claim-progress-sidecar! [target-file]
  (let [role (or (handoff-lib/current-role) "")
        parcel-id (claimed-parcel-id target-file)
        commit (current-head-commit-10)
        progress (batch-claim-progress-lib/make-batch-claim-progress
                  role parcel-id commit (System/currentTimeMillis))]
    (spit (batch-claim-progress-lib/sidecar-path (str target-file))
          (json/generate-string progress))))

(defn -main []
  (let [new-dir        (handoff-lib/my-mailbox-dir :new)
        in-process-dir (handoff-lib/my-mailbox-dir :in_process)
        completed-dir  (handoff-lib/my-mailbox-dir :completed)
        abandoned-dir  (handoff-lib/my-mailbox-dir :abandoned)]
    (doseq [dir [new-dir in-process-dir completed-dir abandoned-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          in-process-files   (handoff-lib/handoff-files in-process-dir)]
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
          (let [new-files            (handoff-lib/handoff-files new-dir)
                completed-basenames  (handoff-lib/terminal-basenames completed-dir)
                abandoned-basenames  (handoff-lib/terminal-basenames abandoned-dir)
                ;; BL-365: same corrupt-candidate quarantine-and-skip as
                ;; ready_for_next_task.bb (shared via
                ;; resolve-dequeueable-candidates) - a corrupt file must
                ;; never be promoted into a batch as work.
                dequeueable          (handoff-lib/resolve-dequeueable-candidates new-files completed-basenames abandoned-basenames)]
            (if (empty? dequeueable)
              (report-no-task-or-rotate!)
              (let [batch-priority (handoff-lib/header-value (first dequeueable) "priority" "50")
                    batch-dir      (new-batch-dir in-process-dir)
                    selected-files (filter #(= batch-priority (handoff-lib/header-value % "priority" "50")) dequeueable)]
                (fs/create-dir batch-dir)
                (doseq [source-file selected-files]
                  (let [target-file (fs/path batch-dir (fs/file-name source-file))]
                    (when (fs/exists? target-file)
                      (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: target batch file already exists: " target-file)))
                    (fs/move source-file target-file)
                    ;; BL-232: same sidecar drop as the task-mode dequeue path.
                    (handoff-lib/remove-sidecars-of! source-file)
                    (handoff-lib/set-header! target-file "dequeued_at" (handoff-lib/timestamp))
                    ;; BL-678 invariant 1: the sidecar is written the INSTANT
                    ;; the item is claimed - never lazily by a later sweep
                    ;; tick (that gap is the BL-648-source near-miss).
                    (write-batch-claim-progress-sidecar! target-file)))
                (when (empty? selected-files)
                  (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: no tasks selected for batch priority " batch-priority ".")))
                (print-batch batch-dir)))))))))

(-main)
