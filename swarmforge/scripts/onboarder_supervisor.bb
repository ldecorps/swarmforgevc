#!/usr/bin/env bb
;; BL-590 slice 1: supervises the Onboarder's own topic-
;; reconcile poll-loop (extension/out/tools/onboarder-reconcile.js),
;; mirroring negotiation_relay_supervisor.bb's spawn/crash-detect/bounded-
;; restart-with-backoff shape and reusing front_desk_supervisor_lib.bb's pure
;; state machine wholesale (check-one!/default-entry/poll-heartbeat-stale?
;; are already adapter-injected and process-agnostic - never a second,
;; drifting copy of that decision).
;;
;; Unlike negotiation_relay_supervisor.bb (one instance PER PROVISIONED
;; TARGET, its own dedicated bot token), the Onboarding topic is ONE topic
;; in the PRIMARY swarm's own group, reused across every target onboarded
;; through it (the specifier's design note) - so this supervisor takes only
;; the swarm repo root, the same "one fixed project" shape front_desk_
;; supervisor.bb's own bot spec uses, and resolves this swarm's own
;; Telegram identity via fleet_telegram_creds_lib.bb (never a raw env read -
;; a second swarm sharing this shell's ambient env must never silently
;; inherit the primary's token, the same BL-436 rule front_desk_supervisor.bb
;; already follows).
;;
;; What it does NOT do: open a second Telegram getUpdates poller. The
;; onboarder's actual inbound message handling runs IN-PROCESS inside the
;; front-desk bot's own single poller (telegramFrontDeskBotCore.ts's
;; attemptOnboardingTopicDelivery) - a second poller on the SAME bot token
;; would 409-conflict with it (docs/how-to/BL-439-fes-second-swarm-bringup.md's
;; own warning). The reconcile poll-loop this supervises only calls OUTBOUND
;; Telegram Bot API methods (createForumTopic) to keep the topic ensured
;; even before the bot's own startup path has run, which is not subject to
;; that restriction - polling is exclusive, sending is not.
;;
;; Usage:
;;   onboarder_supervisor.bb <swarm-repo-root> [--check-once]
;;
;; Env:
;;   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   fallback when no fleet creds file exists
;;   SWARMFORGE_FLEET_HOME                   fleet creds root override (default $HOME)
;;   ONBOARDER_INTERVAL_MS      loop sleep between checks (default 2000)
;;   ONBOARDER_MAX_ATTEMPTS     bounded restart cap (default 5)
;;   ONBOARDER_BACKOFF_BASE_MS / ONBOARDER_BACKOFF_MAX_MS
;;   ONBOARDER_HEALTHY_RESET_MS continuous-uptime attempt reset (default 600000)
;;   ONBOARDER_GIVEUP_COOLDOWN_MS give-up re-arm cooldown (default 900000)
;;   ONBOARDER_STALL_MS         heartbeat staleness window (default 120000)
;;   ONBOARDER_KILL_GRACE_MS    SIGTERM->SIGKILL grace period, ms (default 2000)

(ns onboarder-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "front_desk_supervisor_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_identity_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "fleet_telegram_creds_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: onboarder_supervisor.bb <swarm-repo-root> [--check-once]"))
  (System/exit 1))

