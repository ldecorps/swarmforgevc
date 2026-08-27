#!/usr/bin/env bb
;; BL-458: the impure wiring half of the orphaned acceptance-test-fixture
;; reaper - real /tmp listing, process killing (by /proc/<pid>/cwd rooted-
;; in-root scan, the same technique BL-413's sandbox_sweep_lib.bb sibling
;; uses to DETECT a live process; here the result KILLS it), tmux
;; kill-server for any *.sock file found under a reaped root, and
;; fs/delete-tree. Loaded by BOTH operator_runtime.bb (the always-alive
;; janitor loop, auto-clean) and reap_stale_test_fixtures.bb (a standalone
;; CLI runnerAdapter.js shells out to before an acceptance run) - ONE real
;; implementation, two callers, never a second reimplementation.
;;
;; Every real read/action goes through an injectable adapter, the SAME
;; "thin wiring slice" posture as BL-412/BL-413's own sweeps, so a wiring
;; test can point the whole sweep at a private fixture directory and NEVER
;; touch the real /tmp or a live swarm.

(ns fixture-reaper-sweep-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "fixture_reaper_lib.bb")))
;; BL-413/BL-458: shared /proc cwd+fd scan - the same technique
;; operator_runtime.bb's sandbox-sweep! sibling uses to DETECT a live
;; process; here the result KILLS it. ONE real implementation, loaded by
;; whichever of this file's own two callers (operator_runtime.bb,
;; reap_stale_test_fixtures.bb) gets there first in a given process.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "proc_fd_scan_lib.bb")))
;; BL-460: the shared bounded-DELETE windowing (see its own header comment
;; for the bounded-scan wedge this replaces) - the sandbox-sweep! sibling in
;; operator_runtime.bb uses the SAME lib.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "bounded_delete_sweep_lib.bb")))

(defn sweep-root []
  (or (System/getenv "SWARMFORGE_FIXTURE_REAP_ROOT") "/tmp"))

;; SAME env seam kill_all_swarm.sh / BL-413's sandbox-legacy-socket-dir
;; already established for this exact path - never a third name for the
;; same guardrail. `id -u` (not System/getenv "UID") because UID is a bash
;; builtin, not exported to a child process's environment.
(defn- current-uid! []
  (try
    (let [{:keys [exit out]} (process/sh {:continue true} "id" "-u")]
      (when (zero? exit) (str/trim out)))
    (catch Exception _ nil)))

(defn legacy-socket-dir []
  (or (System/getenv "SWARMFORGE_LEGACY_SOCKET_DIR")
      (when-let [uid (current-uid!)] (str "/tmp/swarmforge-" uid))))

;; A tighter default than BL-413's 24h dir-stale threshold - a crashed
;; acceptance run's orphaned processes are worth reclaiming sooner (they
;; hold live sockets/ports and hammer external APIs, per this ticket's own
;; incident: bots 404-hammering api.telegram.org for hours).
(defn stale-threshold-ms []
  (let [hours (or (some-> (System/getenv "SWARMFORGE_FIXTURE_REAP_STALE_HOURS") (Double/parseDouble)) 6.0)]
    (long (* hours 3600000))))

(defn max-per-tick []
  (or (some-> (System/getenv "SWARMFORGE_FIXTURE_REAP_MAX_PER_TICK") (parse-long)) 100))

;; BL-460: the persisted bounded-delete cursor/streak - default paths sit
;; INSIDE the swept root itself (so a test overriding SWARMFORGE_FIXTURE_REAP_ROOT
;; automatically isolates these too, no second env var required), named as
;; dotfiles that never match known-fixture-prefix? (belt-and-suspenders on
;; top of the explicit exclusion in list-entries! below - see its own
;; comment). Each independently overridable for a test that wants its own
;; state file separate from its fixture root.
(defn cursor-file []
  (or (System/getenv "SWARMFORGE_FIXTURE_REAP_CURSOR_FILE")
      (str (fs/path (sweep-root) ".swarmforge-fixture-reap-cursor"))))

