#!/usr/bin/env bb
;; Cross-platform process-table primitives for the orphan reapers.
;; Linux/WSL: prefer /proc (cmdline + pid enumeration).
;; Darwin (and any host without procfs): java.lang.ProcessHandle.allProcesses —
;; /proc does not exist on macOS, so a /proc-only scan silently reaps nothing.

(ns process-table-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; BL-1524: the Darwin lsof cwd probe runs under the bounded chokepoint
;; (daemon-cycle-guard-lib/sh!), not a direct babashka.process call - this
;; file is load-filed into handoffd.bb's closure via
;; master_checkout_drift_lib.bb.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))

(defn procfs-available?
  []
  (boolean (and (fs/exists? "/proc") (fs/directory? "/proc"))))

(defn- cmdline-from-procfs
  [pid]
  (try
    (str/replace (slurp (str (fs/path "/proc" (str pid) "cmdline"))) "\u0000" " ")
    (catch Exception _ "")))

(defn- cmdline-from-handle
  [ph]
  (try
    (let [info (.info ph)
          cl (.orElse (.commandLine info) nil)]
      (if (and cl (not (str/blank? cl)))
        cl
        (let [cmd (.orElse (.command info) nil)
              args (seq (.orElse (.arguments info) (into-array String [])))]
          (if cmd
            (str/join " " (cons cmd args))
            ""))))
    (catch Exception _ "")))

(defn cmdline!
  "Best-effort command line for pid. Empty string when unavailable."
  [pid]
  (if (procfs-available?)
    (cmdline-from-procfs pid)
    (try
      (if-let [ph (.orElse (java.lang.ProcessHandle/of (long pid)) nil)]
        (cmdline-from-handle ph)
        "")
      (catch Exception _ ""))))

