#!/usr/bin/env bb
;; Poll expedite progress.json and post updates to the Cursor Remote Telegram topic.
;;
;; Usage:
;;   expedite_progress_notify.bb <project-root> <ticket> [--once]
;;
;; Env (from swarm.env or inherited):
;;   TELEGRAM_BOT_TOKEN / CURSOR_BRIDGE_BOT_TOKEN
;;   TELEGRAM_CHAT_ID
;;   EXPEDITE_NOTIFY_TOPIC_ID  (optional; defaults to cursor-bridge-topic-map CURSOR_REMOTE)

(ns expedite-progress-notify
  (:require [babashka.fs :as fs]
            [babashka.http-client :as http]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "expedite_progress_lib.bb")))

(defn usage! []
  (binding [*out* *err*]
    (println "Usage: expedite_progress_notify.bb <project-root> <ticket> [--once]"))
  (System/exit 2))

(def project-root (some-> (first *command-line-args*) fs/canonicalize str))
(def ticket (second *command-line-args*))
(def once? (some #{"--once"} *command-line-args*))

(when (or (str/blank? project-root) (str/blank? ticket)) (usage!))

(def progress-file (fs/path project-root ".swarmforge" "expedite" ticket "progress.json"))
(def poll-ms (or (some-> (System/getenv "EXPEDITE_NOTIFY_POLL_MS") parse-long) 5000))

(defn bot-token []
  (or (System/getenv "CURSOR_BRIDGE_BOT_TOKEN")
      (System/getenv "TELEGRAM_BOT_TOKEN")))

(defn chat-id []
  (System/getenv "TELEGRAM_CHAT_ID"))

(defn topic-id []
  (when-let [explicit (System/getenv "EXPEDITE_NOTIFY_TOPIC_ID")]
    (parse-long explicit))
  (let [map-file (fs/path project-root ".swarmforge" "operator" "cursor-bridge-topic-map.json")]
    (when (fs/exists? map-file)
      (some (fn [[k v]] (when (= v "CURSOR_REMOTE") (parse-long k)))
            (json/parse-string (slurp (str map-file)) true)))))

(defn send-telegram! [text]
  (let [token (bot-token)
        chat (chat-id)
        topic (topic-id)]
    (when (and token chat text (not (str/blank? text)))
      (try
        (http/post (str "https://api.telegram.org/bot" token "/sendMessage")
                   {:form-params (cond-> {:chat_id chat :text text :disable_web_page_preview true}
                                   topic (assoc :message_thread_id topic))})
        (catch Exception e
          (println "expedite-notify: telegram post failed:" (.getMessage e))))))

(defn read-progress []
  (when (fs/exists? progress-file)
    (expedite-progress-lib/parse-progress-file (slurp (str progress-file)))))

(defn -main []
  (println "expedite-notify watching" (str progress-file))
  (loop [last-ms nil]
    (let [progress (read-progress)
          ms (:updated-at-ms progress)]
      (when (and progress ms (not= ms last-ms))
        (println "expedite-notify" (:line progress))
        (send-telegram! (:line progress)))
      (when-not once?
        (Thread/sleep poll-ms)
        (recur ms)))))

(-main)
