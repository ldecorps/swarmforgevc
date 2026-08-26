;; BL-275: pure decision/composition logic for the Support MVP (slice 1 of
;; the Support role epic, BL-274) - thread-store operations (id assignment,
;; create, append) and email-echo composition, kept reachable without live
;; fs/tmux/network (constitution testability boundary), mirroring
;; operator_lib.bb's own purity and briefing_email_lib.bb's build-subject/
;; body-builder split. The real thread-store fs adapters live in
;; support_thread.bb; the disposable-LLM launch loop lives in
;; support_runtime.bb - both `load-file` this lib and inject their real
;; adapters into the functions below.
(ns support-lib
  (:require [clojure.string :as str]))

;; ── id assignment (pure) ──────────────────────────────────────────────────

(defn parse-thread-number
  "\"SUP-42\" -> 42; nil for anything that does not match."
  [id]
  (when-let [[_ n] (re-matches #"SUP-(\d+)" (str id))]
    (parse-long n)))

(defn next-thread-id
  "Next SUP-### id given the existing ones (any order, any shape survives -
   non-matching entries are ignored) - SUP-1 when none exist yet."
  [existing-ids]
  (->> existing-ids
       (keep parse-thread-number)
       (apply max 0)
       inc
       (str "SUP-")))

;; ── thread store (pure) ────────────────────────────────────────────────────
;; Thread shape: {:id "SUP-3" :status "open" :messages [{:channel :timestamp :text}...]}

(defn new-message [channel timestamp text]
  {:channel channel :timestamp timestamp :text text})

(defn new-thread
  "A freshly opened thread - always status \"open\". Support-mvp-01."
  [id channel timestamp text]
  {:id id :status "open" :messages [(new-message channel timestamp text)]})

(defn append-message
  "Appends a follow-up message to an existing thread (support-mvp-03).
   Status is left UNCHANGED by construction - appending never closes a
   thread (support-mvp-04); the autonomous 3-strike close is BL-276, not
   built in this slice."
  [thread channel timestamp text]
  (update thread :messages (fnil conj []) (new-message channel timestamp text)))

(defn record-interaction!
  "The whole open-or-follow-up decision, adapter-injected (mirrors
   briefing_generation_schedule_lib.bb's generate-briefing-if-due! shape) so
   it is directly testable with fake :read-thread!/:write-thread!/
   :list-existing-ids! adapters - no real fs touched in this pure lib.
   thread-id nil means \"open a new discussion\" (support-mvp-01); a real id
   means \"follow up on that thread\" (support-mvp-03). Returns the
   persisted thread."
  [thread-id channel timestamp text adapters]
  (let [thread (if thread-id
                 (append-message ((:read-thread! adapters) thread-id) channel timestamp text)
                 (new-thread (next-thread-id ((:list-existing-ids! adapters))) channel timestamp text))]
    ((:write-thread! adapters) thread)
    thread))

;; ── lifecycle (pure) — BL-276: status, no self-close, idle nudge ─────────

(defn resolve-thread
  "The ONLY closing transition this epic builds: a human-CONFIRMED
   resolution (thread-lifecycle-02). Every caller of this function is
   itself triggered by an explicit human confirmation, never a timer/idle
   decision - idle-nudge-decision below has no code path into this
   function, which IS thread-lifecycle-01's own guarantee (the Operator
   never closes a thread of its own will, even after long silence)."
  [thread]
  (assoc thread :status "resolved"))

;; A day - named + trivially tunable, matching BL-273's own
;; DEFAULT_BURN_RATE_WINDOW_MS convention for a similar "one named
;; constant, not a magic number sprinkled at each call site" ask.
(def default-idle-nudge-threshold-ms (* 24 60 60 1000))

;; "operator" is the ONE channel record-interaction!/append-message never
;; write for an inbound message (support_thread.bb/the bridge's inbound
;; route always pass a human channel: "rc" or "telegram") - only the
;; Operator's own reply/nudge path (operator_reply.bb) tags a message this
;; way, so this is an unambiguous "who spoke" signal already present in
;; the transcript, no separate flag needed.
(def operator-channel "operator")

(defn- human-message? [message]
  (not= (:channel message) operator-channel))

(defn- parse-iso-ms [iso]
  (.toEpochMilli (java.time.Instant/parse iso)))

(def idle-nudge-text
  "Just checking in - still here whenever you're ready to continue.")

