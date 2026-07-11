#!/usr/bin/env bb
;; TDD runner for telegram_topic_lib.bb (BL-281) - pure assertions only
;; (fake adapters, injected timestamps). No real fs, no real network, no
;; real timers.
(ns telegram-topic-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "telegram_topic_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def PRINCIPAL_ID 111)

(defn mk-update [{:keys [from-id thread-id text]}]
  {:message {:from {:id from-id} :message_thread_id thread-id :text text}})

;; ── from-principal? / topic-id-of / message-text-of (pure) ──────────────

(assert= "from-principal? true for the configured principal id"
         true (telegram-topic-lib/from-principal? (mk-update {:from-id PRINCIPAL_ID}) PRINCIPAL_ID))
(assert= "from-principal? false for anyone else"
         false (telegram-topic-lib/from-principal? (mk-update {:from-id 999}) PRINCIPAL_ID))
(assert= "topic-id-of reads message_thread_id" 7 (telegram-topic-lib/topic-id-of (mk-update {:thread-id 7})))
(assert= "message-text-of reads the message text" "hi" (telegram-topic-lib/message-text-of (mk-update {:text "hi"})))

(assert= "next-offset advances past the highest update_id seen"
         6 (telegram-topic-lib/next-offset [{:update_id 3} {:update_id 5}] 0))
(assert= "next-offset never goes backwards when updates is empty"
         6 (telegram-topic-lib/next-offset [] 6))

;; ── open-subject! (adapter-injected) — telegram-topic-01 ─────────────────

(defn mk-store []
  (let [threads (atom {})
        topics (atom {})]
    {:threads threads
     :topics topics
     :adapters
     {:create-topic! (fn [name] (str "topic-for-" name))
      :next-thread-id! (fn [] (support-lib/next-thread-id (keys @threads)))
      :write-thread! (fn [thread] (swap! threads assoc (:id thread) thread))
      :read-thread! (fn [id] (get @threads id))
      :map-topic! (fn [topic-id thread-id] (swap! topics assoc topic-id thread-id))
      :thread-for-topic! (fn [topic-id] (get @topics topic-id))
      :topic-for-thread! (fn [thread-id] (some (fn [[t th]] (when (= th thread-id) t)) @topics))
      :enqueue-event! (fn [_event] nil)
      :now-iso! (fn [] "2026-07-11T09:00:00Z")
      :send! (fn [_topic-id _text] nil)}}))

(let [store (mk-store)
      result (telegram-topic-lib/open-subject! "billing question" "telegram" "2026-07-11T09:00:00Z" "need help with billing" (:adapters store))]
  (assert= "BL-281 telegram-topic-01: a topic is created for the subject"
           "topic-for-billing question" (:topic-id result))
  (assert= "BL-281 telegram-topic-01: a new SUP-### thread is opened, mapped one-to-one to the topic"
           "SUP-1" (:id (:thread result)))
  (assert= "BL-281 telegram-topic-01: the thread is persisted"
           (:thread result) (get @(:threads store) "SUP-1"))
  (assert= "BL-281 telegram-topic-01: the topic<->thread mapping is persisted"
           "SUP-1" (get @(:topics store) "topic-for-billing question")))

;; ── demux-inbound! (adapter-injected) — telegram-topic-02 / -05 ─────────

(let [store (mk-store)
      opened (telegram-topic-lib/open-subject! "billing question" "telegram" "2026-07-11T09:00:00Z" "need help with billing" (:adapters store))
      topic-id (:topic-id opened)
      adapters (assoc (:adapters store) :now-iso! (fn [] "2026-07-11T09:05:00Z"))
      result (telegram-topic-lib/demux-inbound! (mk-update {:from-id PRINCIPAL_ID :thread-id topic-id :text "any update?"}) PRINCIPAL_ID adapters)]
  (assert= "BL-281 telegram-topic-02: an inbound message on a mapped topic is accepted"
           true (:accepted? result))
  (assert= "BL-281 telegram-topic-02: it demuxes to the topic's own SUP-### thread"
           "SUP-1" (:thread-id result))
  (assert= "BL-281 telegram-topic-02: the message is appended to that thread's transcript"
           2 (count (:messages (get @(:threads store) "SUP-1"))))
  (assert= "BL-281 telegram-topic-02: the appended message carries the telegram channel + text"
           {:channel "telegram" :timestamp "2026-07-11T09:05:00Z" :text "any update?"}
           (last (:messages (get @(:threads store) "SUP-1")))))

;; telegram-topic-05: non-principal is rejected, no event, nothing appended.
(let [store (mk-store)
      opened (telegram-topic-lib/open-subject! "billing question" "telegram" "2026-07-11T09:00:00Z" "need help with billing" (:adapters store))
      topic-id (:topic-id opened)
      events (atom [])
      adapters (assoc (:adapters store) :enqueue-event! (fn [e] (swap! events conj e)))
      result (telegram-topic-lib/demux-inbound! (mk-update {:from-id 999 :thread-id topic-id :text "let me in"}) PRINCIPAL_ID adapters)]
  (assert= "BL-281 telegram-topic-05: an update from a non-principal is rejected"
           false (:accepted? result))
  (assert= "BL-281 telegram-topic-05: the reason is not-principal" :not-principal (:reason result))
  (assert= "BL-281 telegram-topic-05: no event is enqueued" [] @events)
  (assert= "BL-281 telegram-topic-05: nothing is appended to the thread"
           1 (count (:messages (get @(:threads store) "SUP-1")))))

;; an update on an unmapped topic id is rejected too (no crash on an unknown topic).
(let [store (mk-store)
      result (telegram-topic-lib/demux-inbound! (mk-update {:from-id PRINCIPAL_ID :thread-id "topic-nobody-knows" :text "hi"}) PRINCIPAL_ID (:adapters store))]
  (assert= "an update on an unmapped topic is rejected, not a crash" false (:accepted? result))
  (assert= "the reason is unmapped-topic" :unmapped-topic (:reason result)))

;; ── reply-context-for / send-topic-reply! — telegram-topic-03 / -04 ─────

(let [store (mk-store)
      subject-a (telegram-topic-lib/open-subject! "subject A" "telegram" "2026-07-11T09:00:00Z" "about A" (:adapters store))
      subject-b (telegram-topic-lib/open-subject! "subject B" "telegram" "2026-07-11T09:00:00Z" "about B" (:adapters store))
      reads (atom [])
      tracking-adapters (assoc (:adapters store)
                                :read-thread! (fn [id] (swap! reads conj id) (get @(:threads store) id)))]
  (let [context (telegram-topic-lib/reply-context-for (:id (:thread subject-a)) tracking-adapters)]
    (assert= "BL-281 telegram-topic-03: the reply context is that thread's OWN transcript"
             (get @(:threads store) (:id (:thread subject-a))) context)
    (assert= "BL-281 telegram-topic-04: exactly ONE thread was read - never the other subject's"
             [(:id (:thread subject-a))] @reads)
    (assert= "BL-281 telegram-topic-04: subject A's transcript never contains subject B's text"
             false (clojure.string/includes? (str context) "about B")))

  (let [sent (atom [])
        send-adapters (assoc (:adapters store) :send! (fn [topic-id text] (swap! sent conj {:topic-id topic-id :text text})))]
    (telegram-topic-lib/send-topic-reply! (:id (:thread subject-a)) "reply text" send-adapters)
    (assert= "BL-281 telegram-topic-03: the reply is sent into subject A's OWN topic, not subject B's"
             [{:topic-id (:topic-id subject-a) :text "reply text"}] @sent)))

;; ── route-update! (adapter-injected) — telegram-topic-01 composed ───────

(let [store (mk-store)
      result (telegram-topic-lib/route-update! (mk-update {:from-id PRINCIPAL_ID :thread-id nil :text "billing question"}) PRINCIPAL_ID (:adapters store))]
  (assert= "route-update!: an update outside any topic opens a new subject" true (:opened? result))
  (assert= "route-update!: the opened thread's id is returned" "SUP-1" (:thread-id result))
  (assert= "route-update!: a thread was actually persisted" 1 (count @(:threads store))))

(let [store (mk-store)
      opened (telegram-topic-lib/open-subject! "billing question" "telegram" "2026-07-11T09:00:00Z" "need help" (:adapters store))
      result (telegram-topic-lib/route-update! (mk-update {:from-id PRINCIPAL_ID :thread-id (:topic-id opened) :text "any update?"}) PRINCIPAL_ID (:adapters store))]
  (assert= "route-update!: an update inside a mapped topic demuxes (does not open a second thread)"
           true (not (:opened? result)))
  (assert= "route-update!: it is accepted and routes to the SAME thread" true (:accepted? result))
  (assert= "route-update!: thread-for-topic id matches" (:id (:thread opened)) (:thread-id result))
  (assert= "route-update!: still only one thread exists" 1 (count @(:threads store))))

;; ── select-dispatch-batch (pure) — telegram-topic-04 ─────────────────────

(assert= "select-dispatch-batch: with no telegram events, dispatch is everything, deferred is empty"
         {:dispatch [{:type "SWARM_CHECK_TIMER"}] :deferred []}
         (telegram-topic-lib/select-dispatch-batch [{:type "SWARM_CHECK_TIMER"}]))

(let [events [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}
              {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-2"}
              {:type "SWARM_CHECK_TIMER"}]
      result (telegram-topic-lib/select-dispatch-batch events)]
  (assert= "select-dispatch-batch: only the OLDEST telegram thread's events dispatch"
           [{:type "SWARM_CHECK_TIMER"} {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}]
           (:dispatch result))
  (assert= "select-dispatch-batch: the other thread's events are deferred, not dropped"
           [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-2"}]
           (:deferred result)))

(let [events [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}
              {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}]
      result (telegram-topic-lib/select-dispatch-batch events)]
  (assert= "select-dispatch-batch: multiple messages for the SAME thread all dispatch together (no bleed within one subject)"
           2 (count (:dispatch result)))
  (assert= "select-dispatch-batch: nothing deferred when only one thread is pending" [] (:deferred result)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: telegram_topic_lib.bb"))
