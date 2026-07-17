#!/usr/bin/env bb
;; BL-486: the impure wiring half of the orphaned SwarmForge agent-process
;; reaper - real /proc scan (candidate scope + per-pid cwd/cmdline/age
;; reads), real tmux window-set enumeration (the SAME tracked-socket +
;; recursive pgrep -P technique kill_all_swarm.sh's own
;; snapshot_pane_descendants/collect_descendant_pids already use), and real
;; process kill. Loaded by BOTH operator_runtime.bb (the always-alive
;; janitor loop, auto-clean) and reap_orphan_agents.bb (a standalone CLI a
;; human/test can shell out to) - ONE real implementation, two callers,
;; never a second reimplementation, mirroring fixture_reaper_sweep_lib.bb's
;; own two-caller posture.
;;
;; Every real read/action goes through an injectable adapter, the SAME
;; "thin wiring slice" posture as fixture_reaper_sweep_lib.bb, so a wiring
;; test can supply pids it spawned itself along with their metadata - and
;; NEVER scans the tester's real /proc for SwarmForge-* candidates, which
;; could enumerate (and evaluate) a genuinely live agent (engineering.prompt
;; "the process table is a shared global").

(ns orphan-agent-reaper-sweep-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "orphan_agent_reaper_lib.bb")))
;; BL-413/BL-458: shared /proc cwd+fd scan - the same technique
;; fixture_reaper_sweep_lib.bb's own sweep! uses to detect a live process;
;; here it is read for a SPECIFIC candidate pid, never to scan the whole
;; table for liveness. ONE real implementation, loaded by whichever of this
;; file's own callers gets there first in a given process.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "proc_fd_scan_lib.bb")))

;; A tighter default matches the motivating incident (a 6h43m-old orphan)
;; and fixture_reaper_sweep_lib.bb's own SWARMFORGE_FIXTURE_REAP_STALE_HOURS
;; default - long enough to never reap an in-progress dry-run (e.g. an
;; active FES second-swarm bring-up), short enough to reclaim a genuine
;; orphan same-day. Human-confirmed at spec time (approval_context).
(defn stale-threshold-ms []
  (let [hours (or (some-> (System/getenv "SWARMFORGE_ORPHAN_REAP_STALE_HOURS") (Double/parseDouble)) 6.0)]
    (long (* hours 3600000))))

(defn audit-log-file [project-root]
  (str (fs/path project-root ".swarmforge" "daemon" "reap-orphan-agents-audit.log")))

;; ── real reads/actions ──────────────────────────────────────────────────

(defn- tracked-socket! [project-root]
  (let [f (fs/path project-root ".swarmforge" "tmux-socket")]
    (when (fs/exists? f)
      (let [s (str/trim (slurp (str f)))]
        (when-not (str/blank? s) s)))))

(defn- parse-pid-lines [out]
  (->> (str/split-lines (or out ""))
       (map str/trim)
       (remove str/blank?)
       (keep (fn [s] (try (Long/parseLong s) (catch Exception _ nil))))))

(defn- pane-pids! [sock]
  (try
    (let [{:keys [exit out]} (process/sh {:continue true} "tmux" "-S" sock "list-panes" "-a" "-F" "#{pane_pid}")]
      (if (zero? exit) (parse-pid-lines out) []))
    (catch Exception _ [])))

(defn- child-pids! [pid]
  (try
    (let [{:keys [exit out]} (process/sh {:continue true} "pgrep" "-P" (str pid))]
      (if (zero? exit) (parse-pid-lines out) []))
    (catch Exception _ [])))