(defn idle-nudge-decision
  "Pure, injected-clock (thread-lifecycle-01/03/04): decides whether a
   gentle idle nudge is due for an OPEN thread. Idle is counted from the
   human's LAST participation (any non-\"operator\"-channel message), never
   from the thread's creation or the Operator's own messages - resets the
   moment the human replies (thread-lifecycle-04). A nudge already posted
   (an \"operator\" message) AFTER the human's last word means the runtime
   is already waiting on them - never a second nudge until they reply
   again (thread-lifecycle-03's own \"one gentle daily nudge\", not a
   repeating spam). Returns :none or :post-nudge - there is no :close
   outcome; this function structurally cannot close a thread (thread-
   lifecycle-01)."
  [thread now-ms]
  (let [human-times (keep (fn [m] (when (human-message? m) (parse-iso-ms (:timestamp m)))) (:messages thread))]
    (if (empty? human-times)
      :none
      (let [last-human-ms (apply max human-times)
            already-nudged? (some (fn [m] (and (not (human-message? m)) (> (parse-iso-ms (:timestamp m)) last-human-ms)))
                                   (:messages thread))]
        (cond
          already-nudged? :none
          (>= (- now-ms last-human-ms) default-idle-nudge-threshold-ms) :post-nudge
          :else :none)))))

;; ── proactive notice (pure) — BL-284: NOTIFY slice ────────────────────────
;; Mirrors idle-nudge-decision's own shape: a pure, adapter-free gate over
;; provided inputs. Unlike the idle nudge (which derives its own due/not-due
;; call from message timestamps), a proactive notice concerns a SUBJECT
;; whose status changed elsewhere - detecting WHETHER something changed is
;; explicitly out of this slice's scope (BL-239 run-narration rehoming is
;; deferred), so status-change is a caller-supplied descriptor
;; ({:changed? bool :summary text}) and this function only gates on it plus
;; the subject having an OPEN thread/topic - a resolved/nonexistent thread
;; never gets a notice (proactive-notify-03/04), and an unchanged
;; descriptor stays silent even for an open one (no spurious pings).

(defn proactive-notice-decision
  "Given a subject's thread (or nil) and a status-change descriptor, decides
   whether to raise exactly one proactive notice. Returns :notify or :none."
  [thread status-change]
  (if (and thread (= (:status thread) "open") (:changed? status-change))
    :notify
    :none))

(defn proactive-notice-text
  "The notice text for a status-change descriptor that decided :notify -
   just its own :summary, same 'composition stays pure, deciding WHAT to
   say is the caller's job' split as build-email-body's next-step/options."
  [status-change]
  (:summary status-change))

;; ── email echo composition (pure) — mirrors briefing_email_lib.bb's ────────
;; ── build-briefing-subject / append-content-block split ────────────────────

(defn thread-title
  "First non-empty line of the thread's OPENING message, truncated - the
   same \"first line as headline\" convention build-briefing-subject uses
   for a briefing file, applied here to the thread's opening message."
  [thread]
  (let [opening (-> thread :messages first :text)
        first-line (->> (str/split-lines (or opening ""))
                        (map str/trim)
                        (filter seq)
                        first)]
    (when first-line
      (if (> (count first-line) 60) (str (subs first-line 0 57) "...") first-line))))

(defn build-email-subject
  "Carries the thread's ticket id + a short title (support-mvp-02)."
  [thread]
  (str "[" (:id thread) "]" (when-let [title (thread-title thread)] (str " " title))))

(defn build-conversation-summary [thread]
  (str/join "\n" (map (fn [m] (str "[" (:channel m) " " (:timestamp m) "] " (:text m))) (:messages thread))))

