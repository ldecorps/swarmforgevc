#!/usr/bin/env bb
;; BL-1370: the entry point a role calls about its OWN pass.
;;
;;   check_worktree_strays.bb <worktree-root> [--reap]
;;
;; `check` (the default) prints one recordable result line and exits non-zero
;; when a stray is found: a stray is a REFUSAL, not a warning, so a pass cannot
;; be approved with test or mutation processes still alive (invariant 3).
;; `--reap` kills each stray's process GROUP and then re-checks.
;;
;; Scope comes from process_table_lib's shared classifier, never from a second
;; notion of "mine" invented here - see worktree_stray_lib.bb's header.
(ns check-worktree-strays
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "worktree_stray_lib.bb")))

(defn- usage []
  (println "usage: check_worktree_strays.bb <worktree-root> [--reap]")
  (System/exit 2))

(defn- pgid-of
  "The process group of `pid`, or nil when it cannot be read - a pgid this
   process cannot see is never guessed."
  [pid]
  (try
    (let [{:keys [out exit]} (p/shell {:out :string :err :string :continue true}
                                      "ps" "-o" "pgid=" "-p" (str pid))]
      (when (zero? exit)
        (let [t (str/trim (or out ""))]
          (when-not (str/blank? t) (parse-long t)))))
    (catch Exception _ nil)))

(defn- self-and-ancestors
  "This process and its parents. A check that reported itself could never be
   clean: bb running this script matches nothing, but a caller wrapping it in
   `npx vitest` would."
  []
  (loop [h (java.lang.ProcessHandle/current) acc #{}]
    (if h
      (recur (.orElse (.parent h) nil) (conj acc (.pid h)))
      acc)))

(defn collect-strays
  "Read the process table once and return this root's strays, each carrying the
   process group reaping needs."
  [root]
  (let [mine (self-and-ancestors)
        procs (or (process-table-lib/list-processes!) [])
        ;; Cheap filter FIRST. `cwd!` shells out per pid, so enriching the
        ;; whole table cost ~30s on a 136-process host and made a role's gate
        ;; slower than the thing it guards - the first draft did exactly that
        ;; and hung the acceptance runner. The job pattern narrows hundreds of
        ;; processes to a handful before any cwd is read; scope is still the
        ;; shared classifier's call, on exactly the same candidates.
        candidates (->> procs
                        (remove #(contains? mine (:pid %)))
                        (filter #(worktree-stray-lib/job-process? (:cmdline %))))
        enriched (mapv (fn [{:keys [pid cmdline]}]
                         {:pid pid
                          :cmdline cmdline
                          :cwd (process-table-lib/cwd! pid)})
                       candidates)
        found (worktree-stray-lib/strays enriched root)]
    {:scanned (count procs)
     :strays (mapv #(assoc % :pgid (pgid-of (:pid %))) found)}))

(defn- own-pgid
  "This process's own group, so the reap can refuse to signal it."
  []
  (try
    (let [{:keys [out exit]} (p/shell {:out :string :err :string :continue true}
                                      "ps" "-o" "pgid=" "-p" (str (.pid (java.lang.ProcessHandle/current))))]
      (when (zero? exit) (parse-long (str/trim (or out "")))))
    (catch Exception _ nil)))

(defn- reap!
  "Signal each stray's process GROUP - never a bare pid (invariant 2).
  
   And never THIS process's own group. A stray started from the role's own
   shell without setsid shares that shell's group, so `kill -- -<pgid>` would
   take out the role's own session along with the stray - measured while
   building this: the probe killed the shell that ran it. Such a stray is
   reported with the pid to kill by hand rather than silently taking the pane
   down; a gate that ends the role's session is worse than the orphan."
  [strays]
  (let [{:keys [pgids unreapable]} (worktree-stray-lib/reap-targets strays)
        mine (own-pgid)
        [self others] [(filter #(= % mine) pgids) (remove #(= % mine) pgids)]]
    (doseq [pgid self]
      (println (str "WORKTREE_STRAYS: pgid=" pgid " is THIS process's own group - reported, not killed"
                    " (a stray sharing the role's shell group; kill the pid by hand)")))
    (doseq [pgid others]
      (try
        (p/shell {:out :string :err :string :continue true} "kill" "--" (str "-" pgid))
        (catch Exception _ nil)))
    (doseq [{:keys [pid]} unreapable]
      (println (str "WORKTREE_STRAYS: pid=" pid " has no readable process group - reported, not killed")))
    (count others)))

(defn -main [& args]
  (let [root-arg (first args)
        reap? (boolean (some #{"--reap"} args))]
    (when (or (nil? root-arg) (str/starts-with? (str root-arg) "--")) (usage))
    (let [root (str (fs/canonicalize root-arg))
          {:keys [scanned strays]} (collect-strays root)]
      (if (and reap? (seq strays))
        (do
          (println (worktree-stray-lib/result-line strays scanned root))
          (reap! strays)
          ;; Re-read the table rather than assume the kill worked: "I sent a
          ;; signal" is not "the process is gone".
          (Thread/sleep 300)
          (let [{:keys [scanned strays]} (collect-strays root)]
            (println (worktree-stray-lib/result-line strays scanned root))
            (System/exit (if (seq strays) 1 0))))
        (do
          (println (worktree-stray-lib/result-line strays scanned root))
          (System/exit (if (seq strays) 1 0)))))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
