#!/usr/bin/env bb
;; rescue_lib.bb — BL-1041: the PURE decisions behind rescuing orphaned work.
;;
;; Work escapes onto no branch - a stash entry with no worktree, files loose in
;; a tree - and eventually someone rescues it. On 2026-08-22 a rescue applied a
;; reviewed-sound BL-981 fix into .worktrees/coder and dropped the stash entry
;; in the SAME operation, so for about an hour the only two copies were a dirty
;; working tree and an evidence file a specifier had happened to write by hand.
;; A `git restore`, a crash sweep or a worktree reset in that window would have
;; destroyed work that had already been flagged twice as at risk.
;;
;; The rescue was well-intentioned and the work genuinely needed rescuing. The
;; defect is that it moved the work from a durable-if-obscure place to a
;; volatile one and destroyed the original in the same step. A rescue that can
;; lose the thing it rescued is not yet a rescue.
;;
;; It also told nobody, which guarantees a wasted turn downstream: a role may
;; not sweep changes it did not make, so it can neither commit them (not its
;; ticket) nor remove them (not its file) nor proceed cleanly past them.
;;
;; Everything here is a function of data. rescue_orphaned_work.bb does the git.
;;
;; Note deliberately NOT extending salvage_lib.bb: that salvages HANDOFFS -
;; abandoning stale parcels and re-injecting at a stage - not orphaned CODE.

(ns rescue-lib
  (:require [clojure.string :as str]))

;; ── invariant 1: durability ───────────────────────────────────────────────

(defn source-release-allowed?
  "Pure, and the whole of invariant 1: may the SOURCE copy be dropped yet?

   Only when all three hold. Each rules out a way the 2026-08-22 rescue could
   have lost the work:
     :commit-sha        - something was actually committed;
     :branch            - it is reachable from a ref. A dangling commit is
                          exactly as recoverable as the stash was, which is to
                          say only by someone who already knows to look;
     :content-verified? - the commit's CONTENT was read back and matches. A
                          subject line naming a ticket proves nothing about
                          what is inside (the gate that ships this repo's
                          `pre_qa_gate` false positives is the same mistake)."
  [{:keys [commit-sha branch content-verified?]}]
  (boolean (and commit-sha
                (not (str/blank? (str commit-sha)))
                branch
                (not (str/blank? (str branch)))
                content-verified?)))

(defn rescue-required?
  "Pure: is this a rescue at all? Only when work is placed in a worktree by
   someone OTHER than the role that owns it. A role committing its own work in
   its own worktree is the ordinary path and must trigger nothing (scenario
   04) - a rescue mechanism that fires on normal commits would be worse than
   the defect it fixes."
  [{:keys [actor worktree-role]}]
  (boolean (and actor worktree-role (not= actor worktree-role))))

;; ── the plan, whose ORDER is the invariant ────────────────────────────────

(defn rescue-plan
  "Pure: the ordered steps of a rescue. The order IS the safety property, so it
   is returned as data that a test can assert over rather than left implicit in
   the CLI's control flow - which is where the original mistake lived.

   `:release-source` carries a GUARD naming the decision above rather than
   running unconditionally, so a caller cannot reach it by falling through."
  [{:keys [role paths reason]}]
  [{:step :stage        :paths paths}
   {:step :commit       :role role :reason reason}
   {:step :verify       :detail "read the content back OUT of the commit"}
   {:step :release-source :guard :source-release-allowed?}
   {:step :notify       :role role :reason reason}])

;; ── invariant 2: the owner of a touched worktree is told ──────────────────

(def ^:private message-cap 80)

(defn notification-draft
  "Pure: the `note` telling a role what landed in its worktree and why.

   The 80-character cap is not cosmetic. swarm_handoff.sh REFUSES a draft whose
   `message` exceeds it and prints its usage block instead of sending, so an
   over-long draft does not notify anyone - which is precisely the harm this
   invariant exists to prevent. The commit sha is kept whatever else is
   dropped: it is the part that lets the owner read the content for themselves.

   Paths are summarised by COUNT rather than listed, and the count is always
   stated - a silently shortened list reads as complete."
  [{:keys [role paths reason commit-sha]}]
  (let [n (count paths)
        head (str "rescued " n " file(s) into your worktree as " commit-sha)
        with-reason (str head " - " (str/trim (str reason)))
        message (if (<= (count with-reason) message-cap)
                  with-reason
                  ;; Trim the REASON, never the sha: the sha is what makes the
                  ;; note actionable, the reason is context.
                  (let [room (- message-cap (count head) 4)]
                    (if (pos? room)
                      (str head " - " (subs (str/trim (str reason)) 0 (min room (count (str/trim (str reason))))))
                      head)))]
    {:type "note"
     :to role
     :priority "00"
     :message (if (<= (count message) message-cap) message (subs message 0 message-cap))}))
