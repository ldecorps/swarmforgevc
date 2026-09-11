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
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "commit_integrity_lib.bb")))
(load-file (str (fs/path script-dir "ticket_close_guard_lib.bb")))
;; BL-1526: chase_sweep_lib.bb spawns this CLI - handoffd.bb load-files
;; chase_sweep_lib.bb - so a plain process/sh here was a spawn-reachable
;; banned-API offender (BL-1031's ratchet), invisible until BL-1526 taught
;; the walk to resolve that spawn target. Self-load-filed rather than
;; relying on a loader to have brought it in first, same convention as
;; every other daemon-reachable lib.
(load-file (str (fs/path script-dir "daemon_cycle_guard_lib.bb")))

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
        (let [{:keys [exit err]} (daemon-cycle-guard-lib/sh! ["node" cli-path "--ticket" ticket-id "--target" project-root])]
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

(defn close-guard-failure-message
  "BL-869: names the tickets that actually FAILED validation
   (:blocked-ticket-ids), not every ticket the commit touched - a
   partially-approved multi-ticket close must not read as if the already-
   approved ticket were also rejected."
  [{:keys [reason blocked-ticket-ids ticket-ids details]}]
  (let [names (str/join "," (or (seq blocked-ticket-ids) ticket-ids))
        ;; BL-1378: a multi-ticket close can fail for more than one reason at
        ;; once, and "which ticket, for which reason" is the only form of this
        ;; message anyone can act on.
        per-ticket (str/join "\n"
                             (for [t (or (seq blocked-ticket-ids) ticket-ids)
                                   :let [{:keys [reason detail]} (get details t)]
                                   :when reason]
                               (str "  " t ": " (name reason)
                                    (when (seq (str detail)) (str " — " detail)))))]
    (str
     (case reason
       :missing-qa-approval
       (str "commit_integrity_cli: CLOSE BLOCKED for " names
            " — no QA git_handoff or note to coordinator referencing this ticket, "
            "and no expedite QA verdict record for it. "
            "Coder/architect bookkeeping notes do not authorize close; wait for QA approval.")

       ;; BL-1378: an expedite-closed ticket is approved by the run's own QA-hat
       ;; verdict record, but the code still has to have reached main - a ticket
       ;; in backlog/done/ whose branch nobody reads is what this refuses.
       :expedite-commit-not-on-main
       (str "commit_integrity_cli: CLOSE BLOCKED for " names
            " — an expedite QA verdict record approves it, but the approved commit "
            "has not reached main. QA lands the branch (Article 1.8/4.2, BL-247); "
            "close after it lands. Do not bypass this guard.")

       :expedite-ancestry-undeterminable
       (str "commit_integrity_cli: CLOSE BLOCKED for " names
            " — an expedite QA verdict record approves it, but whether the approved "
            "commit reached main could not be determined. Refusing rather than guessing.")

       :expedite-store-problem
       (str "commit_integrity_cli: CLOSE BLOCKED for " names
            " — the expedite verdict store cannot be trusted. A store that cannot be "
            "read is never read as absent, and absence is never approval.")

       (str "commit_integrity_cli: CLOSE BLOCKED for " names " (" (name reason) ")."))
     (when (seq per-ticket) (str "\n" per-ticket)))))

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
          ;; BL-1475: :landed-elsewhere means ANOTHER writer's commit
          ;; represents this close (verified against HEAD, this process
          ;; made no commit of its own) - that writer's OWN call is the one
          ;; that already ran (or will run) this close's bookkeeping.
          ;; Running it again here would abandon in-flight handoffs and
          ;; record the lean ledger a second time for a close this process
          ;; did not actually make.
          genuinely-committed? (and (:success result) (not= (:reason result) :landed-elsewhere))
          ticket-ids (when genuinely-committed? (:ticket-ids close-check))
          abandoned (vec (mapcat #(ticket-close-guard-lib/abandon-inflight-for-ticket! project-root %)
                                  ticket-ids))]
      (doseq [ticket-id ticket-ids]
        (record-lean-ledger! project-root ticket-id))
      (when (seq abandoned)
        (binding [*out* *err*]
          (println (str "commit_integrity_cli: abandoned " (count abandoned)
                        " in-flight handoff(s) for " (str/join "," ticket-ids)))))
      ;; BL-1378: an ALLOWED close says which path approved it. A close that
      ;; went through on an expedite verdict record rather than a QA mailbox
      ;; handoff is a materially different event, and a reader who cannot tell
      ;; them apart cannot audit either.
      (println (json/generate-string (cond-> result
                                       (seq ticket-ids)
                                       (assoc :closed-ticket-ids ticket-ids)
                                       (seq abandoned)
                                       (assoc :abandoned-handoffs (count abandoned))
                                       (seq (:details close-check))
                                       (assoc :close-approval (:details close-check)))))
      (when-not (:success result)
        (binding [*out* *err*]
          (println (str "commit_integrity_cli: FAILED (" (name (:reason result))
                         ") after " (:attempts result) " attempt(s)"
                         ;; BL-1475: git's own stderr from the final failed
                         ;; attempt, never discarded - the "landed
                         ;; elsewhere" outcome is a :success true above and
                         ;; never reaches this branch at all.
                         (when (:stderr result) (str " — " (str/trim (:stderr result))))
                         (when (:index-left-dirty result)
                           " — INDEX LEFT DIRTY: restoring the caller's paths to their pre-call state also failed"))))
        (System/exit 1)))))

(-main *command-line-args*)
