#!/usr/bin/env bb
;; BL-284 (Notify slice of the BL-274 front desk): one-shot CLI a status-
;; change source calls to raise a proactive notice for a subject - the
;; SOURCE of status changes (BL-239 run-narration rehoming) is deferred, but
;; this entry point is real and callable today, mirroring operator_reply.bb's
;; own "thin CLI wrapping a pure lib + real fs adapters" shape (BL-275/
;; BL-281). Reuses the EXACT SAME reply-outbox pipe BL-276's idle nudge and
;; BL-281's own reply already post through (support_thread_store.bb's
;; unified SUP-### store + the reply-outbox jsonl the bridge polls) - no new
;; comms path, never a direct Telegram/network call.
;;
;; Usage: operator_notify.bb <project-root> --thread <SUP-###> --changed <true|false> --summary <text>

(ns operator-notify
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "support_lib.bb")))
(load-file (str (fs/path script-dir "support_thread_store.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_notify.bb <project-root> --thread <SUP-###> --changed <true|false> --summary <text>"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))

(defn parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(def opts (parse-opts (drop 1 *command-line-args*)))
(when (or (str/blank? (:thread opts)) (str/blank? (:summary opts))) (usage))

(def state-dir (fs/path project-root ".swarmforge"))
(def reply-outbox-file (fs/path state-dir "operator" "telegram-reply-outbox.jsonl"))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

;; Same wire shape operator_reply.bb/operator_runtime.bb already write -
;; String keys so generate-string prints EXACTLY {"threadId":...,"text":...},
;; matching what operatorEventQueue.ts's readNewReplyOutboxEntries reads.
(defn append-to-outbox! [thread-id text]
  (fs/create-dirs (fs/parent reply-outbox-file))
  (spit (str reply-outbox-file) (str (json/generate-string {"threadId" thread-id "text" text}) "\n") :append true))

(defn -main []
  (let [thread-id (:thread opts)
        status-change {:changed? (= "true" (:changed opts)) :summary (:summary opts)}
        adapters (support-thread-store/adapters-for state-dir)
        thread ((:read-thread! adapters) thread-id)
        decision (support-lib/proactive-notice-decision thread status-change)]
    (if (= decision :notify)
      (let [text (support-lib/proactive-notice-text status-change)
            updated (support-lib/append-message thread support-lib/operator-channel (now-iso) text)]
        ((:write-thread! adapters) updated)
        (append-to-outbox! thread-id text)
        (println (json/generate-string {:notice "notify" :text text})))
      (println (json/generate-string {:notice "none"})))))

(-main)
