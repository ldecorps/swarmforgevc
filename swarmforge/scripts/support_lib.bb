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
