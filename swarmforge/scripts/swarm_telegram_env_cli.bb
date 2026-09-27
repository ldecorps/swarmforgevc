#!/usr/bin/env bb
;; BL-1775: prints `export`/`unset` lines for TELEGRAM_BOT_TOKEN and
;; TELEGRAM_CHAT_ID, to be `eval`-ed by swarmforge.sh (once, early) and by
;; every role launch script it writes (right after the shebang block, so
;; it runs AFTER zsh has already sourced ~/.zshenv - the profile can no
;; longer win). One resolver, two call sites, reusing
;; fleet_telegram_creds_lib's existing BL-436/BL-622 rules rather than a
;; second copy of them:
;;   - the recorded primary root (env-fallback-allowed?): prints nothing -
;;     the ambient environment (whatever ~/.zshenv exported) stands exactly
;;     as today.
;;   - every other swarm: its own fleet creds file wins wholesale (export
;;     lines), or - absent one - both variables are unset, never left at
;;     whatever the profile put there.
;;
;; Usage: swarm_telegram_env_cli.bb <project-root> <swarm-name>
;; home-dir resolves the SAME way front_desk_supervisor.bb's own
;; fleet-home-dir does (SWARMFORGE_FLEET_HOME env override, else the real
;; $HOME) - a test-only seam, never read a second, different way.
(ns swarm-telegram-env-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path scripts-dir "fleet_telegram_creds_lib.bb")))

(def fleet-home-dir (or (System/getenv "SWARMFORGE_FLEET_HOME") (System/getProperty "user.home")))

(defn- sh-single-quote
  "Wraps s in single quotes for a POSIX/zsh shell, escaping any embedded
   single quote - safe for an arbitrary token/chat-id value, never just
   trusted to contain no shell metacharacters."
  [s]
  (str "'" (str/replace (str s) "'" "'\\''") "'"))

(defn env-lines
  "The lines to eval for project-root/swarm-name, or nil for the recorded
   primary root (nothing to override - the ambient environment stands)."
  [home-dir project-root swarm-name]
  (when-not (fleet-telegram-creds-lib/env-fallback-allowed? home-dir project-root swarm-name)
    (if-let [creds (fleet-telegram-creds-lib/read-fleet-creds home-dir swarm-name)]
      [(str "export TELEGRAM_BOT_TOKEN=" (sh-single-quote (:botToken creds)))
       (str "export TELEGRAM_CHAT_ID=" (sh-single-quote (:chatId creds)))]
      ["unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID"])))

(defn- usage []
  (binding [*out* *err*]
    (println "Usage: swarm_telegram_env_cli.bb <project-root> <swarm-name>"))
  (System/exit 1))

(let [args (vec *command-line-args*)]
  (when (< (count args) 2) (usage))
  (let [[project-root swarm-name] args]
    (doseq [line (env-lines fleet-home-dir project-root swarm-name)]
      (println line))))
