#!/usr/bin/env bb
;; BL-372: thin CLI wrapper so start-swarm.sh (bash) can call the pure
;; detached?/decide-launch-outcome decisions. Reads the launched server's
;; CURRENT parent pid via `ps` (the -o ppid= field name is identical on
;; both BSD/macOS and GNU/Linux ps, unlike session-id field names, which
;; differ - see swarm_detach_lib.bb's header for why ppid, not sid/sess,
;; is the portable signal this checks). Prints the decided message to
;; stdout and exits 0 on success, or prints the failure message to stderr
;; and exits 1 - never a silent pass.
;;
;; Usage: check_swarm_detached.bb <ready 0|1> <server-pid> <caller-pid>

(require '[babashka.fs :as fs]
         '[clojure.java.shell :as sh]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_detach_lib.bb")))

(defn- server-ppid [server-pid]
  (let [result (sh/sh "ps" "-o" "ppid=" "-p" (str server-pid))]
    (when (zero? (:exit result))
      (let [trimmed (str/trim (:out result))]
        (when-not (str/blank? trimmed)
          (parse-long trimmed))))))

(defn -main [ready-flag server-pid caller-pid]
  (let [ready? (= "1" ready-flag)
        detached? (swarm-detach-lib/detached? {:server-ppid (server-ppid server-pid)
                                                :caller-pid (parse-long caller-pid)})
        {:keys [ok? message]} (swarm-detach-lib/decide-launch-outcome {:ready? ready? :detached? detached?})]
    (if ok?
      (do (println message) (System/exit 0))
      (do (binding [*out* *err*] (println (str "check_swarm_detached.bb: " message)))
          (System/exit 1)))))

(apply -main *command-line-args*)
