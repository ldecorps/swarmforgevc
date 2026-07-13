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
;; BL-303 (Defect B fix): "gave-up" was previously STICKY/TERMINAL and
;; attempts never reset - a crash burst (or isolated crashes accumulated
;; over the process's whole life) caused a PERMANENT outage. A "running"
;; child now resets its attempt count once continuously healthy past
;; FRONT_DESK_HEALTHY_RESET_MS (the cap counts CONSECUTIVE rapid crashes,
;; not lifetime ones), and "gave-up" is a TIMED state: once
;; FRONT_DESK_GIVEUP_COOLDOWN_MS elapses it re-arms with a fresh attempt
;; budget. Both decisions live in front_desk_supervisor_lib.bb's own
;; check-one! (now the WHOLE per-process state machine, pure/adapter-
;; injected); this script only supplies the real now-ms/pid-alive?/spawn!
;; and logs whatever :event comes back.
;;
;; Usage:
;;   front_desk_supervisor.bb <project-root> [--check-once]
;;
;; Env:
;;   FRONT_DESK_INTERVAL_MS        loop sleep between checks (default 2000)
;;   FRONT_DESK_MAX_ATTEMPTS       bounded restart cap per process (default 5)
;;   FRONT_DESK_BACKOFF_BASE_MS / FRONT_DESK_BACKOFF_MAX_MS
;;   FRONT_DESK_HEALTHY_RESET_MS   continuous-uptime attempt reset (default 600000)
;;   FRONT_DESK_GIVEUP_COOLDOWN_MS give-up re-arm cooldown (default 900000)
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
   :backoff-max-ms (env-long "FRONT_DESK_BACKOFF_MAX_MS" 60000)
   ;; BL-303: a "running" child continuously alive past this window has
   ;; proven it is not in a crash loop, so its attempt count resets to 0 -
   ;; the cap counts CONSECUTIVE rapid crashes, not lifetime-accumulated
   ;; ones. Default 10 minutes.
   :healthy-reset-ms (env-long "FRONT_DESK_HEALTHY_RESET_MS" 600000)})
;; BL-303: "gave-up" is a TIMED state, not terminal - once this (longer)
;; cooldown elapses the child re-arms with a fresh attempt budget. Default
;; 15 minutes - long enough to stay a bounded-RATE retry (never a tight
;; loop), short enough that a healed fault recovers without a human.
(def giveup-config {:giveup-cooldown-ms (env-long "FRONT_DESK_GIVEUP_COOLDOWN_MS" 900000)})
(def bridge-port (env-long "BRIDGE_PORT" 8765))

