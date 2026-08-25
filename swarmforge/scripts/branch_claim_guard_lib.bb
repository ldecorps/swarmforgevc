;; BL-529: pre-turn guard - a pipeline worktree role's git branch must not
;; name a DIFFERENT ticket than the in-process claim before a turn begins.
;; Agents have spent whole turns on a stale ticket branch relative to the
;; active claim (live: coder worktree on BL-526 while the claim was BL-512);
;; bounce lineage failures are the same family. Pure decision logic only -
;; ready_for_next_task.bb wires this to real git, and the shell wiring test
;; (test_branch_claim_guard.sh) plus the BL-529 acceptance feature drive the
;; IO side. Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "branch_claim_guard_lib.bb")))
;; and referred to as branch-claim-guard-lib/foo.

(ns branch-claim-guard-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "branch_naming_lib.bb")))

(defn ticket-prefix
  "The leading BL-<digits> ticket id of a branch or claim task name, or nil
   when the name is not ticket-specific. Generic / role-standard branches
   (swarmforge-coder, main, the unified <swarm>/<role> namespace such as
   primary/coder) and non-ticket task names all yield nil. The id must be
   followed by a word boundary (end of string or a non-word char such as
   '-'), so a digits-then-letter run like BL-52x is NOT a ticket prefix."
  [s]
  (when (string? s)
    (second (re-matches #"(BL-\d+)\b.*" s))))

(defn guard-decision
  "The pure pre-turn branch/claim alignment decision.

   branch     - the worktree's current git branch name.
   claim-task - the in-process handoff's task header (the claim); nil for
                handoffs with no task header (e.g. a note).
   dirty?     - whether the worktree has uncommitted changes.

   Returns {:action :pass} when the branch is not ticket-specific, the claim
   names no ticket, or both name the SAME ticket - the turn proceeds on the
   current branch. A ticket branch naming a DIFFERENT ticket than the claim
   fires the guard: a clean worktree yields {:action :auto-checkout ...}
   (the caller checks out the role's standard branch, then proceeds), a
   dirty one {:action :refuse-requeue ...} (the caller requeues the claim to
   new/ and refuses the turn). dirty? is only consulted once a mismatch is
   established - it never turns a passing state into a refusal."
  [branch claim-task dirty?]
  (let [branch-ticket (ticket-prefix branch)
        claim-ticket (ticket-prefix claim-task)]
    (if (or (nil? branch-ticket) (nil? claim-ticket) (= branch-ticket claim-ticket))
      {:action :pass}
      (if dirty?
        {:action :refuse-requeue :branch-ticket branch-ticket :claim-ticket claim-ticket}
        {:action :auto-checkout :branch-ticket branch-ticket :claim-ticket claim-ticket}))))

(defn standard-branch-candidates
  "The role's standard (non-ticket) branch names to auto-correct onto, in
   preference order: the unified <swarm-name>/<role> namespace (BL-106)
   first, then the legacy swarmforge-<role> scheme pre-migration swarms
   still run. The caller probes the list against real refs and checks out
   the first that exists; main/master are deliberately NOT candidates -
   they are typically already checked out in another worktree, so git would
   refuse the switch."
  [swarm-name role]
  [(branch-naming-lib/derive-branch-name swarm-name role) (str "swarmforge-" role)])
