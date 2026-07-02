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
;; BL-081: at most ONE handoffd process may serve this project root at any
;; time. A restart confirms the old daemon's pid actually exited (bounded
;; wait, then SIGKILL, then confirm again) before starting a replacement,
;; and every check reaps ANY handoffd.bb process discovered for this root
;; that the pid file does not name - not just the pid-file pid - since
;; orphans (from a prior supervisor/launcher, or a pid file overwritten by
;; a newer start) are otherwise never found at all.
;;
;; Tunables (ms unless noted) via environment:
;;   SUPERVISOR_INTERVAL_MS       loop sleep between checks   (default 10000)
;;   SUPERVISOR_STALL_MS          heartbeat+outbox stall age  (default 30000)
;;   SUPERVISOR_RAPID_WINDOW_MS   rapid-death window          (default 120000)
;;   SUPERVISOR_MAX_RAPID         restarts allowed in window  (default 3)
;;   SUPERVISOR_BACKOFF_MS        wait in persistent-failure  (default 300000)
;;   SUPERVISOR_KILL_TIMEOUT_MS   bound on confirming an exit (default 2000)

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
(def kill-timeout-ms (env-ms "SUPERVISOR_KILL_TIMEOUT_MS" 2000))
(def kill-poll-ms 50)

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

(defn all-pid-commands
  "One bulk ps call for the whole process table (pid . command-line) pairs.
   BL-081: the first version of this shelled out to `ps -p <pid>` once per
   candidate pid, which on a machine with hundreds of processes turned every
   reap check into hundreds of subprocess spawns and multi-second checks."
  []
  (let [{:keys [out exit]} (process/sh "ps" "-eo" "pid=,command=")]
    (when (zero? exit)
      (keep (fn [line]
              (let [line (str/trim line)
                    sep (str/index-of line " ")]
                (when sep
                  [(parse-long (subs line 0 sep)) (subs line (inc sep))])))
            (str/split-lines out)))))

(defn handoffd-pids-for-root
  "Discovers every live handoffd.bb process for this project root by
   scanning the process table, not just the pid the pid file names - the
   only way to find an orphan left behind by a prior supervisor or launcher
   (BL-081). Never matches handoffd_supervisor.bb itself or another
   project's daemon."
  []
  (->> (all-pid-commands)
       (filter (fn [[_ cmd]]
                 (and (str/includes? cmd "handoffd.bb")
                      (not (str/includes? cmd "handoffd_supervisor.bb"))
                      (str/includes? cmd project-root))))
       (map first)
       distinct))

(defn wait-until-dead [pid timeout-ms]
  (let [deadline (+ (now-ms) timeout-ms)]
    (loop []
      (cond
        (not (pid-alive? pid)) true
        (>= (now-ms) deadline) false
        :else (do (Thread/sleep kill-poll-ms) (recur))))))

(defn kill-and-confirm!
  "Sends TERM, waits up to kill-timeout-ms for the pid to actually exit,
   escalates to SIGKILL (which bypasses handoffd.bb's own shutdown hook -
   BL-081 root cause #2) and confirms again. Returns true once the pid is
   confirmed dead, false if it survived even SIGKILL."
  [pid]
  (if-not (pid-alive? pid)
    true
    (do
      (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.destroy))
      (or (wait-until-dead pid kill-timeout-ms)
          (do
            (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.destroyForcibly))
            (wait-until-dead pid kill-timeout-ms))))))

(defn reap-orphans!
  "Kills every handoffd.bb process for this root other than tracked-pid,
   confirming each exit. Runs on every check cycle regardless of the
   tracked daemon's health, so an orphan sitting alongside a perfectly
   healthy tracked daemon still gets cleaned up (BL-081 scenario 05)."
  [tracked-pid]
  (let [orphans (remove #(= % tracked-pid) (handoffd-pids-for-root))]
    (doseq [pid orphans]
      (log! "reap-orphan" (str pid))
      (when-not (kill-and-confirm! pid)
        (log! "reap-orphan-failed" (str pid) "still alive after SIGKILL")))
    orphans))

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
    ;; BL-081: the replacement must not start until the old pid is confirmed
    ;; gone - kill-and-confirm! blocks (bounded) on exactly that.
    (when pid
      (when-not (kill-and-confirm! pid)
        (log! "kill-failed" (str pid) "still alive after SIGKILL")))
    (when (= (daemon-pid) pid)
      (fs/delete-if-exists pid-file))
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
  (if (fs/exists? stop-file)
    (log! "skip" "stop file present; swarm shutting down")
    (let [status (or (read-status) {})
          tracked (daemon-pid)
          verdict (evaluate-health {:alive? (pid-alive? tracked)
                                    :heartbeat-age-ms (file-age-ms heartbeat-file)
                                    :pending-outbox-age-ms (oldest-pending-outbox-age-ms)
                                    :stall-ms stall-ms})]
      ;; Reaping runs every cycle, independent of the tracked daemon's own
      ;; health, so a stray orphan next to a perfectly healthy tracked
      ;; daemon still gets cleaned up (BL-081 scenario 05) instead of only
      ;; being caught incidentally during a dead/stalled restart.
      (reap-orphans! tracked)
      (cond
        (= :healthy verdict)
        (when-not (= "healthy" (:state status))
          (write-status! (assoc status :state "healthy"))
          (log! "recovered" "daemon healthy"))

        (in-backoff? status)
        (log! "backoff" "persistent failure; not restarting yet")

        :else
        (restart! verdict)))))

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