(defn now-ms [] (System/currentTimeMillis))
(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

;; ── BL-328: build identity (staleness detection) ────────────────────────────
;; This supervisor's OWN identity (a Babashka process; source loaded fresh
;; at THIS startup, held in memory until it exits) is captured ONCE here.
;; The bridge/bot's own identity is DIFFERENT - they are separate Node
;; processes reading extension/out/BUILD_SHA (compile-time-stamped,
;; extension/out/ is gitignored) at THEIR OWN startup - read fresh at the
;; moment each is (re)spawned below, since that is the exact instant a
;; freshly-spawned child will also read it (nothing else touches
;; extension/out/ in that window). Never a crash on git being unavailable.
(defn- capture-supervisor-build-sha! []
  (try
    (let [{:keys [exit out]} (process/sh {:continue true :dir project-root} "git" "rev-parse" "HEAD")]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

(def supervisor-build-sha (capture-supervisor-build-sha!))

(defn- read-node-build-sha! []
  (try
    (let [f (fs/path project-root "extension" "out" "BUILD_SHA")]
      (when (fs/exists? f) (str/trim (slurp (str f)))))
    (catch Exception _ nil)))

(defn log! [& parts]
  (fs/create-dirs op-dir)
  (spit (str log-file) (str (now-iso) " " (str/join " " parts) "\n") :append true))

;; ── BL-328 (4b): the respawn path must make the build current ITSELF ────────
;; The supervisor is the only actor awake in the window between a merge
;; landing and the coordinator's own step-0 sync running - it cannot
;; delegate a crash in that window to a sync that has not happened yet.
;; Checked fresh on every spawn (not just the first): once a recompile
;; succeeds, extension/out/BUILD_SHA matches main and every later check
;; in the SAME tick (bridge then bot, in that fixed order) sees "not
;; stale" and skips - this is what naturally bounds recompiling to once
;; per merge rather than once per crash, with no separate "did we already
;; compile this tick" state to track. Tiny duplicate of
;; build_freshness_lib.bb's own stale? comparison (small deliberate
;; duplication over a new cross-file coupling, matching this codebase's
;; own established convention) - never fabricates staleness when either
;; sha is unresolvable.
(defn- main-sha! []
  (try
    (let [{:keys [exit out]} (process/sh {:continue true :dir project-root} "git" "rev-parse" "main")]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

(defn- node-build-stale? []
  (let [running (read-node-build-sha!)
        main (main-sha!)]
    (boolean (and (seq running) (seq main) (not= running main)))))

;; Returns nil on success (nothing needed, or recompiled fine) or an error
;; string on a failed recompile. A failed recompile is deliberately NOT a
;; reason to refuse the respawn below - a front desk that stays down takes
;; the human's only channel with it, so the caller still brings the
;; process up on the stale build and surfaces this loudly instead.
(defn- ensure-current-build! []
  (when (node-build-stale?)
    (log! "stale-build-detected" "recompiling before respawn")
    (let [{:keys [exit err]} (process/sh {:continue true :dir (str (fs/path project-root "extension"))} "npm" "run" "compile")]
      (when-not (zero? exit)
        (str "npm run compile failed: " err)))))

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
  (when-let [err (ensure-current-build!)]
    (log! "degraded-respawn" "bridge" "stale build re-armed -" err))
  (process/process {:out :inherit :err :inherit
                     :extra-env {"BRIDGE_TOKEN" (System/getenv "BRIDGE_TOKEN")}}
                    "node" (str bridge-entrypoint) project-root (str bridge-port)))

(defn spawn-bot! []
  (when-let [err (ensure-current-build!)]
    (log! "degraded-respawn" "bot" "stale build re-armed -" err))
  (process/process {:out :inherit :err :inherit
                     :extra-env {"TELEGRAM_BOT_TOKEN" (System/getenv "TELEGRAM_BOT_TOKEN")
                                 "TELEGRAM_CHAT_ID" (System/getenv "TELEGRAM_CHAT_ID")
                                 "TELEGRAM_PRINCIPAL_USER_ID" (System/getenv "TELEGRAM_PRINCIPAL_USER_ID")
                                 "BRIDGE_TOKEN" (System/getenv "BRIDGE_TOKEN")
                                 "BRIDGE_CONTROL_TOKEN" (System/getenv "BRIDGE_TOKEN")}}
                    "node" (str bot-entrypoint) (str "http://127.0.0.1:" bridge-port) project-root))

(def process-specs
  [{:key :bridge :spawn-pid! (fn [] (.pid (:proc (spawn-bridge!))))}
   {:key :bot :spawn-pid! (fn [] (.pid (:proc (spawn-bot!))))}])

;; ── persisted state (JSON: {"bridge": {...}, "bot": {...}}) ───────────────

(defn read-state []
  (if (fs/exists? status-file)
    (try (json/parse-string (slurp (str status-file)) true) (catch Exception _ {}))
    {}))

(defn write-status! [state]
  (atomic-spit! status-file (json/generate-string (assoc state :updated_at (now-iso) :supervisor_build_sha supervisor-build-sha))))

;; BL-303: check-one!'s own state-machine decision now lives in
;; front_desk_supervisor_lib.bb (pure, adapter-injected) - this is just the
;; logging cue for whatever :event it returns, the one piece of real I/O
;; that decision itself never performs.
(defn log-event! [spec-key event entry]
  (case event
    :started (log! "started" (name spec-key) "pid=" (str (:pid entry)) "attempt=" (str (:attempts entry)))
    :crashed (log! "crashed" (name spec-key) "attempt=" (str (:attempts entry)))
    :healthy-reset (log! "healthy-reset" (name spec-key))
    :gave-up (log! "gave-up" (name spec-key) "after" (str (:attempts entry)) "attempt(s)")
    :re-armed (log! "re-armed" (name spec-key) "pid=" (str (:pid entry)))
    nil))

;; BL-328: a fresh spawn (:started or :re-armed - check-one!'s own two
;; "a NEW process was just started" events) gets ITS build_sha stamped
;; RIGHT NOW, reading extension/out/BUILD_SHA at the exact moment the
;; child was spawned - never re-read later, which would report whatever
;; the CURRENT on-disk build is rather than what that specific child
;; process actually loaded at its own boot. Every other event (:crashed,
;; :healthy-reset, nil, ...) leaves the entry's existing build_sha alone -
;; the still-running child's identity has not changed.
(defn- stamp-build-sha [entry event]
  (if (#{:started :re-armed} event)
    (assoc entry :build_sha (read-node-build-sha!))
    entry))

(defn tick! []
  (let [prior (read-state)
        now (now-ms)
        next-state (into {}
                          (map (fn [spec]
                                 (let [entry (merge (front-desk-supervisor-lib/default-entry) (get prior (:key spec)))
                                       {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                                                               entry now pid-alive? (:spawn-pid! spec) restart-config giveup-config)
                                       entry (stamp-build-sha entry event)]
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