(def swarm-repo-root (or (first *command-line-args*) (usage)))
(def check-once? (some #{"--check-once"} *command-line-args*))

(def op-dir (fs/path swarm-repo-root ".swarmforge" "operator"))
(def pid-file (fs/path op-dir "onboarder-supervisor.pid"))
(def stop-file (fs/path op-dir "onboarder-supervisor.stop"))
(def status-file (fs/path op-dir "onboarder-supervisor.status.json"))
(def log-file (fs/path op-dir "onboarder-supervisor.log"))
;; Written by onboarder-reconcile.ts on every completed
;; reconcile cycle - the same {lastHeartbeatMs} shape front-desk-poll-
;; heartbeat.json and negotiation-relay-poll-heartbeat.json already
;; established.
(def poll-heartbeat-file (fs/path op-dir "onboarder-heartbeat.json"))

(def reconcile-entrypoint (fs/path swarm-repo-root "extension" "out" "tools" "onboarder-reconcile.js"))

(defn env-long [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-long "ONBOARDER_INTERVAL_MS" 2000))
(def restart-config
  {:max-attempts (env-long "ONBOARDER_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-long "ONBOARDER_BACKOFF_BASE_MS" 1000)
   :backoff-max-ms (env-long "ONBOARDER_BACKOFF_MAX_MS" 60000)
   :healthy-reset-ms (env-long "ONBOARDER_HEALTHY_RESET_MS" 600000)})
(def giveup-config {:giveup-cooldown-ms (env-long "ONBOARDER_GIVEUP_COOLDOWN_MS" 900000)})

;; How long the reconcile loop's own heartbeat can go quiet before it is
;; treated as stalled. Default 120s - comfortably wider than the reconcile
;; loop's own 60s interval even accounting for one missed tick.
(def stall-ms (env-long "ONBOARDER_STALL_MS" 120000))

(def kill-grace-ms (env-long "ONBOARDER_KILL_GRACE_MS" 2000))
(def kill-pid! (front-desk-supervisor-lib/make-kill-pid! kill-grace-ms))

;; BL-436: this swarm's Telegram identity is a property of the SWARM, not of
;; whatever shell launched this supervisor - same rule front_desk_supervisor.bb
;; already follows, reused here rather than a second resolution path.
;; BL-622: the Onboarding topic is only ever meant to live in the PRIMARY
;; swarm's own group (see this file's own header comment), so refusal here
;; is a defense-in-depth backstop, not the expected path - but this
;; supervisor still calls the Telegram Bot API (createForumTopic) with
;; whatever token it resolves, so an unentitled token must never be used
;; silently, same as front_desk_supervisor.bb.
(def swarm-name (swarm-identity-lib/own-swarm-name swarm-repo-root))
(def fleet-home-dir (or (System/getenv "SWARMFORGE_FLEET_HOME") (System/getProperty "user.home")))
(fleet-telegram-creds-lib/ensure-primary-root-recorded! fleet-home-dir swarm-repo-root swarm-name)
(def resolved-telegram-creds
  (fleet-telegram-creds-lib/resolve-telegram-creds
   fleet-home-dir swarm-repo-root swarm-name
   {"TELEGRAM_BOT_TOKEN" (System/getenv "TELEGRAM_BOT_TOKEN")
    "TELEGRAM_CHAT_ID" (System/getenv "TELEGRAM_CHAT_ID")}
   (env-long "BRIDGE_PORT" 8765)))
(def launch-refusal-reason (:reason resolved-telegram-creds))

(defn now-ms [] (System/currentTimeMillis))
(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn log! [& parts]
  (fs/create-dirs op-dir)
  (spit (str log-file) (str (now-iso) " " (str/join " " parts) "\n") :append true))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn read-poll-heartbeat-ms []
  (when (fs/exists? poll-heartbeat-file)
    (try (:lastHeartbeatMs (json/parse-string (slurp (str poll-heartbeat-file)) true))
         (catch Exception _ nil))))

(defn spawn-reconcile! []
  (process/process {:out :inherit :err :inherit
                     :extra-env {"TELEGRAM_BOT_TOKEN" (:bot-token resolved-telegram-creds)
                                 "TELEGRAM_CHAT_ID" (:chat-id resolved-telegram-creds)}}
                    "node" (str reconcile-entrypoint) swarm-repo-root "poll-loop"))

(def process-specs
  [{:key :onboarder :spawn-pid! (fn [] (.pid (:proc (spawn-reconcile!))))
    :heartbeat-stale? (fn [now] (front-desk-supervisor-lib/poll-heartbeat-stale? (read-poll-heartbeat-ms) now stall-ms))}])

(defn read-state []
  (if (fs/exists? status-file)
    (try (json/parse-string (slurp (str status-file)) true) (catch Exception _ {}))
    {}))

(defn write-status! [state]
  (atomic-spit! status-file (json/generate-string (assoc state :updated_at (now-iso)))))

(defn log-event! [spec-key event entry]
  (case event
    :started (log! "started" (name spec-key) "pid=" (str (:pid entry)) "attempt=" (str (:attempts entry)))
    :crashed (log! "crashed" (name spec-key) "attempt=" (str (:attempts entry)))
    :stalled (log! "stalled" (name spec-key) "no heartbeat within" (str stall-ms) "ms")
    :healthy-reset (log! "healthy-reset" (name spec-key))
    :gave-up (log! "gave-up" (name spec-key) "after" (str (:attempts entry)) "attempt(s)")
    :re-armed (log! "re-armed" (name spec-key) "pid=" (str (:pid entry)))
    nil))

(defn tick! []
  (let [prior (read-state)
        now (now-ms)
        next-state (into {}
                          (map (fn [spec]
                                 (let [entry (merge (front-desk-supervisor-lib/default-entry) (get prior (:key spec)))
                                       heartbeat-stale? ((:heartbeat-stale? spec) now)
                                       {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                                                               entry now pid-alive? (:spawn-pid! spec) restart-config giveup-config heartbeat-stale? kill-pid!)]
                                   (log-event! (:key spec) event entry)
                                   [(:key spec) entry])))
                          process-specs)]
    (write-status! next-state)
    next-state))

;; ── main ──────────────────────────────────────────────────────────────────

(defn stop-all! []
  (doseq [[_ entry] (read-state)]
    (when (map? entry)
      (when-let [pid (:pid entry)]
        (when (pid-alive? pid)
          (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.destroy)))))))

(defn -main []
  (fs/create-dirs op-dir)
  ;; BL-622: see fleet-home-dir/resolved-telegram-creds above - a refused
  ;; resolution never spawns the reconcile loop and never claims the pid
  ;; file, loud line in both the log and stderr.
  (if launch-refusal-reason
    (do
      (log! "refused" launch-refusal-reason)
      (binding [*out* *err*] (println launch-refusal-reason))
      (System/exit 1))
    (if check-once?
      (println (json/generate-string (tick!)))
      (do
        (atomic-spit! pid-file (str (.pid (java.lang.ProcessHandle/current))))
        (log! "onboarder-supervisor started" (str "interval-ms=" interval-ms) "swarm-repo=" swarm-repo-root)
        (try
          (while (not (fs/exists? stop-file))
            (try (tick!) (catch Exception e (log! "tick-error" (.getMessage e))))
            (Thread/sleep interval-ms))
          (finally
            (stop-all!)
            (fs/delete-if-exists pid-file)
            (log! "onboarder-supervisor stopped")))))))

(-main)
