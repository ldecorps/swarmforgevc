#!/usr/bin/env bb

(ns ready-for-next-task
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "branch_claim_guard_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "swarm_identity_lib.bb")))

(def idle-boundary?
  "Set only when invoked from done_with_current_task.bb, right after it
   completed the current task (BL-089): a plain standalone ready_for_next.sh
   run while already idle must never trigger a clear."
  (some #{"--idle-boundary"} *command-line-args*))

(defn maybe-clear-at-idle-boundary! []
  (when (and idle-boundary?
             (handoff-lib/idle-clear-enabled? (handoff-lib/current-role)))
    (handoff-lib/respawn-self! (handoff-lib/current-role))))

;; ── BL-529 pre-turn branch/claim guard ────────────────────────────────────
;; Pure decisions live in branch_claim_guard_lib.bb; this is the git/fs IO
;; wiring around them. Fires before EVERY print-task (both an in-process
;; resume and a fresh dequeue) so no productive turn runs on a branch named
;; after a different ticket than the claim. Covered end-to-end by
;; test/test_branch_claim_guard.sh against the real script.

(defn- git-out
  "stdout of `git -C root args...`, trimmed; nil on non-zero exit."
  [root & args]
  (let [r (apply sh/sh "git" "-C" (str root) args)]
    (when (zero? (:exit r))
      (str/trim (:out r)))))

(defn- current-branch [root]
  (git-out root "rev-parse" "--abbrev-ref" "HEAD"))

(defn- worktree-dirty?
  "Any uncommitted change (staged, unstaged, or untracked) - auto-correcting
   the branch must never carry another ticket's in-flight edits across with
   it, so anything porcelain reports makes the guard refuse instead."
  [root]
  (boolean (seq (git-out root "status" "--porcelain"))))

(defn- local-ref-exists? [root branch]
  (boolean (git-out root "rev-parse" "--verify" "--quiet" (str "refs/heads/" branch))))

(defn- checkout-branch! [root branch]
  (zero? (:exit (sh/sh "git" "-C" (str root) "checkout" branch))))

(defn- resolve-standard-branch
  "The first of the role's standard-branch candidates that exists as a local
   ref, or nil when none does (a swarm whose role branch was never created -
   nothing safe to auto-correct onto). The swarm identity file lives at the
   target root (git-common-dir's parent), not in per-worktree .swarmforge
   state, so the swarm name is read from there."
  [root role]
  (let [swarm-name (swarm-identity-lib/own-swarm-name (handoff-lib/target-root))]
    (some (fn [candidate]
            (when (local-ref-exists? root candidate)
              candidate))
          (branch-claim-guard-lib/standard-branch-candidates swarm-name role))))

(defn requeue-and-refuse!
  "Moves the in-process claim file back to new/ (it never runs this turn),
   then refuses the turn with a warning naming the branch and the claim."
  [handoff-file in-process-dir new-dir branch decision reason]
  (let [target (fs/path new-dir (fs/file-name handoff-file))]
    (when (and (fs/exists? (fs/path in-process-dir (fs/file-name handoff-file)))
               (fs/exists? target))
      (handoff-lib/fail! 2 (str "BRANCH_CLAIM_GUARD: cannot requeue " handoff-file
                                " - a file with the same name already sits in new/: " target)))
    (when (fs/exists? (fs/path in-process-dir (fs/file-name handoff-file)))
      (fs/move handoff-file target)
      ;; The requeued file's sidecars at its old in_process/ location only
      ;; ever described that now-vacated state - drop them, same discipline
      ;; as the dequeue path's new/-location cleanup (BL-232).
      (handoff-lib/remove-sidecars-of! handoff-file)))
  (handoff-lib/fail! 2
                     (str "BRANCH_CLAIM_MISMATCH: worktree branch \"" branch
                          "\" names ticket " (:branch-ticket decision)
                          " but the in-process claim is " (:claim-ticket decision)
                          " (" reason ").")
                     (str "BRANCH_CLAIM_MISMATCH: requeued the claim to new/ and refused"
                          " the turn; no productive turn ran on the mismatched branch.")))

(defn enforce-branch-claim-guard!
  "Runs the BL-529 guard for the in-process claim handoff-file. Returns nil
   when the turn may proceed (passing straight through, or after a clean
   mismatch was auto-corrected by checking out the role's standard branch).
   On a dirty mismatch - or a clean one with no standard branch to correct
   onto - moves handoff-file back to new-dir and refuses the turn (fail!),
   naming the branch and claim in the warning."
  [handoff-file in-process-dir new-dir]
  (let [root (handoff-lib/worktree-root)
        branch (current-branch root)
        claim-task (handoff-lib/header-field handoff-file "task")
        decision (branch-claim-guard-lib/guard-decision branch claim-task (worktree-dirty? root))]
    (case (:action decision)
      :pass nil
      :auto-checkout
      (let [role (handoff-lib/current-role)
            target (resolve-standard-branch root role)]
        (if (and target (checkout-branch! root target))
          (binding [*out* *err*]
            (println (str "BRANCH_CLAIM_GUARD: auto-corrected worktree off branch \""
                          branch "\" (ticket " (:branch-ticket decision) ") onto \""
                          target "\" for claim " (:claim-ticket decision)
                          "; the turn proceeds on the corrected branch.")))
          ;; No safe branch to correct onto (or the checkout itself failed):
          ;; the worktree is clean but uncorrectable - requeue and refuse
          ;; exactly like the dirty case rather than work blind.
          (requeue-and-refuse! handoff-file in-process-dir new-dir branch decision
                               "no standard branch available to auto-correct onto")))
      :refuse-requeue
      (requeue-and-refuse! handoff-file in-process-dir new-dir branch decision
                           "worktree has uncommitted changes"))))

(defn -main []
  (let [new-dir (handoff-lib/my-mailbox-dir :new)
        in-process-dir (handoff-lib/my-mailbox-dir :in_process)
        completed-dir (handoff-lib/my-mailbox-dir :completed)
        abandoned-dir (handoff-lib/my-mailbox-dir :abandoned)]
    (doseq [dir [new-dir in-process-dir completed-dir abandoned-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          in-process-files (handoff-lib/my-handoff-files in-process-dir)]
      (when (seq in-process-batches)
        (handoff-lib/fail! 2
               "TASK_IN_PROCESS_IS_BATCH: use ready_for_next.sh or done_with_current.sh."
               (str/join "\n" (map #(str "- " %) in-process-batches))))
      (when (> (count in-process-files) 1)
        (handoff-lib/fail! 2
               "AMBIGUOUS_TASK_STATE: multiple tasks are already in process."
               (str/join "\n" (map #(str "- " %) in-process-files))))
      (if (= 1 (count in-process-files))
        (do
          (enforce-branch-claim-guard! (first in-process-files) in-process-dir new-dir)
          (handoff-lib/print-task (first in-process-files)))
        (if (handoff-lib/draining?)
          (println "DRAINING")
          (let [new-files (handoff-lib/my-handoff-files new-dir)
                completed-basenames (handoff-lib/terminal-basenames completed-dir)
                abandoned-basenames (handoff-lib/terminal-basenames abandoned-dir)
                ;; BL-365: quarantines any corrupt candidate in place (as
                ;; *.handoff.dead, the suffix the existing dead-letter sweep
                ;; already scans and alerts a human on) so it can never be
                ;; promoted into in_process/ as a task; falls through to the
                ;; next genuinely-dequeueable file.
                dequeueable (handoff-lib/resolve-dequeueable-candidates new-files completed-basenames abandoned-basenames)]
            (if (empty? dequeueable)
              (do
                (println "NO_TASK")
                (maybe-clear-at-idle-boundary!))
              (let [source-file (first dequeueable)
                    target-file (fs/path in-process-dir (fs/file-name source-file))]
                (when (fs/exists? target-file)
                  (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: target in-process file already exists: " target-file)))
                (fs/move source-file target-file)
                ;; BL-232: drops any .chase.json/.nudge sidecar left behind
                ;; at source-file's now-stale new/ location - it only ever
                ;; described state about this handoff waiting in new/, and
                ;; must not outlive it there.
                (handoff-lib/remove-sidecars-of! source-file)
                (handoff-lib/set-header! target-file "dequeued_at" (handoff-lib/timestamp))
                (enforce-branch-claim-guard! target-file in-process-dir new-dir)
                (handoff-lib/print-task target-file)))))))))

(-main)
