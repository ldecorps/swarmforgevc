#!/usr/bin/env bb

;; Supervises the handoffd delivery daemon (BL-061). handoffd is the swarm's
;; single transport; when it dies or hangs silently every role idles believing
;; it has no work. The supervisor periodically evaluates daemon health,
;; restarts a dead/stalled daemon (rotating its log aside so crash evidence
;; survives), backs off instead of crash-looping, and records every state
;; change in a machine-readable status file the extension renders.
;;
;; Usage:
;;   handoffd_supervisor.bb <project-root>              ; supervision loop
;;   handoffd_supervisor.bb <project-root> --check-once ; single health check
;;
;; Tunables (ms unless noted) via environment:
;;   SUPERVISOR_INTERVAL_MS       loop sleep between checks   (default 10000)
;;   SUPERVISOR_STALL_MS          heartbeat+outbox stall age  (default 30000)
;;   SUPERVISOR_RAPID_WINDOW_MS   rapid-death window          (default 120000)
;;   SUPERVISOR_MAX_RAPID         restarts allowed in window  (default 3)
;;   SUPERVISOR_BACKOFF_MS        wait in persistent-failure  (default 300000)

(ns handoffd-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: handoffd_supervisor.bb <project-root> [--check-once]"))
  (System/exit 1))

(def project-root
  (or (first *command-line-args*) (usage)))

(def check-once? (some #{"--check-once"} *command-line-args*))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def state-dir (fs/path project-root ".swarmforge"))
(def daemon-dir (fs/path state-dir "daemon"))
(def pid-file (fs/path daemon-dir "handoffd.pid"))
(def stop-file (fs/path daemon-dir "stop"))
(def log-file (fs/path daemon-dir "handoffd.log"))
(def heartbeat-file (fs/path daemon-dir "handoffd.heartbeat"))
(def status-file (fs/path daemon-dir "handoffd.status.json"))
(def supervisor-pid-file (fs/path daemon-dir "handoffd-supervisor.pid"))
(def supervisor-log (fs/path daemon-dir "handoffd-supervisor.log"))
(def roles-file (fs/path state-dir "roles.tsv"))

(defn env-ms [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-ms "SUPERVISOR_INTERVAL_MS" 10000))
(def stall-ms (env-ms "SUPERVISOR_STALL_MS" 30000))
(def rapid-window-ms (env-ms "SUPERVISOR_RAPID_WINDOW_MS" 120000))
(def max-rapid (env-ms "SUPERVISOR_MAX_RAPID" 3))
(def backoff-ms (env-ms "SUPERVISOR_BACKOFF_MS" 300000))

(defn now-ms [] (System/currentTimeMillis))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT)
           (java.time.Instant/now)))

(defn log! [& parts]
  (fs/create-dirs daemon-dir)
  (spit (str supervisor-log)
        (str (now-iso) " " (str/join " " parts) "\n")
        :append true))

;; ── observations ─────────────────────────────────────────────────────────────

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid)
            (.orElse nil)
            (.isAlive))))

(defn daemon-pid []
  (when (fs/exists? pid-file)
    (parse-long (str/trim (slurp (str pid-file))))))

(defn file-age-ms [path]
  (when (fs/exists? path)
    (- (now-ms)
       (.toMillis (fs/last-modified-time path)))))

(defn worktree-paths []
  (if (fs/exists? roles-file)
    (->> (str/split-lines (slurp (str roles-file)))
         (remove str/blank?)
         (map #(get (str/split % #"\t") 2))
         (remove nil?)
         distinct)
    []))

(defn oldest-pending-outbox-age-ms []
  (->> (worktree-paths)
       (mapcat (fn [wt]
                 (let [outbox (fs/path wt ".swarmforge" "handoffs" "outbox")]
                   (when (fs/exists? outbox)
                     (filter #(and (fs/regular-file? %)
                                   (str/ends-with? (fs/file-name %) ".handoff"))
                             (fs/list-dir outbox))))))
       (keep file-age-ms)
       (reduce max 0)))

;; ── the health decision, kept pure for tests ─────────────────────────────────

