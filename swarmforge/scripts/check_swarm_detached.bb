#!/usr/bin/env bb
;; BL-372: thin CLI wrapper so start-swarm.sh (bash) can call the pure
;; sighup-ignored?/decide-launch-outcome decisions. Reads PID's raw
;; ignored-signals mask via read_proc_sigignore.sh (/proc SigIgn on Linux;
;; sysctl kp_proc.p_sigignore on Darwin — Monterey ps -o sigignore= is
;; broken). See swarm_detach_lib.bb's header for why this replaced an
;; earlier ppid-based check that could never discriminate against a real
;; tmux server. Prints the decided message to stdout and exits 0 on
;; success, or prints the failure message to stderr and exits 1 - never a
;; silent pass.
;;
;; Usage: check_swarm_detached.bb <ready 0|1> <pid>

(require '[babashka.fs :as fs]
         '[clojure.java.shell :as sh]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_detach_lib.bb")))

(def ^:private read-sigignore-script
  (str (fs/path (fs/parent (fs/canonicalize *file*)) "read_proc_sigignore.sh")))

(defn- sig-ignore-mask [pid]
  (let [result (sh/sh "bash" read-sigignore-script (str pid))]
    (when (zero? (:exit result))
      (swarm-detach-lib/parse-hex (:out result)))))

(defn -main [ready-flag pid]
  (let [ready? (= "1" ready-flag)
        detached? (swarm-detach-lib/sighup-ignored? (sig-ignore-mask pid))
        {:keys [ok? message]} (swarm-detach-lib/decide-launch-outcome {:ready? ready? :detached? detached?})]
    (if ok?
      (do (println message) (System/exit 0))
      (do (binding [*out* *err*] (println (str "check_swarm_detached.bb: " message)))
          (System/exit 1)))))

(apply -main *command-line-args*)
