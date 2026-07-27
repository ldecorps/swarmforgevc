#!/usr/bin/env bb
;; Tests cursor_bridge_supervisor reconcile helpers via front_desk_supervisor_lib.

(ns cursor-bridge-supervisor-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))

(defn pid-alive? [pid] false)

(let [giveup {:pid 4242 :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      cfg {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000 :healthy-reset-ms 300000}
      giveup-cfg {:giveup-cooldown-ms 900000}
      spawned (atom 0)
      spawn! (fn [] (swap! spawned inc) 9999)
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              giveup 1005000 pid-alive? spawn! cfg giveup-cfg false (fn [_] nil))]
  (when (not= "running" (:status entry))
    (println "FAIL: gave-up with dead pid should re-arm immediately") (System/exit 1))
  (when (not= :re-armed event)
    (println "FAIL: expected :re-armed event") (System/exit 1))
  (when (not= 1 @spawned)
    (println "FAIL: expected one spawn") (System/exit 1)))

(println "ALL PASS: cursor_bridge_supervisor recovery semantics")