(defn evaluate-health
  "Given observations, decide :healthy, :dead (pid gone) or :stalled (pid
   lingers but the daemon stopped polling while mail is pending)."
  [{:keys [alive? heartbeat-age-ms pending-outbox-age-ms stall-ms]}]
  (cond
    (not alive?) :dead

    (and pending-outbox-age-ms (> pending-outbox-age-ms stall-ms)
         (or (nil? heartbeat-age-ms) (> heartbeat-age-ms stall-ms)))
    :stalled

    :else :healthy))

;; ── status file ──────────────────────────────────────────────────────────────

(defn read-status []
  (try
    (when (fs/exists? status-file)
      (json/parse-string (slurp (str status-file)) true))
    (catch Exception _ nil)))

(defn write-status! [status]
  (fs/create-dirs daemon-dir)
  (spit (str status-file)
        (str (json/generate-string (assoc status :updated_at (now-iso))) "\n")))

(defn recent-restarts [status]
  (let [cutoff (- (now-ms) rapid-window-ms)]
    (->> (:restart_history status)
         (filter #(> % cutoff))
         vec)))

;; ── restart machinery ────────────────────────────────────────────────────────

(defn rotate-log! []
  (when (and (fs/exists? log-file) (pos? (fs/size log-file)))
    ;; Millisecond suffix keeps rapid successive rotations (crash loops) from
    ;; colliding on a same-second filename.
    (let [stamp (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss.SSS'Z'")
                         (.atZone (java.time.Instant/now) java.time.ZoneOffset/UTC))]
      (fs/move log-file
               (fs/path daemon-dir (str "handoffd.log." stamp))
               {:replace-existing false}))))

(defn kill-daemon! [pid]
  (when (pid-alive? pid)
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.destroy))
    (Thread/sleep 300)
    (when (pid-alive? pid)
      (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.destroyForcibly)))))

(defn start-daemon! []
  (rotate-log!)
  (process/process ["bb" (str (fs/path script-dir "handoffd.bb")) project-root]
                   {:out :append :out-file (fs/file log-file)
                    :err :append :err-file (fs/file log-file)}))

(defn restart! [reason]
  (let [pid (daemon-pid)
        status (or (read-status) {})
        restarts (conj (recent-restarts status) (now-ms))
        persistent? (> (count restarts) max-rapid)]
    (log! "restart" (name reason) (str "recent-restarts=" (count restarts)))
    (kill-daemon! pid)
    (if persistent?
      (do
        (write-status! (assoc status
                              :state "persistent-failure"
                              :restart_history restarts
                              :last_incident {:reason (name reason)
                                              :at (now-iso)
                                              :detail "daemon keeps dying; backing off"}))
        (log! "persistent-failure" "backing off"))
      (do
        (start-daemon!)
        (write-status! (assoc status
                              :state "restarting"
                              :restart_history restarts
                              :last_incident {:reason (name reason)
                                              :at (now-iso)}))))))

(defn in-backoff? [status]
  (and (= "persistent-failure" (:state status))
       (let [last-restart (reduce max 0 (:restart_history status))]
         (< (- (now-ms) last-restart) backoff-ms))))

;; ── one health check ─────────────────────────────────────────────────────────

(defn check! []
  (let [status (or (read-status) {})
        verdict (evaluate-health {:alive? (pid-alive? (daemon-pid))
                                  :heartbeat-age-ms (file-age-ms heartbeat-file)
                                  :pending-outbox-age-ms (oldest-pending-outbox-age-ms)
                                  :stall-ms stall-ms})]
    (cond
      (fs/exists? stop-file)
      (log! "skip" "stop file present; swarm shutting down")

      (= :healthy verdict)
      (when-not (= "healthy" (:state status))
        (write-status! (assoc status :state "healthy"))
        (log! "recovered" "daemon healthy"))

      (in-backoff? status)
      (log! "backoff" "persistent failure; not restarting yet")

      :else
      (restart! verdict))))

(defn -main []
  (if check-once?
    (check!)
    (do
      (fs/create-dirs daemon-dir)
      (spit (str supervisor-pid-file)
            (str (.pid (java.lang.ProcessHandle/current)) "\n"))
      (log! "supervisor started" (str "interval-ms=" interval-ms))
      (try
        (while (not (fs/exists? stop-file))
          (check!)
          (Thread/sleep interval-ms))
        (finally
          (fs/delete-if-exists supervisor-pid-file)
          (log! "supervisor stopped"))))))

(-main)
