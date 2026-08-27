#!/usr/bin/env bb
;; BL-660 property: every schedule-derived clock reads the single active shift.

(ns bl660-swarm-shift-property-runner
  (:require [babashka.fs :as fs]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "swarm_shift_lib.bb")))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))

(defn assert-derived-from-shift [shift-name conf]
  (if-let [s (swarm-shift-lib/resolve-schedule conf)]
    (let [{:keys [start stop]} (swarm-shift-lib/shift-times shift-name)
          start-hhmm (swarm-shift-lib/format-hhmm start)
          stop-hhmm (swarm-shift-lib/format-hhmm stop)]
      (when (not= shift-name (:shift s))
        (fail! (str shift-name " shift name mismatch: " (:shift s))))
      (when (not= start-hhmm (:start-local s))
        (fail! (str shift-name " start drift: " (:start-local s))))
      (when (not= stop-hhmm (:stop-local s))
        (fail! (str shift-name " stop drift: " (:stop-local s))))
      (when (not= stop-hhmm (:closure-stop-local s))
        (fail! (str shift-name " closure drift: " (:closure-stop-local s))))
      (when (not= stop-hhmm (:cooldown-start-local s))
        (fail! (str shift-name " cooldown-start drift: " (:cooldown-start-local s))))
      (when (not= start-hhmm (:cooldown-end-local s))
        (fail! (str shift-name " cooldown-end drift: " (:cooldown-end-local s))))
      (when (not (:cooldown-window-enabled s))
        (fail! (str shift-name " cooldown should be enabled"))))
    (fail! (str "no schedule for " shift-name))))

(doseq [shift ["day" "evening" "night"]]
  (assert-derived-from-shift shift (str "config swarm_shift " shift "\n")))

(when (some? (swarm-shift-lib/resolve-schedule "config cooldown_window_enabled false\n"))
  (fail! "absent swarm_shift must not derive a schedule"))

(if (empty? @failures)
  (println "BL-660 property: ALL INVARIANTS PASSED")
  (do (doseq [f @failures] (println "FAIL" f)) (System/exit 1)))
