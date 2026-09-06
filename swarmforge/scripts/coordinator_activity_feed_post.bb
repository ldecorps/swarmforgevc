#!/usr/bin/env bb
;; GH-24: posts one compact line to the coordinator's own standing Telegram
;; topic. A small, standalone CLI - handoffd.bb shells out to it (through
;; daemon-cycle-guard-lib/sh!, the one bounded subprocess chokepoint every
;; in-cycle call in that file already goes through) rather than making an
;; HTTP call directly inside the daemon's own long-running process.
;;
;; Usage: coordinator_activity_feed_post.bb <project-root> <text>
;; Exit 0 on a successful send, non-zero otherwise - the caller's own
;; drop/deliver/fail gate reads the exit code, never stdout.

(ns coordinator-activity-feed-post
  (:require [babashka.fs :as fs]
            [babashka.http-client :as http]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "coordinator_activity_feed_post_lib.bb")))

(defn- usage! []
  (binding [*out* *err*] (println "Usage: coordinator_activity_feed_post.bb <project-root> <text>"))
  (System/exit 2))

(defn bot-token []
  (or (System/getenv "TELEGRAM_BOT_TOKEN")
      (System/getenv "CURSOR_BRIDGE_BOT_TOKEN")))

(defn chat-id [] (System/getenv "TELEGRAM_CHAT_ID"))

;; The existing standing-topic infrastructure's own map - never a second,
;; feed-specific mapping. Same file telegramTopicDecisions.ts's
;; decideEnsureRoleTopicAction reads on the TS side (BL-709).
(defn coordinator-topic-id [project-root]
  (let [map-file (fs/path project-root ".swarmforge" "operator" "role-topic-map.json")]
    (when (fs/exists? map-file)
      (get (json/parse-string (slurp (str map-file)) true) :coordinator))))

(defn post-once! [token chat topic text]
  (try
    (let [resp (http/post (str "https://api.telegram.org/bot" token "/sendMessage")
                           {:form-params {:chat_id chat :text text :message_thread_id topic
                                          :disable_web_page_preview true}
                            :throw false})]
      (if (< (:status resp) 300)
        {:success true :status (:status resp) :body (:body resp)}
        (do (binding [*out* *err*]
              (println "coordinator-activity-feed-post: telegram returned" (:status resp) (:body resp)))
            {:success false :status (:status resp) :body (:body resp)})))
    (catch Exception e
      (binding [*out* *err*] (println "coordinator-activity-feed-post: send failed:" (.getMessage e)))
      {:success false :status nil :body nil})))

(defn -main [& args]
  (let [[project-root text] args]
    (when (or (str/blank? project-root) (str/blank? text)) (usage!))
    (let [token (bot-token)
          chat (chat-id)
          topic (coordinator-topic-id project-root)]
      (when (or (str/blank? token) (str/blank? chat) (nil? topic))
        (binding [*out* *err*]
          (println "coordinator-activity-feed-post: missing bot token, chat id, or coordinator topic id"))
        (System/exit 1))
      (let [ok? (coordinator-activity-feed-post-lib/send-with-rate-limit-retry!
                 #(post-once! token chat topic text)
                 (fn [seconds] (Thread/sleep (long (* 1000 seconds)))))]
        (System/exit (if ok? 0 1))))))

(apply -main *command-line-args*)
