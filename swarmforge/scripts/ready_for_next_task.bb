#!/usr/bin/env bb

(ns ready-for-next-task
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "branch_claim_guard_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "swarm_identity_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "backlog_depth_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "mono_router_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "seat_affinity_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "seat_difficulty_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "idle_clear_fullness_cli.bb")))

(def idle-boundary?
  "Set only when invoked from done_with_current_task.bb, right after it
   completed the current task (BL-089): a plain standalone ready_for_next.sh
   run while already idle must never trigger a clear."
  (some #{"--idle-boundary"} *command-line-args*))

(defn maybe-clear-at-idle-boundary! []
  ;; BL-1238: opt-in (BL-089) alone is no longer sufficient - a role whose
  ;; window is still mostly empty must not pay for a reload it doesn't
  ;; need. idle-clear-fullness-cli/should-respawn? folds the opt-in check
  ;; back in (it stays authoritative and first) and adds the fullness gate;
  ;; respawn-self! itself is unchanged and stays at this exact call site.
  (when (and idle-boundary?
             (idle-clear-fullness-cli/should-respawn? (handoff-lib/current-role)))
    (handoff-lib/respawn-self! (handoff-lib/current-role))))

;; ── BL-550: non-home resident strands after a merge-up note ───────────────
;; Pure decision lives in mono-router-lib/rotate-home?; this reads conf text
;; and prints ROTATE_HOME (instead of NO_TASK) so ready_for_next.sh can hand
;; off to rotate_to_role.sh. Never fires outside mono-router, never diverts
;; the home role itself, and never fires while real work is dequeueable.

(defn- mono-router-conf-text []
  (try (slurp (str (backlog-depth-lib/conf-file-path (handoff-lib/target-root))))
       (catch Exception _ nil)))

(defn- active-ticket-yaml
  "Working-tree active ticket whose id: matches ticket-id, or nil."
  [root ticket-id]
  (when ticket-id
    (let [active-dir (fs/path root "backlog" "active")]
      (when (fs/exists? active-dir)
        (some (fn [f]
                (let [content (try (slurp (str f)) (catch Exception _ nil))]
                  (when (and content
                             (re-find (re-pattern (str "(?m)^id:\\s*" (java.util.regex.Pattern/quote ticket-id) "\\s*$"))
                                      content))
                    content)))
              (fs/glob active-dir "**.yaml"))))))

(defn- mutation-cost-for-task
  [task]
  (let [root (handoff-lib/target-root)
        tid (pipeline-stage-lib/extract-ticket-id task)
        yaml (active-ticket-yaml root tid)]
    (seat-difficulty-lib/parse-mutation-cost yaml)))

(defn- sibling-busy?
  [ri]
  (boolean (seq (handoff-lib/handoff-files
                 (apply fs/path (handoff-lib/mailbox-base-dir ri)
                        (handoff-lib/mailbox-state->relative-segments :in_process))))))

(defn- difficulty-sibling-states
  [tiers]
  (mapv (fn [ri]
          {:role (:role ri)
           :tier (get tiers (:role ri))
           :busy? (sibling-busy? ri)})
        (handoff-lib/stage-sibling-seats)))

(defn- difficulty-allows-claim?
  "BL-1001: leave the parcel in the stage queue when this seat must not take it."
  [handoff-file tiers pack-conf]
  (let [me (handoff-lib/current-role)
        stage (handoff-lib/seat-stage me)
        cost (mutation-cost-for-task (handoff-lib/header-field handoff-file "task"))
        models (seat-difficulty-lib/parse-seat-models pack-conf)
        decision (seat-difficulty-lib/difficulty-claim-decision
                  {:me me
                   :my-tier (get tiers me)
                   :cost cost
                   :stage stage
                   :tiers tiers
                   :models models
                   :conf-text pack-conf
                   :sibling-states (difficulty-sibling-states tiers)})]
    (= :claim decision)))

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
  ;; BL-983: a seat CLAIMS from its STAGE's queue (the stage-named row's
  ;; new/ - for a bare seat this IS its own new/, byte-identical path) into
  ;; its OWN in_process/completed/abandoned, so task-mode single-claim
  ;; holds per seat while the stage keeps one addressable queue.
  (let [new-dir        (handoff-lib/stage-queue-dir :new)
        in-process-dir (handoff-lib/my-mailbox-dir :in_process)
        completed-dir  (handoff-lib/my-mailbox-dir :completed)
        abandoned-dir  (handoff-lib/my-mailbox-dir :abandoned)]
    (doseq [dir [new-dir in-process-dir completed-dir abandoned-dir]]
      (fs/create-dirs dir))
    (let [in-process-batches (handoff-lib/batch-dirs in-process-dir)
          ;; BL-983: a claimed stage-queue parcel keeps its stamped
          ;; recipient (the STAGE), so a seat's own in_process listing must
          ;; accept the stage as "mine" - with the seat-blind mine? filter a
          ;; busy seat looked idle and claimed a second parcel (invariant 2
          ;; violation, caught by this parcel's own e2e probe).
          in-process-files   (handoff-lib/stage-handoff-files in-process-dir)]
      ;; If any batch work is in process, this helper must not run; batch mode
      ;; has its own ready/done helpers.
      (when (seq in-process-batches)
        (handoff-lib/fail! 2
                           "TASK_IN_PROCESS_IS_BATCH: use ready_for_next.sh or done_with_current.sh."
                           (str/join "\n" (map #(str "- " %) in-process-batches))))
      ;; A role must never have more than one in-process task; this is a hard
      ;; invariant for mailbox state.
      (when (> (count in-process-files) 1)
        (handoff-lib/fail! 2
                           "AMBIGUOUS_TASK_STATE: multiple tasks are already in process."
                           (str/join "\n" (map #(str "- " %) in-process-files))))
      (if (= 1 (count in-process-files))
        ;; When there is exactly one in-process task, enforce the BL-529
        ;; branch/claim guard, then print it and do not dequeue a new one.
        ;; This is the behavior that produces the "STOP. You already have
        ;; in_process handoff work." message seen by callers of
        ;; ready_for_next.sh.
        (do
          (enforce-branch-claim-guard! (first in-process-files) in-process-dir new-dir)
          (handoff-lib/print-task (first in-process-files)))
        (if (handoff-lib/draining?)
          (println "DRAINING")
          (let [new-files            (handoff-lib/stage-handoff-files new-dir)
                ;; BL-983: a redelivered copy of a parcel a PEER seat has
                ;; already claimed (live in its in_process) or already
                ;; finished (its completed/abandoned) must never be claimed
                ;; here - fold sibling basenames into the BL-218 terminal
                ;; sets, so the existing dedup path refuses the resurrection
                ;; identically to a same-seat duplicate. Empty for bare
                ;; single-seat stages - sets unchanged, path unchanged.
                siblings             (handoff-lib/stage-sibling-seats)
                sibling-basenames    (fn [state]
                                       (set (mapcat (fn [ri]
                                                      (map fs/file-name
                                                           (handoff-lib/handoff-files
                                                            (apply fs/path (handoff-lib/mailbox-base-dir ri)
                                                                   (handoff-lib/mailbox-state->relative-segments state)))))
                                                    siblings)))
                completed-basenames  (into (into (handoff-lib/terminal-basenames completed-dir)
                                                 (sibling-basenames :completed))
                                           (sibling-basenames :in_process))
                abandoned-basenames  (into (handoff-lib/terminal-basenames abandoned-dir)
                                           (sibling-basenames :abandoned))
                ;; BL-365: quarantines any corrupt candidate in place (as
                ;; *.handoff.dead, the suffix the existing dead-letter sweep
                ;; already scans and alerts a human on) so it can never be
                ;; promoted into in_process/ as a task; falls through to the
                ;; next genuinely-dequeueable file.
                dequeueable          (handoff-lib/resolve-dequeueable-candidates new-files completed-basenames abandoned-basenames)
                ;; BL-1004: a rework whose task a SIBLING seat has worked
                ;; is deferred to that seat until the cross-seat deadline -
                ;; decided here in the claim path, inside the mailbox
                ;; layer, so seat identity never escapes it (BL-983's own
                ;; invariant). A deferred parcel stays untouched in the
                ;; stage queue, exactly like an ambulance hold, and is
                ;; re-considered on the very next poll. With no siblings
                ;; the sibling task set is empty and every decision is
                ;; :claim, so the deferral path is structurally
                ;; unreachable on a single-seat stage (invariant 3), and
                ;; the seat's own mailboxes are then never even read.
                sibling-tasks        (handoff-lib/sibling-worked-task-names)
                my-tasks             (when (seq sibling-tasks)
                                       (into (handoff-lib/worked-task-names-in completed-dir)
                                             (handoff-lib/worked-task-names-in in-process-dir)))
                pack-conf            (mono-router-conf-text)
                deadline-ms          (seat-affinity-lib/parse-cross-seat-claim-deadline-ms pack-conf)
                now-ms               (System/currentTimeMillis)
                decided              (mapv (fn [f]
                                             [f (seat-affinity-lib/rework-claim-decision
                                                 {:type (handoff-lib/header-field f "type")
                                                  :task (handoff-lib/header-field f "task")
                                                  :sibling-tasks sibling-tasks
                                                  :my-tasks my-tasks
                                                  :enqueued-at (handoff-lib/header-field f "enqueued_at")
                                                  :created-at (handoff-lib/header-field f "created_at")
                                                  :now-ms now-ms
                                                  :deadline-ms deadline-ms})])
                                           dequeueable)
                sibling-seat-ids     (mapv :role (handoff-lib/stage-sibling-seats))
                deferred             (filterv #(= :defer (:action (second %))) decided)
                ;; BL-1001: drop candidates this seat must not take (tier /
                ;; prefer-fit). They stay in the stage queue for a peer.
                tiers                (seat-difficulty-lib/parse-seat-tiers pack-conf)
                claimable            (->> decided
                                          (remove #(= :defer (:action (second %))))
                                          (filter (fn [[f _]] (difficulty-allows-claim? f tiers pack-conf)))
                                          vec)]
            (doseq [[f decision] deferred]
              (println (seat-affinity-lib/deferral-line
                        {:basename (fs/file-name f)
                         :task (:task decision)
                         :sibling-seats sibling-seat-ids})))
            (if (empty? claimable)
              (report-no-task-or-rotate!)
              ;; BL-983: two idle seats can race for the same stage-queue
              ;; file; fs/move's rename is the atomic arbiter. The loser's
              ;; move throws (source gone) - it falls through to the next
              ;; candidate rather than failing the turn, so a parcel is
              ;; claimed by exactly one seat and a racing peer simply keeps
              ;; looking.
              (loop [candidates claimable]
                (if (empty? candidates)
                  (report-no-task-or-rotate!)
                  (let [[source-file decision] (first candidates)
                        target-file (fs/path in-process-dir (fs/file-name source-file))]
                    (when (fs/exists? target-file)
                      (handoff-lib/fail! 2 (str "AMBIGUOUS_TASK_STATE: target in-process file already exists: " target-file)))
                    (if (try (fs/move source-file target-file) true
                             (catch Exception _ false))
                      (do
                        ;; BL-232: drops any .chase.json/.nudge sidecar left
                        ;; behind at source-file's now-stale new/ location -
                        ;; it only ever described state about this handoff
                        ;; waiting in new/, and must not outlive it there.
                        (handoff-lib/remove-sidecars-of! source-file)
                        (handoff-lib/set-header! target-file "dequeued_at" (handoff-lib/timestamp))
                        ;; BL-1004 invariant 1's out-loud half: a cross-seat
                        ;; claim past the deadline says the seat did not
                        ;; build this parcel, so it merges the parcel
                        ;; commit FIRST, then works.
                        (when (= :claim-cross-seat (:action decision))
                          (println (seat-affinity-lib/cross-seat-claim-line
                                    {:basename (fs/file-name source-file)
                                     :task (:task decision)
                                     :sibling-seats sibling-seat-ids})))
                        (enforce-branch-claim-guard! target-file in-process-dir new-dir)
                        (handoff-lib/print-task target-file))
                      (recur (rest candidates)))))))))))))

(-main)
