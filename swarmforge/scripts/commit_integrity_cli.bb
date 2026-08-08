#!/usr/bin/env bb
;; BL-419: thin CLI wrapper over commit_integrity_lib.bb's
;; commit-with-integrity!, so shell-driven writers on a shared checkout
;; (coordinator bookkeeping, or any other master-checkout writer that isn't
;; itself a Babashka process) can route through the same locked,
;; pathspec-scoped, verify+retry commit instead of a hand-typed `git add` +
;; `git commit`. Per the thin-wrapper rule, main() is argument parsing and
;; I/O only - all real logic lives in commit_integrity_lib.bb's own
;; unit-tested commit-with-integrity!.
;;
;; Usage: commit_integrity_cli.bb <project-root> --message <msg>
;;          --path <path> [--path <path> ...] [--max-retries <n>]
;;
;; Prints one JSON line (the raw commit-with-integrity! result) and exits
;; non-zero whenever :success is false - never reports a dropped edit as a
;; successful commit.

(ns commit-integrity-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "commit_integrity_lib.bb")))
(load-file (str (fs/path script-dir "ticket_close_guard_lib.bb")))

;; BL-819: the "close point" side of the lifecycle ledger - this CLI is the
;; codepath ticket_close_guard_lib.bb's own doc comment names as the one
;; place a close move (active/ -> done/) is validated and committed, so it
;; is the natural existing hook for the ledger's close event too. Same
;; process/sh-a-compiled-tool + best-effort/degrade-quietly convention as
;; done_with_current_task.bb's own record-lean-ledger! (and
;; handoffd.bb's emit-cost-health-sidecar!): a ledger-write failure must
;; never turn a genuinely successful close commit into a reported failure.
;;
;; The CLI is part of THIS project's own extension/ build, not something
;; every project-root carries - a project-root that isn't swarmforge-vc's
;; own checkout (or a fixture/test worktree with no `npm run compile`
;; output) genuinely has no such instrument; skip quietly rather than warn
;; on that expected-missing case, and reserve the warning for a CLI that
;; exists but still failed.
(defn record-lean-ledger! [project-root ticket-id]
  (let [cli-path (str (fs/path project-root "extension" "out" "tools" "lean-ledger-record.js"))]
    (when (fs/exists? cli-path)
      (try
        (let [{:keys [exit err]} (process/sh ["node" cli-path "--ticket" ticket-id "--target" project-root])]
          (when-not (zero? exit)
            (binding [*out* *err*]
              (println "lean-ledger-record-warn:" ticket-id (str/trim (or err ""))))))
        (catch Exception e
          (binding [*out* *err*]
            (println "lean-ledger-record-warn:" ticket-id (.getMessage e))))))))

(defn usage []
  (binding [*out* *err*]
    (println (str "Usage: commit_integrity_cli.bb <project-root> --message <msg> "
                   "--path <path> [--path <path> ...] [--max-retries <n>]")))
  (System/exit 1))

(defn parse-args [args]
  (loop [args args opts {:paths []}]
    (if (empty? args)
      opts
      (let [[flag value & more] args]
        (when (nil? value) (usage))
        (case flag
          "--message" (recur more (assoc opts :message value))
          "--path" (recur more (update opts :paths conj value))
          "--max-retries" (recur more (assoc opts :max-retries (parse-long value)))
          (usage))))))

(defn build-request [project-root args]
  (let [{:keys [message paths max-retries]} (parse-args args)]
    (when (or (str/blank? project-root) (str/blank? message) (empty? paths))
      (usage))
    (cond-> {:project-root project-root :paths paths :message message}
      max-retries (assoc :max-retries max-retries))))

(defn close-guard-failure-message [{:keys [reason ticket-id]}]
  (case reason
    :missing-qa-approval
    (str "commit_integrity_cli: CLOSE BLOCKED for " ticket-id
         " — no QA git_handoff or note to coordinator referencing this ticket. "
         "Coder/architect bookkeeping notes do not authorize close; wait for QA approval.")
    (str "commit_integrity_cli: CLOSE BLOCKED for " ticket-id " (" (name reason) ").")))

(defn -main [args]
  (let [project-root (first args)
        _ (when (str/blank? project-root) (usage))
        request (build-request project-root (rest args))
        close-check (ticket-close-guard-lib/validate-close-allowed project-root (:paths request))]
    (when-not (:allowed close-check)
      (binding [*out* *err*]
        (println (close-guard-failure-message close-check)))
      (System/exit 1))
    (let [result (commit-integrity-lib/commit-with-integrity! request)
          abandoned (when (and (:success result) (:ticket-id close-check))
                      (ticket-close-guard-lib/abandon-inflight-for-ticket!
                       project-root (:ticket-id close-check)))]
      (when (and (:success result) (:ticket-id close-check))
        (record-lean-ledger! project-root (:ticket-id close-check)))
      (when (seq abandoned)
        (binding [*out* *err*]
          (println (str "commit_integrity_cli: abandoned " (count abandoned)
                        " in-flight handoff(s) for " (:ticket-id close-check)))))
      (println (json/generate-string (cond-> result
                                       (seq abandoned)
                                       (assoc :abandoned-handoffs (count abandoned)))))
      (when-not (:success result)
        (binding [*out* *err*]
          (println (str "commit_integrity_cli: FAILED (" (name (:reason result))
                         ") after " (:attempts result) " attempt(s)"
                         (when (:index-left-dirty result)
                           " — INDEX LEFT DIRTY: restoring the caller's paths to their pre-call state also failed"))))
        (System/exit 1)))))

(-main *command-line-args*)
