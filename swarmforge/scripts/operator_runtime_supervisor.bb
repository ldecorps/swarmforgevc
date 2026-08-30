#!/usr/bin/env bb
;; BL-993: the always-on watch for operator_runtime.bb. Every other
;; long-lived process in this swarm has something that keeps it alive
;; (handoffd_supervisor.bb, front_desk_supervisor.bb,
;; bridge_headless_supervisor.bb, negotiation_relay_supervisor.bb,
;; cursor_bridge_supervisor.bb); operator_runtime.bb had none - the only
;; repair path (swarm_ensure.bb's operator-healthy?/ensure-operator!) runs
;; only when a human types `./swarm ensure`. This is a SEPARATE, always-on
;; process (invariant 3: never hosted by, or dependent on, operator_runtime.bb
;; itself) launched once at swarm boot by
;; launch_operator_runtime_supervisor.sh, and stopped alongside
;; operator-runtime by stop_ancillary_services.sh's stop_operator_runtime.
;;
;; Deliberately TELL + RESTART, not handoffd_supervisor.bb's own
;; alarm-and-halt (BL-144) - that posture is right for the swarm's single
;; transport, wrong here (the human directive is explicit: prefer restart
;; for operator-runtime itself, since leaving it dead silently defeats
;; BL-906's own babysitterd watchdog, which operator-runtime hosts).
;;
;; Reuses front_desk_supervisor_lib.bb's check-one! wholesale for the
;; bounded-restart-with-backoff decision (same convention
;; negotiation_relay_supervisor.bb already established for a single
;; supervised child - never a second, drifting copy of that state machine)
;; and operator_runtime_watch_lib.bb for the one true liveness/stop
;; decision - the SAME check swarm_ensure.bb's operator-healthy? and
;; swarm_status.bb's operator-runtime row now also delegate to (BL-993
;; architect bounce: this must never be a second, diverging liveness
;; check - see operator_runtime_watch_lib.bb's own header).
;;
;; Restart goes THROUGH start_operator_runtime.sh (this feature's own
;; Background: "the operator runtime is started through its normal entry
;; point") - not a direct `bb operator_runtime.bb` spawn, which would skip
;; that script's own prior-runtime cleanup, log rotation, and
;; SWARMFORGE_SKIP_OPERATOR gate. start_operator_runtime.sh runs
;; synchronously (it already waits for the new pid to claim runtime.pid
;; itself) and this supervisor re-reads the pidfile afterward - never a
;; second pid-wait loop.
;;
;; Usage:
;;   operator_runtime_supervisor.bb <project-root> [--check-once]
;;
;; Env overrides (test seams, mirroring swarm_ensure.bb's own):
;;   OPERATOR_WATCH_INTERVAL_MS         loop sleep between checks (default 15000)
;;   OPERATOR_WATCH_MAX_ATTEMPTS        bounded restart cap (default 5)
;;   OPERATOR_WATCH_BACKOFF_BASE_MS / OPERATOR_WATCH_BACKOFF_MAX_MS
;;   OPERATOR_WATCH_HEALTHY_RESET_MS    continuous-uptime attempt reset (default 600000)
;;   OPERATOR_WATCH_GIVEUP_COOLDOWN_MS  give-up re-arm cooldown (default 900000)
;;   OPERATOR_WATCH_START_CMD           substitutes start_operator_runtime.sh
;;                                       (QA's own e2e procedure step 7: point
;;                                       this at a stub that exits non-zero)
;;   OPERATOR_WATCH_NOTIFY_CMD          substitutes the human-channel announce

(ns operator-runtime-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "front_desk_supervisor_lib.bb")))
(load-file (str (fs/path script-dir "operator_runtime_watch_lib.bb")))
(load-file (str (fs/path script-dir "operator_telegram_lib.bb")))
(load-file (str (fs/path script-dir "daemon_log_freshness_pulse_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_runtime_supervisor.bb <project-root> [--check-once]"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))
(def check-once? (some #{"--check-once"} *command-line-args*))

(def op-dir (fs/path project-root ".swarmforge" "operator"))
(def pid-file (fs/path op-dir "operator-runtime-supervisor.pid"))
(def stop-file (fs/path op-dir "operator-runtime-supervisor.stop"))
(def status-file (fs/path op-dir "operator-runtime-supervisor.status.json"))
(def log-file (fs/path op-dir "operator-runtime-supervisor.log"))

(defn env-long [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-long "OPERATOR_WATCH_INTERVAL_MS" 15000))
(def restart-config
  {:max-attempts (env-long "OPERATOR_WATCH_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-long "OPERATOR_WATCH_BACKOFF_BASE_MS" 2000)
   :backoff-max-ms (env-long "OPERATOR_WATCH_BACKOFF_MAX_MS" 60000)
   :healthy-reset-ms (env-long "OPERATOR_WATCH_HEALTHY_RESET_MS" 600000)})
(def giveup-config {:giveup-cooldown-ms (env-long "OPERATOR_WATCH_GIVEUP_COOLDOWN_MS" 900000)})

(def start-cmd
  (or (System/getenv "OPERATOR_WATCH_START_CMD")
      (str "bash " (fs/path script-dir "start_operator_runtime.sh") " " project-root)))

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

;; ── human-channel announce (BL-993 invariant 2/scenario 04) - mirrors
;;    swarm_ensure.bb's own notify-rc-repair!: reuses operator_telegram_lib's
;;    send-message-request (the SAME primitive the live bot posts through),
;;    the same telegram-configured? gate front-desk already uses, and the
;;    SAME env-override test seam shape as SWARM_ENSURE_RC_NOTIFY_CMD. A
;;    no-op when Telegram isn't configured - the outcome is still visible in
;;    this supervisor's own log/status either way (invariant 2: recorded,
;;    not just announced). ─────────────────────────────────────────────────
(defn env-set? [name]
  (let [v (System/getenv name)] (and (some? v) (not (str/blank? v)))))

(defn telegram-configured? []
  (and (env-set? "TELEGRAM_BOT_TOKEN") (env-set? "TELEGRAM_CHAT_ID") (env-set? "TELEGRAM_PRINCIPAL_USER_ID")))

(def notify-cmd (System/getenv "OPERATOR_WATCH_NOTIFY_CMD"))

(defn announce! [text]
  (log! "announce" text)
  (cond
    notify-cmd
    (process/sh {:continue true} notify-cmd text)

    (telegram-configured?)
    (let [{:keys [url form-params]}
          (operator-telegram-lib/send-message-request
           (System/getenv "TELEGRAM_BOT_TOKEN") (System/getenv "TELEGRAM_CHAT_ID") text)]
      (process/sh {:continue true} "curl" "-fsS" "-X" "POST"
                  "-d" (str "chat_id=" (:chat_id form-params))
                  "-d" (str "text=" (:text form-params))
                  "-d" "disable_web_page_preview=true"
                  url))

    :else nil))

;; ── the tracked entry - persisted across ticks so a restarted supervisor
;;    process resumes attempt/backoff state rather than forgetting it ──────

(defn read-state []
  (if (fs/exists? status-file)
    (try (:entry (json/parse-string (slurp (str status-file)) true)) (catch Exception _ nil))
    nil))

(defn write-status! [entry state-tag reason]
  (atomic-spit! status-file
                (json/generate-string {:state state-tag :reason reason :entry entry :updated_at (now-iso)})))

(defn spawn-operator!
  "Runs start_operator_runtime.sh (already synchronous - it waits for the
   new process to claim runtime.pid or fails within its own bound) and
   re-reads the pidfile. Returns nil (never throws) when the start command
   itself failed or never claimed a pid - check-one!'s own bounded-restart
   clause then sees a dead :pid on the very next tick and continues the
   backoff sequence exactly as it would for a crash."
  []
  (let [{:keys [exit]} (process/sh {:continue true} "sh" "-c" start-cmd)]
    (when-not (zero? exit)
      (log! "start-cmd-failed" (str "exit=" exit))))
  (operator-runtime-watch-lib/read-pid project-root))

;; BL-1224: an adoption is NOT announced to the human - it is not an incident -
;; but it must be visible here and in the status file, or a post-mortem cannot
;; tell a handover from a tick that did nothing (invariant 3).
;;
;; The default arm no longer swallows an unknown event. It used to return nil,
;; which is how :adopted would have been silently invisible had this arm not
;; been added - the same fail-safe direction announcement-for-event already
;; takes for its own default, and for the same reason: a new event should be
;; noisy and wrong rather than quiet and missing.
(defn log-event! [event entry]
  (case event
    :started (log! "started" "pid=" (str (:pid entry)) "attempt=" (str (:attempts entry)))
    :crashed (log! "crashed" "attempt=" (str (:attempts entry)))
    :healthy-reset (log! "healthy-reset")
    :gave-up (log! "gave-up" "after" (str (:attempts entry)) "attempt(s)")
    :re-armed (log! "re-armed" "pid=" (str (:pid entry)))
    :adopted (log! "adopted" "pid=" (str (:pid entry))
                   "attempt=" (str (:attempts entry))
                   "reason=deliberate restart by another process")
    (when event (log! (name event)))))

;; The whole is-it-announced/what-does-it-say decision lives in
;; operator-runtime-watch-lib/announcement-for-event (gated on
;; announced-event?, the single source of truth) - this wrapper only owns
;; the announce! I/O. Never grow a second case dispatch here: the
;; 2026-08-21 architect bounce was exactly that - an independent
;; hand-written copy of the announced set that no test tied back to the
;; predicate (backlog/evidence/BL-993-bounce-20260821-architect.md).
(defn announce-for-event! [event entry]
  (some-> (operator-runtime-watch-lib/announcement-for-event event entry) announce!))

;; ── one check cycle ──────────────────────────────────────────────────────

(defn check! []
  (daemon-log-freshness-pulse-lib/append-log-heartbeat! log-file)
  (if (fs/exists? stop-file)
    (log! "skip" "stop file present; watch shutting down")
    (let [now (now-ms)
          prior (or (read-state)
                    (operator-runtime-watch-lib/initial-entry
                     (operator-runtime-watch-lib/healthy? project-root)
                     (operator-runtime-watch-lib/read-pid project-root)
                     now
                     front-desk-supervisor-lib/default-entry))
          {:keys [entry event stop-reason]}
          (operator-runtime-watch-lib/decide
           {:skip-env (operator-runtime-watch-lib/skip-env-set?)
            :parked (operator-runtime-watch-lib/parked? project-root)
            :entry prior :now-ms now
            :pid-alive? operator-runtime-watch-lib/pid-alive?
            :spawn! spawn-operator!
            :restart-config restart-config :giveup-config giveup-config
            :check-one-fn front-desk-supervisor-lib/check-one!
            ;; BL-1224: the discriminator between a crash and a handover. Read
            ;; fresh on every tick, because the whole point is that somebody
            ;; else may have rewritten it since the last one.
            :pidfile-pid (operator-runtime-watch-lib/read-pid project-root)})]
      (if (= :deliberately-stopped event)
        (do (log! "deliberately-stopped" stop-reason)
            (write-status! prior "deliberately-stopped" stop-reason))
        (do (log-event! event entry)
            (announce-for-event! event entry)
            (write-status! entry (:status entry) nil))))))

;; ── main ──────────────────────────────────────────────────────────────────

(defn -main []
  (fs/create-dirs op-dir)
  (if check-once?
    (check!)
    (do
      (atomic-spit! pid-file (str (.pid (java.lang.ProcessHandle/current))))
      (log! "operator-runtime-supervisor started" (str "interval-ms=" interval-ms))
      (try
        (while (not (fs/exists? stop-file))
          (try (check!) (catch Exception e (log! "check-error" (.getMessage e))))
          (Thread/sleep interval-ms))
        (finally
          (fs/delete-if-exists pid-file)
          (log! "operator-runtime-supervisor stopped"))))))

(-main)
