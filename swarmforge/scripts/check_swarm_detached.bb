#!/usr/bin/env bb
;; BL-372: thin CLI wrapper so start-swarm.sh (bash) can call the pure
;; sighup-ignored?/decide-launch-outcome decisions. Reads PID's raw
;; ignored-signals mask - /proc/<pid>/status's SigIgn line on Linux, or
;; `ps -o sigignore=` on macOS/BSD where /proc does not exist (both
;; conventionally hex; the macOS path is a best-effort port, unverified on
;; a real macOS host in this environment - see swarm_detach_lib.bb's
;; header for why this replaced an earlier ppid-based check that could
;; never discriminate against a real tmux server). Prints the decided
;; message to stdout and exits 0 on success, or prints the failure message
;; to stderr and exits 1 - never a silent pass.
;;
;; Usage: check_swarm_detached.bb <ready 0|1> <pid>

(require '[babashka.fs :as fs]
         '[clojure.java.shell :as sh]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_detach_lib.bb")))

(defn- sig-ignore-mask [pid]
  (let [proc-status (str "/proc/" pid "/status")]
    (if (fs/exists? proc-status)
      ;; slurp fails on /proc's virtual files (a JVM/NIO quirk - they
      ;; report size 0 regardless of actual content) - shell out to cat
      ;; instead, same as every other real-filesystem-vs-/proc split in
      ;; this codebase.
      (let [result (sh/sh "cat" proc-status)]
        (when (zero? (:exit result))
          (some->> (:out result)
                    str/split-lines
                    (some #(when (str/starts-with? % "SigIgn:") %))
                    (#(some-> % (str/split #"\s+") second))
                    swarm-detach-lib/parse-hex)))
      (let [result (sh/sh "ps" "-o" "sigignore=" "-p" (str pid))]
        (when (zero? (:exit result))
          (swarm-detach-lib/parse-hex (:out result)))))))

(defn -main [ready-flag pid]
  (let [ready? (= "1" ready-flag)
        detached? (swarm-detach-lib/sighup-ignored? (sig-ignore-mask pid))
        {:keys [ok? message]} (swarm-detach-lib/decide-launch-outcome {:ready? ready? :detached? detached?})]
    (if ok?
      (do (println message) (System/exit 0))
      (do (binding [*out* *err*] (println (str "check_swarm_detached.bb: " message)))
          (System/exit 1)))))

(apply -main *command-line-args*)
