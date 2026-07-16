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

(defn- list-entries! [root]
  (try (mapv fs/file-name (fs/list-dir root)) (catch Exception _ [])))

(defn- entry-age-ms! [entry-path]
  (try (- (System/currentTimeMillis) (.toMillis (fs/last-modified-time entry-path))) (catch Exception _ 0)))

;; pid -> its cwd's real absolute path, for every live process, read via
;; /proc/<pid>/cwd (Linux/WSL). Read ONCE per sweep pass, not once per
;; candidate root. Returns an empty map (never throws) when /proc is
;; unavailable - a reaped root then simply has no pids to kill, which is
;; safe: the tree walk + fs/delete-tree still runs, so a stale root with NO
;; live process (the common case - a crash, not a still-running orphan)
;; still gets cleaned up.
(defn- live-process-cwds! []
  (try
    (->> (fs/list-dir "/proc")
         (keep (fn [p]
                 (try
                   (let [pid (try (Long/parseLong (fs/file-name p)) (catch Exception _ nil))
                         cwd-link (fs/path p "cwd")]
                     (when (and pid (fs/exists? cwd-link))
                       [pid (str (fs/real-path cwd-link))]))
                   (catch Exception _ nil))))
         (into {}))
    (catch Exception _ {})))

(defn- pids-rooted-in [pid->cwd entry-path]
  (let [entry-str (str entry-path)]
    (->> pid->cwd
         (filter (fn [[_ cwd]] (or (= cwd entry-str) (str/starts-with? cwd (str entry-str "/")))))
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

(defn sweep!
  "adapters is {:list-entries! fn :entry-age-ms! fn :pid->cwd map
   :kill-pid! fn :kill-tmux-sockets-under! fn :delete-tree! fn}, defaulting
   to the real reads/actions above. Bounded to max-per-tick entries per
   call - the remainder is picked up on a later call (removed roots simply
   drop out of the next listing)."
  ([]
   (sweep!
    {:list-entries! list-entries!
     :entry-age-ms! entry-age-ms!
     :pid->cwd (live-process-cwds!)
     :kill-pid! kill-pid!
     :kill-tmux-sockets-under! kill-tmux-sockets-under!
     :delete-tree! (fn [p] (fs/delete-tree p {:force true}))}))
  ([adapters]
   (let [root (sweep-root)
         socket-dir (legacy-socket-dir)
         threshold-ms (stale-threshold-ms)
         cap (max-per-tick)]
     (when (fs/exists? root)
       (doseq [name (take cap ((:list-entries! adapters) root))]
         (let [entry-path (fs/path root name)
               socket-root? (= (str entry-path) socket-dir)
               age-ms ((:entry-age-ms! adapters) entry-path)]
           (when (fixture-reaper-lib/reapable?
                  {:known-fixture-prefix? (fixture-reaper-lib/known-fixture-prefix? name)
                   :stale? (>= age-ms threshold-ms)
                   :socket-root? socket-root?})
             (doseq [pid (pids-rooted-in (:pid->cwd adapters) entry-path)]
               ((:kill-pid! adapters) pid))
             ((:kill-tmux-sockets-under! adapters) entry-path)
             (try ((:delete-tree! adapters) entry-path) (catch Exception _ nil)))))))))
