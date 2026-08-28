;; tree_collapse_guard_lib.bb — BL-1205: refuses a git_handoff whose merge
;; into a recipient role's branch would mass-delete that branch's tracked
;; files, whatever role the parcel is addressed to and whatever ticket (if
;; any) it names.
;;
;; On 2026-08-27 refs/heads/swarmforge-architect was collapsed to 79 tracked
;; paths by 200 test-fixture commits (subjects `init`, `seed`, `fixture:
;; initial`, all authored `t <t@t>` at the identical second). Each fixture
;; commit is a ~9,700-file deletion relative to the real tree, and every
;; later merge from cleaner honoured those deletions the ordinary way - one
;; side deleted, the other untouched, no conflict, no marker; the branch
;; looked like it was healing while merges were simply re-applying the
;; deletion each time. Simulating the very next hop the branch was queued
;; to make (`git merge-tree --write-tree swarmforge-hardender
;; swarmforge-architect`) produced a 93-path tree against the hardener's
;; 9,773 - one ordinary forward deletes 9,680 tracked files and is then
;; four ordinary hops from landing that on `main`.
;;
;; None of swarm_handoff.bb's four existing gates see this: pre_qa_gate_lib/
;; gate-armed? arms only for a send whose `to` includes QA and keys its
;; findings to a ticket id, so a deletion tied to no ticket crosses the
;; architect -> hardener hop - which has no gate at all - untouched.
;;
;; Signal: simulate the merge the recipient is about to perform
;; (`git merge-tree --write-tree <recipient-branch> <cited-commit>`) and
;; compare the resulting tree's path count against the recipient branch's
;; own, rather than inferring intent from the sender's diff - the same
;; simulation that confirmed the incident. Threshold (direction, not
;; mandate per the ticket): refuse when the merge would remove more paths
;; than the SMALLER of 5% of the recipient branch's own path count and 100
;; paths flat - today's 9,680 clears either bound by two orders of
;; magnitude; an ordinary directory-deletion refactor clears neither.
;;
;; Every recipient the handoff names is checked independently (invariant
;; 1: no hop is exempt, no ticket id required) - a mass-deletion finding
;; for ANY recipient refuses the whole send; an unreadable recipient
;; contributes a warning, never a refusal on its own (invariant 3: a guard
;; that cannot read what it needs warns and lets the send through). The
;; guard only ever reports; it never alters, rewrites, or reverts the
;; commit it is refusing (invariant 2) - no git write of any kind happens
;; here.

(ns tree-collapse-guard-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))

(def threshold-fraction 0.05)
(def threshold-absolute 100)

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

(defn- recipient-branch-ref
  "The recipient role's own branch ref, read from roles.tsv - this
   project's convention names a role's branch identically to its tmux
   session (:session), the same field roles.tsv already carries for every
   other purpose. nil when roles.tsv has no row for this role."
  [root recipient]
  (:session (handoff-lib/load-role-info recipient root)))

(defn- tree-path-count
  "Tracked path count at ref (a branch name or a tree sha alike - git
   ls-tree treats both identically), or nil when ref cannot be read."
  [root ref]
  (let [{:keys [exit out]} (git! root "ls-tree" "-r" "--name-only" ref)]
    (when (zero? exit) (count (remove str/blank? (str/split-lines out))))))

(defn- merged-tree-path-count
  "Path count of the tree that merging commit into branch-ref would
   produce, via a real, no-write `git merge-tree --write-tree` simulation -
   never a diff-based guess. nil when the simulation itself cannot run."
  [root branch-ref commit]
  (let [{:keys [exit out]} (git! root "merge-tree" "--write-tree" branch-ref commit)]
    (when (zero? exit)
      (when-let [tree-sha (first (remove str/blank? (str/split-lines (str/trim out))))]
        (tree-path-count root tree-sha)))))

(defn mass-deletion?
  "Pure (BL-654-style property target): true when removed exceeds the
   SMALLER of 5% of before and the flat 100-path cap. before <= 0 never
   refuses - there is nothing to protect on an empty/unreadable branch,
   and that shape is already routed to the warning path by the caller
   before this function is ever reached."
  [{:keys [before removed]}]
  (boolean
   (and (pos? before)
        (pos? removed)
        (> removed (min (* threshold-fraction before) threshold-absolute)))))

(defn- finding-for-recipient
  [root recipient commit]
  (let [branch-ref (recipient-branch-ref root recipient)]
    (if-not branch-ref
      {:warning (str "tree-collapse check could not run for " recipient
                     " (no roles.tsv branch entry) - send allowed, unverified (BL-1205)")}
      (let [before (tree-path-count root branch-ref)]
        (if-not before
          {:warning (str "tree-collapse check could not run - recipient branch "
                         branch-ref " for " recipient " could not be read - send allowed, unverified (BL-1205)")}
          (let [after (merged-tree-path-count root branch-ref commit)]
            (if-not after
              {:warning (str "tree-collapse check could not run - could not simulate the merge onto "
                             branch-ref " for " recipient " - send allowed, unverified (BL-1205)")}
              (let [removed (max 0 (- before after))]
                (when (mass-deletion? {:before before :removed removed})
                  {:finding {:recipient recipient :branch branch-ref
                             :before before :after after :removed removed}})))))))))

(defn findings-for-git-handoff
  "The one impure entry point. Checks EVERY recipient independently.
   Returns {:findings [...] :warnings [...]} - findings never empty implies
   blocked?, warnings are reported (never block) alongside either outcome."
  [{:keys [root recipients commit]}]
  (reduce
   (fn [acc recipient]
     (let [result (finding-for-recipient root recipient commit)]
       (cond-> acc
         (:finding result) (update :findings conj (:finding result))
         (:warning result) (update :warnings conj (:warning result)))))
   {:findings [] :warnings []}
   recipients))

(defn blocked? [{:keys [findings]}]
  (boolean (seq findings)))

(defn refusal-message
  [{:keys [findings]}]
  (str/join
   " "
   (for [{:keys [recipient branch before after removed]} findings]
     (format (str "Cannot send git_handoff to %s: merging the cited commit into %s "
                  "would remove %d of its %d tracked paths (leaving %d) - refused as a "
                  "mass-deletion forward (BL-1205). If this is genuinely intended, land it "
                  "by hand after confirming the recipient branch's health; if the recipient "
                  "branch is itself corrupt, it needs re-cutting from a known-good ref, not "
                  "a parcel routed through it.")
             recipient branch removed before after))))
