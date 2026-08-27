#!/usr/bin/env bb
;; Tests cursor_bridge_supervisor reconcile helpers via front_desk_supervisor_lib.

(ns cursor-bridge-supervisor-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))

(defn pid-alive? [pid] false)

;; ── BL-1088: RETIRED - "gave-up with dead pid should re-arm immediately" ──
;; This assertion demanded a re-arm 5 seconds into a 15-minute cooldown, on the
;; grounds that the recorded process was dead. It arrived in BL-696, a Mini App
;; cursor-audio parcel, and changed the give-up semantics all SIX supervisors
;; share; the same parcel broke test_front_desk_supervisor_tick.sh's opposite
;; assertion, which has been red on main ever since. Two executable contracts,
;; one function, opposite required results.
;;
;; It is retired rather than reworded because the cooldown is the declared
;; design: a child reaches gave-up by crash-looping, so its process is always
;; dead, and "dead pid re-arms" makes the bound unreachable in the one case it
;; exists for. The cursor bridge's evident intent - recover faster than 15
;; minutes - is served by the lever it already has: CURSOR_BRIDGE_GIVEUP_
;; COOLDOWN_MS, read by cursor_bridge_supervisor.bb, which shortens ITS outage
;; without removing the bound for the other five.
;;
;; What this file checks instead is that same intent, end to end: a shorter
;; configured cooldown really does re-arm sooner, and the default one really
;; does hold the child down.

(let [giveup {:pid 4242 :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      cfg {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000 :healthy-reset-ms 300000}
      giveup-cfg {:giveup-cooldown-ms 900000}
      spawned (atom 0)
      spawn! (fn [] (swap! spawned inc) 9999)
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              giveup 1005000 pid-alive? spawn! cfg giveup-cfg false (fn [_] nil))]
  (when (not= "gave-up" (:status entry))
    (println "FAIL: a dead pid must NOT bypass the configured cooldown (BL-1088)") (System/exit 1))
  (when (some? event)
    (println "FAIL: expected no event inside the cooldown, got" event) (System/exit 1))
  (when (not= 0 @spawned)
    (println "FAIL: expected no spawn inside the cooldown, got" @spawned) (System/exit 1)))

;; The sanctioned lever: this supervisor's own shorter cooldown, honoured.
(let [giveup {:pid 4242 :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      cfg {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000 :healthy-reset-ms 300000}
      short-cfg {:giveup-cooldown-ms 3000}
      spawned (atom 0)
      spawn! (fn [] (swap! spawned inc) 9999)
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              giveup 1005000 pid-alive? spawn! cfg short-cfg false (fn [_] nil))]
  (when (not= "running" (:status entry))
    (println "FAIL: a shorter configured cooldown must still re-arm once elapsed") (System/exit 1))
  (when (not= :re-armed event)
    (println "FAIL: expected :re-armed with the shorter cooldown elapsed") (System/exit 1))
  (when (not= 1 @spawned)
    (println "FAIL: expected exactly one spawn") (System/exit 1))
  (when (not= 1 (:attempts entry))
    (println "FAIL: expected a fresh attempt budget") (System/exit 1)))

(println "ALL PASS: cursor_bridge_supervisor recovery semantics")
