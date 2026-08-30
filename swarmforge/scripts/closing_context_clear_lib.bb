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
;;
;; Hotfix 2026-08-30 (human): also require a known context-window fullness
;; at or above the threshold (default 75%) before /clear. Same fail-closed
;; posture as BL-1238 / BL-141 — if fullness-percent is nil/unknown, do NOT
;; clear. Prevents Anthropic agents from paying a full prefix reload when
;; the window is mostly empty (or when we cannot tell).
(ns closing-context-clear-lib)

(def default-fullness-threshold-percent 75)

(defn new-close?
  "True when closed-ticket-id is present AND differs from
   last-cleared-ticket-id - a nil/absent last-cleared-ticket-id means
   \"never cleared before\", so the first close ever is always new. A nil
   closed-ticket-id (nothing has ever closed - an empty backlog/done/)
   is never new, since there is nothing to clear for."
  [closed-ticket-id last-cleared-ticket-id]
  (boolean (and closed-ticket-id (not= closed-ticket-id last-cleared-ticket-id))))

(defn fullness-allows-clear?
  "True only when fullness-percent is a real number at or above
   threshold-percent. nil/non-number = cannot tell = refuse (fail-closed)."
  [fullness-percent threshold-percent]
  (boolean (and (number? fullness-percent)
                (>= fullness-percent threshold-percent))))

(defn decide-context-clear
  "The whole decision, pure: clear only at the intersection of the role
   being idle (no in-process task, no pending inbox item) AND the most
   recent bookkeeping close being one this role has not already been
   cleared for AND the context window being known-and-full-enough.
   Returns {:action :clear|nil}."
  [{:keys [idle? new-close? fullness-percent threshold-percent]
    :or {threshold-percent default-fullness-threshold-percent}}]
  {:action (if (and idle?
                    new-close?
                    (fullness-allows-clear? fullness-percent threshold-percent))
             :clear
             nil)})

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
   state (:idle?, :closed-ticket-id, :last-cleared-ticket-id, :role-name,
   :fullness-percent, optional :threshold-percent) decides whether to clear
   and, if so, performs it through the injected adapters IN ORDER -
   :inject-clear! (fn []), then :inject-startup-reread! (fn [instruction-text]),
   then :record-clear! (fn [ticket-id]) so a crash between clear and record
   simply re-clears (harmless/idempotent from the agent's point of view)
   rather than ever silently skipping the startup re-read. Returns
   {:action :clear|nil}."
  [{:keys [idle? closed-ticket-id last-cleared-ticket-id role-name
           fullness-percent threshold-percent]
    :or {threshold-percent default-fullness-threshold-percent}}
   adapters]
  (let [decision (decide-context-clear
                  {:idle? idle?
                   :new-close? (new-close? closed-ticket-id last-cleared-ticket-id)
                   :fullness-percent fullness-percent
                   :threshold-percent threshold-percent})]
    (when (= :clear (:action decision))
      ((:inject-clear! adapters))
      ((:inject-startup-reread! adapters) (startup-reread-instruction role-name))
      ((:record-clear! adapters) closed-ticket-id))
    decision))
