#!/usr/bin/env bb
;; GH-24 acceptance driver: drives the REAL coordinator-activity-feed-lib/tick!
;; against a JSON-described fixture (stdin in, JSON out on stdout) - never a
;; reimplementation of the lib.
;;
;; Input JSON: {daemon-dir, sent-handoffs: [{file, header}], commits: [{sha, subject}], fail-first-n}
;; Output JSON: {posted: [line...], cursor: {handoff-cursor, commit-cursor}}

(ns gh24-coordinator-activity-feed-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "coordinator_activity_feed_lib.bb")))

(defn -main []
  (let [input (json/parse-string (slurp *in*) true)
        daemon-dir (:daemon-dir input)
        sent-handoffs (->> (or (:sent-handoffs input) [])
                            (mapv (fn [h] {:file (:file h) :header (:header h)}))
                            (sort-by (comp coordinator-activity-feed-lib/handoff-sort-key :file)))
        commits (mapv (fn [c] {:sha (:sha c) :subject (:subject c)}) (or (:commits input) []))
        remaining-fails (atom (or (:fail-first-n input) 0))
        posted (atom [])
        post! (fn [line]
                (if (pos? @remaining-fails)
                  (do (swap! remaining-fails dec) false)
                  (do (swap! posted conj line) true)))]
    (coordinator-activity-feed-lib/tick!
     {:daemon-dir daemon-dir
      :list-sent-handoffs (fn [] sent-handoffs)
      :list-bookkeeping-commits (fn [] commits)
      :post! post!})
    (println (json/generate-string {:posted @posted
                                     :cursor (coordinator-activity-feed-lib/read-cursor daemon-dir)}))))

(-main)