(defn nothing-streak-file []
  (or (System/getenv "SWARMFORGE_FIXTURE_REAP_NOTHING_STREAK_FILE")
      (str (fs/path (sweep-root) ".swarmforge-fixture-reap-nothing-streak"))))

;; How many consecutive nothing-reaped ticks between "scanned, found
;; nothing" log lines - periodic, never per-tick-spammy (BL-460
;; tmp-sweep-bounded-deletes-05). Small enough to drive from a test.
(defn nothing-log-period []
  (or (some-> (System/getenv "SWARMFORGE_FIXTURE_REAP_NOTHING_LOG_PERIOD") (parse-long)) 20))

(defn- list-entries! [root]
  (let [own #{(fs/file-name (cursor-file)) (fs/file-name (nothing-streak-file))}]
    (try (->> (fs/list-dir root) (mapv fs/file-name) (remove own) vec) (catch Exception _ []))))

(defn- entry-age-ms! [entry-path]
  (try (- (System/currentTimeMillis) (.toMillis (fs/last-modified-time entry-path))) (catch Exception _ 0)))

;; pid -> the set of every REAL absolute path its cwd OR any of its open
;; file descriptors currently resolves to, for every live process -
;; BL-877's shared proc-fd-scan-lib/live-pid-paths! (/proc on Linux/WSL, a
;; single `lsof` call on Darwin; the platform split lives there, not here).
;; Read ONCE per sweep pass, not once per candidate root.
;;
;; nil (liveness could not be determined at all - neither facility
;; reachable) is passed through as nil, not coerced to {}: pids-rooted-in
;; already treats a nil/empty pid->paths identically (no pids found to
;; kill), which is this caller's own safe direction regardless - a reaped
;; root with a genuinely undetermined liveness state still gets its tree
;; deleted (the common case is a crash, not a still-running orphan) but
;; kills nothing it cannot actually see, same as an ordinary #{} miss. Only
;; the sandbox-sweep! sibling in operator_runtime.bb needs nil to flip its
;; OWN default, because ITS dangerous direction is deleting a root a live
;; process still needs, not this file's "an orphan keeps running one more
;; tick".
(defn- live-process-paths! []
  (proc-fd-scan-lib/live-pid-paths!))

;; BL-877: entry-path is resolved to its REAL path before matching - same
;; macOS /var -> /private/var symlink concern as operator_runtime.bb's
;; live-process-rooted-in? sibling (see its comment). Without this, a
;; reaped root under a symlinked macOS temp path never matches any live
;; pid's (resolved) cwd/fd paths, so an orphan is never killed.
(defn- pids-rooted-in [pid->paths entry-path]
  (let [entry-str (try (str (fs/real-path entry-path)) (catch Exception _ (str entry-path)))
        rooted? (fn [path] (or (= path entry-str) (str/starts-with? path (str entry-str "/"))))]
    (->> pid->paths
         (filter (fn [[_ paths]] (some rooted? paths)))
         (map first))))

(defn- kill-pid! [pid]
  (try
    (some-> (java.lang.ProcessHandle/of (long pid)) (.orElse nil) (.destroyForcibly))
    (catch Exception _ nil)))

;; A unix socket special file fails java.io.File's own .isFile() (it is
;; neither a regular file nor a directory) - filtering on "not a directory"
;; rather than "is a file" is what makes this actually match a live tmux
;; socket, not just skip it silently.
(defn- kill-tmux-sockets-under! [entry-path]
  (try
    (doseq [f (file-seq (java.io.File. (str entry-path)))]
      (when (and (str/ends-with? (.getName f) ".sock") (not (.isDirectory f)))
        (try (process/sh {:continue true} "tmux" "-S" (str f) "kill-server") (catch Exception _ nil))))
    (catch Exception _ nil)))

(defn- default-log! [msg] (println (str "fixture-reaper-sweep: " msg)))