(defn list-pids!
  "All numeric pids visible on this host, or nil when the process table
   could not be enumerated. BL-849: nil is never conflated with an empty
   vector - a caller distinguishing 'nothing to reap' from 'I cannot see
   the process table' depends on that distinction surviving here, the
   root of every candidate scan."
  []
  (try
    (if (procfs-available?)
      (->> (fs/list-dir "/proc")
           (keep (fn [p] (try (Long/parseLong (fs/file-name p)) (catch Exception _ nil))))
           vec)
      (->> (iterator-seq (.iterator (java.lang.ProcessHandle/allProcesses)))
           (map #(.pid %))
           vec))
    (catch Exception _ nil)))

(defn list-processes!
  "Return [{:pid Long :cmdline String}] for processes with a non-blank
   cmdline, or nil when the process table could not be enumerated (BL-849 -
   see list-pids!'s docstring; the /proc branch propagates list-pids!'s own
   nil via when-let rather than `keep`-ing over it, which would otherwise
   silently degrade a failed read into an empty-but-successful result)."
  []
  (try
    (if (procfs-available?)
      (when-let [pids (list-pids!)]
        (->> pids
             (keep (fn [pid]
                     (let [cmd (cmdline-from-procfs pid)]
                       (when-not (str/blank? cmd)
                         {:pid pid :cmdline cmd}))))
             vec))
      (->> (iterator-seq (.iterator (java.lang.ProcessHandle/allProcesses)))
           (keep (fn [ph]
                   (let [cmd (cmdline-from-handle ph)]
                     (when-not (str/blank? cmd)
                       {:pid (.pid ph) :cmdline cmd}))))
           vec))
    (catch Exception _ nil)))

(defn age-ms!
  "Process age via ProcessHandle startInstant when available; else 0.
   Prefer this over /proc/<pid> mtime (unstable on WSL; absent on Darwin)."
  [pid]
  (try
    (if-let [ph (.orElse (java.lang.ProcessHandle/of (long pid)) nil)]
      (if-let [start (.orElse (.startInstant (.info ph)) nil)]
        (- (System/currentTimeMillis) (.toEpochMilli start))
        0)
      0)
    (catch Exception _ 0)))

;; ── BL-1907: the host's adopter of last resort ──────────────────────────────
;; An orphan is adopted by PID 1, or by the nearest CHILD SUBREAPER above it
;; (prctl PR_SET_CHILD_SUBREAPER): WSL's per-session Relay /init, systemd
;; --user. No /proc field names a subreaper, so the adopter is learned the
;; way an orphan learns it: a short-lived probe is orphaned below this
;; process and the pid that adopts it is read. A reaper and the processes
;; it judges sit below the same subreaper, so they share the answer.

(defn orphaned-by-parent?
  "PURE. Whether a process with this parent reads orphaned: no parent, a
   parent of PID 1, a dead parent, or a parent that is the host's adopter
   (adopter-pid, nil when none was learned - then only today's PID 1 rule
   applies)."
  [{:keys [parent-pid parent-alive? adopter-pid]}]
  (boolean
   (or (nil? parent-pid)
       (= 1 parent-pid)
       (not parent-alive?)
       (and adopter-pid (= adopter-pid parent-pid)))))

(defn adopter-from-probe
  "PURE. The adopter a probe teaches: the pid that parents it after its
   starter exited. Nothing when the parent is unreadable, is still the
   starter (not reparented), or is the reading process itself - a process
   that is its own subreaper must never read its own children orphaned."
  [{:keys [probe-ppid self-pid starter-pid]}]
  (when (and probe-ppid (pos? probe-ppid) (not= probe-ppid self-pid) (not= probe-ppid starter-pid))
    probe-ppid))

(defn- start-instant [pid]
  (try
    (some-> (.orElse (java.lang.ProcessHandle/of (long pid)) nil) .info .startInstant (.orElse nil) str)
    (catch Exception _ nil)))

(defn- probe-adopter!
  "Orphans a `sleep` below this process (its `sh` starter exits at once),
   reads the pid that adopts it, then kills it. nil on any failure."
  []
  (try
    (let [{:keys [exit out]} (daemon-cycle-guard-lib/sh! "sh" "-c" "sleep 30 </dev/null >/dev/null 2>&1 & echo \"$$ $!\"")
          [starter probe] (map parse-long (str/split (str/trim (str out)) #"\s+"))]
      (when (and (zero? exit) starter probe)
        (when-let [ph (.orElse (java.lang.ProcessHandle/of (long probe)) nil)]
          (try
            (let [ppid (loop [i 0]
                         (let [pp (some-> (.orElse (.parent ph) nil) .pid)]
                           (if (and (= pp starter) (< i 50))
                             (do (Thread/sleep 10) (recur (inc i)))
                             pp)))]
              (adopter-from-probe {:probe-ppid ppid
                                   :self-pid (.pid (java.lang.ProcessHandle/current))
                                   :starter-pid starter}))
            (finally (.destroyForcibly ph))))))
    (catch Exception _ nil)))

(defonce ^:private adopter-cache (atom nil))

(defn orphan-adopter-pid
  "The pid that adopts this process's orphans (PID 1 or a child
   subreaper), probed once and cached for the life of the process. The
   cache is dropped when that pid has exited or been reused (a different
   start instant), so a long-lived reaper never trusts a stale adopter."
  []
  (let [{:keys [pid start]} @adopter-cache]
    (if (and pid (some? start) (= start (start-instant pid)))
      pid
      (let [fresh (probe-adopter!)]
        (reset! adopter-cache (when fresh {:pid fresh :start (start-instant fresh)}))
        fresh))))

(defn parent-orphaned?
  "True when pid's parent is gone, dead, PID 1 (init/launchd), or the
   host's adopter of last resort (orphan-adopter-pid: a child subreaper such
   as WSL's Relay /init, BL-1907). Disposable-root front-desk bridge/bot
   children keep a living supervisor as parent while a test is still
   running; an adopted parent means that supervisor already exited and
   left them behind (the exact leftovers that bind host :8765 and trip the
   production front-desk give-up email before the multi-hour age gate
   would ever fire). Never true for a process whose live starter is not the
   adopter. A daemon the swarm detaches on purpose is parented the same
   way, so each reaper's own candidate filter is what keeps it off one."
  [pid]
  (try
    (if-let [ph (.orElse (java.lang.ProcessHandle/of (long pid)) nil)]
      (let [parent (.orElse (.parent ph) nil)
            parent-pid (some-> parent .pid)]
        (orphaned-by-parent? {:parent-pid parent-pid
                              :parent-alive? (boolean (some-> parent .isAlive))
                              :adopter-pid (when (and parent-pid (not= 1 parent-pid) (.isAlive parent))
                                             (orphan-adopter-pid))}))
      true)
    (catch Exception _ false)))

(defn- cwd-from-procfs
  [pid]
  (try
    (let [cwd-link (fs/path "/proc" (str pid) "cwd")]
      (when (fs/exists? cwd-link)
        (str (fs/real-path cwd-link))))
    (catch Exception _ nil)))

(defn- cwd-from-lsof
  "Darwin (and other non-procfs hosts): lsof reports cwd as an `n…` path line."
  [pid]
  (try
    (let [{:keys [out]} (daemon-cycle-guard-lib/sh! {:continue true} "lsof" "-a" "-p" (str pid) "-d" "cwd" "-Fn")]
      (->> (str/split-lines (or out ""))
           (keep (fn [line]
                   (when (str/starts-with? line "n")
                     (subs line 1))))
           (remove str/blank?)
           first))
    (catch Exception _ nil)))

(defn cwd!
  "Best-effort absolute cwd for pid."
  [pid]
  (if (procfs-available?)
    (cwd-from-procfs pid)
    (cwd-from-lsof pid)))

(defn- path-boundary-after?
  "True when the character following a path match is a real path boundary -
   end of string, a separator, whitespace, or a quote. BL-1370: without this,
   both arms matched a bare prefix, so `.worktrees/coder` claimed
   `.worktrees/coder-cursor2` (a live sibling on this host) and `/repo`
   claimed `/repo-2`. For a classifier whose consumers KILL what it claims,
   that is the wrong direction to be wrong in."
  [s idx]
  (or (>= idx (count s))
      (contains? #{\/ \space \tab \" \'} (.charAt ^String s idx))))

(defn- cmd-names-path?
  "The command line mentions `path` at a path-component boundary. Every
   occurrence is considered: a path can appear more than once in an argv, and
   only one of them needs to be a real reference."
  [cmd path]
  (loop [from 0]
    (let [idx (str/index-of cmd path from)]
      (cond
        (nil? idx) false
        (path-boundary-after? cmd (+ idx (count path))) true
        :else (recur (inc idx))))))

(defn project-scoped-process?
  "True when cmd names any path in `paths`, or cwd is non-nil and is inside
   one, matching only at a PATH-COMPONENT BOUNDARY: cwd must equal the path or
   continue with `/`, and a command-line match must be followed by `/`,
   whitespace, a quote, or end of string. Nil-safe on both cmd and cwd.

   Shared 'is this process ours' classification for the handoffd supervisor's
   crash-orphan reaper, the orphan janitor's stale-process sweep, and the
   per-pass worktree stray gate (BL-1370), so the three can never disagree
   (BL-887). The boundary requirement is BL-1370's: a prefix-sibling root is
   never mine, in either arm."
  [cmd cwd paths]
  (boolean
   (or (some #(cmd-names-path? (or cmd "") %) paths)
       (and cwd (some #(or (= cwd %)
                           (and (str/starts-with? cwd %)
                                (path-boundary-after? cwd (count %))))
                      paths)))))
