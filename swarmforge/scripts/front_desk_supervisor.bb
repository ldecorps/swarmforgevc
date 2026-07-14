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
;; BL-370: also reads the bot's own poll-cycle heartbeat
;; (.swarmforge/operator/front-desk-poll-heartbeat.json, written by
;; telegram-front-desk-bot.ts on every COMPLETED poll cycle) and treats a
;; "running" bot whose heartbeat has gone stale as needing the same
;; bounded restart a crash gets - a live pid is not proof it is still
;; listening. Restarts stopping at the cap is escalated to the human via
;; email, reusing operator_lib.bb's own BL-345 delivery-based alarm arming
;; (classify-delivery-result/starvation-alarm-should-attempt?/
;; next-starvation-alarm-state) rather than a parallel implementation -
;; never armed on a mere attempt, only on confirmed delivery.
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
;;   FRONT_DESK_STALL_MS           bot poll-heartbeat staleness window (default 90000)
;;   FRONT_DESK_ESCALATION_MAX_ATTEMPTS bounded retry cap on the give-up
;;                                 escalation email (default 5)
;;   FRONT_DESK_ESCALATION_BACKOFF_BASE_MS / FRONT_DESK_ESCALATION_BACKOFF_MAX_MS
;;   FRONT_DESK_ESCALATION_FORCE_RESULT  test-only: JSON send-result override,
;;                                 short-circuits the real send entirely
;;                                 (mirrors operator_runtime.bb's own
;;                                 OPERATOR_ALARM_FORCE_RESULT seam)
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
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_alarm_lib.bb")))

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
;; BL-370: written by telegram-front-desk-bot.ts's pollLoop on every
;; COMPLETED poll cycle - the SAME path/shape read-poll-heartbeat-ms below
;; parses.
(def poll-heartbeat-file (fs/path op-dir "front-desk-poll-heartbeat.json"))
(def escalation-state-file (fs/path op-dir "front-desk-escalation-alarm.json"))
(def conf-file (fs/path project-root "swarmforge" "swarmforge.conf"))

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

;; BL-370: how long the bot's poll heartbeat can go quiet before it is
;; treated as stalled. Default 90s - a healthy long-poll (25s timeout,
;; POLL_TIMEOUT_SECONDS in telegram-front-desk-bot.ts) completes well
;; inside this window even accounting for network latency; a genuinely
;; stuck loop misses it by a wide margin.
(def stall-ms (env-long "FRONT_DESK_STALL_MS" 90000))

