#!/usr/bin/env bb
;; BL-092: the second-swarm remote wake-up bridge's nudge step, invoked by
;; .github/workflows/second-swarm-wakeup.yml's self-hosted-runner job AFTER
;; it has already synced (fetched/pulled) the target checkout. This script
;; owns only the decision (does this push concern MY swarm?) and the wake
;; itself - no routing/business logic, per the ticket's "no business logic
;; in the workflow" constraint extended to this script too. The specifier
;; does the real work once woken, exactly like any local handoffd wake.
;;
;; Reuses the SAME wake mechanism handoffd.bb's own notify! wraps
;; (agent_runtime_inject.bb's notify-agent!, agent_runtime_lib.bb's wake
;; steps/message) rather than a second implementation - one wake mechanism,
;; whether the nudge originates from the local daemon or this bridge.
;;
;; Idempotent/lossy-tolerant by construction: a missing tmux socket or
;; specifier role (swarm not running) or an already-busy pane (notify-
;; agent!'s own stacked-input detection) all degrade to a harmless no-op
;; rather than a crash or a duplicate-work risk - the durable state is git
;; + the backlog files, never this script.
;;
;; Usage: remote_wakeup_nudge.bb <project-root> <target-swarm-name> <changed-file-path>...
(ns remote-wakeup-nudge
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "remote_wakeup_lib.bb")))
(load-file (str (fs/path script-dir "agent_runtime_lib.bb")))
(load-file (str (fs/path script-dir "agent_runtime_inject.bb")))
(load-file (str (fs/path script-dir "handoff_lib.bb")))

(def project-root (nth *command-line-args* 0 nil))
(def target-swarm (nth *command-line-args* 1 nil))
(def changed-paths (drop 2 *command-line-args*))

(when (or (str/blank? project-root) (str/blank? target-swarm))
  (binding [*out* *err*]
    (println "Usage: remote_wakeup_nudge.bb <project-root> <target-swarm-name> <changed-file-path>..."))
  (System/exit 1))

(defn read-changed-backlog-files []
  (vec (for [path changed-paths
             :when (remote-wakeup-lib/backlog-yaml-path? path)
             :let [full (fs/path project-root path)]
             :when (fs/exists? full)]
         {:path path :swarm (remote-wakeup-lib/read-swarm-field (slurp (str full)))})))

(defn -main []
  (let [changed (read-changed-backlog-files)]
    (if-not (remote-wakeup-lib/should-nudge? changed target-swarm)
      (println (str "NO_NUDGE: no changed backlog item assigned to swarm \"" target-swarm "\""))
      (if-let [role-info (handoff-lib/load-role-info "specifier" project-root)]
        (let [socket-file (fs/path project-root ".swarmforge" "tmux-socket")]
          (if-not (fs/exists? socket-file)
            (println "NO_NUDGE: no tmux socket found (swarm not running)")
            (let [socket (str/trim (slurp (str socket-file)))]
              (agent-runtime-inject/notify-agent! socket (:session role-info) (or (:agent role-info) "claude")
                                                   :script-rel-path agent-runtime-lib/ready-script-rel-path)
              (println (str "NUDGED: specifier woken for swarm \"" target-swarm "\"")))))
        (println "NO_NUDGE: specifier not found in roles.tsv (swarm not running?)")))))

(-main)
