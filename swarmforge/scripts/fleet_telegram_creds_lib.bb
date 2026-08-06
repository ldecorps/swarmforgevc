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
;;
;; BL-622: BL-436's env fallback covered the primary swarm unconditionally -
;; but "no creds file exists" is also true of a genuinely rogue/uninitialized
;; non-primary swarm (a copied .swarmforge/ dir, or an inherited shell), so
;; that swarm silently inherited the primary's token too (human-confirmed
;; incident 2026-07-24: a rival poller stole ~9h of inbound). Env fallback is
;; now reserved for the ONE recorded primary root
;; (~/.swarmforge/fleet/primary/root, written once on that root's first
;; primary launch by `ensure-primary-root-recorded!` - moving the primary is
;; a deliberate operator edit of that file, never automatic). Every other
;; swarm without its own creds file gets a REFUSAL, never a silent nil.
;; A second, independent check (`conflicting-swarm`) catches the sibling
;; failure mode: two swarms' creds files (or a creds file and the primary's
;; env token) happening to carry the identical bot token.

(ns fleet-telegram-creds-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [cheshire.core :as json]))

;; Deliberately duplicated rather than load-file'd from swarm_identity_lib.bb
;; (small duplication over a new cross-file coupling - this codebase's own
;; established convention, e.g. front_desk_supervisor.bb's escalation-retry-
;; config comment) - must stay equal to swarm-identity-lib/default-swarm-name.
(def default-primary-swarm-name "primary")

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

;; ── BL-622: the one recorded primary root ───────────────────────────────

(defn primary-root-file [home-dir]
  (fs/path home-dir ".swarmforge" "fleet" "primary" "root"))

(defn- normalize-root [s]
  (when s
    (let [t (str/trim s)]
      (if (and (> (count t) 1) (str/ends-with? t "/"))
        (subs t 0 (dec (count t)))
        t))))

(defn read-primary-root
  "The durably recorded primary project root, or nil when none is recorded
   yet (a genuinely fresh host, or one that has never launched a primary's
   front desk)."
  [home-dir]
  (let [f (primary-root-file home-dir)]
    (when (fs/exists? f)
      (not-empty (normalize-root (slurp (str f)))))))

(defn- atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn ensure-primary-root-recorded!
  "Bootstraps the durable primary-root record on this swarm's first primary
   launch. A no-op whenever a record ALREADY exists (whatever root it
   names - moving the primary is a deliberate operator edit of the file,
   never something a later launch overwrites automatically) or when
   swarm-name is not the primary swarm."
  [home-dir project-root swarm-name]
  (when (and (= swarm-name default-primary-swarm-name)
             (nil? (read-primary-root home-dir)))
    (atomic-spit! (primary-root-file home-dir) (normalize-root project-root))))

(defn env-fallback-allowed?
  "True when the ambient environment's Telegram token may be used for this
   project-root/swarm-name: either project-root IS the recorded primary
   root, or (bootstrap window) no root is recorded yet and swarm-name is
   itself the primary swarm - the very first primary launch, before
   ensure-primary-root-recorded! has had a chance to persist the record."
  [home-dir project-root swarm-name]
  (if-let [recorded (read-primary-root home-dir)]
    (= recorded (normalize-root project-root))
    (= swarm-name default-primary-swarm-name)))

(defn refusal-message
  "The one loud, actionable line for a swarm that resolves no token at
   all: names the swarm and the provisioning command (BL-380's channel
   provisioning tool, the only thing that writes a per-swarm creds file)."
  [swarm-name]
  (str "front desk refused: swarm '" swarm-name "' has no Telegram creds of "
       "its own (~/.swarmforge/fleet/" swarm-name "/telegram.json) and is "
       "not the recorded primary root - the ambient environment token is "
       "reserved for the primary swarm and will not be used here. "
       "Provision this swarm's own bot: node "
       "extension/out/tools/provision-onboarding-telegram-channel.js "
       "<target-repo-path> <bot-token> <bot-username> <host-secrets-file-path> "
       swarm-name " [bridge-port]"))

(defn resolve-telegram-creds
  "Resolves {:bot-token :chat-id :bridge-port :refused? :reason} for
   swarm-name launched from project-root.

   The fleet creds file WINS WHOLESALE when present and parses - never
   merged field-by-field with `env`, so a creds file that exists is the
   swarm's whole Telegram identity and an inherited env token can never
   leak through a partially-present file.

   Absent a creds file, env fallback (a map of the same string keys
   `System/getenv` would return: \"TELEGRAM_BOT_TOKEN\", \"TELEGRAM_CHAT_ID\")
   is used ONLY when `env-fallback-allowed?` holds (BL-622) - otherwise
   :refused? is true, :bot-token/:chat-id are nil, and :reason carries the
   one loud line explaining why (never a silent nil token, which would
   just look like a not-yet-configured desk rather than a refusal).

   `default-bridge-port` is the value already resolved from BRIDGE_PORT
   env (or its own hardcoded default) - the creds file's own bridgePort
   overrides it only when present; every other case keeps today's
   behavior unchanged."
  [home-dir project-root swarm-name env default-bridge-port]
  (if-let [creds (read-fleet-creds home-dir swarm-name)]
    {:bot-token (:botToken creds)
     :chat-id (:chatId creds)
     :bridge-port (or (:bridgePort creds) default-bridge-port)
     :refused? false
     :reason nil}
    (if (env-fallback-allowed? home-dir project-root swarm-name)
      {:bot-token (get env "TELEGRAM_BOT_TOKEN")
       :chat-id (get env "TELEGRAM_CHAT_ID")
       :bridge-port default-bridge-port
       :refused? false
       :reason nil}
      {:bot-token nil
       :chat-id nil
       :bridge-port default-bridge-port
       :refused? true
       :reason (refusal-message swarm-name)})))

;; ── BL-622: cross-swarm token-uniqueness guard (scenario 05) ───────────

(defn- fleet-dir [home-dir] (fs/path home-dir ".swarmforge" "fleet"))

(defn- all-fleet-swarm-names [home-dir]
  (let [d (fleet-dir home-dir)]
    (if (fs/exists? d)
      (->> (fs/list-dir d) (filter fs/directory?) (map (comp str fs/file-name)))
      [])))

(defn conflicting-swarm
  "The name of another fleet swarm (never swarm-name itself) whose OWN
   creds file carries the identical bot-token, or nil when there is no
   conflict. A nil bot-token never conflicts with anything - there is
   nothing to compare. Deliberately compares against every OTHER fleet
   swarm's file regardless of how THIS swarm's own token was resolved (its
   own file, or primary env fallback) - a token collision is a real
   two-pollers-one-token hazard either way."
  [home-dir swarm-name bot-token]
  (when (some? bot-token)
    (some (fn [other-name]
            (when (and (not= other-name swarm-name)
                       (= bot-token (:botToken (read-fleet-creds home-dir other-name))))
              other-name))
          (all-fleet-swarm-names home-dir))))

(defn duplicate-token-message
  "The one loud line for scenario 05: names the conflicting swarm."
  [swarm-name conflicting-swarm-name]
  (str "front desk refused: swarm '" swarm-name "'s resolved Telegram bot "
       "token is already in use by fleet swarm '" conflicting-swarm-name
       "' - one bot token allows exactly one getUpdates poller. Provision a "
       "distinct bot for '" swarm-name "': node "
       "extension/out/tools/provision-onboarding-telegram-channel.js "
       "<target-repo-path> <bot-token> <bot-username> <host-secrets-file-path> "
       swarm-name " [bridge-port]"))
