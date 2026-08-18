#!/usr/bin/env bb
;; BL-678: small CLI wrapper over batch_claim_progress_lib.bb, with an
;; injectable clock/commit - lets shell/acceptance tests exercise the REAL
;; pure decision logic against fixture paths, without a live daemon, tmux
;; socket, or wall-clock dependency. Mirrors relaunch_resume_cli.bb's own
;; root-explicit, subcommand-dispatch shape (see BL-648).
;;
;; Subcommands:
;;   mark-progress <in-process-file> <commit> <now-ms>
;;     Refreshes last-progress instant when commit differs from the
;;     sidecar's own last-recorded commit; no-ops otherwise. Requires an
;;     existing sidecar (written at claim time by ready_for_next_batch.bb).
;;   observe <in-process-file> <now-ms> <staleness-ms>
;;     Prints "SILENT" or "STALE_SUSPECT <parcel-id> <age-ms>" - never
;;     moves, deletes, or re-delivers the handoff file itself (invariant 2:
;;     this subcommand has no code path that touches the handoff file).
;;   retire <in-process-file>
;;     Calls the REAL handoff_lib.bb/remove-sidecars-of! (the exact function
;;     done_with_current_batch.bb runs on every completing batch item) -
;;     never a re-derived deletion - so a standalone check exercises the
;;     genuine terminal-cleanup path without needing a full
;;     done_with_current_batch.bb run (which re-execs ready_for_next_batch.
;;     sh's own `cd "$SCRIPT_DIR"`, unsafe to drive against a fixture root
;;     from inside a real, currently-in-use role worktree).

(ns batch-claim-progress-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "batch_claim_progress_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(defn- read-progress [fp]
  (let [p (batch-claim-progress-lib/sidecar-path fp)]
    (when (fs/exists? p)
      (json/parse-string (slurp p) true))))

(defn- write-progress! [fp progress]
  (spit (batch-claim-progress-lib/sidecar-path fp) (json/generate-string progress)))

(defn -main [& args]
  (let [[cmd & rest-args] args]
    (case cmd
      "mark-progress"
      (let [[fp commit now-ms] rest-args
            progress (read-progress fp)]
        (when (nil? progress)
          (binding [*out* *err*] (println "no sidecar for" fp))
          (System/exit 2))
        (let [advanced? (batch-claim-progress-lib/advanced? progress commit)
              progress' (if advanced?
                          (batch-claim-progress-lib/mark-progress progress commit (parse-long now-ms))
                          progress)]
          (write-progress! fp progress')
          (println (if advanced? "PROGRESSED" "UNCHANGED"))))

      "observe"
      (let [[fp now-ms staleness-ms] rest-args
            progress (read-progress fp)
            now-ms'  (parse-long now-ms)
            decision (batch-claim-progress-lib/decide-batch-claim-observation
                      progress now-ms' (parse-long staleness-ms))]
        (case decision
          :silent (println "SILENT")
          :stale-suspect
          (println (str "STALE_SUSPECT " (:parcelId progress) " "
                         (batch-claim-progress-lib/progress-age-ms progress now-ms')))))

      "retire"
      (let [[fp] rest-args]
        (handoff-lib/remove-sidecars-of! fp)
        (println "RETIRED"))

      (do (binding [*out* *err*] (println "unknown subcommand:" cmd))
          (System/exit 2)))))

(apply -main *command-line-args*)
