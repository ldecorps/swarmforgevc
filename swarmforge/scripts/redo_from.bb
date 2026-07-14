#!/usr/bin/env bb

;; redo_from — salvage a failed or rejected pipeline run by restarting a work
;; item from a named stage (BL-036).
;;
;;   redo_from.sh <item-id> <stage> [reason...]
;;
;; Steps, in order:
;;   1. validate the stage (nothing is touched on an invalid stage)
;;   2. abandon the item's stale handoffs (inbox new/ and in_process/ across
;;      all worktrees move to inbox/abandoned/ so no role processes them)
;;   3. tag the current HEAD as redo/<item-id>/<stage>/<timestamp>
;;   4. queue a fresh git_handoff to the stage's role, using the last known
;;      good commit previously handed to that stage (current HEAD for coder
;;      or when no prior handoff exists)
;;   5. append an {event: redo} entry to .swarmforge/run-log.jsonl, capturing
;;      the rejection_reason from the item's most recent rejection handoff
;;      when no explicit reason is given
;;
;; BL-063: the abandon/tag/queue/log plumbing lives in salvage_lib.bb, shared
;; with the reroute machinery so there is only one salvage mechanism.

(ns redo-from
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "salvage_lib.bb")))

(defn -main [& args]
  (let [[item-id stage & reason-words] args]
    (when (or (str/blank? item-id) (str/blank? stage))
      (salvage-lib/exit! 1 "Usage: redo_from.sh <item-id> <stage> [reason...]"))
    (when-not (contains? salvage-lib/stage->role stage)
      (salvage-lib/exit! 2 (str "Invalid stage '" stage "'. Valid stages: "
                                (str/join " | " salvage-lib/stage-order))))
    (let [root (salvage-lib/project-root)
          abandoned (salvage-lib/abandon-stale! root item-id)
          reason (or (not-empty (str/join " " reason-words))
                     (salvage-lib/captured-rejection-reason root item-id)
                     "manual redo")
          commit (salvage-lib/last-good-commit root item-id stage)
          tag (salvage-lib/tag-checkpoint! root item-id stage)
          queued (salvage-lib/queue-handoff! root (salvage-lib/stage->role stage)
                                              (salvage-lib/task-name root item-id) commit)]
      (salvage-lib/log-event! root {:event "redo"
                                    :item item-id
                                    :from_stage stage
                                    :reason reason
                                    :tag tag
                                    :commit commit
                                    :abandoned (count abandoned)
                                    :at (salvage-lib/now-iso)})
      (println (str "REDO: " item-id " from " stage
                    " (commit " commit ", " (count abandoned) " stale handoff(s) abandoned)"))
      (println (str "CHECKPOINT: " tag))
      (println queued))))

(apply -main *command-line-args*)
