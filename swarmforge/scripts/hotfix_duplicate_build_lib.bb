;; hotfix_duplicate_build_lib.bb — BL-1885: finds a build already in flight
;; for a stamp-off ticket, the commit-msg-time gate that would have stopped
;; the 2026-10-02 BL-1877 duplicate (a hotfix landed while the coder's own
;; build of it sat unclaimed in QA's new/).
;;
;; Reuses handoff_lib.bb's own mailbox walkers (load-all-roles,
;; handoff-files[-with-batches], mailbox-dir, header-field,
;; non-forwarding?) and pipeline_stage_lib.bb's extract-ticket-id - never a
;; second parcel walker or ticket-id parser (BL-1811). The role-branch scan
;; and the main/abandoned_commits reads are this ticket's own, impure, kept
;; in this one file.

(ns hotfix-duplicate-build-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_gather_lib.bb")))

(defn- git-ok [root args]
  (let [r (process/sh (into ["git" "-C" (str root)] args))]
    (when (zero? (:exit r)) (str/trim (:out r)))))

(defn- ref-sha [root ref]
  (git-ok root ["rev-parse" "-q" "--verify" (str ref "^{commit}")]))

;; fail-open posture, same as check_closed_ticket_subject.sh's own
;; unreadable-origin-main handling: when main cannot be resolved at all,
;; a candidate commit is treated as unreadable and SKIPPED (never reported
;; as a blocker on the strength of a guess).
(defn- main-ref [root]
  (cond
    (ref-sha root "main") "main"
    (ref-sha root "origin/main") "origin/main"
    :else nil))

(defn- on-main? [root main-ref sha]
  (boolean (and main-ref sha
                (zero? (:exit (process/sh ["git" "-C" (str root) "merge-base" "--is-ancestor" sha main-ref]))))))

(defn- abandoned-commits-for-ticket [root ticket-id]
  (when-let [yaml-content (pre-qa-gate-gather-lib/find-ticket-yaml-content root ticket-id)]
    (let [field (pre-qa-gate-lib/read-abandoned-commits yaml-content)]
      (when (:present? field) (or (:items field) [])))))

(defn- abandoned-sha? [sha abandoned]
  (boolean (some #(str/starts-with? sha %) abandoned)))

(defn- git-handoff-task-ticket
  "ticket-id when file is a git_handoff whose task header resolves to it;
   nil otherwise. Mirrors duplicate_chain_guard_lib.bb's own predicate."
  [file]
  (when (= "git_handoff" (handoff-lib/header-field file "type"))
    (pipeline-stage-lib/extract-ticket-id (handoff-lib/header-field file "task"))))

(defn mailbox-blockers
  "Every live (new/ or in_process/, any role) git_handoff parcel for
   ticket-id whose own commit header is NOT on main - scenario 01. A
   non-forwarding (reverse-hop) copy is skipped, same exclusion
   duplicate_chain_guard_lib.bb's own walker applies."
  [root ticket-id main-ref]
  (vec
   (for [role-info (handoff-lib/load-all-roles root)
         state [:new :in_process]
         file ((if (= state :in_process)
                 handoff-lib/handoff-files-with-batches
                 handoff-lib/handoff-files)
               (handoff-lib/mailbox-dir role-info state))
         :let [sha (handoff-lib/header-field file "commit")]
         :when (and (= ticket-id (git-handoff-task-ticket file))
                    (not (handoff-lib/non-forwarding? file))
                    sha
                    (not (on-main? root main-ref sha)))]
     {:kind "mailbox" :role (:role role-info) :file (str (fs/file-name file)) :commit sha})))

(defn- commits-not-on-main [root main-ref branch]
  (when main-ref
    (when-let [out (git-ok root ["log" branch (str "^" main-ref) "--format=%H%x09%s"])]
      (->> (str/split-lines out)
           (remove str/blank?)
           (map (fn [line]
                  (let [[sha subject] (str/split line #"\t" 2)]
                    {:sha sha :subject (or subject "")})))))))

(defn role-branch-blockers
  "Every commit on a role's own branch (roles.tsv's session column) whose
   subject names ticket-id, that is not on main and not recorded in the
   ticket's own abandoned_commits - scenario 02."
  [root ticket-id main-ref abandoned]
  (vec
   (for [role-info (handoff-lib/load-all-roles root)
         :let [branch (:session role-info)]
         :when (not (str/blank? branch))
         {:keys [sha subject]} (commits-not-on-main root main-ref branch)
         :when (and (= ticket-id (pipeline-stage-lib/extract-ticket-id subject))
                    (not (abandoned-sha? sha abandoned)))]
     {:kind "branch" :role (:role role-info) :commit sha})))

(defn blockers-for-ticket
  "Every build already in flight for ticket-id - see mailbox-blockers and
   role-branch-blockers. [] when main cannot be resolved at all (fail
   open: never refuse a hotfix on the strength of an unreadable ref) or
   when nothing is in flight."
  [root ticket-id]
  (let [main-ref (main-ref root)]
    (if-not main-ref
      []
      (let [abandoned (or (abandoned-commits-for-ticket root ticket-id) [])]
        (vec (concat (mailbox-blockers root ticket-id main-ref)
                     (role-branch-blockers root ticket-id main-ref abandoned)))))))
