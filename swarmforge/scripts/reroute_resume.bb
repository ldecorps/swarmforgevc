#!/usr/bin/env bb

;; reroute_resume — after a detour target finishes its work, resumes the
;; parcel at the stage it was interrupted from, continuing the normal chain
;; from there (BL-063 "Resume" behavior). Invoked by the detour target in
;; place of its normal forward handoff.
;;
;;   reroute_resume.sh <item-id> [reason...]

(ns reroute-resume
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "salvage_lib.bb")))

(defn state-file [root item-id]
  (fs/path root ".swarmforge" "reroute-state" (str item-id ".json")))

(defn read-state [root item-id]
  (let [f (state-file root item-id)]
    (when (fs/exists? f)
      (json/parse-string (slurp (str f)) true))))

(defn write-state! [root item-id state]
  (spit (str (state-file root item-id)) (json/generate-string state)))

(defn -main [& args]
  (let [[item-id & reason-words] args]
    (when (str/blank? item-id)
      (salvage-lib/exit! 1 "Usage: reroute_resume.sh <item-id> [reason...]"))
    (let [root (salvage-lib/project-root)
          state (read-state root item-id)
          return-stage (:pending_return state)]
      (when (or (nil? state) (str/blank? return-stage))
        (salvage-lib/exit! 2 (str "No pending detour to resume for " item-id ".")))
      (let [reason (or (not-empty (str/join " " reason-words)) "resuming after detour")
            commit (salvage-lib/last-good-commit root item-id return-stage)
            queued (salvage-lib/queue-handoff! root (salvage-lib/stage->role return-stage)
                                                (salvage-lib/task-name root item-id) commit
                                                {"reroute_reason" reason})]
        (write-state! root item-id (assoc state :pending_return nil))
        (salvage-lib/log-event! root {:event "reroute-resume"
                                      :item item-id
                                      :to_stage return-stage
                                      :reason reason
                                      :commit commit
                                      :at (salvage-lib/now-iso)})
        (println (str "REROUTE RESUME: " item-id " resumes at " return-stage " (commit " commit ")"))
        (println queued)))))

(apply -main *command-line-args*)
