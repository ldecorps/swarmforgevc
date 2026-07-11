;; BL-281: pure decision/composition logic for the Operator-hosted Telegram
;; forum-topic threads MVP (refocus of the Support epic, BL-274) - topic<->
;; SUP-### mapping, inbound demux, principal filtering, and the "load only
;; THIS thread's transcript" reply context, kept reachable without live
;; fs/network (constitution testability boundary). REUSES support_lib.bb's
;; thread-store functions (new-thread/append-message) unchanged - this file
;; adds topic-hosting logic on top, never a second thread-store
;; implementation (the ticket's own module boundary: "keep the pure SUP-###
;; store lib, host the poll/demux/wake in the operator runtime").
(ns telegram-topic-lib
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "support_lib.bb")))

;; ── principal filter (pure) — telegram-topic-05 ──────────────────────────

(defn from-principal?
  "True only when the inbound update's sender matches the configured
   principal Telegram user id - BL-239/240's own human-only posture,
   applied here by user id (message.from.id) rather than chat id."
  [update principal-user-id]
  (= (str (get-in update [:message :from :id])) (str principal-user-id)))

(defn topic-id-of [update]
  (get-in update [:message :message_thread_id]))

(defn message-text-of [update]
  (get-in update [:message :text]))

;; Pure: the next offset to pass to the next getUpdates poll so an already-
;; delivered update is never redelivered - Telegram's own "offset" contract
;; (the highest update_id seen so far, plus one), mirroring
;; telegramInboundRelay.ts's nextUpdateOffset exactly, for the Babashka side
;; of this same protocol.
(defn next-offset [updates current-offset]
  (reduce (fn [acc u] (max acc (inc (:update_id u)))) current-offset updates))

;; ── open a new subject: create topic + open a new SUP-### thread + map them ──
;; telegram-topic-01

(defn open-subject!
  "Adapter-injected (mirrors support_lib.bb's record-interaction! shape):
   :create-topic! (subject-name) -> topic-id
   :next-thread-id! () -> the next SUP-### id (the caller derives it from
     support-lib/next-thread-id against its own existing-id listing)
   :write-thread! (thread) -> persists the new thread
   :map-topic! (topic-id thread-id) -> persists the topic<->thread mapping
   Returns {:topic-id :thread}."
  [subject-name channel timestamp text adapters]
  (let [topic-id ((:create-topic! adapters) subject-name)
        thread-id ((:next-thread-id! adapters))
        thread (support-lib/new-thread thread-id channel timestamp text)]
    ((:write-thread! adapters) thread)
    ((:map-topic! adapters) topic-id thread-id)
    {:topic-id topic-id :thread thread}))

;; ── demux one inbound update — telegram-topic-02 / telegram-topic-05 ─────

(defn demux-inbound!
  "Adapter-injected. Rejects (nothing appended, no event) when the sender is
   not the principal, or when the update's topic has no mapped SUP-###
   thread. Otherwise appends the message to that thread (support-lib/
   append-message, via :read-thread!/:write-thread!) and enqueues a
   per-topic wake event. Returns {:accepted? bool :reason kw? :thread-id
   id?}."
  [update principal-user-id adapters]
  (cond
    (not (from-principal? update principal-user-id))
    {:accepted? false :reason :not-principal}

    :else
    (let [topic-id (topic-id-of update)
          thread-id ((:thread-for-topic! adapters) topic-id)]
      (if-not thread-id
        {:accepted? false :reason :unmapped-topic}
        (let [thread ((:read-thread! adapters) thread-id)
              updated (support-lib/append-message thread "telegram" ((:now-iso! adapters)) (message-text-of update))]
          ((:write-thread! adapters) updated)
          ;; :subject (not :thread-id) is deliberate - operator_lib.bb's
          ;; event-key/should-enqueue? dedup keys subject-bearing event
          ;; types by :subject (same convention as AGENT_EXITED/
          ;; HUMAN_COMMAND/TASK_ARRIVED), so a SECOND message on an
          ;; already-pending thread coalesces to one wake while a
          ;; DIFFERENT thread's message still survives as its own event.
          ((:enqueue-event! adapters) {:type "TELEGRAM_TOPIC_MESSAGE" :subject thread-id})
          {:accepted? true :thread-id thread-id})))))

;; ── reply context — telegram-topic-03 / telegram-topic-04 ────────────────

(defn reply-context-for
  "Reads ONLY the named thread's transcript via the injected :read-thread!
   adapter - never any other thread's. This is the structural guarantee
   behind telegram-topic-04 (parallel subjects stay independent): a wake
   for one SUP-### id can only ever request that one id's data."
  [thread-id adapters]
  ((:read-thread! adapters) thread-id))

;; ── top-level routing — telegram-topic-01 composed with -02/-05 ─────────

(defn route-update!
  "The one per-update entry point the runtime's poll sweep calls: an update
   posted OUTSIDE any topic (no message_thread_id) from the principal opens
   a NEW subject (telegram-topic-01) - the message's own text doubles as
   both the topic name and the thread's opening message, an MVP heuristic
   good enough for a short subject line. An update posted INSIDE a topic
   routes through demux-inbound! (telegram-topic-02/telegram-topic-05)
   unchanged. adapters is the union of open-subject!'s and demux-inbound!'s
   own adapter shapes."
  [update principal-user-id adapters]
  (if (and (from-principal? update principal-user-id) (nil? (topic-id-of update)))
    (let [text (message-text-of update)
          opened (open-subject! text "telegram" ((:now-iso! adapters)) text adapters)]
      {:accepted? true :opened? true :thread-id (:id (:thread opened)) :topic-id (:topic-id opened)})
    (demux-inbound! update principal-user-id adapters)))

;; ── per-launch dispatch batching — telegram-topic-04 ─────────────────────

(defn select-dispatch-batch
  "Given the full pending event list, selects AT MOST ONE Telegram
   subject's worth of events to dispatch this launch - telegram-topic-04's
   own \"a wake for one subject never sees the other's transcript\"
   guarantee, enforced at the DISPATCH boundary rather than left to the
   disposable LLM's own reading discipline. Every non-Telegram event
   dispatches together exactly as before (unchanged behavior for the
   Operator's existing event types - dead-agent/swarm-check/human-command
   etc.); TELEGRAM_TOPIC_MESSAGE events are grouped by :subject (the
   thread id) and only the OLDEST group is included in :dispatch - every
   other group is returned as :deferred, to be re-queued for a later tick
   rather than dropped or bled together into one wake."
  [pending-events]
  (let [is-telegram? #(= (:type %) "TELEGRAM_TOPIC_MESSAGE")
        telegram (filter is-telegram? pending-events)
        other (remove is-telegram? pending-events)
        by-thread (group-by :subject telegram)
        thread-ids-in-order (distinct (map :subject telegram))
        dispatch-thread-id (first thread-ids-in-order)
        dispatch-telegram (get by-thread dispatch-thread-id [])
        deferred (mapcat #(get by-thread %) (rest thread-ids-in-order))]
    {:dispatch (concat other dispatch-telegram)
     :deferred deferred}))

(defn send-topic-reply!
  "Looks up the topic mapped to thread-id (:topic-for-thread! adapter) and
   sends the reply into THAT topic (:send! adapter, called with topic-id +
   text) - never a bare/un-routed send. Returns nil when the thread has no
   mapped topic (should not happen for a thread opened via open-subject!,
   but never throws)."
  [thread-id text adapters]
  (when-let [topic-id ((:topic-for-thread! adapters) thread-id)]
    ((:send! adapters) topic-id text)))
