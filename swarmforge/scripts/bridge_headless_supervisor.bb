#!/usr/bin/env bb
;; Supervises the Mini App headless bridge (start-bridge-headless.js) with
;; bounded restart + HTTP health on /lets-talk — same state machine as
;; cursor_bridge_supervisor.bb (front_desk_supervisor_lib.bb).
;;
;; Usage:
;;   bridge_headless_supervisor.bb <project-root> [--check-once]
;;
;; Env:
;;   BRIDGE_PORT (default 8765)
;;   BRIDGE_HEADLESS_INTERVAL_MS / BRIDGE_HEADLESS_MAX_ATTEMPTS / ...
;;   BRIDGE_TOKEN (optional — read from .swarmforge/operator/bridge-token)
;;   Plus Let's Talk / whisper env from swarm.env when the launcher sources it.

(ns bridge-headless-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "front_desk_supervisor_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: bridge_headless_supervisor.bb <project-root> [--check-once]"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))
(def check-once? (some #{"--check-once"} *command-line-args*))

(def op-dir (fs/path project-root ".swarmforge" "operator"))
(def pid-file (fs/path op-dir "bridge-headless-supervisor.pid"))
(def stop-file (fs/path op-dir "bridge-headless-supervisor.stop"))
(def status-file (fs/path op-dir "bridge-headless-supervisor.status.json"))
(def supervisor-log-file (fs/path op-dir "bridge-headless-supervisor.log"))
(def bridge-log-file (fs/path op-dir "bridge-headless.log"))
(def token-file (fs/path op-dir "bridge-token"))

(def bridge-entrypoint (fs/path project-root "extension" "out" "tools" "start-bridge-headless.js"))

(defn env-long [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def bridge-port (or (some-> (System/getenv "BRIDGE_PORT") parse-long) 8765))
(def interval-ms (env-long "BRIDGE_HEADLESS_INTERVAL_MS" 2000))
(def restart-config
  {:max-attempts (env-long "BRIDGE_HEADLESS_MAX_ATTEMPTS" 5)
   :backoff-base-ms (env-long "BRIDGE_HEADLESS_BACKOFF_BASE_MS" 1000)
   :backoff-max-ms (env-long "BRIDGE_HEADLESS_BACKOFF_MAX_MS" 60000)
   :healthy-reset-ms (env-long "BRIDGE_HEADLESS_HEALTHY_RESET_MS" 600000)})
(def giveup-config {:giveup-cooldown-ms (env-long "BRIDGE_HEADLESS_GIVEUP_COOLDOWN_MS" 900000)})
(def stall-ms (env-long "BRIDGE_HEADLESS_STALL_MS" 120000))
(def health-startup-grace-ms (env-long "BRIDGE_HEADLESS_HEALTH_STARTUP_GRACE_MS" 45000))
(def kill-grace-ms (env-long "BRIDGE_HEADLESS_KILL_GRACE_MS" 2000))
(def kill-pid! (front-desk-supervisor-lib/make-kill-pid! kill-grace-ms))

(def last-http-ok-ms (atom nil))

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

(defn read-bridge-token []
  (when (fs/exists? token-file)
    (some-> (slurp (str token-file)) str/trim not-empty)))

(defn bridge-extra-env []
  (into {}
        (remove (fn [[_ v]] (nil? v))
                [["BRIDGE_TOKEN" (or (System/getenv "BRIDGE_TOKEN") (read-bridge-token))]
                 ["LD_LIBRARY_PATH" (System/getenv "LD_LIBRARY_PATH")]
                 ["LETS_TALK_AUDIO_ENGINE" (System/getenv "LETS_TALK_AUDIO_ENGINE")]
                 ["LETS_TALK_SPEECH_LANGUAGE" (System/getenv "LETS_TALK_SPEECH_LANGUAGE")]
                 ["WHISPER_MODEL_PATH" (System/getenv "WHISPER_MODEL_PATH")]
                 ["WHISPER_CPP_BIN" (System/getenv "WHISPER_CPP_BIN")]
                 ["FFMPEG_BIN" (System/getenv "FFMPEG_BIN")]
                 ["OPENAI_API_KEY" (System/getenv "OPENAI_API_KEY")]
                 ["CURSOR_API_KEY" (System/getenv "CURSOR_API_KEY")]
                 ["CURSOR_BRIDGE_MODEL" (System/getenv "CURSOR_BRIDGE_MODEL")]
                 ["CURSOR_RIPGREP_PATH" (System/getenv "CURSOR_RIPGREP_PATH")]])))

(defn probe-http-health! [http-get-fn]
  (try
    (let [resp (http-get-fn (str "http://127.0.0.1:" bridge-port "/lets-talk") {:request-timeout 5000})]
      (when (= 200 (:status resp))
        (reset! last-http-ok-ms (now-ms))))
    (catch Exception _ nil)))

(defn default-http-get []
  (requiring-resolve 'babashka.http-client/get))

(defn spawn-bridge! []
  (reset! last-http-ok-ms nil)
  (spit (str bridge-log-file) (str (now-iso) " supervisor-spawn port=" bridge-port "\n") :append true)
  (process/process {:out :inherit :err :inherit :extra-env (bridge-extra-env)}
                   "node" (str bridge-entrypoint) project-root (str bridge-port)))

(def process-specs
  [{:key :bridge :spawn-pid! (fn [] (.pid (:proc (spawn-bridge!))))
    :heartbeat-stale? (fn [now entry]
                        (front-desk-supervisor-lib/poll-heartbeat-stale?
                          @last-http-ok-ms now stall-ms
                          (:started-at-ms entry) health-startup-grace-ms))}])

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
    :stalled (log! "stalled" (name spec-key) "no /lets-talk health within" (str stall-ms) "ms")
    :healthy-reset (log! "healthy-reset" (name spec-key))
    :gave-up (log! "gave-up" (name spec-key) "after" (str (:attempts entry)) "attempt(s)")
    :re-armed (log! "re-armed" (name spec-key) "pid=" (str (:pid entry)))
    nil))

(defn tick! [http-get-fn]
  (let [prior (read-state)
        now (now-ms)
        bridge-entry (get prior :bridge)
        _ (when (and (map? bridge-entry) (pid-alive? (:pid bridge-entry)))
            (probe-http-health! http-get-fn))
        next-state (into {}
                         (map (fn [spec]
                                (let [entry (merge (front-desk-supervisor-lib/default-entry) (get prior (:key spec)))
                                      heartbeat-stale? ((:heartbeat-stale? spec) now entry)
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
  (let [http-get (default-http-get)]
    (if check-once?
      (println (json/generate-string (tick! http-get)))
      (do
        (atomic-spit! pid-file (str (.pid (java.lang.ProcessHandle/current))))
        (log! "bridge-headless-supervisor started" (str "interval-ms=" interval-ms) (str "port=" bridge-port) "root=" project-root)
        (try
          (while (not (fs/exists? stop-file))
            (try (tick! http-get) (catch Exception e (log! "tick-error" (.getMessage e))))
            (Thread/sleep interval-ms))
          (finally
            (stop-all!)
            (fs/delete-if-exists pid-file)
            (log! "bridge-headless-supervisor stopped")))))))

(-main)