;; BL-370 (scenario 05): same bounded-retry-with-backoff shape as
;; operator_runtime.bb's own alarm-retry-config for the starvation alarm -
;; independently defined here rather than cross-namespace-coupled, same
;; small-duplication rationale as this codebase's other independent
;; adapters.
(def escalation-retry-config
  {:max-attempts (env-long "FRONT_DESK_ESCALATION_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-long "FRONT_DESK_ESCALATION_BACKOFF_BASE_MS" 60000)
   :backoff-max-ms (env-long "FRONT_DESK_ESCALATION_BACKOFF_MAX_MS" 1800000)})

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

;; BL-370: reads the SAME {lastHeartbeatMs} JSON telegram-front-desk-bot.ts
;; writes on every completed poll cycle. Never throws on a missing/corrupt
;; file - front-desk-supervisor-lib/poll-heartbeat-stale? already treats a
;; nil value as stale, so "the bot has not written one yet" and "the bot
;; stopped writing one" both correctly read as stalled.
(defn read-poll-heartbeat-ms []
  (when (fs/exists? poll-heartbeat-file)
    (try (:lastHeartbeatMs (json/parse-string (slurp (str poll-heartbeat-file)) true))
         (catch Exception _ nil))))

;; ── per-process specs ─────────────────────────────────────────────────────
;; A data-driven table (mirrors bridgeServer.ts's own JsonRoute/WriteRoute
;; tables and telegram-bridge.ts's ACTIONS table): a third supervised
;; process is a new row here, never a new branch in check-one! below.
;; Ordering matters - the bridge must already be listening before the
;; bot's first auth attempt, so process-specs is iterated in this exact
;; order every tick, never shuffled.
;;
;; BL-370: :heartbeat-stale? is a 1-arg (now-ms) predicate, present on
;; every spec so tick! below can call it uniformly - the bridge has no
;; poll-heartbeat concept at all, so its own entry is a constant false
;; rather than a special case in the calling code.

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
  [{:key :bridge :spawn-pid! (fn [] (.pid (:proc (spawn-bridge!)))) :heartbeat-stale? (constantly false)}
   {:key :bot :spawn-pid! (fn [] (.pid (:proc (spawn-bot!))))
    :heartbeat-stale? (fn [now] (front-desk-supervisor-lib/poll-heartbeat-stale? (read-poll-heartbeat-ms) now stall-ms))}])

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
    ;; BL-370: distinct from :crashed - the pid never died, the poll
    ;; heartbeat just went stale. Logged separately so a human grepping
    ;; the log (or the acceptance suite) can tell the two failure modes
    ;; apart even though they recover through the identical mechanism.
    :stalled (log! "stalled" (name spec-key) "no poll heartbeat within" (str stall-ms) "ms")
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

;; ── BL-370 (scenarios 04/05): give-up escalation ────────────────────────────
;; Restarts stopping at the cap must reach a human LOUDLY - and the alarm
;; whose whole purpose is to break a silence must not itself fail silently
;; (constitution: a repeat-suppression flag is set on CONFIRMED DELIVERY,
;; never an attempt). Reuses operator_lib.bb's own BL-345 delivery-based
;; arming wholesale rather than a parallel implementation.

(defn read-escalation-state []
  (if (fs/exists? escalation-state-file)
    (try (json/parse-string (slurp (str escalation-state-file)) true) (catch Exception _ {}))
    {}))

(defn write-escalation-state! [m]
  (atomic-spit! escalation-state-file (json/generate-string m)))

;; BL-215/BL-326's own pattern, mirrored exactly: warn ONCE per process on a
;; configured-but-keyless alarm.
(def escalation-email-key-warned? (atom false))

(defn- escalation-email-text [spec-key entry]
  (str "The front desk's " (name spec-key) " process stopped and gave up "
       "restarting itself after " (:attempts entry) " attempt(s) - it needs "
       "a human. Check swarmforge/scripts/front_desk_supervisor.bb's log "
       "(front-desk-supervisor.log) and restart it by hand."))

;; BL-345's own E2E test seam, mirrored: lets the acceptance suite script a
;; deterministic send outcome (success, transient failure, ...) without
;; ever reaching daemon-alarm-lib or the network.
(defn send-escalation-email! [spec-key subject text]
  (if-let [forced (System/getenv "FRONT_DESK_ESCALATION_FORCE_RESULT")]
    (json/parse-string forced true)
    (daemon-alarm-lib/send-configured-email!
     project-root conf-file subject text
     {:already-warned?! (fn [] @escalation-email-key-warned?)
      :log-warning! (fn [msg] (log! "escalation-email-misconfigured" (name spec-key) msg))
      :mark-warned! (fn [] (reset! escalation-email-key-warned? true))})))

;; Runs every tick over EVERY process's just-computed next-state (not only
;; the one that gave up THIS tick) - "gave-up" is a persisted status, so a
;; human must still be told even on a tick where nothing transitioned.
;; Applies uniformly to bridge and bot alike: "restarts are bounded, and
;; giving up is loud" is a general property of this supervisor, not
;; specific to a stall-triggered give-up (a crash-loop give-up is exactly
;; as urgent - either way the front desk is down).
;; BL-370 bugfix (caught by this ticket's own scenario 05 test): the
;; persisted state's keys MUST stay keywords end to end, matching
;; read-state/write-status!'s own convention - json/parse-string's
;; keywordize-keys turns "bot" back into :bot on every read, so building
;; `next` with a STRING key (name (:key spec)) meant every (get prev k {})
;; lookup silently missed and fell back to {}, resetting delivery-attempts
;; to 0 (and effectively re-attempting on every tick, forever) instead of
;; ever seeing what the prior tick actually persisted.
(defn escalate-gave-up! [state now]
  (let [prev (read-escalation-state)
        next (into {}
                   (map (fn [spec]
                          (let [k (:key spec)
                                entry (get state k)
                                given-up? (= "gave-up" (:status entry))
                                prev-alarm (get prev k {})]
                            [k (cond
                                 (not given-up?)
                                 {:armed? false :delivery-attempts 0 :last-attempt-at-ms nil}

                                 (not (operator-lib/starvation-alarm-should-attempt?
                                       {:starving? true :armed? (boolean (:armed? prev-alarm))
                                        :delivery-attempts (:delivery-attempts prev-alarm)
                                        :last-attempt-at-ms (:last-attempt-at-ms prev-alarm)
                                        :now-ms now :retry-config escalation-retry-config}))
                                 prev-alarm

                                 :else
                                 (let [result (send-escalation-email!
                                               k
                                               (str "SwarmForge: front desk " (name k) " has given up restarting")
                                               (escalation-email-text k entry))
                                       outcome (operator-lib/classify-delivery-result result)
                                       {:keys [armed? delivery-attempts last-attempt-at-ms gave-up?]}
                                       (operator-lib/next-starvation-alarm-state outcome prev-alarm escalation-retry-config now)]
                                   (apply log! "escalation" (name k) (name outcome)
                                          (remove nil? [(when gave-up? "ESCALATION-RETRY-CAP-HIT")]))
                                   {:armed? armed? :delivery-attempts delivery-attempts :last-attempt-at-ms last-attempt-at-ms}))]))
                        process-specs))]
    (write-escalation-state! next)))

(defn tick! []
  (let [prior (read-state)
        now (now-ms)
        next-state (into {}
                          (map (fn [spec]
                                 (let [entry (merge (front-desk-supervisor-lib/default-entry) (get prior (:key spec)))
                                       heartbeat-stale? ((:heartbeat-stale? spec) now)
                                       {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                                                               entry now pid-alive? (:spawn-pid! spec) restart-config giveup-config heartbeat-stale?)
                                       entry (stamp-build-sha entry event)]
                                   (log-event! (:key spec) event entry)
                                   [(:key spec) entry])))
                          process-specs)]
    (write-status! next-state)
    (escalate-gave-up! next-state now)
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
