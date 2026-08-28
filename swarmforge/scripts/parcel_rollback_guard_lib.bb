;; parcel_rollback_guard_lib.bb — BL-1213: refuses a git_handoff whose
;; branch holds, at its tip, content byte-identical to what a path held
;; BEFORE the ticket's accepted parcel commit changed it, with no revert of
;; that parcel commit on this branch explaining the rollback.
;;
;; On 2026-08-27 e52261521 ("recovery: restore swarmforge-architect's full
;; tree tracking") rebuilt a collapsed tree from verified on-disk content -
;; for seven of those paths the on-disk content was itself stale
;; (pre-BL-592), so the recovery froze the staleness into a commit that
;; reads as a repair. Three existing defences all read clean on this shape:
;; `git log --oneline` shows a "recovery: ..." subject, not a revert; the
;; deletion-diff quarantine lift returns zero (every path is PRESENT, only
;; its content is stale); and BL-1098's silent-revert predicate excuses it
;; BY CONSTRUCTION - its first conjunct is `(not tip-matches-newest-
;; authoring?)`, and after a bulk restore the tip DOES match its newest
;; authoring commit exactly. This gate asks a different, narrower question
;; that none of the three answer: did the specific content a specific
;; accepted parcel commit landed survive to this send, regardless of which
;; commit most recently touched the path or how clean the tree diff reads.
;;
;; Discriminator (invariant 2): tip content byte-identical to the parcel
;; commit's PARENT blob for that path, with no `git revert`/`git revert -m
;; 1` of the parcel commit reachable on this branch since it landed. A
;; revert on this branch stays legal (BL-490/BL-495 bounce reverts must
;; keep working); later work authoring genuinely different content for the
;; same path is never a finding - only an unexplained return to the exact
;; pre-parcel bytes is. Ancestry is never consulted as truth (the parcel
;; commit IS an ancestor of every damaged branch and its content is gone
;; from all three anyway - the same lesson BL-1211 records); only the tip
;; blob and the branch's own revert history decide.
;;
;; Fail-open on unreadable facts (scenario 04), same posture as the four
;; existing send-time gates in swarm_handoff.bb (ticket_close_guard_lib.bb,
;; duplicate_chain_guard_lib.bb, pre_qa_gate_lib.bb,
;; task_commit_coherence_gate_lib.bb): a gate against silent destruction of
;; landed work must never itself wedge every hop in the swarm on an
;; unrelated git hiccup. No recorded parcel commit at all (a fresh task
;; with nothing yet received, same as review_forward_evidence_gate_lib.bb's
;; own coder exclusion) is silent - not a warning - since it is the
;; ordinary case, not a fact-reading failure.
;;
;; Bounded by the paths the parcel commit itself touched (diff-tree), never
;; a full-tree walk (constraints: "Do NOT extend the gate to paths no
;; accepted parcel commit touched").

(ns parcel-rollback-guard-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

(defn- received-parcel-commit-for-task
  "sender's received parcel commit for task-name, or nil - the newest
   in_process git_handoff parcel whose task matches (batch roles hold
   several in-process tasks at once; handoff-files' own sort makes `last`
   the newest). Mirrors review-forward-evidence-gate-lib's own
   received-commit-for-task (BL-806): fails open (nil) on every 'nothing to
   check against' shape - unknown role, no mailbox, no matching parcel, a
   matching parcel with no commit header."
  [root sender task-name]
  (when-let [role-info (handoff-lib/load-role-info sender root)]
    (when-let [file (->> (handoff-lib/handoff-files (handoff-lib/mailbox-dir role-info :in_process))
                          (filter (fn [f]
                                    (and (= "git_handoff" (handoff-lib/header-field f "type"))
                                         (= task-name (handoff-lib/header-field f "task")))))
                          last)]
      (handoff-lib/header-field file "commit"))))

(defn- full-sha [root ref]
  (let [{:keys [exit out]} (git! root "rev-parse" ref)]
    (when (zero? exit) (str/trim out))))

(defn- changed-paths
  "Paths parcel-commit touched (diff-tree, no-commit-id, name-only, -r), or
   nil when the commit cannot be read at all."
  [root parcel-commit]
  (let [{:keys [exit out]} (git! root "diff-tree" "--no-commit-id" "--name-only" "-r" parcel-commit)]
    (when (zero? exit)
      (remove str/blank? (str/split-lines out)))))

(defn- blob-at
  "The blob sha ref holds at path, or nil - covers both 'ref/path
   unreadable' and 'path did not exist at ref' identically, since both mean
   there is no pre-parcel (or no tip) content to compare against."
  [root ref path]
  (let [{:keys [exit out]} (git! root "rev-parse" (str ref ":" path))]
    (when (zero? exit) (str/trim out))))

(defn- revert-of-commit-on-branch?
  "True when some commit reachable from canonical, since parcel-commit,
   carries the standard `This reverts commit <full-sha>` body both
   `git revert` and `git revert -m 1` produce for parcel-full-sha - the
   BL-490/BL-495 bounce-revert convention itself, never a second revert
   mechanism. -F (fixed string), never a regex compile of commit text. A
   git failure here (corrupt range, etc.) resolves to false - the more
   cautious side for a gate protecting landed work, and distinct from the
   TRUE fail-open cases below (which never reach this call)."
  [root canonical parcel-commit parcel-full-sha]
  (let [{:keys [exit out]} (git! root "log" (str parcel-commit ".." canonical)
                                 (str "--grep=This reverts commit " parcel-full-sha)
                                 "-F" "--format=%H")]
    (and (zero? exit) (not (str/blank? (str/trim out))))))

(defn path-rolled-back?
  "Pure (BL-654-style property target): true only when the tip blob is
   BYTE-IDENTICAL to the parcel commit's PARENT blob for that path AND no
   revert explains it. parent-blob nil (the parcel commit introduced the
   path - nothing 'pre-parcel' to roll back to) is never a finding.
   tip-blob nil (the path is now deleted) is never a finding here either -
   deletion-shaped loss is BL-1205's gate, not this one."
  [{:keys [tip-blob parent-blob reverted?]}]
  (boolean (and tip-blob parent-blob (= tip-blob parent-blob) (not reverted?))))

(defn findings-for-git-handoff
  "The one impure entry point. Returns {:findings [{:path :parcel-commit}]}
   on a clean read (possibly empty), or {:warning \"...\"} when a recorded
   parcel commit exists but could not be resolved (scenario 04) - never
   both, and a missing/no-op recorded commit (no parcel yet received)
   yields {:findings []} silently, not a warning."
  [{:keys [root sender task-name canonical]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
        parcel-commit (received-parcel-commit-for-task root sender task-name)
        unreadable-warning (delay {:warning (str "parcel-rollback check could not run for " task-ticket-id
                                                  " (parcel commit " parcel-commit " unreadable) - send allowed, unverified (BL-1213)")})]
    (if-not parcel-commit
      {:findings []}
      (if-let [parcel-full-sha (full-sha root parcel-commit)]
        (if-let [paths (changed-paths root parcel-commit)]
          (let [reverted? (revert-of-commit-on-branch? root canonical parcel-commit parcel-full-sha)
                findings (for [path paths
                               :let [tip-blob (blob-at root canonical path)
                                     parent-blob (blob-at root (str parcel-commit "^") path)]
                               :when (path-rolled-back? {:tip-blob tip-blob :parent-blob parent-blob :reverted? reverted?})]
                           {:path path :parcel-commit parcel-commit})]
            {:findings (vec findings)})
          @unreadable-warning)
        @unreadable-warning))))

(defn blocked? [{:keys [findings]}]
  (boolean (seq findings)))

(defn refusal-message
  [{:keys [task-name findings]}]
  (let [paths (map :path findings)
        parcel-commit (:parcel-commit (first findings))]
    (format (str "Cannot send git_handoff for %s: this branch's tip holds pre-parcel "
                 "content for %s (%s) - accepted commit %s changed it but no revert of "
                 "that commit explains the rollback on this branch (BL-1213). If this is "
                 "a deliberate BL-490/BL-495 bounce revert, revert the parcel commit "
                 "properly; otherwise the branch has silently lost landed work and needs "
                 "the content restored before this send.")
          task-name
          (if (= 1 (count paths)) "one path" (format "%d paths" (count paths)))
          (str/join ", " paths)
          parcel-commit)))
