#!/usr/bin/env bb

;; reroute — detour a pipeline parcel to another stage with a reason note,
;; bounded by a detour budget and livelock (repeating-pattern) detection
;; (BL-063). Generalizes redo_from's salvage plumbing (BL-036) for
;; agent-initiated mid-pipeline detours instead of human-initiated recovery.
;;
;;   reroute.sh <item-id> <to-stage> [reason...]
;;
;; The current role (SWARMFORGE_ROLE) is the detour's FROM stage. On success:
;;   1. abandon the item's stale handoffs (same mechanism as redo_from)
;;   2. tag a checkpoint
;;   3. queue a fresh git_handoff to the target stage carrying reroute_reason
;;   4. record the detour in .swarmforge/reroute-state/<item-id>.json
;;      (count, history, pending_return) and as a {event: reroute} run-log
;;      entry
;; Refused (no handoff sent — the parcel simply stays put, gating to a
;; human who can see why in the run log and salvage manually with
;; redo_from) when:
;;   - the detour budget is exhausted (event: reroute-blocked, budget-exceeded)
;;   - the exact from->to pattern already occurred for this item, i.e. a
;;     repeating stage-to-stage cycle (event: reroute-blocked, livelock)

(ns reroute
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "salvage_lib.bb")))

(def default-budget 3)

(defn budget []
  (if-let [v (not-empty (System/getenv "SWARMFORGE_REROUTE_BUDGET"))]
    (try (Integer/parseInt v) (catch Exception _ default-budget))
    default-budget))

(defn current-stage []
  (let [role (System/getenv "SWARMFORGE_ROLE")]
    (when (str/blank? role)
      (salvage-lib/exit! 1 "Set SWARMFORGE_ROLE."))
    (or (some (fn [[stage r]] (when (= r role) stage)) salvage-lib/stage->role)
        (str/lower-case role))))

(defn state-file [root item-id]
  (fs/path root ".swarmforge" "reroute-state" (str item-id ".json")))

(defn read-state [root item-id]
  (let [f (state-file root item-id)]
    (if (fs/exists? f)
      (json/parse-string (slurp (str f)) true)
      {:count 0 :history [] :pending_return nil})))

(defn write-state! [root item-id state]
  (let [f (state-file root item-id)]
    (fs/create-dirs (fs/parent f))
    (spit (str f) (json/generate-string state))))

(defn livelock? [history from to]
  (some #(and (= from (:from %)) (= to (:to %))) history))

(defn -main [& args]
  (let [[item-id to-stage & reason-words] args]
    (when (or (str/blank? item-id) (str/blank? to-stage))
      (salvage-lib/exit! 1 "Usage: reroute.sh <item-id> <to-stage> [reason...]"))
    (when-not (contains? salvage-lib/stage->role to-stage)
      (salvage-lib/exit! 2 (str "Invalid stage '" to-stage "'. Valid stages: "
                                (str/join " | " salvage-lib/stage-order))))
    (let [root (salvage-lib/project-root)
          from-stage (current-stage)
          reason (or (not-empty (str/join " " reason-words)) "reroute")
          state (read-state root item-id)
          history (or (:history state) [])
          used (or (:count state) 0)
          the-budget (budget)]
      (cond
        (>= used the-budget)
        (do
          (salvage-lib/log-event! root {:event "reroute-blocked"
                                        :reason "budget-exceeded"
                                        :item item-id
                                        :from_stage from-stage
                                        :to_stage to-stage
                                        :budget the-budget
                                        :count used
                                        :at (salvage-lib/now-iso)})
          (salvage-lib/exit! 3 (str "REROUTE BLOCKED: detour budget (" the-budget
                                    ") exhausted for " item-id ". Escalating to human.")))

        (livelock? history from-stage to-stage)
        (do
          (salvage-lib/log-event! root {:event "reroute-blocked"
                                        :reason "livelock"
                                        :item item-id
                                        :from_stage from-stage
                                        :to_stage to-stage
                                        :cycle [from-stage to-stage]
                                        :at (salvage-lib/now-iso)})
          (salvage-lib/exit! 3 (str "REROUTE BLOCKED: livelock detected (" from-stage " -> " to-stage
                                    " repeats) for " item-id ". Escalating to human.")))

        :else
        (let [abandoned (salvage-lib/abandon-stale! root item-id)
              commit (salvage-lib/last-good-commit root item-id to-stage)
              tag (salvage-lib/tag-checkpoint! root item-id to-stage)
              queued (salvage-lib/queue-handoff! root (salvage-lib/stage->role to-stage)
                                                  (salvage-lib/task-name root item-id) commit
                                                  {"reroute_reason" reason})
              new-count (inc used)
              new-history (conj history {:from from-stage :to to-stage :at (salvage-lib/now-iso)})]
          (write-state! root item-id {:count new-count :history new-history :pending_return from-stage})
          (salvage-lib/log-event! root {:event "reroute"
                                        :item item-id
                                        :from_stage from-stage
                                        :to_stage to-stage
                                        :reason reason
                                        :tag tag
                                        :commit commit
                                        :count new-count
                                        :abandoned (count abandoned)
                                        :at (salvage-lib/now-iso)})
          (println (str "REROUTE: " item-id " from " from-stage " to " to-stage
                        " (commit " commit ", detour " new-count "/" the-budget ")"))
          (println (str "CHECKPOINT: " tag))
          (println queued))))))

(apply -main *command-line-args*)
