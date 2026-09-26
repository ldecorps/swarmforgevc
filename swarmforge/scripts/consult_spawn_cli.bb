#!/usr/bin/env bb

;; Hotfix 2026-09-16: a standalone, idempotent CLI any EXTERNAL caller (not
;; just handoffd.bb's own chase sweep) can shell out to when it needs a
;; mono-router dormant role to get a live, ephemeral session without
;; touching the resident pane.
;;
;; WHY THIS EXISTS: night-closing-ceremony-run.ts's rotateDocumenter tries
;; `rotate_to_role.sh documenter` to hand the resident over for the morning
;; briefing. Under mono-router that call is gated by handoff_lib.bb's
;; respawn-as! (BL-805) exactly like any resident-invoked rotation - a
;; resident with its own real, undrained in_process parcel (the normal
;; case; the ceremony fires while work is ongoing) is REFUSED (exit 5),
;; and rotateDocumenter's catch block fell through to a plain note to
;; coordinator - which cannot itself respawn a pane it does not own, so
;; documenter never got a live session and the briefing silently never got
;; written (observed live 2026-09-15: "rotate-documenter" then
;; "briefing-missing" then "swarm-stopped" in the same ceremony run, no
;; chase-rotate/consult-spawn event for documenter anywhere that night).
;;
;; This CLI is the SAME fix once proven for chase's own :departing-mid-
;; parcel refusal (handoffd.bb's automatic consult spawn, landed
;; 2026-09-15 as BL-1549, removed 2026-09-26 as BL-1752 - "mono-router =
;; one resident" - a chase refusal now only waits for the resident's next
;; turn): spin up the role's OWN roles.tsv session
;; (never the resident's), write the same consult marker format
;; (.swarmforge/daemon/consult/<role>.json) handoffd.bb's EXISTING
;; consult-teardown-sweep! already watches every cycle - so teardown needs
;; NO new code at all, the already-certified sweep manages any marker file
;; regardless of who wrote it. Session create goes through
;; single-role-repair-lib/resolve-single-role-repair exclusively (BL-1018),
;; same one-atomic-command guarantee as every other spawn site in this tree.
;;
;; Deliberately NOT sharing code with handoffd.bb's own spawn-consult-
;; session! - that function is part of an already-certified, already-
;; stamped hotfix (BL-1549); refactoring it to serve a second caller here
;; would touch already-reviewed code for no functional need. The ~20 lines
;; below are the same small, mechanical shape, duplicated once - the same
;; posture swarm_ensure.bb's own kill-session!/session-exists? already take
;; relative to handoff_lib.bb's copies.
;;
;; Usage: consult_spawn_cli.bb <project-root> <role> <requested-by>
;; Idempotent: a no-op (exit 0, "already-exists" / "already-consulting")
;; when the role's session already exists (owned by this CLI or not) or a
;; consult marker for it already exists - never a second spawn attempt.

(ns consult-spawn-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path script-dir "shell_quote_lib.bb")))
(load-file (str (fs/path script-dir "single_role_repair_lib.bb")))
(load-file (str (fs/path script-dir "handoff_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: consult_spawn_cli.bb <project-root> <role> <requested-by>"))
  (System/exit 2))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))
(def role (or (nth *command-line-args* 1 nil) (usage)))
(def requested-by (or (nth *command-line-args* 2 nil) (usage)))

(defn- socket-path []
  (str/trim (slurp (str (fs/path project-root ".swarmforge" "tmux-socket")))))

(defn- consult-marker-path [state-dir role]
  (fs/path state-dir "daemon" "consult" (str role ".json")))

(defn -main []
  (let [state-dir (fs/path project-root ".swarmforge")
        socket (socket-path)
        role-info (handoff-lib/load-role-info role project-root)
        session (:session role-info)
        marker (consult-marker-path state-dir role)]
    (cond
      (nil? role-info)
      (do (println (json/generate-string {:status "no-such-role" :role role}))
          (System/exit 1))

      (str/blank? session)
      (do (println (json/generate-string {:status "no-session-name" :role role}))
          (System/exit 1))

      (handoff-lib/session-exists? socket session)
      (println (json/generate-string {:status "already-exists" :role role :session session}))

      (fs/exists? marker)
      (println (json/generate-string {:status "already-consulting" :role role}))

      :else
      (let [launch-script (fs/path state-dir "launch" (str role ".sh"))
            {:keys [status commands]}
            (single-role-repair-lib/resolve-single-role-repair
             {:socket socket :session session
              :launch-script (str launch-script)
              :env-args []
              :session-present? false})]
        (if (not= :ok status)
          (do (println (json/generate-string {:status (name status) :role role}))
              (System/exit 1))
          (do
            (doseq [cmd commands] (daemon-cycle-guard-lib/sh! cmd))
            (fs/create-dirs (fs/parent marker))
            (spit (str marker)
                  (json/generate-string {:role role :requested_by requested-by
                                          :started_at_ms (System/currentTimeMillis)}))
            (println (json/generate-string {:status "spawned" :role role :session session
                                             :requested_by requested-by}))))))))

(-main)
