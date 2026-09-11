;; bounded_run_lib.bb (BL-1103, folded into the chokepoint by BL-1525) — one
;; wall-clock-bounded subprocess runner.
;;
;; Fold of expedite_cli.bb's former private `sh-bounded` and babysitter_check.bb's
;; former `run-bounded!`. Both carried the same two traps a first implementation
;; got wrong; two copies meant the next fix landed in one place only (BL-571
;; hand-copy shape). Callers load-file this lib and keep their own timeout
;; defaults / env seams — this file is the runner only.
;;
;; BL-1525 (human ruling A): this file used to hold its own private
;; subprocess-launch call and its own setsid/group-kill trap, making it a
;; SECOND place naming the subprocess API in the daemon's spawn-reachable
;; subtree (handoffd.bb spawns expedite_cli.bb, which loads this lib) -
;; exactly the debt BL-1031's ratchet exists to catch. run-bounded! is now a
;; THIN WRAPPER over daemon-cycle-guard-lib/sh! - same signature, same
;; {:exit :timed-out?} result shape, so expedite_cli.bb and
;; babysitter_check.bb change nothing at their call sites. The setsid wrap
;; is pure data (no process API); the actual kill on a bound hit is sh!'s
;; :kill-mode :group (see daemon_cycle_guard_lib.bb) - the one caller that
;; needs the stricter whole-process-group kill rather than sh!'s default
;; live-descendants destroy-tree.
;;
;; Loaded via load-file; refer as bounded-run-lib/run-bounded!.

(ns bounded-run-lib
  (:require [babashka.fs :as fs]
            [clojure.java.io :as io]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))

(defn run-bounded!
  "Like a bounded sh call but ENFORCES a wall-clock bound: on overrun the
   whole process GROUP is destroyed and {:timed-out? true} comes back.

   TWO details that a first fix got wrong and a genuinely-hung fixture exposed,
   both now carried by daemon-cycle-guard-lib/sh! under :kill-mode :group:

     1. `.destroyForcibly` kills the DIRECT child only. A shell script's own
        children (a `sleep`, a `claude`, an ensure) survive and keep running.
        So the command is wrapped in `setsid`, making it a process-group
        leader, and the whole GROUP is killed via `kill -KILL -- -<pgid>`.
        The `--` is LOAD-BEARING and its absence is silent: without it
        `/usr/bin/kill` reads `-<pid>` as an option, exits 0, kills only the
        leader, and leaves every grandchild running.
     2. Deref-ing the process after destroying it BLOCKS when a surviving
        grandchild still holds the stdout pipe open — EOF never arrives. So
        output goes to FILES rather than :string pipes, and sh!'s bounded
        wait (one deadline over exit AND drain, BL-1021) is what frees the
        caller rather than a raw .waitFor - a timed-out process is never
        deref'd for its result here."
  [opts timeout-ms out-file err-file & cmd]
  (let [result (daemon-cycle-guard-lib/sh!
                (vec (concat ["setsid"] cmd))
                (merge opts
                       ;; stdin from /dev/null: otherwise some runners log
                       ;; "no stdin data received in 3s" on EVERY invocation.
                       {:in (io/file "/dev/null")
                        :out (io/file (str out-file))
                        :err (io/file (str err-file))
                        :bound-ms timeout-ms
                        :kill-mode :group}))]
    {:exit (:exit result) :timed-out? (= 124 (:exit result))}))
