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
;;   SUPERVISOR_IN_SWEEP_BUDGET_MS  how long ONE named in-flight sweep may
;;                                legitimately run (default 225000; BL-977)

(ns handoffd-supervisor
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_alarm_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "process_table_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_log_freshness_pulse_lib.bb")))

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

;; BL-977: how long ONE named in-flight sweep may legitimately run. This is
;; deliberately NOT a raise of SUPERVISOR_STALL_MS - a silent daemon with
;; nothing in flight still halts in 30s, unchanged. Derived from the
;; measured worst LEGITIMATE sweep on this host, not a round number:
;; `sweep-boundary sweep=dropped-parcel-sweep ms=202158` at
;; 2026-08-20T08:31:19Z (the freshness-restart-storm intake's live
;; measurement; the rotated log's own worst that morning was 143269 ms).
;; 202158 x ~1.11 headroom = 225000. Shrinks as BL-978's single-pass index
;; lands (post-index the same live sweep measured 21739 ms).
(def sweep-marker-file (fs/path daemon-dir "handoffd.sweep-marker"))
(def in-sweep-budget-ms (env-ms "SUPERVISOR_IN_SWEEP_BUDGET_MS" 225000))

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
   lingers but the daemon stopped polling while mail is pending).

   BL-977: :stalled now requires evidence of TRUE SILENCE, never
   heartbeat-file mtime alone (invariant 1) - BL-789 writes the heartbeat
   only at cycle start/end, so one heavy sweep (143269 ms measured
   2026-08-20) legitimately outages the mtime signal mid-cycle.
   in-flight-sweep-age-ms is how long the daemon's published sweep marker
   says the CURRENT sweep has been running (nil when the marker is absent,
   idle, or unreadable - which leaves the pre-BL-977 verdict exactly as it
   was). A sweep in flight within in-sweep-budget-ms is demonstrable
   progress: :healthy regardless of heartbeat age. A sweep in flight PAST
   the budget voids the heartbeat evidence entirely - the verdict is then
   exactly what a missing heartbeat produces today (invariant 2: a genuine
   wedge is still caught within a bounded time, and the marker only ever
   advances with the poll loop's own progress, so a wedged loop cannot
   forge liveness)."
  [{:keys [alive? heartbeat-age-ms pending-outbox-age-ms stall-ms
           in-flight-sweep-age-ms in-sweep-budget-ms daemon-age-ms]}]
  (let [in-flight? (and (number? in-flight-sweep-age-ms) (number? in-sweep-budget-ms)
                        (<= 0 in-flight-sweep-age-ms))
        under-budget? (and in-flight? (<= in-flight-sweep-age-ms in-sweep-budget-ms))
        ;; over-budget in-flight = the heartbeat evidence is void, exactly
        ;; as if the heartbeat were missing.
        effective-heartbeat-age-ms (if (and in-flight? (not under-budget?)) nil heartbeat-age-ms)
        ;; hotfix startup-grace (2026-09-02): -main runs check! before its
        ;; first sleep, and right after a crash every observation is stale
        ;; by construction (the dead daemon's heartbeat, the parcel whose
        ;; delivery crashed it). A daemon younger than one stall window has
        ;; not yet HAD a stall window in which to write a heartbeat - it
        ;; cannot be stalled. An unknown age grants nothing (pre-hotfix
        ;; verdict stands); :dead is untouched.
        within-startup-grace? (and (number? daemon-age-ms) (<= daemon-age-ms stall-ms))]
    (cond
      (not alive?) :dead

      under-budget? :healthy

      within-startup-grace? :healthy

      (and pending-outbox-age-ms (> pending-outbox-age-ms stall-ms)
           (or (nil? effective-heartbeat-age-ms) (> effective-heartbeat-age-ms stall-ms)))
      :stalled

      :else :healthy)))

(defn read-in-flight-sweep-age-ms
  "The published sweep marker's in-flight age in ms, or nil when the marker
   is absent, idle, unreadable, or nonsense (a started_at_ms in the future
   is nonsense, never evidence of progress - fail toward the pre-BL-977
   verdict, not toward :healthy)."
  [now-ms]
  (try
    (when (fs/exists? sweep-marker-file)
      (let [{:keys [sweep started_at_ms]} (json/parse-string (slurp (str sweep-marker-file)) true)]
        (when (and sweep (not= sweep "idle") (number? started_at_ms))
          (let [age (- now-ms started_at_ms)]
            (when (<= 0 age) age)))))
    (catch Exception _ nil)))

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
   targets: Stryker mutation roots, `node --test` batches (BL-108), and the
   property-lane vitest tree (`vitest.properties.config.mjs`, npm/npx vitest,
   Vitest worker processes). Kept narrow and case-insensitive so it never
   matches an unrelated process."
  #"(?i)stryker|node --test|vitest\.properties\.config\.mjs|\bnpm exec vitest\b|\bnpx vitest\b|\(vitest")

