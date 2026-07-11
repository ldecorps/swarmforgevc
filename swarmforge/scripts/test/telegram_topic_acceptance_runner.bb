#!/usr/bin/env bb
;; BL-281: acceptance-pipeline harness for telegram_topic_lib.bb - drives
;; the REAL pure lib functions against an in-memory fake store (mirrors
;; telegram_topic_lib_test_runner.bb's own mk-store), printing a JSON
;; result so the JS step handlers assert against the real Babashka
;; decision logic instead of reimplementing it in JS.
;;
;; Usage: telegram_topic_acceptance_runner.bb <scenario> <json-config>
;; scenario: open-subject | demux | reply-independence

(ns telegram-topic-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "telegram_topic_lib.bb")))

(def scenario (nth *command-line-args* 0))
(def config (json/parse-string (nth *command-line-args* 1) true))

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

(defmulti run-scenario (fn [s _] s))

;; telegram-topic-01
(defmethod run-scenario "open-subject" [_ cfg]
  (let [store (mk-store)
        result (telegram-topic-lib/open-subject! (:subjectName cfg) "telegram" "2026-07-11T09:00:00Z" (:text cfg) (:adapters store))]
    {:topicId (:topic-id result) :threadId (:id (:thread result))}))

;; telegram-topic-02 / telegram-topic-05
(defmethod run-scenario "demux" [_ cfg]
  (let [store (mk-store)
        opened (telegram-topic-lib/open-subject! (:subjectName cfg) "telegram" "2026-07-11T09:00:00Z" (:openingText cfg) (:adapters store))
        events (atom [])
        adapters (assoc (:adapters store) :enqueue-event! (fn [e] (swap! events conj e)))
        update {:message {:from {:id (:fromId cfg)} :message_thread_id (:topic-id opened) :text (:text cfg)}}
        result (telegram-topic-lib/demux-inbound! update (:principalId cfg) adapters)]
    {:accepted (boolean (:accepted? result))
     :reason (some-> (:reason result) name)
     :threadId (:thread-id result)
     :messageCount (count (:messages (get @(:threads store) (:id (:thread opened)))))
     :events @events}))

;; telegram-topic-03 / telegram-topic-04
(defmethod run-scenario "reply-independence" [_ _cfg]
  (let [store (mk-store)
        subject-a (telegram-topic-lib/open-subject! "subject A" "telegram" "2026-07-11T09:00:00Z" "about A" (:adapters store))
        _subject-b (telegram-topic-lib/open-subject! "subject B" "telegram" "2026-07-11T09:00:00Z" "about B" (:adapters store))
        reads (atom [])
        tracking-adapters (assoc (:adapters store) :read-thread! (fn [id] (swap! reads conj id) (get @(:threads store) id)))
        context (telegram-topic-lib/reply-context-for (:id (:thread subject-a)) tracking-adapters)
        sent (atom [])
        send-adapters (assoc (:adapters store) :send! (fn [topic-id text] (swap! sent conj {:topicId topic-id :text text})))]
    (telegram-topic-lib/send-topic-reply! (:id (:thread subject-a)) "reply text" send-adapters)
    {:reads @reads
     :transcriptText (pr-str context)
     :sent @sent
     :subjectATopic (:topic-id subject-a)}))

(println (json/generate-string (run-scenario scenario config)))
