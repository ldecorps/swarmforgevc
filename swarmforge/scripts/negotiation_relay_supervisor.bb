#!/usr/bin/env bb
;; BL-381 QA bounce: the live trigger for the onboarding negotiation relay's
;; `poll` action - nothing in the live swarm called it on a recurring basis,
;; so a human's objection/agreement in a target's negotiation topic was never
;; actually picked up without running the CLI by hand. This supervises ONE
;; `relay-onboarding-negotiation-telegram.js poll-loop` child process for ONE
;; provisioned target, mirroring front_desk_supervisor.bb's own spawn/crash-
;; detect/bounded-restart-with-backoff shape and reusing its pure state
;; machine wholesale (front_desk_supervisor_lib.bb's check-one!/default-entry/
;; poll-heartbeat-stale? are already adapter-injected and process-agnostic -
;; never a second, drifting copy of that decision).
;;
;; Unlike front_desk_supervisor.bb (one fixed project, one bridge + one bot),
;; a target repo is a DIFFERENT filesystem path from the swarm's own repo, so
;; this script takes both: the swarm repo root (to resolve the compiled CLI
;; entrypoint) and the target repo path (to resolve where the relay's own
;; state - offset, heartbeat, and this supervisor's own pid/status/log -
;; already lives, alongside contract.yaml and telegram-channel.json). One
;; supervisor instance per provisioned target; launch_negotiation_relay.sh
;; is the idempotent entry point an operator runs once per target, same
;; posture as BL-380's own provisioning CLI.
;;
;; The relay's own poll-loop action already retries transient failures
;; forever via its internal runContainedLoop (a thrown getUpdates/etc error
;; restarts the SAME process after a short delay, never exiting) - this
;; supervisor's bounded-restart-then-give-up policy is the outer safety net
;; for when the OS PROCESS itself dies (crash, OOM, `node` not found), not a
;; duplicate of that inner retry.
;;
;; Usage:
;;   negotiation_relay_supervisor.bb <swarm-repo-root> <target-repo-path> <host-secrets-file-path> [--check-once]
;;
;; Env:
;;   TELEGRAM_PRINCIPAL_USER_ID          required - the one authorized sender (BL-379 guard)
;;   NEGOTIATION_RELAY_INTERVAL_MS        loop sleep between checks (default 2000)
;;   NEGOTIATION_RELAY_MAX_ATTEMPTS       bounded restart cap (default 5)
;;   NEGOTIATION_RELAY_BACKOFF_BASE_MS / NEGOTIATION_RELAY_BACKOFF_MAX_MS
;;   NEGOTIATION_RELAY_HEALTHY_RESET_MS   continuous-uptime attempt reset (default 600000)
;;   NEGOTIATION_RELAY_GIVEUP_COOLDOWN_MS give-up re-arm cooldown (default 900000)
;;   NEGOTIATION_RELAY_STALL_MS           poll-heartbeat staleness window (default 90000)
;;   NEGOTIATION_RELAY_ESCALATION_MAX_ATTEMPTS bounded retry cap on the give-up
;;                                         escalation email (default 5)
;;   NEGOTIATION_RELAY_ESCALATION_BACKOFF_BASE_MS / NEGOTIATION_RELAY_ESCALATION_BACKOFF_MAX_MS
;;   NEGOTIATION_RELAY_ESCALATION_FORCE_RESULT  test-only: JSON send-result override,
;;                                         short-circuits the real send entirely
;;   NEGOTIATION_RELAY_KILL_GRACE_MS       SIGTERM->SIGKILL grace period, ms (default 2000)

(ns negotiation-relay-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "front_desk_supervisor_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_alarm_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: negotiation_relay_supervisor.bb <swarm-repo-root> <target-repo-path> <host-secrets-file-path> [--check-once]"))
  (System/exit 1))

