#!/usr/bin/env bb
;; BL-1697: the one shell-callable entry point for
;; local_parcel_driver_lib.bb's drive-to-end! - used by the acceptance
;; step handler (a fake tmux, a throwaway git checkout, no real handoffd
;; loop and no live router) to drive one seat's parcel to a terminal
;; state. The live daemon never calls this file; it calls drive-tick!
;; directly, once per its own poll cycle.
;;
;; Usage: local_parcel_driver_cli.bb <project-root> <checkout> <role> <seat-id> <agent> <socket> <session> [fix-turns-limit] [max-ticks] [poll-interval-ms]
;; Prints the final state file's own JSON (or "null" when the parcel ended
;; clean, no state file left) and exits 0.

(ns local-parcel-driver-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "local_parcel_driver_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: local_parcel_driver_cli.bb <project-root> <checkout> <role> <seat-id> <agent> <socket> <session> [fix-turns-limit] [max-ticks] [poll-interval-ms]"))
  (System/exit 1))

(defn -main [& args]
  (when (< (count args) 7)
    (usage))
  (let [[project-root checkout role seat-id agent socket session fix-turns-limit max-ticks poll-interval-ms] args
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
    (local-parcel-driver-lib/drive-to-end!
     ctx
     :max-ticks (if max-ticks (Long/parseLong max-ticks) 200)
     :poll-interval-ms (if poll-interval-ms (Long/parseLong poll-interval-ms) 10))
    (println (json/generate-string (local-parcel-driver-lib/read-driver-state project-root seat-id)))))

(apply -main *command-line-args*)