(defn job-scope-paths
  "Canonical host root plus every registered role worktree. Vitest/npm
   invocations often omit the checkout path from argv; cwd is checked too."
  []
  (distinct (cons canonical-project-root (map canonical-path (worktree-paths)))))

(defn job-in-scope?
  "True when cmdline or cwd is rooted under this project's host root or a
   registered role worktree. Delegates classification to
   process-table-lib/project-scoped-process? (BL-887) so this and the
   janitor's project-scoped-path? can never disagree."
  [pid cmd]
  (let [paths (job-scope-paths)
        cwd (try (process-table-lib/cwd! pid) (catch Exception _ nil))]
    (process-table-lib/project-scoped-process? cmd cwd paths)))

(defn orphaned-job-groups
  "Every (pid, pgid, cmd) whose command line matches job-process-pattern, is
   rooted under this project's host root or a swarm worktree (argv or cwd), and
   has already lost its owning parent (process-table-lib/parent-orphaned? -
   PPID 1, dead parent, or missing ProcessHandle; not raw ppid==1 alone, which
   misses subreaper hosts). A process still parented to a live supervisor is
   owned by a live agent run and must never be matched here, however long it
   runs."
  []
  (->> (all-pid-ppid-commands)
       (filter (fn [[pid _ _ cmd]]
                 (and (process-table-lib/parent-orphaned? pid)
                      (re-find job-process-pattern cmd)
                      (job-in-scope? pid cmd))))
       (map (fn [[pid _ pgid cmd]] [pid pgid cmd]))))

;; ── BL-995: deliberate-detach registry ──────────────────────────────────
;; detach_job.sh (the ONE sanctioned >120s escape hatch) registers each
;; detached job's process GROUP here before the job can ever look orphaned.
;; The reaper below consults this registry so it can tell deliberate
;; detachment from abandonment - BL-108's protection is never weakened
;; (invariant 1: an unregistered orphan is reaped exactly as before), and
;; registration is not immunity (invariant 2: an entry aged past its own
;; expires_at_ms is reaped like any crash orphan, and its entry removed so
;; the next sweep never re-reads it).

(def detached-jobs-dir (fs/path daemon-dir "detached-jobs"))

