#!/usr/bin/env bb

;; Supervises the handoffd delivery daemon (BL-061). handoffd is the swarm's
;; single transport; when it dies or hangs silently every role idles believing
;; it has no work. The supervisor periodically evaluates daemon health and
;; records every state change in a machine-readable status file the extension
;; renders.
;;
;; BL-144: a dead/stalled daemon is no longer silently auto-restarted. The
;; operator asked for the opposite - a loud alarm and a full stop, not a
;; papered-over restart loop. On death the supervisor writes a failure log
;; (daemon_alarm_lib.bb), sends one alarm email, and hard-stops the whole
;; swarm (kills every tmux session, via the same swarm-cleanup.sh a graceful
;; shutdown already uses). Recovery is human: fix the daemon, then relaunch.
;;
;; Usage:
;;   handoffd_supervisor.bb <project-root>              ; supervision loop
;;   handoffd_supervisor.bb <project-root> --check-once ; single health check
;;
;; BL-081: at most ONE handoffd process may serve this project root at any
;; time. Every check reaps ANY handoffd.bb process discovered for this root
;; that the pid file does not name - not just the pid-file pid - since
;; orphans (from a prior supervisor/launcher, or a pid file overwritten by
;; a newer start) are otherwise never found at all. This orphan reaping is
;; independent of BL-144's alarm-and-halt and still runs every cycle.
;;
;; Tunables (ms unless noted) via environment:
;;   SUPERVISOR_INTERVAL_MS       loop sleep between checks   (default 10000)
;;   SUPERVISOR_STALL_MS          heartbeat+outbox stall age  (default 30000)
;;   SUPERVISOR_KILL_TIMEOUT_MS   bound on confirming an exit (default 2000)

(ns handoffd-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_alarm_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: handoffd_supervisor.bb <project-root> [--check-once]"))
  (System/exit 1))

(def project-root
  (or (first *command-line-args*) (usage)))

