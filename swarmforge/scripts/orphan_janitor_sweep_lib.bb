#!/usr/bin/env bb
;; Orphan janitor sweep — reclaim leftovers fixture/agent reapers miss:
;;   - tmp operator_runtime.bb
;;   - hung acceptance `node …generated.test.js`
;;   - disposable-root ancillaries (babysitter tmux/launch, bridge/bot,
;;     claude -n Babysitter under /tmp/tmp.|aps-|sfvc-)
;; Wired into operator_runtime.bb's tick (best-effort). Injectable adapters
;; so tests never scan the real process table for kill decisions.

(ns orphan-janitor-sweep-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "orphan_janitor_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "orphan_agent_reaper_sweep_lib.bb")))

;; Tighter than the 6h agent/fixture defaults: a /tmp operator_runtime or a
;; hung acceptance test should not live past a couple of hours.
(defn operator-runtime-stale-threshold-ms []
  (let [hours (or (some-> (System/getenv "SWARMFORGE_ORPHAN_JANITOR_RUNTIME_STALE_HOURS")
                          (Double/parseDouble))
                  2.0)]
    (long (* hours 3600000))))

(defn acceptance-stale-threshold-ms []
  (let [hours (or (some-> (System/getenv "SWARMFORGE_ORPHAN_JANITOR_ACCEPTANCE_STALE_HOURS")
                          (Double/parseDouble))
                  2.0)]
    (long (* hours 3600000))))

(defn ancillary-stale-threshold-ms []
  (let [hours (or (some-> (System/getenv "SWARMFORGE_ORPHAN_JANITOR_ANCILLARY_STALE_HOURS")
                          (Double/parseDouble))
                  2.0)]
    (long (* hours 3600000))))

(defn audit-log-file [project-root]
  (str (fs/path project-root ".swarmforge" "daemon" "orphan-janitor-audit.log")))

(defn- proc-cmdline! [pid]
  (try
    (str/replace (slurp (str (fs/path "/proc" (str pid) "cmdline"))) "\u0000" " ")
    (catch Exception _ "")))

(defn- scan-candidate-pids! []
  (try
    (->> (fs/list-dir "/proc")
         (keep (fn [p] (try (Long/parseLong (fs/file-name p)) (catch Exception _ nil))))
         (filter (fn [pid]
                   (let [cmd (proc-cmdline! pid)]
                     (or (orphan-janitor-lib/operator-runtime-cmdline? cmd)
                         (orphan-janitor-lib/hung-acceptance-cmdline? cmd)
                         (orphan-janitor-lib/tmp-ancillary-cmdline? cmd)))))
         vec)
    (catch Exception _ [])))

(defn list-candidate-pids! []
  (if-let [override (System/getenv "SWARMFORGE_ORPHAN_JANITOR_CANDIDATE_PIDS")]
    (->> (str/split override #",")
         (map str/trim)
         (remove str/blank?)
         (keep (fn [s] (try (Long/parseLong s) (catch Exception _ nil))))
         vec)
    (scan-candidate-pids!)))

(defn live-runtime-pid!
  "Pid claimed by this project's operator_runtime.bb (runtime.pid), if alive."
  [project-root]
  (let [f (fs/path project-root ".swarmforge" "operator" "runtime.pid")]
    (when (fs/exists? f)
      (try
        (let [pid (Long/parseLong (str/trim (slurp (str f))))]
          (when (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))
            pid))
        (catch Exception _ nil)))))

(defn- age-ms!
  "Process age via ProcessHandle startInstant — /proc/<pid> mtime is not
   stable on WSL (reads refresh it), so the fixture/agent reaper's mtime
   proxy under-ages long-lived orphans here."
  [pid]
  (try
    (if-let [ph (some-> (java.lang.ProcessHandle/of (long pid)) (.orElse nil))]
      (if-let [start (some-> (.info ph) .startInstant (.orElse nil))]
        (- (System/currentTimeMillis) (.toEpochMilli start))
        0)
      0)
    (catch Exception _ 0)))

(defn- kill-pid! [pid]
  (try (some-> (java.lang.ProcessHandle/of (long pid)) (.orElse nil) (.destroyForcibly))
       (catch Exception _ nil)))

(defn- append-audit! [log-file line]
  (fs/create-dirs (fs/parent log-file))
  (spit (str log-file) (str line "\n") :append true))

(defn- default-log! [msg] (println (str "orphan-janitor-sweep: " msg)))

(defn- now-iso []
  (.format java.time.format.DateTimeFormatter/ISO_INSTANT (java.time.Instant/now)))

(defn default-adapters
  [project-root]
  {:list-candidate-pids! list-candidate-pids!
   :cmdline! proc-cmdline!
   :age-ms! age-ms!
   :live-window-pid-set! (fn [] (orphan-agent-reaper-sweep-lib/live-window-pid-set! project-root))
   :live-runtime-pid! (fn [] (live-runtime-pid! project-root))
   :kill-pid! kill-pid!
   :audit! (fn [line] (append-audit! (audit-log-file project-root) line))
   :log! default-log!})

(defn sweep!
  ([project-root] (sweep! project-root (default-adapters project-root)))
  ([project-root adapters]
   (let [log! (or (:log! adapters) default-log!)
         runtime-threshold (operator-runtime-stale-threshold-ms)
         acceptance-threshold (acceptance-stale-threshold-ms)
         ancillary-threshold (ancillary-stale-threshold-ms)
         window-pids ((:live-window-pid-set! adapters))
         live-runtime ((:live-runtime-pid! adapters))
         candidates ((:list-candidate-pids! adapters))
         reaped (atom 0)]
     (doseq [pid candidates]
       (let [cmd ((:cmdline! adapters) pid)
             age ((:age-ms! adapters) pid)
             in-window? (contains? window-pids pid)
             is-live-runtime? (= pid live-runtime)]
         (cond
           (orphan-janitor-lib/operator-runtime-cmdline? cmd)
           (let [root (orphan-janitor-lib/parse-operator-runtime-root cmd)
                 tmp? (orphan-janitor-lib/tmp-project-root? root)
                 stale? (>= age runtime-threshold)]
             (when (orphan-janitor-lib/reapable-tmp-operator-runtime?
                    {:in-live-window-set? in-window?
                     :is-live-runtime-pid? is-live-runtime?
                     :tmp-project-root? tmp?
                     :stale? stale?})
               ((:kill-pid! adapters) pid)
               ((:audit! adapters)
                (str (now-iso) " reaped-operator-runtime pid=" pid
                     " root=" root " age_ms=" age))
               (swap! reaped inc)))

           (orphan-janitor-lib/hung-acceptance-cmdline? cmd)
           (let [stale? (>= age acceptance-threshold)]
             (when (orphan-janitor-lib/reapable-hung-acceptance?
                    {:in-live-window-set? in-window?
                     :hung-acceptance? true
                     :stale? stale?})
               ((:kill-pid! adapters) pid)
               ((:audit! adapters)
                (str (now-iso) " reaped-hung-acceptance pid=" pid
                     " age_ms=" age))
               (swap! reaped inc)))

           (orphan-janitor-lib/tmp-ancillary-cmdline? cmd)
           (let [root (orphan-janitor-lib/parse-tmp-ancillary-root cmd)
                 tmp? (orphan-janitor-lib/tmp-project-root? root)
                 stale? (>= age ancillary-threshold)]
             (when (orphan-janitor-lib/reapable-tmp-ancillary?
                    {:in-live-window-set? in-window?
                     :tmp-rooted-ancillary? tmp?
                     :stale? stale?})
               ((:kill-pid! adapters) pid)
               ((:audit! adapters)
                (str (now-iso) " reaped-tmp-ancillary pid=" pid
                     " root=" root " age_ms=" age))
               (swap! reaped inc))))))
     (log! (str "swept " (count candidates) " candidate(s), reaped " @reaped)))))
