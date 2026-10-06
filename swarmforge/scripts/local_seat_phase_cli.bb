#!/usr/bin/env bb
;; BL-2037: the one command that reads and moves a local-model seat's
;; per-parcel phase record. Run from the seat's worktree - the record lives
;; at <worktree>/.swarmforge/phase/<ticket>.md (`.swarmforge/` is
;; gitignored, so this is never a tracked path). All pure judgement lives
;; in local_seat_phase_lib.bb; this file is IO only (engineering rule: CLI
;; main is a thin wrapper).
;;
;; Usage (run from the seat's worktree):
;;   local_seat_phase_cli.bb show <ticket>
;;     Prints {"phase":...,"failed":...,"path":...} as JSON. A ticket with
;;     no record reads as phase "arrange", failed 0.
;;   local_seat_phase_cli.bb end <ticket> --to <arrange|act|assert> --notes <file>
;;     Appends the notes file's text and moves the record: arrange to
;;     arrange/act/assert, or act to assert. Any other --to for the
;;     record's current phase refuses (exit 1), naming the move, leaving
;;     the record unchanged. --notes is required and must name a file
;;     that exists; absent or missing, refuses (exit 1) before any write.
;;     BL-2038: a successful move restarts the seat's session on the same
;;     parcel (handoff_lib's respawn-pane-fresh!, local-model seats only) -
;;     always AFTER the record is written, never before.
;;   local_seat_phase_cli.bb fail <ticket> --notes <file>
;;     From assert only: appends the notes and returns to act, counting the
;;     failed assert. At 2 failed asserts already, moves nothing, still
;;     appends the notes, and prints "SPLIT_REQUEST <ticket>" (exit 0) -
;;     the seat then sends the coordinator a note `split <ticket>: <seat>
;;     failed assert twice` (the existing split BAU) and never restarts for
;;     this outcome - the seat is about to give up this parcel, not resume
;;     it. Called from any phase other than assert: refuses (exit 1),
;;     record unchanged. --notes is required, same as end. A genuine
;;     assert-to-act move restarts the session, same as end (BL-2038).
;;   local_seat_phase_cli.bb pass <ticket> --notes <file>
;;     From assert only: appends the notes and moves to done. Called from
;;     any other phase: refuses (exit 1), record unchanged. --notes is
;;     optional here - absent or missing simply appends nothing.
;;
;; Exit codes: 0 success (including the split-request outcome); 1 refused
;; (illegal move, or end/fail's --notes absent/missing - unchanged, nothing
;; written); 2 usage.

(ns local-seat-phase-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "local_seat_phase_lib.bb")))
(load-file (str (fs/path scripts-dir "handoff_lib.bb")))

