#!/usr/bin/env bb
;; BL-281 (bridge-client architecture): one-shot CLI the disposable Operator
;; LLM calls, per its future prompt (specifier-owned, lands WITH this
;; slice), once it has composed a reply for a SUP-### it was woken for.
;; Mirrors support_thread.bb's own "thin CLI wrapping a pure lib +
;; real fs adapters" shape (BL-275). Records the reply into that thread's
;; OWN transcript (support_thread_store.bb - the SAME unified store the
;; bridge's inbound route writes to) and appends it to the reply outbox
;; the bridge polls to relay onto its SSE stream (telegram-topic-03) - the
;; runtime/LLM never calls Telegram or the bridge directly, only ever this
;; local file hand-off.
;;
;; Usage: operator_reply.bb <project-root> --thread <SUP-###> --text <t>

(ns operator-reply
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "support_lib.bb")))
(load-file (str (fs/path script-dir "support_thread_store.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_reply.bb <project-root> --thread <SUP-###> --text <t>"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))

(defn parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(def opts (parse-opts (drop 1 *command-line-args*)))
(when (or (str/blank? (:thread opts)) (str/blank? (:text opts))) (usage))

(def state-dir (fs/path project-root ".swarmforge"))
(def reply-outbox-file (fs/path state-dir "operator" "telegram-reply-outbox.jsonl"))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn append-to-outbox! [thread-id text]
  (fs/create-dirs (fs/parent reply-outbox-file))
  ;; String keys (not keyword) so generate-string prints EXACTLY
  ;; {"threadId":...,"text":...} - operatorEventQueue.ts's
  ;; readNewReplyOutboxEntries reads these two field names verbatim.
  (spit (str reply-outbox-file) (str (json/generate-string {"threadId" thread-id "text" text}) "\n") :append true))

(defn -main []
  (let [thread-id (:thread opts)
        text (:text opts)
        adapters (support-thread-store/adapters-for state-dir)
        existing ((:read-thread! adapters) thread-id)
        updated (if existing
                  (support-lib/append-message existing support-lib/operator-channel (now-iso) text)
                  (support-lib/new-thread thread-id support-lib/operator-channel (now-iso) text))]
    ((:write-thread! adapters) updated)
    (append-to-outbox! thread-id text)
    (println (json/generate-string updated))))

(-main)
