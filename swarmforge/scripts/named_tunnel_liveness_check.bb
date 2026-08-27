#!/usr/bin/env bb
;; BL-1199: thin CLI so start_ancillary_services.sh (bash) can consult the
;; SAME "is the Bubble named tunnel live?" decision swarm_status.bb's own
;; "bubble-cloudflared" row uses (named_tunnel_liveness_lib.bb) - one
;; shared predicate, not two hand-rolled checks. Real pidfile-read + `kill
;; -0` here; the decision itself stays in the pure lib.
;;
;; Usage: named_tunnel_liveness_check.bb <project-root>
;; Prints UP / DOWN / NOT_CONFIGURED to stdout.
;; Exit 0 = UP, 1 = DOWN, 2 = NOT_CONFIGURED.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "named_tunnel_liveness_lib.bb")))

(defn- read-pid [path]
  (when (fs/exists? path)
    (try
      (let [s (str/trim (slurp (str path)))]
        (when-not (str/blank? s) (parse-long s)))
      (catch Exception _ nil))))

(defn- pid-alive? [pid]
  (boolean
   (when pid
     (try (zero? (:exit (process/sh "kill" "-0" (str pid))))
          (catch Exception _ false)))))

(defn -main [root]
  (let [root (str (fs/canonicalize root))
        op (fs/path root ".swarmforge" "operator")
        pid-file (fs/path op "resident-spy-cloudflared.pid")
        configured? (named-tunnel-liveness-lib/configured? op)
        alive? (pid-alive? (read-pid pid-file))
        verdict (named-tunnel-liveness-lib/liveness-verdict {:configured? configured? :pid-alive? alive?})]
    (println (case verdict :up "UP" :down "DOWN" :not-configured "NOT_CONFIGURED"))
    (System/exit (case verdict :up 0 :down 1 :not-configured 2))))

(apply -main *command-line-args*)
