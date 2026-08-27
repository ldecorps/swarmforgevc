#!/usr/bin/env bb

;; Gracefully respawn agent panes to re-establish their remote-control
;; (claude.ai/code) sessions with fresh session URLs.
;;
;; "Graceful" = never kill an agent mid-turn. For each role we watch its pane
;; for Claude Code's own busy footer ("esc to interrupt", the same signal the
;; chase daemon uses); we only respawn while the agent is idle at its prompt.
;; A busy agent is waited on up to --wait-seconds, then SKIPPED (reported, not
;; killed) so no in-flight generation is lost. Any parcel a respawned agent had
;; already claimed is picked back up by the RESUME-ON-START block its launch
;; script prints, so an idle-time respawn loses no queued work either.
;;
;; Roles are done one at a time (respawn, then confirm the new process carries
;; its --remote-control flag and capture the fresh session URL) so a mass
;; simultaneous restart never races the handoff daemon.
;;
;; Usage:
;;   remote_control_respawn.bb <project-root> [options]
;;     --role <name>       only this role (default: all roles in roles.tsv)
;;     --wait-seconds N    how long to wait for a busy agent to go idle (180)
;;     --dry-run          report each role's busy/idle state; respawn nothing

(ns remote-control-respawn
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "remote_control_health_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "chase_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: remote_control_respawn.bb <project-root> [--role N] [--wait-seconds N] [--dry-run]"))
  (System/exit 2))

(defn parse-args [args]
  (loop [a args, opts {:wait-seconds 180 :dry-run false :role nil}]
    (if-let [x (first a)]
      (case x
        "--role"         (recur (drop 2 a) (assoc opts :role (second a)))
        "--wait-seconds" (recur (drop 2 a) (assoc opts :wait-seconds (parse-long (str (second a)))))
        "--dry-run"      (recur (rest a) (assoc opts :dry-run true))
        (recur (rest a) opts))
      opts)))

(let [args *command-line-args*
      project-root (first args)
      opts (parse-args (rest args))]
  (when (or (nil? project-root) (str/starts-with? (str project-root) "--"))
    (usage))

  (let [state-dir (fs/path project-root ".swarmforge")
        socket-file (fs/path state-dir "tmux-socket")
        socket (when (fs/exists? socket-file) (str/trim (slurp (str socket-file))))
        _ (when-not socket
            (binding [*out* *err*] (println "No tmux socket - swarm not running?"))
            (System/exit 1))
        all-roles (->> (handoff-lib/load-all-roles project-root)
                       (remove #(str/blank? (:role %))))
        roles (if (:role opts)
                (filter #(= (:role opts) (:role %)) all-roles)
                all-roles)]

    (when (empty? roles)
      (binding [*out* *err*] (println "No matching roles for" (pr-str (:role opts))))
      (System/exit 1))

    (defn capture [session]
      (:out (process/sh {:continue true} "tmux" "-S" socket "capture-pane"
                        "-p" "-t" session "-S" "-120")))

    (defn busy? [session]
      (chase-sweep-lib/actively-processing? (capture session)))

    ;; Wait for a busy agent to go idle, polling ~every 3s up to the budget.
    ;; Returns true if it became idle, false if it stayed busy past the wait.
    ;; The stop/continue decision itself is remote-control-health/wait-outcome
    ;; (pure, unit-tested); this loop is just that decision driving Thread/sleep.
    (defn wait-until-idle [session wait-seconds]
      (loop [remaining wait-seconds]
        (case (remote-control-health/wait-outcome (busy? session) remaining)
          :idle true
          :timeout false
          :keep-waiting (do (Thread/sleep 3000) (recur (- remaining 3))))))

    ;; After a respawn, wait for the new claude process to appear carrying the
    ;; expected flag, then pull the fresh session URL out of the new scrollback.
    ;; URL extraction is remote-control-health/session-url-in-capture (pure,
    ;; unit-tested); this loop is just that plus Thread/sleep.
    (defn confirm-rc [role session expected]
      (loop [tries 20]
        (let [actual (remote-control-health/extract-rc-name
                      (remote-control-health/claude-cmdline-in-pane socket session))]
          (cond
            (= actual expected)
            {:ok true :url (remote-control-health/session-url-in-capture (capture session))}
            (<= tries 0) {:ok false :actual actual}
            :else (do (Thread/sleep 1500) (recur (dec tries)))))))

    (println (if (:dry-run opts) "Graceful RC respawn (DRY RUN)" "Graceful RC respawn"))
    (println "Project:" (str project-root))
    (println "Wait budget per busy agent:" (:wait-seconds opts) "s")
    (println)

    (let [outcomes
          (doall
           (for [{:keys [role session]} roles]
             (let [expected (remote-control-health/expected-rc-name state-dir role)]
               (cond
                 (nil? expected)
                 (do (printf "%-14s off (remote_control disabled) - skipped\n" role) (flush)
                     {:role role :status :off})

                 (busy? session)
                 (if (:dry-run opts)
                   (do (printf "%-14s BUSY (would wait up to %ds, then skip if still busy)\n"
                               role (:wait-seconds opts)) (flush)
                       {:role role :status :busy})
                   (do (printf "%-14s busy - waiting up to %ds for idle...\n" role (:wait-seconds opts)) (flush)
                       (if (wait-until-idle session (:wait-seconds opts))
                         (do (printf "%-14s now idle - respawning\n" role) (flush)
                             (remote-control-health/respawn-role-pane!
                              socket session (remote-control-health/launch-script-path state-dir role))
                             (let [{:keys [ok url]} (confirm-rc role session expected)]
                               (printf "%-14s %s\n" role (if ok (str "RESPAWNED  " (or url "(url pending)"))
                                                            "RESPAWNED but RC flag not yet confirmed"))
                               (flush)
                               {:role role :status (if ok :respawned :unconfirmed) :url url}))
                         (do (printf "%-14s STILL BUSY after %ds - SKIPPED (not killed)\n"
                                     role (:wait-seconds opts)) (flush)
                             {:role role :status :skipped-busy}))))

                 :else
                 (if (:dry-run opts)
                   (do (printf "%-14s idle - would respawn\n" role) (flush)
                       {:role role :status :idle})
                   (do (printf "%-14s idle - respawning\n" role) (flush)
                       (remote-control-health/respawn-role-pane!
                        socket session (remote-control-health/launch-script-path state-dir role))
                       (let [{:keys [ok url]} (confirm-rc role session expected)]
                         (printf "%-14s %s\n" role (if ok (str "RESPAWNED  " (or url "(url pending)"))
                                                      "RESPAWNED but RC flag not yet confirmed"))
                         (flush)
                         {:role role :status (if ok :respawned :unconfirmed) :url url})))))))]

      (println)
      (let [by (frequencies (map :status outcomes))]
        (println "Summary:" (str/join "  " (for [[k v] by] (str v " " (name k))))))
      ;; Non-zero only if something we tried to respawn could not be confirmed.
      (System/exit (if (some #(= :unconfirmed (:status %)) outcomes) 1 0)))))