;; BL-321: path-boundary matching for the orphan reaper below - resolves
;; symlinks and trailing slashes so two DIFFERENT on-disk paths that
;; happen to normalize to the same real location are correctly treated as
;; the same root, and so a root's own string form (with/without a
;; trailing slash) always compares consistently. fs/canonicalize does not
;; require the path to exist (unlike Path.toRealPath's default), so a
;; daemon whose root has since been removed still gets a stable, if
;; unresolved-past-that-point, string rather than throwing out of the
;; reap sweep.
(defn canonical-path [p]
  (try (str (fs/canonicalize p)) (catch Exception _ p)))

(def canonical-project-root (canonical-path project-root))

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
(def tmux-socket-file (fs/path state-dir "tmux-socket"))
(def window-ids-file (fs/path state-dir "window-ids"))
(def conf-file (fs/path script-dir ".." "swarmforge.conf"))

(defn env-ms [name default]
  (or (some-> (System/getenv name) parse-long) default))

(def interval-ms (env-ms "SUPERVISOR_INTERVAL_MS" 10000))
(def stall-ms (env-ms "SUPERVISOR_STALL_MS" 30000))
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
  (->> (handoff-lib/load-all-roles project-root)
       (mapcat (fn [role-info]
                 (let [outbox (handoff-lib/mailbox-dir role-info :outbox)]
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

(defn all-pid-ppid-commands
  "One bulk ps call for the whole process table as (pid, ppid, pgid,
   command-line) tuples. BL-108 supervisor-reaper: PPID 1 is the
   reparent-to-launchd signal for a crash-orphaned job process, and pgid is
   read alongside it because a signal must target the process's ACTUAL
   group (looked up, never assumed equal to its pid) so a respawning
   Stryker root's workers die with it instead of surviving as fresh
   orphans."
  []
  (let [{:keys [out exit]} (process/sh "ps" "-eo" "pid=,ppid=,pgid=,command=")]
    (when (zero? exit)
      (keep (fn [line]
              (let [fields (str/split (str/triml line) #"\s+" 4)]
                (when (= 4 (count fields))
                  (let [[pid ppid pgid cmd] fields]
                    [(parse-long pid) (parse-long ppid) (parse-long pgid) cmd]))))
            (str/split-lines out)))))

(defn handoffd-pids-for-root
  "Discovers every live handoffd.bb process for this project root by
   scanning the process table, not just the pid the pid file names - the
   only way to find an orphan left behind by a prior supervisor or launcher
   (BL-081). Never matches handoffd_supervisor.bb itself, never matches
   another project's daemon - not a NESTED root beneath this one (e.g.
   `<this-root>/tmp/fixture`) and not a SIBLING root whose path merely
   extends this one as a text prefix (e.g. `<this-root>-2`).

   Matches on the LAST whitespace-separated token of the command line (the
   actual <project-root> argument handoffd.bb was invoked with -
   start_handoff_daemon.sh always launches it as `bb handoffd.bb
   <project-root>`), canonicalized (symlinks resolved, trailing slash
   normalized) and compared by PATH EQUALITY against this supervisor's own
   canonicalized root - never a raw substring search over the whole
   command line, and never a bare string compare of two un-normalized
   paths that could differ only cosmetically. A substring search
   false-positive-matched a worktree's own nested copy of handoffd.bb
   (e.g. .worktrees/coder/swarmforge/scripts/handoffd.bb is textually
   NESTED under this project's own root path) even when it was actually
   launched against a wholly different <project-root> argument, and
   equally false-positive-matched a sibling project whose path happens to
   extend this root as a prefix - and reaped both. Confirmed live: this
   supervisor SIGTERM'd a handoffd.bb test fixture running against a /tmp
   root from a coder-worktree test script, every ~10s poll, purely because
   the worktree's own script path happened to start with this root's path
   (coder session, 2026-07-12; BL-321)."
  []
  (->> (all-pid-commands)
       (filter (fn [[_ cmd]]
                 (and (str/includes? cmd "handoffd.bb")
                      (not (str/includes? cmd "handoffd_supervisor.bb"))
                      (= canonical-project-root (canonical-path (last (str/split (str/trim cmd) #"\s+")))))))
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

(def job-process-pattern
  "Command-line signature of the long-running job processes this reaper
   targets: Stryker mutation roots and `node --test` batches (BL-108). Kept
   narrow and case-insensitive so it never matches an unrelated process."
  #"(?i)stryker|node --test")

(defn orphaned-job-groups
  "Every (pid, pgid, cmd) whose command line matches job-process-pattern, is
   rooted under one of this project's swarm worktrees, and has already
   reparented to launchd/init (ppid 1) - the crash-orphan signal (BL-108
   supervisor-reaper). A process still parented to anything else is still
   owned by a live agent run and must never be matched here, however long
   it runs."
  []
  (let [worktrees (worktree-paths)]
    (->> (all-pid-ppid-commands)
         (filter (fn [[_ ppid _ cmd]]
                   (and (= 1 ppid)
                        (re-find job-process-pattern cmd)
                        (some #(str/includes? cmd %) worktrees))))
         (map (fn [[pid _ pgid cmd]] [pid pgid cmd])))))

(defn reap-orphaned-job-processes!
  "Reaps crash-orphaned mutation/test-batch process groups (BL-108 defenses
   4-5). Runs every check tick, independent of the tracked handoffd daemon's
   own health, same as reap-orphans! above. Sends the signal to the
   process's ACTUAL group (looked up via ps, never assumed equal to its
   pid), since Stryker keeps respawning sandbox workers under its own root
   and killing only the root pid leaves the respawned workers running (the
   original BL-108 incident)."
  []
  (doseq [[pid pgid cmd] (orphaned-job-groups)]
    (log! "reap-job-orphan" (str pid) cmd)
    (process/sh {:continue true} "kill" "-TERM" "--" (str "-" pgid))
    (when-not (wait-until-dead pid kill-timeout-ms)
      (process/sh {:continue true} "kill" "-KILL" "--" (str "-" pgid))
      (when-not (wait-until-dead pid kill-timeout-ms)
        (log! "reap-job-orphan-failed" (str pid) "still alive after SIGKILL")))))

;; ── BL-144: daemon-death alarm+halt (adapters for daemon_alarm_lib.bb) ──────

(defn read-log-tail [n]
  (if (fs/exists? log-file)
    (vec (take-last n (str/split-lines (slurp (str log-file)))))
    []))

(defn roles-with-worktrees []
  (remove #(nil? (:worktree-path %)) (handoff-lib/load-all-roles project-root)))

(defn count-handoff-files [dir]
  (if (fs/exists? dir)
    (count (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff"))
                   (fs/list-dir dir)))
    0))

(defn snapshot-role-counts []
  (vec (for [role-info (roles-with-worktrees)]
         {:role (:role role-info)
          :inbox-new (count-handoff-files (handoff-lib/mailbox-dir role-info :new))
          :outbox (count-handoff-files (handoff-lib/mailbox-dir role-info :outbox))})))

(defn write-failure-log-file! [content]
  (fs/create-dirs daemon-dir)
  (let [stamp (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")
                       (.atZone (java.time.Instant/now) java.time.ZoneOffset/UTC))
        path (fs/path daemon-dir (str "handoffd-failure-" stamp ".log"))]
    (spit (str path) content)
    (str path)))

;; BL-215: one-shot per process - the daemon's launch environment does not
;; change mid-process, so a repeated warning across polls/sweeps would just
;; be spam once the operator has already been told once.
(def missing-key-warned? (atom false))

(defn send-configured-alarm-email! [subject text]
  (daemon-alarm-lib/send-configured-email!
   project-root conf-file subject text
   {:already-warned?! (fn [] @missing-key-warned?)
    :log-warning! (fn [msg] (log! "email-misconfigured" msg))
    :mark-warned! (fn [] (reset! missing-key-warned? true))}))

(defn distinct-sessions []
  (if (fs/exists? roles-file)
    (->> (str/split-lines (slurp (str roles-file)))
         (remove str/blank?)
         (keep #(nth (str/split % #"\t") 3 nil))
         distinct)
    []))

(defn halt-swarm!
  "Hard-stops the whole swarm: TERMs the daemon if it is still lingering,
   kills every agent's tmux session, and touches stop-file so this
   supervisor's own loop (and any surviving daemon) also sees shutdown -
   reusing swarm-cleanup.sh, the same script a graceful exit already uses,
   rather than a second kill-the-swarm implementation."
  []
  (fs/create-dirs daemon-dir)
  (spit (str stop-file) "")
  (when-let [pid (daemon-pid)]
    (kill-and-confirm! pid))
  (when (fs/exists? tmux-socket-file)
    (let [socket (str/trim (slurp (str tmux-socket-file)))
          sessions (distinct-sessions)
          cleanup-script (str (fs/path script-dir "swarm-cleanup.sh"))]
      (try
        (apply process/sh cleanup-script socket (str window-ids-file) sessions)
        (catch Exception e (log! "halt-swarm-error" (.getMessage e)))))))

(defn alarm-and-halt! [reason status]
  (daemon-alarm-lib/alarm-and-halt!
   {:reason reason
    :status status
    :now-iso! now-iso
    :log-tail! #(read-log-tail 200)
    :role-counts! snapshot-role-counts
    :write-failure-log! write-failure-log-file!
    :send-email! send-configured-alarm-email!
    :halt-swarm! halt-swarm!
    :write-status! write-status!}))

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
      (reap-orphaned-job-processes!)
      (cond
        (= :healthy verdict)
        (when-not (= "healthy" (:state status))
          (write-status! (assoc status :state "healthy"))
          (log! "recovered" "daemon healthy"))

        (= "halted" (:state status))
        (log! "skip" "already halted; awaiting human recovery")

        :else
        (do
          (log! "alarm-and-halt" (name verdict))
          (alarm-and-halt! verdict status))))))

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
