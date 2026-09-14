;; BL-1565: swarm_handoff.bb must refuse ANY git_handoff addressed to the
;; coordinator before it ever reaches a mailbox. The coordinator holds no
;; code worktree (Article 1.1) and never integrates; Article 2.4 makes a
;; `non-forwarding: true` inbound merge-only ("merge, then
;; done_with_current"), and the terminal stamp (BL-1536) already marks a
;; QA-to-coordinator forward that way. There is nothing for the coordinator
;; to merge, so it completes the parcel and waits for a close that already
;; arrived - BL-1527 (parcel 002673, 2026-09-13) and BL-1563 (parcel 002698,
;; 2026-09-14) each starved the whole mono-router swarm at
;; active_backlog_max_depth 1 this way until an operator hand-note named the
;; parcel as the close. The QA close is a `note` (Article 2.2); this refuses
;; the git_handoff shape at send instead of relying on every prose site and
;; every sender to keep remembering that by hand.
;;
;; Pure - no I/O - so `swarm_handoff.bb`'s live sender can call `decide`
;; directly (twice: on the literal draft header, and again on the
;; post-routing recipient set - BL-606 required_stages routing can rewrite
;; `to:` before a parcel is ever written) and a step handler can drive the
;; same function with no fixture root, no tmux, no roles.tsv (the bl1536
;; handler shape).
;;
;; Loaded via load-file; refer as git-handoff-recipient-guard-lib/<name>.

(ns git-handoff-recipient-guard-lib)

(def refusal-message
  (str "git_handoff refused: the coordinator holds no code worktree and "
       "integrates nothing (Article 1.1). QA's post-land close reaches it "
       "as a note instead - message `type: note` / "
       "`QA-approved <task> landed <sha> - bookkeep to done`."))

(defn decide
  "{:type :recipients} -> {:decision :refuse :message ...} when type is
   \"git_handoff\" and \"coordinator\" is among recipients - alone or among
   others, in any position, whatever the sender or how recipients got here
   (a literal draft `to:` header or a post-routing recipient set).
   {:decision :allow} otherwise: a `note`/`awake`/`rule_proposal` to the
   coordinator, and a git_handoff to any other role (including the
   specifier), are unaffected."
  [{:keys [type recipients]}]
  (if (and (= "git_handoff" type)
           (some #(= "coordinator" %) recipients))
    {:decision :refuse :message refusal-message}
    {:decision :allow}))
