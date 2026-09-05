#!/usr/bin/env bb
;; BL-653 property tests: tick-observed-events never manufactures patrol/liveness wakes.

(ns operator-lib-bl653-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_lib.bb")))

(def failures (atom []))
(defn assert-true [msg v]
  (when-not v (swap! failures conj (str "FAIL: " msg))))

;; BL-1353 added TASK_ARRIVED: retired as a wake source by human ruling, so it
;; must never re-enter the tick path either - the same regression this runner
;; was built to catch, one source later.
(def forbidden #{"SWARM_CHECK_TIMER" "AGENT_EXITED" "AGENT_STALLED" "TASK_ARRIVED"})

(doseq [reachable? [true false]
        cmd? [true false]
        inbox? [true false]]
  (let [events (operator-lib/tick-observed-events
                 {:reachable? reachable?
                  :command-file-exists? cmd?
                  :command-detail (when cmd? "x")
                  :coordinator-inbox-fresh? inbox?})]
    (doseq [e events]
      (assert-true (str "no forbidden type " (:type e))
                   (not (contains? forbidden (:type e))))
      (assert-true (str "manufactured type only " (:type e))
                   (contains? operator-lib/manufactured-tick-event-types (:type e))))))

(if (empty? @failures)
  (println "operator_lib BL-653 properties: ALL PASSED")
  (do (doseq [f @failures] (println f)) (System/exit 1)))