(def value-flags #{"--to" "--notes"})

(defn- flag-value
  [args flag]
  (let [v (second (drop-while #(not= flag %) args))]
    (when (and v (not (str/starts-with? (str v) "--"))) v)))

(defn- positionals
  [args]
  (loop [in (seq args) out []]
    (if (empty? in)
      out
      (let [a (str (first in)) rest' (rest in)]
        (cond
          (contains? value-flags a) (recur (drop 1 rest') out)
          (str/starts-with? a "--") (recur rest' out)
          :else (recur rest' (conj out a)))))))

(defn- usage []
  (binding [*out* *err*]
    (println "Usage: local_seat_phase_cli.bb show <ticket>")
    (println "       local_seat_phase_cli.bb end <ticket> --to <arrange|act|assert> --notes <file>")
    (println "       local_seat_phase_cli.bb fail <ticket> --notes <file>")
    (println "       local_seat_phase_cli.bb pass <ticket> --notes <file>"))
  (System/exit 2))

(defn- record-path [ticket]
  (fs/path ".swarmforge" "phase" (str ticket ".md")))

(defn- read-record [ticket]
  (let [p (record-path ticket)]
    (if (fs/exists? p)
      (local-seat-phase-lib/parse (slurp (str p)))
      local-seat-phase-lib/initial-record)))

(defn- write-record! [ticket record]
  (let [p (record-path ticket)]
    (fs/create-dirs (fs/parent p))
    (spit (str p) (local-seat-phase-lib/render record))))

(defn- read-notes [path]
  (if (and path (fs/exists? path)) (slurp path) ""))

(defn- print-status! [ticket record]
  (println (json/generate-string {:phase (:phase record) :failed (:failed record)
                                   :path (str (record-path ticket))})))

(defn- refuse! [reason]
  (binding [*out* *err*] (println (str "local_seat_phase_cli.bb: " reason)))
  (System/exit 1))

;; end/fail are the only phase-carrying moves (BL-2037 D1): a phase's
;; findings reach the next fresh session ONLY through the note it appends
;; here, so a silently-empty or silently-skipped --notes loses that phase's
;; work without any error. Checked before the move is even judged, so a
;; refusal here never touches the record (pass keeps --notes optional).
(defn- notes-problem [notes-path]
  (cond
    (nil? notes-path) "--notes <file> is required"
    (not (fs/exists? notes-path)) (str "--notes file not found: " notes-path)
    :else nil))

(defn- apply-move! [ticket result notes-path]
  ;; Shared tail for end/fail/pass once the lib has judged the move legal:
  ;; append the note, write the record, report the outcome.
  (let [note (read-notes notes-path)
        final (local-seat-phase-lib/append-note (:record result) note)]
    (write-record! ticket final)
    (if (:split result)
      (println (str "SPLIT_REQUEST " ticket))
      (print-status! ticket final))))

;; BL-2038: a genuine phase move (end, or a non-split fail) restarts the
;; seat's session on the SAME parcel, the way the existing parcel-boundary
;; restart does (ready_for_next_task.bb's maybe-fresh-session-for-parcel!) -
;; reusing handoff-lib/respawn-pane-fresh! rather than a second respawn
;; implementation. Only ever called AFTER apply-move! has already written
;; the record (invariant 1), and only for a local-model seat (invariant 2) -
;; any other agent, or a role with no roles.tsv row at all, is a no-op. A
;; restart that fails prints why and lets the seat carry on in this session,
;; mirroring maybe-fresh-session-for-parcel!'s own fallback.
(defn- maybe-restart-session! []
  (let [role (handoff-lib/current-role)
        agent (:agent (when role (handoff-lib/load-role-info role)))]
    (when (and role (= "local-model" agent))
      (try
        (handoff-lib/respawn-pane-fresh! role (System/getenv "TMUX_PANE"))
        (catch Exception e
          (binding [*out* *err*]
            (println (str "local_seat_phase_cli.bb: restart skipped (" (.getMessage e) "); carry on in this session."))))))))

(defn -main [& args]
  (let [[subcommand & rest-args] args
        ticket (first (positionals rest-args))]
    (when (or (nil? subcommand) (nil? ticket)) (usage))
    (case subcommand
      "show"
      (print-status! ticket (read-record ticket))

      "end"
      (let [to (flag-value rest-args "--to")
            notes-path (flag-value rest-args "--notes")]
        (if-let [problem (notes-problem notes-path)]
          (refuse! problem)
          (let [result (local-seat-phase-lib/end-move (read-record ticket) to)]
            (if (:ok result)
              (do (apply-move! ticket result notes-path)
                  (maybe-restart-session!))
              (refuse! (:reason result))))))

      "fail"
      (let [notes-path (flag-value rest-args "--notes")]
        (if-let [problem (notes-problem notes-path)]
          (refuse! problem)
          (let [result (local-seat-phase-lib/fail-move (read-record ticket))]
            (if (:ok result)
              (do (apply-move! ticket result notes-path)
                  (when-not (:split result) (maybe-restart-session!)))
              (refuse! (:reason result))))))

      "pass"
      (let [notes-path (flag-value rest-args "--notes")
            result (local-seat-phase-lib/pass-move (read-record ticket))]
        (if (:ok result)
          (apply-move! ticket result notes-path)
          (refuse! (:reason result))))

      (usage))))

(apply -main *command-line-args*)
