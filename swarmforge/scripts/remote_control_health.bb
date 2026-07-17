#!/usr/bin/env bb

;; Report (and optionally repair) the remote-control health of every configured
;; agent. This is the BAU probe: for each role it checks that the pane's live
;; claude process still carries its `--remote-control SwarmForge-<Role>` flag,
;; which is what keeps the agent visible/controllable from claude.ai/code and
;; the mobile app. See remote_control_health_lib.bb for why the live-process
;; flag - not pane scrollback - is the signal we trust.
;;
;; Usage:
;;   remote_control_health.bb <project-root> [--fix]
;;
;;   (no flag)  report only; exit 1 if any role is :degraded, else 0.
;;   --fix      respawn any :degraded pane from its persisted launch script
;;              (which restores the flag), then re-report. Never touches a
;;              :healthy agent, so it is safe to run against a live swarm.
;;
;; :down roles (crashed agent, no live process) are reported but left alone -
;; reviving the pane itself is `swarm_ensure.bb`'s job; once it respawns, the
;; launch script restores RC automatically.

(ns remote-control-health-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "remote_control_health_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: remote_control_health.bb <project-root> [--fix]"))
  (System/exit 2))

(let [args *command-line-args*
      project-root (first args)
      fix? (some #(= "--fix" %) (rest args))]
  (when (or (nil? project-root) (str/starts-with? (str project-root) "--"))
    (usage))

  (let [state-dir (fs/path project-root ".swarmforge")
        socket-file (fs/path state-dir "tmux-socket")
        socket (when (fs/exists? socket-file) (str/trim (slurp (str socket-file))))
        roles (->> (handoff-lib/load-all-roles project-root)
                   (remove #(str/blank? (:role %))))
        label {:healthy "HEALTHY" :degraded "DEGRADED" :down "DOWN (agent not running)"
               :off "off (remote_control disabled)"}]

    (when-not socket
      (binding [*out* *err*]
        (println "No tmux socket at" (str socket-file) "- swarm not running?")))

    (println "Remote-control health")
    (println "Project:" (str project-root))
    (println)

    (let [results
          (doall
           (for [{:keys [role session]} roles]
             (let [r (remote-control-health/check-role state-dir socket role session)]
               (printf "%-14s %-28s %s\n"
                       role
                       (or (:expected r) "(none)")
                       (get label (:status r) (name (:status r))))
               (flush)
               r)))
          degraded (filter #(remote-control-health/actionable? (:status %)) results)]

      (when (and fix? (seq degraded))
        (println)
        (println "Repairing" (count degraded) "degraded agent(s) by respawning from launch script...")
        (doseq [{:keys [role session]} degraded]
          (println "  respawn" role)
          (remote-control-health/respawn-role-pane!
           socket session (remote-control-health/launch-script-path state-dir role))))

      (let [final (if (and fix? (seq degraded))
                    (doall (for [{:keys [role session]} roles]
                             (remote-control-health/check-role state-dir socket role session)))
                    results)
            still-degraded (filter #(remote-control-health/actionable? (:status %)) final)]
        (System/exit (if (seq still-degraded) 1 0))))))
