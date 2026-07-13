;; BL-281 (reshaped 2026-07-11, bridge-client architecture): pure
;; per-launch dispatch logic for the Operator runtime's Telegram-sourced
;; SUP-### wakes. The runtime NEVER talks to Telegram directly any more -
;; the Front Desk Bot (extension/src/tools/telegram-front-desk-bot.ts) owns
;; all Telegram specifics (topic<->SUP-### mapping, the principal filter,
;; forum-topic demux) as a bridge CLIENT; the bridge's new POST inbound-
;; message route ingests already-resolved {SUP-### id, text} and enqueues
;; the SAME TELEGRAM_TOPIC_MESSAGE event shape into
;; .swarmforge/operator/events.jsonl this file's functions consume. This
;; keeps the runtime's own job exactly what it was before the reshape:
;; decide WHICH pending subject to dispatch next, and load ONLY that
;; subject's transcript - never how those events got there.
(ns telegram-topic-lib)

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

;; ── BL-334 restricted-front-desk-operator-06: front-desk's own dispatch ──

(defn select-front-desk-dispatch-batch
  "The front-desk Operator's counterpart to select-dispatch-batch: it has no
   authority over non-human-facing events (AGENT_EXITED, TASK_ARRIVED, ...),
   so it claims ONLY TELEGRAM_TOPIC_MESSAGE events - at most one subject
   (oldest thread first, same ordering rule as select-dispatch-batch) - and
   leaves EVERY other pending event, including any OTHER Telegram subject,
   completely untouched in :remaining for the full Operator's own normal
   path once it is free. Never mixes in select-dispatch-batch's `other`
   events the way that function's own :dispatch does."
  [pending-events]
  (let [is-telegram? #(= (:type %) "TELEGRAM_TOPIC_MESSAGE")
        telegram (filter is-telegram? pending-events)
        other (remove is-telegram? pending-events)
        by-thread (group-by :subject telegram)
        thread-ids-in-order (distinct (map :subject telegram))
        dispatch-thread-id (first thread-ids-in-order)
        dispatch-telegram (get by-thread dispatch-thread-id [])
        remaining-telegram (mapcat #(get by-thread %) (rest thread-ids-in-order))]
    {:dispatch (vec dispatch-telegram)
     :remaining (vec (concat other remaining-telegram))}))

;; ── reply context — telegram-topic-03 / telegram-topic-04 ────────────────

(defn reply-context-for
  "Reads ONLY the named thread's transcript via the injected :read-thread!
   adapter - never any other thread's. This is the structural guarantee
   behind telegram-topic-04 (parallel subjects stay independent): a wake
   for one SUP-### id can only ever request that one id's data."
  [thread-id adapters]
  ((:read-thread! adapters) thread-id))
