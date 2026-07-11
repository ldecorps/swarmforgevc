#!/usr/bin/env bb
;; BL-292: supervises the headless Telegram front desk - the bridge
;; (start-bridge-headless.js) and the Front Desk Bot
;; (telegram-front-desk-bot.js), spawned as two independent Node child
;; processes, bridge FIRST (the bot authenticates against it). Each
;; process is restarted with bounded backoff on crash
;; (front_desk_supervisor_lib.bb's pure decide-restart-action/
;; compute-backoff-ms), then given up on - never an unbounded restart loop
;; (engineering.prompt). Mirrors handoffd_supervisor.bb's own pid-file/
;; stop-file/status-file/loop/--check-once conventions; the SUPERVISION
;; POLICY differs deliberately (bounded restart here, vs
;; handoffd_supervisor.bb's own zero-restart alarm-and-halt for the swarm
;; daemon - a different kind of process with a different recovery story).
;;
;; State (attempts/status/crashed-at-ms/pid per process) is PERSISTED TO
;; DISK in status.json and re-read at the start of every tick, rather than
;; held in an in-memory atom - a spawned child process is a real, detached
;; OS process that outlives this script's own exit (confirmed empirically:
;; babashka.process/process does not tie child lifetime to the parent), so
;; --check-once must reconstruct "is it still alive" from a persisted pid
;; on each fresh invocation, exactly like operator_runtime.bb's own
;; pid-alive?/operator-running? checks do for the disposable LLM Operator.
;;
;; Usage:
;;   front_desk_supervisor.bb <project-root> [--check-once]
;;
;; Env:
;;   FRONT_DESK_INTERVAL_MS        loop sleep between checks (default 2000)
;;   FRONT_DESK_MAX_ATTEMPTS       bounded restart cap per process (default 5)
;;   FRONT_DESK_BACKOFF_BASE_MS / FRONT_DESK_BACKOFF_MAX_MS
;;   BRIDGE_PORT                   fixed port the bridge listens on (default 8765)
;;   BRIDGE_TOKEN                  shared bridge token - provisioned by
;;                                 launch_front_desk.sh, never generated here
;;   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TELEGRAM_PRINCIPAL_USER_ID
;;                                 required for the bot (validated by the
;;                                 bot's own CLI, not re-validated here)

(ns front-desk-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "front_desk_supervisor_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: front_desk_supervisor.bb <project-root> [--check-once]"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))
(def check-once? (some #{"--check-once"} *command-line-args*))

(def op-dir (fs/path project-root ".swarmforge" "operator"))
(def pid-file (fs/path op-dir "front-desk-supervisor.pid"))
(def stop-file (fs/path op-dir "front-desk-supervisor.stop"))
(def status-file (fs/path op-dir "front-desk-supervisor.status.json"))
(def log-file (fs/path op-dir "front-desk-supervisor.log"))

(def ext-out-dir (fs/path project-root "extension" "out" "tools"))
(def bridge-entrypoint (fs/path ext-out-dir "start-bridge-headless.js"))
(def bot-entrypoint (fs/path ext-out-dir "telegram-front-desk-bot.js"))

(defn env-long [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-long "FRONT_DESK_INTERVAL_MS" 2000))
(def restart-config
  {:max-attempts (env-long "FRONT_DESK_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-long "FRONT_DESK_BACKOFF_BASE_MS" 1000)
   :backoff-max-ms (env-long "FRONT_DESK_BACKOFF_MAX_MS" 60000)})
(def bridge-port (env-long "BRIDGE_PORT" 8765))

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

;; ── per-process specs ─────────────────────────────────────────────────────
;; A data-driven table (mirrors bridgeServer.ts's own JsonRoute/WriteRoute
;; tables and telegram-bridge.ts's ACTIONS table): a third supervised
;; process is a new row here, never a new branch in check-one! below.
;; Ordering matters - the bridge must already be listening before the
;; bot's first auth attempt, so process-specs is iterated in this exact
;; order every tick, never shuffled.

(defn spawn-bridge! []
  (process/process {:out :inherit :err :inherit
                     :extra-env {"BRIDGE_TOKEN" (System/getenv "BRIDGE_TOKEN")}}
                    "node" (str bridge-entrypoint) project-root (str bridge-port)))

(defn spawn-bot! []
  (process/process {:out :inherit :err :inherit
                     :extra-env {"TELEGRAM_BOT_TOKEN" (System/getenv "TELEGRAM_BOT_TOKEN")
                                 "TELEGRAM_CHAT_ID" (System/getenv "TELEGRAM_CHAT_ID")
                                 "TELEGRAM_PRINCIPAL_USER_ID" (System/getenv "TELEGRAM_PRINCIPAL_USER_ID")
                                 "BRIDGE_TOKEN" (System/getenv "BRIDGE_TOKEN")
                                 "BRIDGE_CONTROL_TOKEN" (System/getenv "BRIDGE_TOKEN")}}
                    "node" (str bot-entrypoint) (str "http://127.0.0.1:" bridge-port) project-root))

(def process-specs
  [{:key :bridge :spawn! spawn-bridge!}
   {:key :bot :spawn! spawn-bot!}])

;; ── persisted state (JSON: {"bridge": {...}, "bot": {...}}) ───────────────

(defn default-entry [] {:pid nil :attempts 0 :status "not-started" :crashed-at-ms nil})

(defn read-state []
  (if (fs/exists? status-file)
    (try (json/parse-string (slurp (str status-file)) true) (catch Exception _ {}))
    {}))

(defn write-status! [state]
  (atomic-spit! status-file (json/generate-string (assoc state :updated_at (now-iso)))))

(defn start! [spec entry]
  (let [proc ((:spawn! spec))
        pid (.pid (:proc proc))
        attempts (inc (:attempts entry))]
    (log! "started" (name (:key spec)) "pid=" (str pid) "attempt=" (str attempts))
    {:pid pid :attempts attempts :status "running" :crashed-at-ms nil}))

;; One process's own check-and-react, split out of tick! so that function's
;; own branch count stays low - a crash transitions straight to "waiting"
;; (the backoff timer starts NOW, at detection time), a due backoff either
;; restarts (bounded) or gives up permanently (front_desk_supervisor_lib.bb's
;; pure decision, never re-evaluated once given up).
(defn check-one! [spec entry]
  (case (:status entry)
    "not-started"
    (start! spec entry)

    "running"
    (if (pid-alive? (:pid entry))
      entry
      (do
        (log! "crashed" (name (:key spec)) "attempt=" (str (:attempts entry)))
        (assoc entry :status "waiting" :crashed-at-ms (now-ms))))

    "waiting"
    (let [due-ms (+ (:crashed-at-ms entry) (front-desk-supervisor-lib/compute-backoff-ms (:attempts entry) restart-config))]
      (if (< (now-ms) due-ms)
        entry
        (if (= :restart (front-desk-supervisor-lib/decide-restart-action (:attempts entry) restart-config))
          (start! spec entry)
          (do
            (log! "gave-up" (name (:key spec)) "after" (str (:attempts entry)) "attempt(s)")
            (assoc entry :status "gave-up")))))

    entry))

(defn tick! []
  (let [prior (read-state)
        next-state (into {} (map (fn [spec] [(:key spec) (check-one! spec (merge (default-entry) (get prior (:key spec))))])) process-specs)]
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
  (if check-once?
    (println (json/generate-string (tick!)))
    (do
      (atomic-spit! pid-file (str (.pid (java.lang.ProcessHandle/current))))
      (log! "front-desk-supervisor started" (str "interval-ms=" interval-ms))
      (try
        (while (not (fs/exists? stop-file))
          (try (tick!) (catch Exception e (log! "tick-error" (.getMessage e))))
          (Thread/sleep interval-ms))
        (finally
          (stop-all!)
          (fs/delete-if-exists pid-file)
          (log! "front-desk-supervisor stopped"))))))

(-main)
