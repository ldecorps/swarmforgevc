;; BL-760: refuses a git_handoff send when the same ticket already has a live
;; parcel sitting in another role's mailbox — the send-time gate that would
;; have caught BL-727 forking into two concurrent pipeline chains under two
;; task names. Sibling to ticket_close_guard_lib.bb's done-ticket refusal;
;; wired into swarm_handoff.bb's validate the same way.
;;
;; Pure decision + small fs reads via handoff_lib.bb's own shared mailbox
;; walkers — no new ticket-id parser, no new mailbox walker (this ticket's
;; own explicit constraint): identity is pipeline-stage-lib/extract-ticket-id
;; equality, never salvage-lib/item-handoff?'s prefix match (that would let
;; ticket BL-72 block a send for BL-727).

(ns duplicate-chain-guard-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(defn- git-handoff-for-ticket?
  "True when file is a git_handoff parcel whose task header resolves to
   exactly ticket-id — never a prefix/substring match (BL-90 must never
   match BL-901)."
  [file ticket-id]
  (and (= "git_handoff" (handoff-lib/header-field file "type"))
       (= ticket-id (pipeline-stage-lib/extract-ticket-id (handoff-lib/header-field file "task")))))

(defn- live-parcel-for-ticket
  "The first other-role live (new/ or in_process/) git_handoff parcel for
   ticket-id, as {:role :file}, or nil. exclude-role is the sender: its own
   mailbox is never a blocker (BL-760 own-inbound-parcel-never-blocks-02) —
   the sender's inbound parcel is by definition the one it is acting on.
   Deterministic order: roles.tsv order, then new/ before in_process/, then
   filename order (handoff-lib/handoff-files' own sort) — a genuine
   duplicate reports the same blocker every time."
  [root ticket-id exclude-role]
  (some (fn [[role-info state]]
          (some (fn [file]
                  (when (git-handoff-for-ticket? file ticket-id)
                    {:role (:role role-info) :file file}))
                (handoff-lib/handoff-files (handoff-lib/mailbox-dir role-info state))))
        (for [role-info (handoff-lib/load-all-roles root)
              :when (not= (:role role-info) exclude-role)
              state [:new :in_process]]
          [role-info state])))

(defn blocking-parcel
  "{:ticket-id :role :file} when task-name's ticket already has a live parcel
   at another role's mailbox; nil when the send is unblocked. A task-name
   with no extractable ticket id (e.g. a tracer bullet) skips the guard
   silently, exactly like ticket-close-guard-lib/git-handoff-blocked-for-task?."
  [root task-name sender]
  (when-let [ticket-id (pipeline-stage-lib/extract-ticket-id task-name)]
    (when-let [{:keys [role file]} (live-parcel-for-ticket root ticket-id sender)]
      {:ticket-id ticket-id :role role :file file})))

(defn refusal-message
  "Names the ticket, the blocking role, the blocking parcel's filename, and
   the command that clears a genuinely stale blocker — a blocking gate must
   be clearable (BL-760 approval_context)."
  [{:keys [ticket-id role file]}]
  (format (str "Cannot send git_handoff for %s: a live parcel for this ticket "
               "already exists at %s (%s). If that parcel is genuinely stale, "
               "clear it first: redo_from.sh %s <stage>")
          ticket-id role (fs/file-name file) ticket-id))
