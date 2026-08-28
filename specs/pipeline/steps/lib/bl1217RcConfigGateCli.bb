#!/usr/bin/env bb
;; BL-1217 acceptance driver: exercises the REAL
;; remote_control_health_lib.bb (check-role, actionable?, expected-rc-name)
;; against a real fixture root - a persisted launch script that still
;; carries --remote-control, plus a real conf file, exactly as a pack
;; flipped to `config remote_control off` after launch looks on disk.
;;
;; Usage: bb bl1217RcConfigGateCli.bb <root> <configValue|NONE> <observed>
;;   observed: degraded | session-dead | down
;; Prints one JSON line:
;;   {"status":"...", "actionable":bool, "expectedRcName":str-or-null}
(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "remote_control_health_lib.bb")))

(def root (nth *command-line-args* 0))
(def config-value (nth *command-line-args* 1))
(def observed (nth *command-line-args* 2))

(def state-dir (str (fs/path root ".swarmforge")))
(def launch-dir (fs/path state-dir "launch"))
(fs/create-dirs launch-dir)
(spit (str (fs/path launch-dir "coder.sh"))
      "claude --dangerously-skip-permissions --remote-control SwarmForge-Coder --append-system-prompt-file x\n")

(when (not= config-value "NONE")
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
        (str "config remote_control " config-value "\n")))

(def cmdline-fn
  (case observed
    "degraded" (fn [_ _] "claude --dangerously-skip-permissions --append-system-prompt-file x")
    "session-dead" (fn [_ _] "claude --dangerously-skip-permissions --remote-control SwarmForge-Coder --append-system-prompt-file x")
    "down" (fn [_ _] nil)
    (throw (ex-info "unknown observed shape" {:observed observed}))))

(def footer-streak (if (= observed "session-dead") 2 0))

(def result
  (remote-control-health/check-role state-dir "sock" "coder" "swarmforge-coder" cmdline-fn footer-streak))

(def status (:status result))

(println (json/generate-string
          {:status (name status)
           :actionable (remote-control-health/actionable? status)
           :expectedRcName (remote-control-health/expected-rc-name state-dir "coder")}))
