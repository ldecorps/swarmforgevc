#!/usr/bin/env bb
;; BL-436: prints exactly the Telegram creds front_desk_supervisor.bb would
;; resolve for this project's own swarm_name - a thin CLI over
;; fleet_telegram_creds_lib.bb's resolve-telegram-creds, useful both as an
;; operator debugging tool ("what creds would swarm X actually use?") and
;; as the acceptance-suite's own drive point (never re-implements the
;; resolution logic a second time).
;;
;; Usage: fleet_telegram_creds_cli.bb <project-root>
;; Env:
;;   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   env fallback inputs, same as
;;                                           front_desk_supervisor.bb
;;   BRIDGE_PORT                             default bridge port fallback
;;                                           (default 8765)
;;   SWARMFORGE_FLEET_HOME                   overrides the fleet creds root
;;                                           (default the real $HOME)
;;
;; Prints one JSON line: {"swarmName":..., "botToken":..., "chatId":...,
;; "bridgePort":...}

(ns fleet-telegram-creds-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "swarm_identity_lib.bb")))
(load-file (str (fs/path script-dir "fleet_telegram_creds_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: fleet_telegram_creds_cli.bb <project-root>"))
  (System/exit 1))

(defn env-long [name default]
  (or (some-> (System/getenv name) parse-long) default))

(defn -main [args]
  (let [project-root (first args)]
    (when (nil? project-root) (usage))
    (let [swarm-name (swarm-identity-lib/own-swarm-name project-root)
          fleet-home-dir (or (System/getenv "SWARMFORGE_FLEET_HOME") (System/getProperty "user.home"))
          resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                    fleet-home-dir swarm-name
                    {"TELEGRAM_BOT_TOKEN" (System/getenv "TELEGRAM_BOT_TOKEN")
                     "TELEGRAM_CHAT_ID" (System/getenv "TELEGRAM_CHAT_ID")}
                    (env-long "BRIDGE_PORT" 8765))]
      (println (json/generate-string {:swarmName swarm-name
                                       :botToken (:bot-token resolved)
                                       :chatId (:chat-id resolved)
                                       :bridgePort (:bridge-port resolved)})))))

(-main *command-line-args*)