(defn read-detached-registrations
  "{pgid-string entry-map} for every parseable entry; unreadable files are
   skipped (a torn write must never fail the sweep)."
  []
  (if (fs/exists? detached-jobs-dir)
    (into {}
          (keep (fn [f]
                  (try
                    (let [entry (json/parse-string (slurp (str f)) true)]
                      (when (:pgid entry) [(str (:pgid entry)) (assoc entry :file (str f))]))
                    (catch Exception _ nil))))
          (filter #(str/ends-with? (str %) ".json") (fs/list-dir detached-jobs-dir)))
    {}))

(defn registration-expired? [entry now-ms]
  (>= now-ms (or (:expires_at_ms entry) 0)))

(defn- remove-registration! [entry]
  (try (fs/delete-if-exists (:file entry)) (catch Exception _ nil)))

(defn- append-reap-notice!
  "Invariant 3: the owner collects a run from its own artifacts, so the
   kill is written into the job's OWN log when the registry (or a best-
   effort cmdline scan for an unregistered job's redirect target) names
   one. Best-effort throughout - a missing/unwritable log never fails the
   sweep."
  [entry cmd reason]
  (let [log-path (or (:log entry)
                     (second (re-find #"(?:>>?)\s*(\S+\.(?:log|txt|out))" (or cmd ""))))]
    (when log-path
      (try
        (spit log-path
              (str "[handoffd_supervisor] REAPED pgid group (BL-108 orphan reaper): " reason
                   " - see .swarmforge/daemon/handoffd-supervisor.log\n")
              :append true)
        (catch Exception _ nil)))))

(def ^:private prune-grace-ms
  "An entry younger than this is never pruned, however dead its group
   looks - a registration can land between this sweep's process listing
   and its prune pass, and pruning it would reintroduce the exact
   register-then-orphan race the write ordering closes."
  120000)

(defn- pgid-alive? [pgid]
  (try
    (zero? (:exit (process/sh {:continue true} "kill" "-0" "--" (str "-" pgid))))
    (catch Exception _ true)))

(defn prune-dead-registrations!
  "Housekeeping: an entry is removed only when its process GROUP is probed
   dead (kill -0) AND the entry is past the registration grace period -
   the registry only ever holds live or fresh detaches, and a stale entry
   can never accumulate forever (BL-995 invariant 2's cleanup half)."
  [now-ms]
  (doseq [[pgid entry] (read-detached-registrations)]
    ;; A missing started_at_ms reads as infinitely OLD, not fresh: our own
    ;; writer always stamps it, so an unstamped entry is torn/foreign and
    ;; must stay prunable or it sits in the registry forever.
    (when (and (> (- now-ms (or (:started_at_ms entry) 0)) prune-grace-ms)
               (not (pgid-alive? pgid)))
      (remove-registration! entry))))

(defn reap-orphaned-job-processes!
  "Reaps crash-orphaned mutation/test-batch process groups (BL-108 defenses
   4-5). Runs every check tick, independent of the tracked handoffd daemon's
   own health, same as reap-orphans! above. Sends the signal to the
   process's ACTUAL group (looked up via ps, never assumed equal to its
   pid), since Stryker keeps respawning sandbox workers under its own root
   and killing only the root pid leaves the respawned workers running (the
   original BL-108 incident).
   BL-995: a group registered by detach_job.sh with an UNEXPIRED entry is
   spared - deliberate detachment, not abandonment; an expired entry is
   reaped exactly like an unregistered orphan, its entry removed, and the
   kill written into the job's own log so its owner can discover it."
  []
  (let [regs (read-detached-registrations)
        now-ms (System/currentTimeMillis)
        candidates (orphaned-job-groups)]
    (doseq [[pid pgid cmd] candidates]
      (let [entry (get regs (str pgid))]
        (if (and entry (not (registration-expired? entry now-ms)))
          nil ;; spared: a live, registered, unexpired deliberate detach
          (do
            (log! "reap-job-orphan" (str pid)
                  (str cmd (when entry " [registered but EXPIRED - BL-995 invariant 2]")))
            (append-reap-notice! entry cmd
                                 (if entry
                                   (str "registration expired at " (:expires_at_ms entry))
                                   "orphaned and never registered (detach_job.sh is the sanctioned escape hatch)"))
            (process/sh {:continue true} "kill" "-TERM" "--" (str "-" pgid))
            (when-not (wait-until-dead pid kill-timeout-ms)
              (process/sh {:continue true} "kill" "-KILL" "--" (str "-" pgid))
              (when-not (wait-until-dead pid kill-timeout-ms)
                (log! "reap-job-orphan-failed" (str pid) "still alive after SIGKILL")))
            (when entry (remove-registration! entry))))))
    (prune-dead-registrations! now-ms)))

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

;; BL-813: takes attachments (daemon_alarm_lib.bb's alarm-and-halt! now
;; calls send-email! with 3 args) and threads them into the attachment-
;; capable 7-arg send-configured-email! form (html nil - this alarm has no
;; html body), so the death email actually carries the failure log instead
;; of only naming its on-disk path.
(defn send-configured-alarm-email! [subject text attachments]
  (daemon-alarm-lib/send-configured-email!
   project-root conf-file subject text nil attachments
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
  (daemon-log-freshness-pulse-lib/append-log-heartbeat! supervisor-log)
  (if (fs/exists? stop-file)
    (log! "skip" "stop file present; swarm shutting down")
    (let [status (or (read-status) {})
          tracked (daemon-pid)
          verdict (evaluate-health {:alive? (pid-alive? tracked)
                                    ;; hotfix startup-grace: the daemon's pid
                                    ;; file is written at its start, so its
                                    ;; age is the daemon's age.
                                    :daemon-age-ms (file-age-ms pid-file)
                                    :heartbeat-age-ms (file-age-ms heartbeat-file)
                                    :pending-outbox-age-ms (oldest-pending-outbox-age-ms)
                                    :stall-ms stall-ms
                                    ;; BL-977: the daemon's published in-flight
                                    ;; sweep marker, as one more observation.
                                    :in-flight-sweep-age-ms (read-in-flight-sweep-age-ms (now-ms))
                                    :in-sweep-budget-ms in-sweep-budget-ms})]
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
