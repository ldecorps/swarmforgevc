#!/usr/bin/env bb
;; BL-1697: the one shell-callable entry point for
;; local_parcel_driver_lib.bb's drive-to-end! - used by the acceptance
;; step handler (a fake tmux, a throwaway git checkout, no real handoffd
;; loop and no live router) to drive one seat's parcel to a terminal
;; state. The live daemon never calls this file; it calls drive-tick!
;; directly, once per its own poll cycle.
;;
;; Usage: local_parcel_driver_cli.bb <project-root> <checkout> <role> <seat-id> <agent> <socket> <session> [fix-turns-limit] [max-ticks] [poll-interval-ms] [resume]
;; Prints the final state file's own JSON (or "null" when the parcel ended
;; clean, no state file left) and exits 0. A trailing "resume" argument
;; (BL-1698 requirement 1) runs the write-permission sweep once before
;; driving, standing in for "the driver starts again" in a test harness
;; where each invocation is otherwise indistinguishable from any other.
;;
;; BL-1698 requirement 3, a second verb (never typed into a pane):
;;   local_parcel_driver_cli.bb release <project-root> <checkout> <role> <seat-id> <complete|retry>
;; Prints release-hold!'s own result JSON and exits 0 (or 1 when there is
;; no record for that seat - nothing to release).
;;
;; BL-1699 requirement 4, a third verb, shelled out to by `seat test` when
;; aider's own --auto-test loop calls it with no SEAT_TICKET/SEAT_ACCEPTANCE
;; already in its environment:
;;   local_parcel_driver_cli.bb test-scope <project-root> <seat-id>
;; Prints "SEAT_TICKET=<ticket>\nSEAT_ACCEPTANCE=<path>\n" and exits 0, or
;; prints nothing and exits 1 when there is no record naming a ticket yet.

(ns local-parcel-driver-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "local_parcel_driver_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: local_parcel_driver_cli.bb <project-root> <checkout> <role> <seat-id> <agent> <socket> <session> [fix-turns-limit] [max-ticks] [poll-interval-ms] [resume]")
    (println "       local_parcel_driver_cli.bb release <project-root> <checkout> <role> <seat-id> <complete|retry>")
    (println "       local_parcel_driver_cli.bb test-scope <project-root> <seat-id>"))
  (System/exit 1))

(defn- release-main [args]
  (when (< (count args) 5)
    (usage))
  (let [[project-root checkout role seat-id mode] args
        result (local-parcel-driver-lib/release-hold! project-root checkout role seat-id mode)]
    (println (json/generate-string result))
    (when-not result (System/exit 1))))

(defn- test-scope-main [args]
  (when (< (count args) 2)
    (usage))
  (let [[project-root seat-id] args
        scope (local-parcel-driver-lib/driver-test-scope project-root seat-id)]
    (if scope
      (do (println (str "SEAT_TICKET=" (:ticket scope)))
          (println (str "SEAT_ACCEPTANCE=" (:acceptancePath scope))))
      (System/exit 1))))

(defn- drive-main [args]
  (when (< (count args) 7)
    (usage))
  (let [[project-root checkout role seat-id agent socket session fix-turns-limit max-ticks poll-interval-ms resume-flag] args
        ctx {:project-root project-root
             :checkout checkout
             :role role
             :seat-id seat-id
             :agent agent
             :socket socket
             :session session
             :fix-turns-limit (if fix-turns-limit
                                (Long/parseLong fix-turns-limit)
                                local-parcel-driver-lib/default-fix-turns)}]
    (when (= "resume" resume-flag)
      (local-parcel-driver-lib/resume-writable-sweep! project-root))
    (local-parcel-driver-lib/drive-to-end!
     ctx
     :max-ticks (if max-ticks (Long/parseLong max-ticks) 200)
     :poll-interval-ms (if poll-interval-ms (Long/parseLong poll-interval-ms) 10))
    (println (json/generate-string (local-parcel-driver-lib/read-driver-state project-root seat-id)))))

(defn -main [& args]
  (case (first args)
    "release" (release-main (rest args))
    "test-scope" (test-scope-main (rest args))
    (drive-main args)))

(apply -main *command-line-args*)
