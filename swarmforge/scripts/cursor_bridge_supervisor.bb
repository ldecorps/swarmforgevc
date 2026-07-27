#!/usr/bin/env bb
;; Supervises the Telegram ↔ Cursor SDK bridge (telegram-cursor-bridge.js)
;; with bounded restart + backoff — same state machine as onboarder_supervisor.bb
;; (front_desk_supervisor_lib.bb). Kept separate from swarm ancillary services.
;;
;; Usage:
;;   cursor_bridge_supervisor.bb <project-root> [--check-once]
;;
;; Env:
;;   CURSOR_BRIDGE_INTERVAL_MS / CURSOR_BRIDGE_MAX_ATTEMPTS / ...
;;   TELEGRAM_BOT_TOKEN (or set CURSOR_BRIDGE_BOT_TOKEN before launch)
;;   TELEGRAM_CHAT_ID / TELEGRAM_PRINCIPAL_USER_ID / CURSOR_API_KEY
;;   CURSOR_BRIDGE_MODEL

(ns cursor-bridge-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "front_desk_supervisor_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: cursor_bridge_supervisor.bb <project-root> [--check-once]"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))
(def check-once? (some #{"--check-once"} *command-line-args*))

(def op-dir (fs/path project-root ".swarmforge" "operator"))
(def pid-file (fs/path op-dir "cursor-bridge-supervisor.pid"))
(def stop-file (fs/path op-dir "cursor-bridge-supervisor.stop"))
(def status-file (fs/path op-dir "cursor-bridge-supervisor.status.json"))
(def supervisor-log-file (fs/path op-dir "cursor-bridge-supervisor.log"))
(def bridge-log-file (fs/path op-dir "cursor-bridge.log"))
(def poll-heartbeat-file (fs/path op-dir "cursor-bridge-heartbeat.json"))

(def bridge-entrypoint (fs/path project-root "extension" "out" "tools" "telegram-cursor-bridge.js"))

(defn env-long [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-long "CURSOR_BRIDGE_INTERVAL_MS" 2000))
(def restart-config
  {:max-attempts (env-long "CURSOR_BRIDGE_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-long "CURSOR_BRIDGE_BACKOFF_BASE_MS" 1000)
   :backoff-max-ms (env-long "CURSOR_BRIDGE_BACKOFF_MAX_MS" 60000)
   :healthy-reset-ms (env-long "CURSOR_BRIDGE_HEALTHY_RESET_MS" 600000)})
(def giveup-config {:giveup-cooldown-ms (env-long "CURSOR_BRIDGE_GIVEUP_COOLDOWN_MS" 900000)})
;; Poll long-polls up to 30s; 120s without heartbeat ⇒ stalled.
(def stall-ms (env-long "CURSOR_BRIDGE_STALL_MS" 120000))
(def kill-grace-ms (env-long "CURSOR_BRIDGE_KILL_GRACE_MS" 2000))
(def kill-pid! (front-desk-supervisor-lib/make-kill-pid! kill-grace-ms))

(defn now-ms [] (System/currentTimeMillis))
(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn log! [& parts]
  (fs/create-dirs op-dir)
  (spit (str supervisor-log-file) (str (now-iso) " " (str/join " " parts) "\n") :append true))

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

(defn bridge-extra-env []
  (into {}
        (remove (fn [[_ v]] (nil? v))
                [["TELEGRAM_BOT_TOKEN" (System/getenv "TELEGRAM_BOT_TOKEN")]
                 ["TELEGRAM_CHAT_ID" (System/getenv "TELEGRAM_CHAT_ID")]
                 ["TELEGRAM_PRINCIPAL_USER_ID" (System/getenv "TELEGRAM_PRINCIPAL_USER_ID")]
                 ["CURSOR_API_KEY" (System/getenv "CURSOR_API_KEY")]
                 ["CURSOR_BRIDGE_MODEL" (System/getenv "CURSOR_BRIDGE_MODEL")]
                 ["CURSOR_BRIDGE_BOOT_PROMPT" (System/getenv "CURSOR_BRIDGE_BOOT_PROMPT")]])))

(defn spawn-bridge! []
  (process/process {:out :inherit :err :inherit
                    :extra-env (bridge-extra-env)}
                   "node" (str bridge-entrypoint) project-root))

(def process-specs
  [{:key :bridge :spawn-pid! (fn [] (.pid (:proc (spawn-bridge!))))
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

(defn stop-all! []
  (doseq [[_ entry] (read-state)]
    (when (map? entry)
      (when-let [pid (:pid entry)]
        (when (pid-alive? pid)
          (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.destroy)))))))

(defn -main []
  (fs/create-dirs op-dir)
  (if check-once?
    (println (json/generate-string (tick!)))
    (do
      (atomic-spit! pid-file (str (.pid (java.lang.ProcessHandle/current))))
      (log! "cursor-bridge-supervisor started" (str "interval-ms=" interval-ms) "root=" project-root)
      (try
        (while (not (fs/exists? stop-file))
          (try (tick!) (catch Exception e (log! "tick-error" (.getMessage e))))
          (Thread/sleep interval-ms))
        (finally
          (stop-all!)
          (fs/delete-if-exists pid-file)
          (log! "cursor-bridge-supervisor stopped"))))))

(-main)
