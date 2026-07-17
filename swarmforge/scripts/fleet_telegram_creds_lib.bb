#!/usr/bin/env bb
;; BL-436: a swarm's Telegram identity is a property of the SWARM (keyed by
;; its own swarm_name), not of whatever shell launched it. The one-bot-
;; per-target rule was already settled and structurally enforced (a shared
;; token gives Telegram 409 Conflict, and a shared global getUpdates offset
;; is silent message theft - BL-380), but the isolation was fragile at the
;; LAUNCH boundary: front_desk_supervisor.bb resolved creds from the
;; ambient environment, so a second supervisor launched from a shell that
;; already exported the primary's TELEGRAM_BOT_TOKEN silently inherited
;; it. Per-swarm creds live at
;; ~/.swarmforge/fleet/<swarm_name>/telegram.json = {botToken, chatId,
;; bridgePort}, under the HOST home directory - never inside the target
;; working tree (secrets rule; extension-host owns the rendezvous dir).
;;
;; `home-dir` is always an explicit parameter, never read internally via
;; System/getProperty - the caller resolves the real $HOME once; a test
;; passes its own fixture directory, so nothing here can ever read or
;; write the real developer home directory.

(ns fleet-telegram-creds-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(defn creds-file-path [home-dir swarm-name]
  (fs/path home-dir ".swarmforge" "fleet" swarm-name "telegram.json"))

(defn read-fleet-creds
  "This swarm's fleet creds ({:botToken :chatId :bridgePort}, keywordized)
   read from home-dir/.swarmforge/fleet/<swarm-name>/telegram.json, or nil
   when no file exists for this swarm_name. Never throws on corrupt JSON -
   treated the same as absent (callers fall back to the environment)."
  [home-dir swarm-name]
  (let [f (creds-file-path home-dir swarm-name)]
    (when (fs/exists? f)
      (try (json/parse-string (slurp (str f)) true) (catch Exception _ nil)))))

(defn resolve-telegram-creds
  "Resolves {:bot-token :chat-id :bridge-port} for swarm-name.

   The fleet creds file WINS WHOLESALE when present and parses - never
   merged field-by-field with `env`, so a creds file that exists is the
   swarm's whole Telegram identity and an inherited env token can never
   leak through a partially-present file. Falls back entirely to `env`
   (a map of the same string keys `System/getenv` would return:
   \"TELEGRAM_BOT_TOKEN\", \"TELEGRAM_CHAT_ID\") only when no creds file
   exists at all for this swarm_name - the mandatory single-swarm/primary
   compatibility path, so nothing pre-BL-436 breaks.

   `default-bridge-port` is the value already resolved from BRIDGE_PORT
   env (or its own hardcoded default) - the creds file's own bridgePort
   overrides it only when present; every other case keeps today's
   behavior unchanged."
  [home-dir swarm-name env default-bridge-port]
  (if-let [creds (read-fleet-creds home-dir swarm-name)]
    {:bot-token (:botToken creds)
     :chat-id (:chatId creds)
     :bridge-port (or (:bridgePort creds) default-bridge-port)}
    {:bot-token (get env "TELEGRAM_BOT_TOKEN")
     :chat-id (get env "TELEGRAM_CHAT_ID")
     :bridge-port default-bridge-port}))
