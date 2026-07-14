#!/usr/bin/env bb

;; BL-275: Support runtime SKELETON (slice 1 of the Support role epic,
;; BL-274) - mirrors operator_runtime.bb's heartbeat/status.json/event-queue/
;; disposable-LLM-wake shape, trimmed to this slice's scope: no provider-
;; cooldown detection and no dead-agent tracking (Support has no swarm
;; agents to scan), no reminder/close timers (that clock is BL-276). Support
;; is EXTERNAL to the swarm workflow, like the Operator: its own tmux
;; socket/session, never a swarmforge.conf pipeline window.
;;
;; This runtime does NOT touch the SUP-### thread store directly - that is
;; support_thread.bb's job (the disposable Support LLM, once launched, calls
;; it; see support_thread.bb's own docstring). This runtime only decides
;; WHEN to wake that disposable LLM: it watches for a dropped command file
;; (mirrors operator_runtime.bb's HUMAN_COMMAND detection - a human or a
;; thin RC-launch wrapper signals "someone wants to talk"), queues it as an
;; event, and launches launch_support.sh when due.
;;
;; Usage:
;;   support_runtime.bb <project-root>              ; run the loop
;;   support_runtime.bb <project-root> --tick-once   ; a single observe/act tick
;;
;; Tunables via environment (ms unless noted):
;;   SUPPORT_INTERVAL_MS   loop sleep between ticks (default 30000)
;;   SUPPORT_HEARTBEAT     set to 0 to skip heartbeat writes (tests)
;;   SUPPORT_SKIP_LAUNCH   set to 1 to never actually launch the LLM (dry-run)

