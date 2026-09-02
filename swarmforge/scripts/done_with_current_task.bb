#!/usr/bin/env bb

(ns done-with-current-task
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (fs/parent *file*))

(load-file (str (fs/path script-dir "handoff_lib.bb")))
(load-file (str (fs/path script-dir "pipeline_stage_lib.bb")))
(load-file (str (fs/path script-dir "dispatch_lib.bb")))
;; BL-1317: Adapt reads the seat's backend and the pack/window default effort
;; off the same effective pack conf BL-1316's claim-time apply reads.
(load-file (str (fs/path script-dir "backlog_depth_lib.bb")))
(load-file (str (fs/path script-dir "seat_difficulty_lib.bb")))

(defn run-ready! []
  (process/exec (str (fs/path script-dir "ready_for_next_task.sh")) "--idle-boundary"))

;; BL-819: the "handoff point" side of the lifecycle ledger - shells to the
;; compiled lean-ledger-record.js CLI (same process/sh-a-compiled-tool
;; convention handoffd.bb's emit-cost-health-sidecar! already uses), passing
;; the ticket this just-completed handoff named. The CLI itself composes
;; from already-shipping instruments (stage-dwell, bounce-store,
;; routing-skip-log, chaser-telemetry, backlog-close) - this call only
;; decides WHEN to run it. Best-effort and silent on success: a ledger
;; write is a side observation of a completion that has ALREADY happened,
;; never a gate on it, so a failure here degrades to a stderr warning and
;; the completion (and run-ready! below) proceeds unaffected either way.
;;
;; The CLI is part of THIS project's own extension/ build, not something
;; every target-root carries - a target-root that isn't swarmforge-vc's own
;; checkout (or a fixture/test worktree with no `npm run compile` output)
;; genuinely has no such instrument. That is the invariant-2 "absent, never
;; invented" case applied to the WIRING itself: skip quietly rather than
;; warn on the expected-missing case, and reserve the warning for a CLI
;; that exists but still failed - a real signal worth surfacing.
(defn record-lean-ledger! [target-file]
  (when-let [ticket-id (pipeline-stage-lib/extract-ticket-id (handoff-lib/header-field target-file "task"))]
    (let [root (str (handoff-lib/target-root))
          cli-path (str (fs/path root "extension" "out" "tools" "lean-ledger-record.js"))]
      (when (fs/exists? cli-path)
        (try
          (let [{:keys [exit err]} (process/sh ["node" cli-path "--ticket" ticket-id "--target" root])]
            (when-not (zero? exit)
              (binding [*out* *err*]
                (println "lean-ledger-record-warn:" ticket-id (str/trim (or err ""))))))
          (catch Exception e
            (binding [*out* *err*]
              (println "lean-ledger-record-warn:" ticket-id (.getMessage e)))))))))

;; BL-1317 Adapt tier: the same completion the lifecycle ledger observes above
;; is also the moment the seat learns whether its held ticket went CLEAN or
;; came back as a bounce, so the effort dial moves here and nowhere else - one
;; outcome, one observation point, no second notion of "done".
;;
;; The signal is read off the completed handoff itself: a non-forwarding
;; inbound is a reverse hop, i.e. this seat's work coming back, which is the
;; under-thinking evidence Adapt climbs on. Anything else completing normally
;; is a clean pass, which only counts toward a descent once a whole streak of
;; them has accumulated.
;;
;; Best-effort and silent, exactly like record-lean-ledger! above: the
;; completion has ALREADY happened, and a dial that cannot be retuned must
;; never turn a finished parcel into a failure. All of the deciding lives in
;; seat-difficulty-lib/adapt-effort-decision (pure) behind
;; handoff-lib/record-effort-adapt! (the only IO edge) - this call decides
;; WHEN, never WHAT.
(defn- pack-conf-text []
  (try (slurp (str (backlog-depth-lib/conf-file-path (handoff-lib/target-root))))
       (catch Exception _ nil)))

(defn record-effort-adapt-for! [target-file]
  (try
    (let [conf (pack-conf-text)
          me (handoff-lib/current-role)
          ticket (pipeline-stage-lib/extract-ticket-id
                  (handoff-lib/header-field target-file "task"))]
      (handoff-lib/record-effort-adapt!
       {:role me
        :backend (get (seat-difficulty-lib/parse-seat-backends conf) me)
        :mutation-cost (handoff-lib/active-ticket-mutation-cost ticket)
        :pack-default-effort (get (seat-difficulty-lib/parse-seat-efforts conf) me)
        :ticket ticket
        :signal (if (handoff-lib/non-forwarding? target-file) "bounce" "clean")}))
    (catch Exception _ nil)))

(defn -main []
  ;; BL-652: family contract — direct helper invocation also refuses argv.
  (dispatch-lib/refuse-unexpected-args!)
  (let [in-process-dir (handoff-lib/my-mailbox-dir :in_process)
        completed-dir  (handoff-lib/my-mailbox-dir :completed)]
    (doseq [dir [in-process-dir completed-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          ;; BL-983: a claimed stage-queue parcel keeps its stamped STAGE
          ;; recipient - the seat's own in_process listing must accept it
          ;; (same fix as ready_for_next_task.bb; identical for bare roles).
          in-process-files   (handoff-lib/stage-handoff-files in-process-dir)]
      ;; Batch work must be completed via the batch helpers; task-mode done
      ;; cannot operate on batch directories.
      (when (seq in-process-batches)
        (handoff-lib/fail! 2
                           "CURRENT_WORK_IS_BATCH: use done_with_current.sh."
                           (str/join "\n" (map #(str "- " %) in-process-batches))))
      ;; There must be exactly one current task in-process to complete.
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
        (handoff-lib/remove-sidecars-of! source-file)
        (println "COMPLETED:" (str target-file))
        (record-lean-ledger! target-file)
        (record-effort-adapt-for! target-file)
        ;; After completing the current task, immediately ask for the next
        ;; one, marking this call as an idle-boundary so ready_for_next_task
        ;; can consider any configured idle clear behavior.
        (run-ready!)))))

(-main)
