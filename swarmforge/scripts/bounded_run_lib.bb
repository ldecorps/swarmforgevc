;; bounded_run_lib.bb (BL-1103) — one wall-clock-bounded subprocess runner.
;;
;; Fold of expedite_cli.bb's former private `sh-bounded` and babysitter_check.bb's
;; former `run-bounded!`. Both carried the same two traps a first implementation
;; got wrong; two copies meant the next fix landed in one place only (BL-571
;; hand-copy shape). Callers load-file this lib and keep their own timeout
;; defaults / env seams — this file is the runner only.
;;
;; Loaded via load-file; refer as bounded-run-lib/run-bounded!.

(ns bounded-run-lib
  (:require [babashka.process :as process]
            [clojure.java.io :as io]))

(defn run-bounded!
  "Like babashka.process/sh but ENFORCES a wall-clock bound: on overrun the
   whole process GROUP is destroyed and {:timed-out? true} comes back.

   TWO details that a first fix got wrong and a genuinely-hung fixture exposed:

     1. `.destroyForcibly` kills the DIRECT child only. A shell script's own
        children (a `sleep`, a `claude`, an ensure) survive and keep running.
        So the command is wrapped in `setsid`, making it a process-group
        leader, and the whole GROUP is killed via `kill -KILL -- -<pgid>`.
        The `--` is LOAD-BEARING and its absence is silent: without it
        `/usr/bin/kill` reads `-<pid>` as an option, exits 0, kills only the
        leader, and leaves every grandchild running.
     2. Deref-ing the process after destroying it BLOCKS when a surviving
        grandchild still holds the stdout pipe open — EOF never arrives. So
        output goes to FILES rather than :string pipes, and a timed-out
        process is never deref'd."
  [opts timeout-ms out-file err-file & cmd]
  (let [proc (apply process/process
                    ;; stdin from /dev/null: otherwise some runners log
                    ;; "no stdin data received in 3s" on EVERY invocation.
                    (assoc opts :in (io/file "/dev/null")
                           :out (io/file (str out-file)) :err (io/file (str err-file)))
                    (concat ["setsid"] cmd))
        pid (.pid (:proc proc))
        finished? (.waitFor (:proc proc) (long timeout-ms) java.util.concurrent.TimeUnit/MILLISECONDS)]
    (if finished?
      {:exit (:exit @proc) :timed-out? false}
      (do
        ;; Negative pid = the whole process group. setsid made this pid the
        ;; group leader, so this reaches the runner AND everything it spawned.
        (try (process/sh {:continue true} "kill" "-KILL" "--" (str "-" pid))
             (catch Exception _ nil))
        (.destroyForcibly (:proc proc))
        {:exit nil :timed-out? true}))))