(defn build-email-body
  "The 3-part body Support's email-of-record always carries (support-mvp-02):
   (1) a summary of the conversation so far, (2) the next step, (3) the
   options. next-step and options are supplied by the CALLER (the disposable
   Support LLM's own reasoning output) - this function only ASSEMBLES
   already-decided content, mirroring briefing_email_lib.bb's own
   build-briefing-subject/append-content-block split: composition stays
   pure, deciding WHAT to say is not this function's job."
  [thread next-step options]
  (str "Conversation so far:\n" (build-conversation-summary thread)
       "\n\nNext step: " next-step
       "\n\nOptions:\n" (str/join "\n" (map #(str "- " %) options))))

(defn assemble-email-echo [thread next-step options]
  {:subject (build-email-subject thread)
   :body (build-email-body thread next-step options)})

;; ── wake decision (pure) — mirrors operator_lib.bb's should-launch-operator? ──

(defn should-wake-support?
  "True when there is pending work and the disposable Support LLM is not
   already running. Mirrors operator_lib.bb's should-launch-operator? shape,
   trimmed to this slice's skeleton scope - no provider-cooldown gate here;
   the Operator's cooldown detection scans SWARM agent panes, and Support
   has no swarm agents to scan."
  [{:keys [llm-running? pending-count]}]
  (and (not llm-running?) (pos? pending-count)))

;; ── coordinator handoff (pure + adapter-injected) — BL-283 ────────────────
;; The bridge between a subject thread and the swarm's build pipeline: the
;; Operator files an intake + coordinator note referencing the subject
;; (never creates/specs/promotes the ticket itself - the coordinator owns
;; that), and records the resulting ticket(s) the thread spawned. Later,
;; check-linked-ticket-status! reuses proactive-notice-decision/
;; proactive-notice-text (BL-284, unchanged) to report the linked ticket's
;; status back into the SAME topic, over the SAME reply-outbox path - no
;; second notice mechanism.

(defn link-ticket
  "Records a BL-### this thread's actionable discussion spawned - the ONE
   net-new thread field this ticket adds (mirrors resolve-thread's own
   one-line pure transition shape). A thread may link more than one ticket
   over its lifetime; linking the same id twice is a no-op, not a
   duplicate entry. :last-reported-status starts nil - nothing has been
   reported into the topic yet."
  [thread ticket-id]
  (if (some #(= (:id %) ticket-id) (:linked-tickets thread))
    thread
    (update thread :linked-tickets (fnil conj []) {:id ticket-id :last-reported-status nil})))

(defn record-linked-ticket-status
  "Updates ONLY the named linked ticket's own last-reported-status, leaving
   every other linked ticket (and the rest of the thread) untouched -
   called once a status notice for that ticket has actually been posted,
   so the same status is never reported twice (mirrors
   idle-nudge-decision's own 'already posted, do not repeat' guard)."
  [thread ticket-id status]
  (update thread :linked-tickets
          (fn [links] (mapv (fn [l] (if (= (:id l) ticket-id) (assoc l :last-reported-status status) l)) links))))

;; A slug filenames/note text can carry safely - thread ids are always a
;; short "SUP-<digits>" shape, so a plain lowercase is enough (no other
;; character ever needs stripping).
(defn build-intake-slug [thread]
  (str/lower-case (:id thread)))

(defn build-intake-content [thread]
  (str "# Intake: " (:id thread) "\n\n"
       "Filed by the Operator - a Telegram topic discussion became actionable.\n"
       "This is a PROPOSAL only: the coordinator owns specing/promoting/creating\n"
       "the resulting ticket; give it `source: " (:id thread) "` so the two stay linked.\n\n"
       "## Conversation so far\n\n"
       (build-conversation-summary thread) "\n"))

;; Kept well under swarm_handoff.bb's 80-char note-message limit regardless
;; of thread id length (SUP-### ids are always short) - never references
;; the intake file's own path, since the coordinator's inbox freshness
;; check alone is what wakes it (operator_runtime.bb's
;; coordinator-inbox-has-fresh?); the note only needs to name the subject.
(defn build-coordinator-note-message [thread]
  (str (:id thread) " actionable: intake filed for coordinator review"))

(defn hand-off-to-coordinator!
  "Adapter-injected (coordinator-handoff-01/02): files the intake + sends
   the coordinator note via the given adapters, then records the linked
   ticket and persists the thread. The adapters map is the ONLY side-effect
   surface this function can reach - :write-intake!/:send-coordinator-note!/
   :write-thread! and nothing else, so it is structurally impossible for
   this function to create, spec, or promote a backlog ticket itself
   (anti-fabrication - the coordinator owns that)."
  [thread ticket-id adapters]
  (let [intake-content (build-intake-content thread)
        note-message (build-coordinator-note-message thread)
        updated (link-ticket thread ticket-id)]
    ((:write-intake! adapters) (build-intake-slug thread) intake-content)
    ((:send-coordinator-note! adapters) note-message)
    ((:write-thread! adapters) updated)
    updated))

(defn status-change-for-linked-ticket
  "Pure compare: a linked ticket's CURRENT backlog status vs its own
   last-reported-status -> {:changed? :summary}, the exact shape
   proactive-notice-decision/proactive-notice-text (BL-284) already
   expect - no second 'changed' signal. A status never before reported
   (last-reported-status nil) is itself news the first time. A ticket
   that cannot currently be found anywhere (current-status nil - not yet
   created, or an id typo) is never reported as a change - nothing to say
   about it yet, never a fabricated one."
  [linked-ticket current-status]
  (if (and current-status (not= current-status (:last-reported-status linked-ticket)))
    {:changed? true :summary (str (:id linked-ticket) " is now " current-status ".")}
    {:changed? false :summary nil}))

(defn check-linked-ticket-status!
  "Adapter-injected (coordinator-handoff-03/04/05): for ONE linked ticket,
   derives its status-change descriptor (pure, above) via the injected
   :current-status! reader, then reuses proactive-notice-decision/
   proactive-notice-text UNCHANGED to decide whether to post - an unchanged
   status touches no adapter at all (coordinator-handoff-04: no notice, no
   write). On :notify, posts into the SAME reply-outbox/topic path BL-284's
   own operator_notify.bb already posts through (:post-notice!, given the
   thread's own id - coordinator-handoff-05: only ITS subject's topic),
   records the new last-reported status, and persists the thread. Returns
   {:posted? bool}."
  [thread linked-ticket adapters]
  (let [current ((:current-status! adapters) (:id linked-ticket))
        status-change (status-change-for-linked-ticket linked-ticket current)]
    (if (= :notify (proactive-notice-decision thread status-change))
      (let [text (proactive-notice-text status-change)
            updated (-> thread
                        (append-message operator-channel ((:now-iso! adapters)) text)
                        (record-linked-ticket-status (:id linked-ticket) current))]
        ((:post-notice! adapters) (:id thread) text)
        ((:write-thread! adapters) updated)
        {:posted? true})
      {:posted? false})))