(ns support-runtime
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "support_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: support_runtime.bb <project-root> [--tick-once]"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))
(def tick-once? (some #{"--tick-once"} *command-line-args*))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def state-dir (fs/path project-root ".swarmforge"))
(def sup-dir (fs/path state-dir "support"))
(def status-file (fs/path sup-dir "status.json"))
(def heartbeat-file (fs/path sup-dir "heartbeat"))
(def events-file (fs/path sup-dir "events.jsonl"))
(def inflight-file (fs/path sup-dir "events.inflight.jsonl"))
(def pid-file (fs/path sup-dir "runtime.pid"))
(def support-pid-file (fs/path sup-dir "support.pid"))
(def stop-file (fs/path sup-dir "stop"))
(def command-file (fs/path sup-dir "command"))
(def done-file (fs/path sup-dir "support.done"))
(def log-file (fs/path sup-dir "runtime.log"))
(def launch-support-script (fs/path script-dir "launch_support.sh"))

;; Support is NOT a swarm agent: own tmux socket/session, dropped
;; "SwarmForge-" prefix - same posture as the Operator's own socket split
;; (operator_runtime.bb) and for the same reason (resilience: a dead swarm
;; tmux must never take Support down with it).
(def support-session "support")
(def support-rc-name "Support")
(def support-socket-file (fs/path sup-dir "support-tmux.sock"))

(defn env-ms [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-ms "SUPPORT_INTERVAL_MS" 30000))
(def heartbeat? (not= "0" (System/getenv "SUPPORT_HEARTBEAT")))
(def skip-launch? (= "1" (System/getenv "SUPPORT_SKIP_LAUNCH")))

(defn now-ms [] (System/currentTimeMillis))
(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn log! [& parts]
  (fs/create-dirs sup-dir)
  (spit (str log-file) (str (now-iso) " " (str/join " " parts) "\n") :append true))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

;; ── event queue (jsonl) - mirrors operator_runtime.bb's shape ─────────────

(defn read-events [path]
  (if (fs/exists? path)
    (->> (str/split-lines (slurp (str path)))
         (remove str/blank?)
         (keep (fn [line] (try (json/parse-string line true) (catch Exception _ nil))))
         vec)
    []))

(defn append-event! [event]
  (fs/create-dirs sup-dir)
  (spit (str events-file) (str (json/generate-string event) "\n") :append true))

;; ── disposable-LLM liveness/launch (mirrors operator_runtime.bb) ─────────

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn read-pid [path]
  (when (fs/exists? path)
    (try (parse-long (str/trim (slurp (str path)))) (catch Exception _ nil))))

(defn tmux-sessions-on [sock]
  (if (and sock (fs/exists? (fs/path sock)))
    (let [{:keys [out exit]} (process/sh {:continue true}
                                         "tmux" "-S" (str sock) "list-sessions" "-F" "#{session_name}")]
      (if (zero? exit)
        (->> (str/split-lines out) (map str/trim) (remove str/blank?) vec)
        []))
    []))

(defn support-running?
  "Is the disposable LLM Support currently alive? Checks Support's OWN tmux
   socket (never the swarm socket - Support is independent) OR its pid file."
  []
  (boolean (or (some #{support-session} (tmux-sessions-on support-socket-file))
               (pid-alive? (read-pid support-pid-file)))))

(defn launch-support!
  "Move the pending queue aside so new events accumulate cleanly, then spawn
   launch_support.sh which starts the disposable Support LLM (with
   --remote-control) on its own tmux socket, pointed at the inflight
   events. Never launches a second one (caller already checked
   support-running?)."
  []
  (when (fs/exists? events-file)
    (fs/move events-file inflight-file {:replace-existing true :atomic-move true}))
  (log! "launch-support" "inflight=" (str (when (fs/exists? inflight-file)
                                            (count (read-events inflight-file)))))
  (if skip-launch?
    (log! "launch-support" "SKIPPED (SUPPORT_SKIP_LAUNCH=1)")
    (process/process ["bash" (str launch-support-script) project-root (str inflight-file)]
                     {:out :inherit :err :inherit})))

(defn kill-support-window!
  "Tear down Support's own tmux session (on its dedicated socket). Used when
   Support signalled completion (support.done) but its interactive
   --remote-control session is still sitting at a prompt - the runtime owns
   disposal so the LLM half stays truly disposable."
  []
  (when (fs/exists? support-socket-file)
    (process/sh {:continue true} "tmux" "-S" (str support-socket-file)
                "kill-session" "-t" support-session)))

(defn reap-finished-support!
  "Retire a completed Support run. Two triggers: support.done seen (kill its
   lingering RC window), or the window/pid is already gone. Either way, once
   it is no longer running its inflight events are archived - inflight stays
   put until a run completes, so a crash never loses the queue permanently."
  []
  (when (fs/exists? done-file)
    (log! "reap-support" "support.done seen; killing RC window")
    (kill-support-window!)
    (fs/delete-if-exists done-file))
  (when (and (fs/exists? inflight-file) (not (support-running?)))
    (let [done-dir (fs/path sup-dir "events-done")]
      (fs/create-dirs done-dir)
      (fs/move inflight-file
               (fs/path done-dir (str "events-" (now-ms) ".jsonl"))
               {:replace-existing true})
      (fs/delete-if-exists support-pid-file)
      (log! "reap-support" "inflight retired"))))

;; ── status ─────────────────────────────────────────────────────────────

(defn write-status! [m]
  (atomic-spit! status-file (str (json/generate-string (assoc m :updated_at (now-iso))) "\n")))

;; ── one tick ───────────────────────────────────────────────────────────

(defn tick! []
  (when heartbeat? (atomic-spit! heartbeat-file (now-iso)))

  ;; A dropped command file (human, or a thin RC-launch wrapper) means
  ;; "someone wants to talk" - mirrors operator_runtime.bb's HUMAN_COMMAND
  ;; detection exactly (fs/exists? + consume-and-delete).
  (when (fs/exists? command-file)
    (append-event! {:type "DISCUSSION_REQUESTED" :detail (str/trim (slurp (str command-file)))})
    (fs/delete-if-exists command-file))

  (reap-finished-support!)

  (let [llm-running? (support-running?)
        pending (read-events events-file)
        decision (support-lib/should-wake-support?
                  {:llm-running? llm-running? :pending-count (count pending)})
        state (cond
                llm-running? :support_running
                (pos? (count pending)) :dispatching
                :else :idle)]
    (write-status! {:state state :llm-running? llm-running? :pending-count (count pending)})
    (when decision
      (log! "decision" "launch (pending=" (str (count pending)) ")")
      (launch-support!))
    {:state state :launched? decision :pending (count pending)}))

;; ── main ───────────────────────────────────────────────────────────────

(defn -main []
  (fs/create-dirs sup-dir)
  (if tick-once?
    (println (json/generate-string (tick!)))
    (do
      (atomic-spit! pid-file (str (.pid (java.lang.ProcessHandle/current))))
      (log! "support-runtime started" (str "interval-ms=" interval-ms))
      (try
        (while (not (fs/exists? stop-file))
          (try (tick!) (catch Exception e (log! "tick-error" (.getMessage e))))
          (Thread/sleep interval-ms))
        (finally
          (fs/delete-if-exists pid-file)
          (log! "support-runtime stopped"))))))

(-main)
