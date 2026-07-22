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
  "When paths include an active/ -> done/ move for the same ticket, returns
   {:ticket-id :active-path :done-path}. nil for ordinary commits."
  [paths]
  (let [active (first (filter #(str/includes? % "backlog/active/") paths))
        done (first (filter #(str/includes? % "backlog/done/") paths))]
    (when (and active done)
      (let [active-id (ticket-id-from-backlog-path active)
            done-id (ticket-id-from-backlog-path done)]
        (when (and active-id done-id (= active-id done-id))
          {:ticket-id active-id :active-path active :done-path done})))))

(defn- coordinator-mailbox-handoffs [root]
  (when-let [coordinator (handoff-lib/load-role-info "coordinator" root)]
    (concat (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :completed))
            (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :new))
            (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :in_process)))))

(defn qa-approved-ticket?
  "True when coordinator's mailbox shows QA passed this ticket (git_handoff
   or note with a matching ticket id). Coder/architect bookkeeping notes do
   not qualify — from must be QA."
  [root ticket-id]
  (boolean
   (some (fn [file]
           (let [from (salvage-lib/header-field file "from")
                 typ (salvage-lib/header-field file "type")
                 task (salvage-lib/header-field file "task")
                 message (salvage-lib/header-field file "message")]
             (and (= "QA" from)
                  (contains? #{"git_handoff" "note"} typ)
                  (= ticket-id
                     (pipeline-stage-lib/ticket-id-from-headers {:task task :message message})))))
         (or (coordinator-mailbox-handoffs root) []))))

(defn validate-close-allowed
  "Returns {:allowed true :ticket-id ...} or {:allowed false :reason kw
   :ticket-id ...}. Close moves require QA approval. The coordinator runs
   `git mv` before commit_integrity_cli, so a ticket may already appear under
   backlog/done/ on disk during a legitimate close — do not treat that as
   :already-done."
  [root paths]
  (if-let [close (parse-close-move paths)]
    (if (qa-approved-ticket? root (:ticket-id close))
      {:allowed true :ticket-id (:ticket-id close)}
      {:allowed false :reason :missing-qa-approval :ticket-id (:ticket-id close)})
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
