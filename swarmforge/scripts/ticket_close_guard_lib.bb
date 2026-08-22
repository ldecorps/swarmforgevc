;; BL-551 incident follow-up: keep backlog close, outbound git_handoffs, and
;; in-flight mailbox mail aligned. Pure decision + small fs helpers; callers
;; (commit_integrity_cli.bb, swarm_handoff.bb) own exit codes / user messages.
;;
;;  1. Close commits (active/ -> done/) require a QA git_handoff or note to
;;     coordinator referencing the same ticket id — never a coder bookkeeping
;;     note.
;;  2. swarm_handoff.bb refuses new git_handoffs for tickets already in
;;     backlog/done/ (see swarm_handoff.bb).
;;  3. After a successful close commit, abandon every role's new/ and
;;     in_process/ handoff whose task header matches the closed ticket
;;     (reuses salvage_lib.bb's abandon-stale!).

(ns ticket-close-guard-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "ticket_status_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "salvage_lib.bb")))

(defn ticket-id-from-backlog-path
  "Extract BL-551 / GH-22 from a backlog yaml path or filename."
  [path]
  (pipeline-stage-lib/extract-ticket-id (fs/file-name path)))

(defn parse-close-move
  "Returns a seq of {:ticket-id :active-path :done-path}, one entry per
   ticket whose active/ -> done/ move appears in paths - a close commit is
   a SET of tickets, and every layer of this guard must treat it as one
   (BL-869). Pairs each active/ path with the done/ path that shares its
   own ticket id, regardless of where either falls in paths - the old
   `(first (filter active))` / `(first (filter done))` shape silently
   collapsed a multi-ticket close to its first pair (fault B: an
   interleaved path order could even pair one ticket's active path with a
   DIFFERENT ticket's done path, fail the id match, and return nil - a
   multi-ticket close read as `{:allowed true}`, no validation at all).
   Entries are ordered by the position of their active/ path in paths.
   nil for a commit with no active->done pairing (ordinary commits)."
  [paths]
  (let [done-by-id (into {}
                          (keep (fn [p]
                                  (when (str/includes? p "backlog/done/")
                                    (when-let [id (ticket-id-from-backlog-path p)]
                                      [id p]))))
                          paths)]
    (seq
     (distinct
      (keep (fn [p]
              (when (str/includes? p "backlog/active/")
                (when-let [id (ticket-id-from-backlog-path p)]
                  (when-let [done-p (get done-by-id id)]
                    {:ticket-id id :active-path p :done-path done-p}))))
            paths)))))

(defn- coordinator-mailbox-handoffs [root]
  (when-let [coordinator (handoff-lib/load-role-info "coordinator" root)]
    (concat (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :completed))
            (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :new))
            (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :in_process)))))

(defn qa-approved-ticket?
  "True when coordinator's mailbox shows QA passed this ticket (git_handoff
   or note NAMING this ticket id among possibly several - Article 2.6 batch
   forwards - not just the first id the note happens to name; BL-869 fault
   A). Coder/architect bookkeeping notes do not qualify — from must be QA."
  [root ticket-id]
  (boolean
   (some (fn [file]
           (let [from (salvage-lib/header-field file "from")
                 typ (salvage-lib/header-field file "type")
                 task (salvage-lib/header-field file "task")
                 message (salvage-lib/header-field file "message")]
             (and (= "QA" from)
                  (contains? #{"git_handoff" "note"} typ)
                  (contains? (set (pipeline-stage-lib/ticket-ids-from-headers {:task task :message message}))
                             ticket-id))))
         (or (coordinator-mailbox-handoffs root) []))))

(defn validate-close-allowed
  "Returns {:allowed true :ticket-ids [...]} or {:allowed false :reason kw
   :ticket-ids [...] :blocked-ticket-ids [...]}, or {:allowed true} for a
   commit with no active->done move at all. Every ticket a close commit
   moves is validated independently (BL-869) - :ticket-ids names every
   ticket the commit closed, :blocked-ticket-ids only the ones that failed
   approval, so a partially-approved multi-ticket close names precisely
   the tickets still missing QA sign-off, not the whole set. The
   coordinator runs `git mv` before commit_integrity_cli, so a ticket may
   already appear under backlog/done/ on disk during a legitimate close —
   do not treat that as :already-done."
  [root paths]
  (if-let [closes (parse-close-move paths)]
    (let [ticket-ids (mapv :ticket-id closes)
          blocked (->> closes
                       (remove #(qa-approved-ticket? root (:ticket-id %)))
                       (mapv :ticket-id))]
      (if (seq blocked)
        {:allowed false :reason :missing-qa-approval :ticket-ids ticket-ids :blocked-ticket-ids blocked}
        {:allowed true :ticket-ids ticket-ids}))
    {:allowed true}))

(defn ticket-done?
  [root ticket-id]
  (= "done" (ticket-status-lib/current-status root ticket-id)))

(defn git-handoff-blocked-for-task?
  "True when a git_handoff draft's task header names a ticket already in
   backlog/done/."
  [root task]
  (when-let [ticket-id (pipeline-stage-lib/extract-ticket-id task)]
    (ticket-done? root ticket-id)))

(defn abandon-inflight-for-ticket!
  "Move every matching new/ and in_process/ handoff to abandoned/ across
   all roles. Returns the moved target paths (may be empty)."
  [root ticket-id]
  (salvage-lib/abandon-stale! root ticket-id))
