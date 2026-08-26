;; BL-309: pure decision module for clearing a role's tmux-pane session
;; context at the safe idle boundary right after it finishes a ticket's
;; bookkeeping close. Mirrors operator_lib.bb's BL-307
;; should-hibernate?/evaluate-closing-pass! shape exactly: pure predicates
;; take already-gathered state (no live tmux/fs reads in here), and the one
;; adapter-injected orchestration fn is the ONLY place the actual
;; inject-clear!/inject-startup-reread!/record-clear! actions happen, so a
;; test can spy on which actions ran without a real tmux socket.
;;
;; Scope (per the ticket): this predicate is written GENERICALLY (any role,
;; any "last close" identifier) but wired and verified for the coordinator
;; only in this ticket - the idle check itself reuses operator_lib.bb's
;; own role-idle? {:inbox-new-count :in-process-count} -> boolean shape,
;; computed by the caller and passed in as :idle?.
(ns closing-context-clear-lib)

(defn new-close?
  "True when closed-ticket-id is present AND differs from
   last-cleared-ticket-id - a nil/absent last-cleared-ticket-id means
   \"never cleared before\", so the first close ever is always new. A nil
   closed-ticket-id (nothing has ever closed - an empty backlog/done/)
   is never new, since there is nothing to clear for."
  [closed-ticket-id last-cleared-ticket-id]
  (boolean (and closed-ticket-id (not= closed-ticket-id last-cleared-ticket-id))))

(defn decide-context-clear
  "The whole decision, pure: clear only at the intersection of the role
   being idle (no in-process task, no pending inbox item) AND the most
   recent bookkeeping close being one this role has not already been
   cleared for. Returns {:action :clear|nil}."
  [{:keys [idle? new-close?]}]
  {:action (if (and idle? new-close?) :clear nil)})

(defn startup-reread-instruction
  "Literal text injected immediately after /clear (BL-309/BL-316).

   BL-519 inlines constitution+PIPELINE+role into claude
   --append-system-prompt-file at launch; that system prefix survives a
   conversation /clear without a respawn. The pre-BL-519 instruction that
   told the agent to Read constitution.prompt, PIPELINE.md, and
   roles/<role>.prompt therefore (a) fights the cacheable prefix and
   (b) left panes empty/Resident:unknown when that poke failed. Match the
   launch kickoff instead. role-name is kept for call-site compatibility
   but is not interpolated — the inlined role prompt already names the role."
  [role-name]
  (str "Your constitution, pipeline, and role are already loaded above via "
       "--append-system-prompt-file. Begin your role loop now; if idle, run "
       "ready_for_next.sh."))

(defn evaluate-closing-context-clear!
  "One tick's full evaluation, adapter-injected (mirrors
   operator_lib.bb's evaluate-closing-pass! shape): given the gathered pure
   state (:idle?, :closed-ticket-id, :last-cleared-ticket-id, :role-name)
   decides whether to clear and, if so, performs it through the injected
   adapters IN ORDER - :inject-clear! (fn []), then
   :inject-startup-reread! (fn [instruction-text]), then :record-clear!
   (fn [ticket-id]) so a crash between clear and record simply re-clears
   (harmless/idempotent from the agent's point of view) rather than ever
   silently skipping the startup re-read. Returns {:action :clear|nil}."
  [{:keys [idle? closed-ticket-id last-cleared-ticket-id role-name]} adapters]
  (let [decision (decide-context-clear
                  {:idle? idle?
                   :new-close? (new-close? closed-ticket-id last-cleared-ticket-id)})]
    (when (= :clear (:action decision))
      ((:inject-clear! adapters))
      ((:inject-startup-reread! adapters) (startup-reread-instruction role-name))
      ((:record-clear! adapters) closed-ticket-id))
    decision))
