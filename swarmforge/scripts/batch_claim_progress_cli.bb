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
;;   observe <in-process-file> <now-ms> <staleness-ms> [role] [clean|dirty]
;;     Prints "SILENT", "STALE_SUSPECT <parcel-id> <age-ms>" or (BL-1076)
;;     "SUPPRESSED_VISIBLE_WORK <parcel-id> <age-ms> worktree-dirty" - never
;;     moves, deletes, or re-delivers the handoff file itself (invariant 2:
;;     this subcommand has no code path that touches the handoff file).
;;     BL-1076: `role` resolves that role's own tolerance from the built-in
;;     map (hardender gets 90 minutes), with <staleness-ms> as the base for
;;     every other role; the last argument supplies the owner's worktree
;;     dirtiness, the second progress signal beside HEAD. Both are optional
;;     and default to "no role override" and "clean", which is what every
;;     pre-BL-1076 caller of this subcommand meant.
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
      (let [[fp now-ms staleness-ms role dirt] rest-args
            progress (read-progress fp)
            now-ms'  (parse-long now-ms)
            base-ms  (parse-long staleness-ms)
            ;; BL-1076: an absent role resolves to the base, so the
            ;; three-argument form behaves exactly as it did before.
            stale-ms (batch-claim-progress-lib/resolve-stale-threshold-ms role base-ms nil)
            dirty?   (= "dirty" dirt)
            age-ms   (batch-claim-progress-lib/progress-age-ms progress now-ms')
            decision (batch-claim-progress-lib/decide-batch-claim-observation
                      progress now-ms' stale-ms dirty?)]
        (case decision
          :silent (println "SILENT")
          :stale-suspect
          (println (str "STALE_SUSPECT " (:parcelId progress) " " age-ms))
          :suppressed-visible-work
          (println (str "SUPPRESSED_VISIBLE_WORK " (:parcelId progress) " " age-ms
                         " worktree-dirty"))))

      "retire"
      (let [[fp] rest-args]
        (handoff-lib/remove-sidecars-of! fp)
        (println "RETIRED"))

      (do (binding [*out* *err*] (println "unknown subcommand:" cmd))
          (System/exit 2)))))

(apply -main *command-line-args*)