;; Recursive over the REAL process tree - the same "every descendant, not
;; just direct children" traversal kill_all_swarm.sh's own
;; collect_descendant_pids performs before any teardown, needed because the
;; live claude agent is spawned several process levels below its own pane's
;; shell (respawn-pane's zsh -> the generated launch script -> claude),
;; never the pane pid itself.
(defn- descendant-pids! [pid]
  (let [children (child-pids! pid)]
    (into (set children) (mapcat descendant-pids! children))))

(defn live-window-pid-set!
  "Every pid belonging to the live control socket's tmux window set: each
   pane's own pid plus every real descendant. Reads the SAME tracked-socket
   file kill_all_swarm.sh reads (project-root/.swarmforge/tmux-socket) -
   never inferred or globbed. Empty when no socket is tracked (e.g. a
   private test fixture project-root that never launched tmux), which is
   safe: an empty window set simply excludes nothing, leaving every other
   gate to decide."
  [project-root]
  (if-let [sock (tracked-socket! project-root)]
    (let [panes (pane-pids! sock)]
      (into (set panes) (mapcat descendant-pids! panes)))
    #{}))

;; SwarmForge-* remote-control candidate tell - the exact flag
;; swarmforge.sh's own launch_role bakes into every claude role's argv
;; (extra_cli+=" --remote-control $(remote_control_session_name_for_role
;; ...)"). Whitespace-tolerant (a single space today, but never assume the
;; exact byte count of a shell-assembled argv).
(defn remote-control-cmdline? [cmdline]
  (boolean (re-find #"--remote-control\s+SwarmForge-" (or cmdline ""))))

(defn- proc-cmdline! [pid]
  (try
    (str/replace (slurp (str (fs/path "/proc" (str pid) "cmdline"))) "\u0000" " ")
    (catch Exception _ "")))

;; Candidate SCOPE: only SwarmForge-* remote-control claude processes are
;; ever surfaced - never a bare `pgrep claude` pattern-to-kill (BL-367's own
;; forbidden shape). A real /proc-wide scan, bounded by the host's own
;; process count, the same cost fixture_reaper_sweep_lib.bb's own
;; live-process-paths! already pays every sweep.
(defn- scan-candidate-pids! []
  (try
    (->> (fs/list-dir "/proc")
         (keep (fn [p] (try (Long/parseLong (fs/file-name p)) (catch Exception _ nil))))
         (filter #(remote-control-cmdline? (proc-cmdline! %)))
         vec)
    (catch Exception _ [])))

;; Test-only override: a wiring test supplies the EXACT pids it spawned
;; itself, never triggering the real /proc-wide scan above (which could
;; enumerate, and evaluate, a genuinely live agent on the tester's own
;; host). Comma-separated, matching the shell-friendly convention every
;; other SwarmForge env seam here uses.
(defn list-candidate-pids! []
  (if-let [override (System/getenv "SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS")]
    (->> (str/split override #",") (map str/trim) (remove str/blank?)
         (keep (fn [s] (try (Long/parseLong s) (catch Exception _ nil)))) vec)
    (scan-candidate-pids!)))

(defn cwd! [pid]
  (proc-fd-scan-lib/process-cwd-path (fs/path "/proc" (str pid))))

(defn has-children?! [pid]
  (boolean (seq (child-pids! pid))))

;; Same technique fixture_reaper_sweep_lib.bb's own entry-age-ms! uses for a
;; /tmp entry, pointed at /proc/<pid> instead: a process's procfs directory
;; is created at process start and its mtime is a stable, filesystem-level
;; proxy for process age, with no external tool dependency.
(defn age-ms! [pid]
  (try (- (System/currentTimeMillis) (.toMillis (fs/last-modified-time (fs/path "/proc" (str pid)))))
       (catch Exception _ 0)))

(defn- kill-pid! [pid]
  (try (some-> (java.lang.ProcessHandle/of (long pid)) (.orElse nil) (.destroyForcibly))
       (catch Exception _ nil)))

(defn- default-log! [msg] (println (str "orphan-agent-reaper-sweep: " msg)))

(defn- append-audit! [log-file line]
  (fs/create-dirs (fs/parent log-file))
  (spit (str log-file) (str line "\n") :append true))

(defn default-adapters
  "The real reads/actions sweep! uses when called with no adapters map -
   exposed so a caller (operator_runtime.bb) that wants its OWN :log!
   (writing into its own runtime.log instead of stdout) can override just
   that one key without hand-duplicating every other real adapter here."
  [project-root]
  {:list-candidate-pids! list-candidate-pids!
   :cmdline! proc-cmdline!
   :cwd! cwd!
   :has-children?! has-children?!
   :age-ms! age-ms!
   :live-window-pid-set! (fn [] (live-window-pid-set! project-root))
   :kill-pid! kill-pid!
   :audit! (fn [line] (append-audit! (audit-log-file project-root) line))
   :log! default-log!})

(defn- now-iso []
  (.format java.time.format.DateTimeFormatter/ISO_INSTANT (java.time.Instant/now)))

(defn sweep!
  "adapters is {:list-candidate-pids! fn :cmdline! fn :cwd! fn
   :has-children?! fn :age-ms! fn :live-window-pid-set! fn :kill-pid! fn
   :audit! fn :log! fn}, defaulting to the real reads/actions in
   default-adapters for project-root. Evaluates every candidate pid through
   the pure orphan-agent-reaper-lib/reapable? predicate; kills and
   audit-logs only a candidate that clears every gate. Never a
   pattern-to-kill: enumeration only SURFACES candidates, the kill decision
   is per-pid through the pure predicate."
  ([project-root] (sweep! project-root (default-adapters project-root)))
  ([project-root adapters]
   (let [log! (or (:log! adapters) default-log!)
         threshold-ms (stale-threshold-ms)
         window-pids ((:live-window-pid-set! adapters))
         candidates ((:list-candidate-pids! adapters))
         reaped (atom 0)]
     (doseq [pid candidates]
       (let [cwd ((:cwd! adapters) pid)
             cwd-inside-root? (boolean (and cwd (str/starts-with? cwd (str project-root "/.swarmforge"))))
             remote-control? (remote-control-cmdline? ((:cmdline! adapters) pid))
             has-children? ((:has-children?! adapters) pid)
             age-ms ((:age-ms! adapters) pid)
             stale? (>= age-ms threshold-ms)
             in-window? (contains? window-pids pid)]
         (when (orphan-agent-reaper-lib/reapable?
                {:in-live-window-set? in-window?
                 :cwd-inside-root? cwd-inside-root?
                 :remote-control-agent? remote-control?
                 :has-children? has-children?
                 :stale? stale?})
           ((:kill-pid! adapters) pid)
           ((:audit! adapters) (str (now-iso) " reaped pid=" pid " cwd=" cwd " age_ms=" age-ms))
           (swap! reaped inc))))
     (log! (str "swept " (count candidates) " candidate(s), reaped " @reaped)))))