(def swarm-repo-root (or (first *command-line-args*) (usage)))
(def target-repo-path (or (second *command-line-args*) (usage)))
(def host-secrets-file-path (or (nth *command-line-args* 2 nil) (usage)))
(def check-once? (some #{"--check-once"} *command-line-args*))

(def op-dir (fs/path target-repo-path ".swarmforge" "operator"))
(def pid-file (fs/path op-dir "negotiation-relay-supervisor.pid"))
(def stop-file (fs/path op-dir "negotiation-relay-supervisor.stop"))
(def status-file (fs/path op-dir "negotiation-relay-supervisor.status.json"))
(def log-file (fs/path op-dir "negotiation-relay-supervisor.log"))
;; Written by relay-onboarding-negotiation-telegram.ts's pollLoop on every
;; COMPLETED poll cycle - the same {lastHeartbeatMs} shape
;; front-desk-poll-heartbeat.json already established.
(def poll-heartbeat-file (fs/path op-dir "negotiation-relay-poll-heartbeat.json"))
(def escalation-state-file (fs/path op-dir "negotiation-relay-escalation-alarm.json"))
(def conf-file (fs/path swarm-repo-root "swarmforge" "swarmforge.conf"))

(def relay-entrypoint (fs/path swarm-repo-root "extension" "out" "tools" "relay-onboarding-negotiation-telegram.js"))

(defn env-long [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-long "NEGOTIATION_RELAY_INTERVAL_MS" 2000))
(def restart-config
  {:max-attempts (env-long "NEGOTIATION_RELAY_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-long "NEGOTIATION_RELAY_BACKOFF_BASE_MS" 1000)
   :backoff-max-ms (env-long "NEGOTIATION_RELAY_BACKOFF_MAX_MS" 60000)
   :healthy-reset-ms (env-long "NEGOTIATION_RELAY_HEALTHY_RESET_MS" 600000)})
(def giveup-config {:giveup-cooldown-ms (env-long "NEGOTIATION_RELAY_GIVEUP_COOLDOWN_MS" 900000)})

;; How long the relay's own poll heartbeat can go quiet before it is treated
;; as stalled. Default 90s - comfortably wider than the relay's own 25s
;; long-poll timeout even accounting for network latency.
(def stall-ms (env-long "NEGOTIATION_RELAY_STALL_MS" 90000))

(def escalation-retry-config
  {:max-attempts (env-long "NEGOTIATION_RELAY_ESCALATION_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-long "NEGOTIATION_RELAY_ESCALATION_BACKOFF_BASE_MS" 60000)
   :backoff-max-ms (env-long "NEGOTIATION_RELAY_ESCALATION_BACKOFF_MAX_MS" 1800000)})

;; BL-411: this supervisor is check-one!'s OTHER caller (front_desk_supervisor.bb,
;; BL-403, is the first) and had never passed a kill-pid! adapter, so a
;; restart never terminated the prior relay poll-loop child - two children
;; then long-poll Telegram getUpdates on the SAME bot token at once (HTTP
;; 409, unreliable/duplicated/dropped delivery). The kill semantics
;; themselves are shared with front_desk_supervisor.bb via
;; front-desk-supervisor-lib/make-kill-pid! (see its own docstring) so
;; there is exactly one SIGTERM->grace->SIGKILL implementation, not two
;; drifting copies.
(def kill-grace-ms (env-long "NEGOTIATION_RELAY_KILL_GRACE_MS" 2000))
(def kill-pid! (front-desk-supervisor-lib/make-kill-pid! kill-grace-ms))

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

(defn spawn-relay! []
  (process/process {:out :inherit :err :inherit
                     :extra-env {"TELEGRAM_PRINCIPAL_USER_ID" (System/getenv "TELEGRAM_PRINCIPAL_USER_ID")}}
                    "node" (str relay-entrypoint) target-repo-path host-secrets-file-path "poll-loop"))

(def process-specs
  [{:key :relay :spawn-pid! (fn [] (.pid (:proc (spawn-relay!))))
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
    :stalled (log! "stalled" (name spec-key) "no poll heartbeat within" (str stall-ms) "ms")
    :healthy-reset (log! "healthy-reset" (name spec-key))
    :gave-up (log! "gave-up" (name spec-key) "after" (str (:attempts entry)) "attempt(s)")
    :re-armed (log! "re-armed" (name spec-key) "pid=" (str (:pid entry)))
    nil))

;; ── give-up escalation (mirrors front_desk_supervisor.bb's own, one
;;    process-spec instead of two) ────────────────────────────────────────

(defn read-escalation-state []
  (if (fs/exists? escalation-state-file)
    (try (json/parse-string (slurp (str escalation-state-file)) true) (catch Exception _ {}))
    {}))

(defn write-escalation-state! [m]
  (atomic-spit! escalation-state-file (json/generate-string m)))

(def escalation-email-key-warned? (atom false))

(defn- escalation-email-text [entry]
  (str "The onboarding negotiation relay for " target-repo-path " stopped and "
       "gave up restarting itself after " (:attempts entry) " attempt(s) - it "
       "needs a human. Check " (str log-file) " and restart it by hand "
       "(launch_negotiation_relay.sh " target-repo-path " " host-secrets-file-path ")."))

(defn send-escalation-email! [subject text]
  (if-let [forced (System/getenv "NEGOTIATION_RELAY_ESCALATION_FORCE_RESULT")]
    (json/parse-string forced true)
    (daemon-alarm-lib/send-configured-email!
     target-repo-path conf-file subject text
     {:already-warned?! (fn [] @escalation-email-key-warned?)
      :log-warning! (fn [msg] (log! "escalation-email-misconfigured" msg))
      :mark-warned! (fn [] (reset! escalation-email-key-warned? true))})))

(defn escalate-gave-up! [state now]
  (let [prev (read-escalation-state)
        entry (get state :relay)
        given-up? (= "gave-up" (:status entry))
        prev-alarm (get prev :relay {})
        next-alarm
        (cond
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
                        "SwarmForge: onboarding negotiation relay has given up restarting"
                        (escalation-email-text entry))
                outcome (operator-lib/classify-delivery-result result)
                {:keys [armed? delivery-attempts last-attempt-at-ms gave-up?]}
                (operator-lib/next-starvation-alarm-state outcome prev-alarm escalation-retry-config now)]
            (apply log! "escalation" "relay" (name outcome)
                   (remove nil? [(when gave-up? "ESCALATION-RETRY-CAP-HIT")]))
            {:armed? armed? :delivery-attempts delivery-attempts :last-attempt-at-ms last-attempt-at-ms}))]
    (write-escalation-state! {:relay next-alarm})))

(defn tick! []
  (let [prior (read-state)
        now (now-ms)
        next-state (into {}
                          (map (fn [spec]
                                 (let [entry (merge (front-desk-supervisor-lib/default-entry) (get prior (:key spec)))
                                       heartbeat-stale? ((:heartbeat-stale? spec) now)
                                       ;; BL-411: kill-pid! (the 9th arg) is
                                       ;; the fix - without it, check-one!'s
                                       ;; own bounded-restart clause defaults
                                       ;; to a no-op and never terminates the
                                       ;; superseded relay child before
                                       ;; spawning its replacement (proven by
                                       ;; test_negotiation_relay_supervisor_tick.sh's
                                       ;; real-subprocess old-pid-is-dead check).
                                       {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                                                               entry now pid-alive? (:spawn-pid! spec) restart-config giveup-config heartbeat-stale? kill-pid!)]
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
      (log! "negotiation-relay-supervisor started" (str "interval-ms=" interval-ms) "target=" target-repo-path)
      (try
        (while (not (fs/exists? stop-file))
          (try (tick!) (catch Exception e (log! "tick-error" (.getMessage e))))
          (Thread/sleep interval-ms))
        (finally
          (stop-all!)
          (fs/delete-if-exists pid-file)
          (log! "negotiation-relay-supervisor stopped"))))))

(-main)