(defn default-adapters
  "The real reads/actions sweep! uses when called with no arguments - exposed
   so a caller (operator_runtime.bb) that wants its OWN :log! (writing into
   its own runtime.log instead of stdout) can override just that one key
   without hand-duplicating every other real adapter here.

   BL-877: when live-process-paths! returns nil (liveness undetermined -
   neither /proc nor lsof reachable), it is passed through as :pid->paths
   nil rather than coerced - pids-rooted-in already treats nil like {}
   (nothing to kill), which is this reaper's own safe direction regardless
   of whether liveness was determined or not. The visibility log for this
   lives in sweep! itself (see its own comment), not here, so it reaches
   whichever :log! the caller ends up overriding this map's default with."
  []
  {:list-entries! list-entries!
   :entry-age-ms! entry-age-ms!
   :pid->paths (live-process-paths!)
   :kill-pid! kill-pid!
   :kill-tmux-sockets-under! kill-tmux-sockets-under!
   :delete-tree! (fn [p] (fs/delete-tree p {:force true}))
   :log! default-log!})

(defn sweep!
  "adapters is {:list-entries! fn :entry-age-ms! fn :pid->paths map
   :kill-pid! fn :kill-tmux-sockets-under! fn :delete-tree! fn :log! fn},
   defaulting to the real reads/actions in default-adapters. BL-460: bounds
   DELETES per tick via bounded-delete-sweep-lib's persisted cursor, not the
   scan - a reapable entry ordered after the per-tick cap is still reaped
   within a bounded number of ticks (the window advances and wraps every
   call, regardless of how many examined entries turn out non-reapable),
   never re-scanning the same dead window forever.

   BL-877 bounce fix: the liveness-undetermined visibility log fires HERE,
   using the already-resolved :log! below, not inside default-adapters -
   default-adapters returns before a caller's :log! override (assoc'd onto
   its result) ever takes effect, so logging there means the message goes
   through default-log! (stdout) even when a caller like operator_runtime.bb
   overrides :log! to write into its own runtime.log. Every other message
   this sweep produces already goes through this same resolved log!; this
   one was the sole exception."
  ([] (sweep! (default-adapters)))
  ([adapters]
   (let [root (sweep-root)
         socket-dir (legacy-socket-dir)
         threshold-ms (stale-threshold-ms)
         cap (max-per-tick)
         log! (or (:log! adapters) default-log!)]
     (when (nil? (:pid->paths adapters))
       (log! "liveness could not be determined this pass (no /proc, no lsof) - killing nothing this pass"))
     (when (fs/exists? root)
       (let [names ((:list-entries! adapters) root)
             cursor (bounded-delete-sweep-lib/read-cursor (cursor-file))
             {:keys [window next-cursor]} (bounded-delete-sweep-lib/next-window names cursor cap)
             reaped (atom 0)]
         (doseq [name window]
           (let [entry-path (fs/path root name)
                 socket-root? (= (str entry-path) socket-dir)
                 age-ms ((:entry-age-ms! adapters) entry-path)]
             (when (fixture-reaper-lib/reapable?
                    {:known-fixture-prefix? (fixture-reaper-lib/known-fixture-prefix? name)
                     :stale? (>= age-ms threshold-ms)
                     :socket-root? socket-root?})
               (doseq [pid (pids-rooted-in (:pid->paths adapters) entry-path)]
                 ((:kill-pid! adapters) pid))
               ((:kill-tmux-sockets-under! adapters) entry-path)
               (try ((:delete-tree! adapters) entry-path) (catch Exception _ nil))
               (swap! reaped inc))))
         (bounded-delete-sweep-lib/record-tick!
          {:cursor-file (cursor-file)
           :next-cursor next-cursor
           :nothing-streak-file (nothing-streak-file)
           :nothing-log-period (nothing-log-period)
           :reaped @reaped
           :window window
           :log! log!}))))))
