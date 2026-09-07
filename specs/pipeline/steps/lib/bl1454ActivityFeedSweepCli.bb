#!/usr/bin/env bb
;; BL-1454 acceptance driver: drives the REAL coordinator-activity-feed-lib/tick!
;; against a JSON-described fixture (stdin in, JSON out on stdout) - never a
;; reimplementation of the lib. Adds three fixture-only seams the plain
;; GH-24 CLI does not need: a controllable clock (advances by a fixed
;; amount after every successful post, to exercise the deadline), a
;; per-tick post cap override, and a "throw on the Nth send" interrupt (a
;; daemon killed mid-batch) rather than GH-24's "return false" failed-send
;; shape.
;;
;; Input JSON: {daemon-dir, sent-handoffs: [{file, header}], commits: [{sha, subject}],
;;              post-cap, deadline-ms, clock-advance-ms-per-post, fail-after-n-successes}
;; Output JSON: {posted: [line...], cursor: {handoff-cursor, commit-cursor},
;;               threw, writeCount, headerReadCount, clockMs, result}

(ns bl1454-activity-feed-sweep-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "coordinator_activity_feed_lib.bb")))

(defn -main []
  (let [input (json/parse-string (slurp *in*) true)
        daemon-dir (:daemon-dir input)
        sent-handoffs (->> (or (:sent-handoffs input) [])
                            (mapv (fn [h] {:file (:file h) :header (:header h)}))
                            (sort-by (comp coordinator-activity-feed-lib/handoff-sort-key :file)))
        names (mapv :file sent-handoffs)
        header-by-name (into {} (map (fn [h] [(:file h) (:header h)]) sent-handoffs))
        commits (mapv (fn [c] {:sha (:sha c) :subject (:subject c)}) (or (:commits input) []))
        post-cap (:post-cap input)
        deadline-ms (:deadline-ms input)
        clock-advance-ms (or (:clock-advance-ms-per-post input) 0)
        fail-after (:fail-after-n-successes input)
        clock (atom 0)
        write-count (atom 0)
        header-read-count (atom 0)
        posted (atom [])
        threw (atom false)
        write-cursor! (fn [dir cursor]
                        (swap! write-count inc)
                        (coordinator-activity-feed-lib/write-cursor! dir cursor))
        read-handoff-header (fn [name]
                              (swap! header-read-count inc)
                              (get header-by-name name))
        post! (fn [line]
                (if (and fail-after (>= (count @posted) fail-after))
                  (throw (ex-info "send-interrupted" {}))
                  (do (swap! posted conj line)
                      (swap! clock + clock-advance-ms)
                      true)))
        tick-opts (cond-> {:daemon-dir daemon-dir
                            :list-sent-handoff-names (fn [] names)
                            :read-handoff-header read-handoff-header
                            :list-bookkeeping-commits (fn [] commits)
                            :post! post!
                            :write-cursor! write-cursor!
                            :now-ms (fn [] @clock)}
                    post-cap (assoc :post-cap post-cap)
                    deadline-ms (assoc :deadline-ms deadline-ms))
        result (try
                 (coordinator-activity-feed-lib/tick! tick-opts)
                 (catch Exception _ (reset! threw true) nil))]
    (println (json/generate-string {:posted @posted
                                     :result result
                                     :threw @threw
                                     :writeCount @write-count
                                     :headerReadCount @header-read-count
                                     :clockMs @clock
                                     :cursor (coordinator-activity-feed-lib/read-cursor daemon-dir)}))))

(-main)
