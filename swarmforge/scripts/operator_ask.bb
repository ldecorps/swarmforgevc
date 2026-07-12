#!/usr/bin/env bb
;; BL-306: one-shot CLI the disposable Operator LLM calls, per operator.prompt,
;; when it hits a decision only the human can make and chooses to ASK a
;; clarifying question instead of notifying/guessing. Mirrors
;; operator_reply.bb's own "thin CLI wrapping the real fs adapters" shape
;; (BL-281) - posts the question into the SAME SUP-### thread transcript +
;; reply outbox operator_reply.bb already uses, and ADDITIONALLY records the
;; always-alive runtime's own awaiting-answer state (the DISPOSABLE LLM can
;; never wait - operator_runtime.bb is what holds the wait/pairs the later
;; reply/times it out, see operator_lib.bb's own check-awaiting-answer).
;;
;; ONE pending question at a time (MVP - concurrent asks are out of scope):
;; refuses to overwrite an already-pending question rather than silently
;; clobbering it, so a second ask from a later run cannot lose track of the
;; first.
;;
;; Usage: operator_ask.bb <project-root> --thread <SUP-###> --question <q>

(ns operator-ask
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "support_lib.bb")))
(load-file (str (fs/path script-dir "support_thread_store.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_ask.bb <project-root> --thread <SUP-###> --question <q>"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))

(defn parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(def opts (parse-opts (drop 1 *command-line-args*)))
(when (or (str/blank? (:thread opts)) (str/blank? (:question opts))) (usage))

(def state-dir (fs/path project-root ".swarmforge"))
(def op-dir (fs/path state-dir "operator"))
(def reply-outbox-file (fs/path op-dir "telegram-reply-outbox.jsonl"))
(def awaiting-answer-file (fs/path op-dir "awaiting-answer.json"))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn append-to-outbox! [thread-id text]
  (fs/create-dirs (fs/parent reply-outbox-file))
  (spit (str reply-outbox-file) (str (json/generate-string {"threadId" thread-id "text" text}) "\n") :append true))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn -main []
  (if (fs/exists? awaiting-answer-file)
    (do
      (binding [*out* *err*]
        (println "operator_ask.bb: a question is already pending - refusing to ask a second one (MVP: one at a time)"))
      (println (json/generate-string {:asked false :reason "already-pending"})))
    (let [thread-id (:thread opts)
          question (:question opts)
          adapters (support-thread-store/adapters-for state-dir)
          existing ((:read-thread! adapters) thread-id)
          updated (if existing
                    (support-lib/append-message existing support-lib/operator-channel (now-iso) question)
                    (support-lib/new-thread thread-id support-lib/operator-channel (now-iso) question))]
      ((:write-thread! adapters) updated)
      (append-to-outbox! thread-id question)
      (atomic-spit! awaiting-answer-file
                    (json/generate-string {:question question :thread_id thread-id :asked_at_ms (System/currentTimeMillis)}))
      (println (json/generate-string {:asked true :thread thread-id :question question})))))

(-main)
