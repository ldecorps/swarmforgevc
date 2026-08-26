#!/usr/bin/env bb
;; Pure/adapter tests for bridge_headless_supervisor.bb health semantics.

(ns bridge-headless-supervisor-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))

(def stall-ms 120000)
(def startup-grace-ms 45000)

(defn http-health-stale? [last-ok-ms now-ms started-at-ms]
  (front-desk-supervisor-lib/poll-heartbeat-stale?
    last-ok-ms now-ms stall-ms started-at-ms startup-grace-ms))

(assert (= false (http-health-stale? nil 80000 50000)) "startup grace: no probe yet is not stale")
(assert (= true (http-health-stale? nil 200000 50000)) "after grace, missing probe is stale")
(assert (= false (http-health-stale? 150000 200000 50000)) "recent probe is healthy")
(assert (= true (http-health-stale? 50000 200000 10000)) "old probe is stale")

(println "ALL PASS: bridge_headless_supervisor health semantics")
