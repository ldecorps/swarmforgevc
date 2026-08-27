#!/usr/bin/env bb
;; BL-597 acceptance seam: drives self_heal_telemetry_lib.bb at log-site shapes.
;; Usage: self_heal_telemetry_cli.bb <project-root> <action> [subject] [reason]

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "self_heal_telemetry_lib.bb")))

(def action-map
  {"a stale-build-detected recompile" {:type "stale-build-recompile"
                                       :subject "front-desk-supervisor"
                                       :reason "recompiling before respawn"}
   "a bounded supervisor respawn" {:type "supervisor-respawn"
                                   :subject "front-desk-supervisor"
                                   :reason "bounded restart"}
   "a kill_all_swarm invocation" {:type "kill-all-swarm"
                                  :subject "lifecycle"
                                  :reason "clean slate"}
   "a mono-router rotation respawn" {:type "rotation-respawn"
                                     :subject "mono-router-resident"
                                     :reason "persona swap"}
   "a claim-heal or resume-orphan claim" {:type "claim-heal"
                                          :subject "handoffd"
                                          :reason "resume orphaned in_process"}})

(defn usage []
  (binding [*out* *err*]
    (println "Usage: self_heal_telemetry_cli.bb <project-root> <action> [subject] [reason]"))
  (System/exit 2))

(defn -main []
  (let [args (vec *command-line-args*)
        root (nth args 0 nil)
        action (nth args 1 nil)
        subject-override (nth args 2 nil)
        reason-override (nth args 3 nil)]
    (when (or (str/blank? root) (str/blank? action)) (usage))
    (let [base (get action-map action)]
      (when (nil? base)
        (binding [*out* *err*] (println "unknown action:" action))
        (System/exit 2))
      (self-heal-telemetry-lib/append-self-heal-event!
       root (merge base
                   (cond-> {}
                     subject-override (assoc :subject subject-override)
                     reason-override (assoc :reason reason-override))))
      (println "ok"))))

(-main)
