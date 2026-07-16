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
;; BL-466: an optional --options carries the question's discrete options (a
;; JSON array of strings) - normalized by operator-lib/poll-options to nil
;; (2-or-more requirement not met: falls back to a plain message, today's
;; unchanged behavior) or a vector of 2+ trimmed, non-blank options (the
;; Front Desk Bot renders these as a native Telegram poll instead of a plain
;; message - see telegramFrontDeskBotCore.ts's deliverAgentQuestion). Every
;; entry this file appends to the reply outbox is marked "agentQuestion":
;; true, the routing signal the bot uses to send it to the dedicated
;; agent-questions topic regardless of which topic the SUP-### thread itself
;; is otherwise bound to.
;;
;; Usage: operator_ask.bb <project-root> --thread <SUP-###> --question <q> [--options '["a","b"]']

(ns operator-ask
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "support_lib.bb")))
(load-file (str (fs/path script-dir "support_thread_store.bb")))
(load-file (str (fs/path script-dir "operator_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_ask.bb <project-root> --thread <SUP-###> --question <q> [--options '[\"a\",\"b\"]']"))
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

(defn append-to-outbox!
  "BL-466: extra (a map, e.g. {\"options\" [...]}) is merged into the
   generated entry so the Front Desk Bot's routing/poll-rendering fields
   ride the same egress every other reply-outbox entry already uses -
   never a parallel/second outbox."
  [thread-id text & [extra]]
  (fs/create-dirs (fs/parent reply-outbox-file))
  (spit (str reply-outbox-file)
        (str (json/generate-string (merge {"threadId" thread-id "text" text} extra)) "\n")
        :append true))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn parse-options
  "BL-466 hardening: --options must degrade to nil (this ticket's own
   plain-message-fallback contract for 'no usable discrete options') on ANY
   malformed input - invalid JSON, or valid JSON that is not an array of
   strings (a number, an object, an array of non-strings) - never crash the
   ask CLI. A crash here would silently lose the agent's question entirely
   (never even reaching the plain-message fallback the ticket already
   specifies for the no-options case), which is strictly worse."
  [raw]
  (when raw
    (try
      (operator-lib/poll-options (json/parse-string raw))
      (catch Exception e
        (binding [*out* *err*]
          (println (str "operator_ask.bb: --options was not a usable JSON array of strings (" (.getMessage e) ") - falling back to a plain message")))
        nil))))

(defn -main []
  (if (fs/exists? awaiting-answer-file)
    (do
      (binding [*out* *err*]
        (println "operator_ask.bb: a question is already pending - refusing to ask a second one (MVP: one at a time)"))
      (println (json/generate-string {:asked false :reason "already-pending"})))
    (let [thread-id (:thread opts)
          question (:question opts)
          resolved-options (parse-options (:options opts))
          adapters (support-thread-store/adapters-for state-dir)
          existing ((:read-thread! adapters) thread-id)
          updated (if existing
                    (support-lib/append-message existing support-lib/operator-channel (now-iso) question)
                    (support-lib/new-thread thread-id support-lib/operator-channel (now-iso) question))]
      ((:write-thread! adapters) updated)
      (append-to-outbox! thread-id question (cond-> {"agentQuestion" true}
                                               resolved-options (assoc "options" resolved-options)))
      (atomic-spit! awaiting-answer-file
                    (json/generate-string {:question question :thread_id thread-id
                                            :asked_at_ms (System/currentTimeMillis)
                                            :options resolved-options}))
      (println (json/generate-string {:asked true :thread thread-id :question question :options resolved-options})))))

(-main)
