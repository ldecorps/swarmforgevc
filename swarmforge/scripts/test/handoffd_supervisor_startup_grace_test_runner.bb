#!/usr/bin/env bb
;; hotfix startup-grace (2026-09-02): handoffd_supervisor.bb's -main runs
;; check! IMMEDIATELY, before its first sleep. Right after a daemon crash the
;; observations are stale by construction - the dead daemon's last heartbeat
;; is minutes old and the parcel whose delivery crashed it still sits in an
;; outbox - so the very first check! of the relaunched daemon read :stalled
;; ~0.25s after `started`, alarm-and-halted the whole swarm, and the BL-675
;; cron relaunched into the same verdict (15:28:13Z and 15:29:18Z). A daemon
;; younger than one stall window has not yet HAD the chance to write a fresh
;; heartbeat: it cannot be stalled. Pure evaluate-health, no real daemon.

(require '[babashka.fs :as fs])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def fixture-root (str (fs/create-temp-dir {:prefix "supervisor-grace-"})))
;; A pre-existing stop file makes the supervisor's own -main return at once
;; when the script is load-file'd (same trick bl977's runner relies on).
(fs/create-dirs (fs/path fixture-root ".swarmforge" "daemon"))
(spit (str (fs/path fixture-root ".swarmforge" "daemon" "stop")) "")
(binding [*command-line-args* [fixture-root]]
  (load-file (str (fs/path script-dir ".." "handoffd_supervisor.bb"))))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def STALL 30000)
;; The exact post-crash-relaunch observation: heartbeat 2.6 min old, a
;; pending outbox parcel older than the stall window, pid alive.
(def stale-obs {:alive? true :heartbeat-age-ms 158000 :pending-outbox-age-ms 160000
                :stall-ms STALL :in-flight-sweep-age-ms nil :in-sweep-budget-ms 225000})

(assert= "a daemon younger than one stall window is never :stalled on stale pre-crash evidence (the 15:28/15:29 halt loop)"
         :healthy (handoffd-supervisor/evaluate-health (assoc stale-obs :daemon-age-ms 250)))
(assert= "grace ends exactly at the stall window: a daemon older than stall-ms with the same stale evidence IS :stalled (safety kept)"
         :stalled (handoffd-supervisor/evaluate-health (assoc stale-obs :daemon-age-ms (inc STALL))))
(assert= "an unknown daemon age never grants grace - the pre-hotfix verdict stands"
         :stalled (handoffd-supervisor/evaluate-health (assoc stale-obs :daemon-age-ms nil)))
(assert= "no :daemon-age-ms key at all (every pre-hotfix caller) - the pre-hotfix verdict stands"
         :stalled (handoffd-supervisor/evaluate-health stale-obs))
(assert= "grace never hides a dead pid"
         :dead (handoffd-supervisor/evaluate-health (assoc stale-obs :alive? false :daemon-age-ms 250)))
(assert= "grace changes nothing for a healthy daemon"
         :healthy (handoffd-supervisor/evaluate-health (assoc stale-obs :heartbeat-age-ms 1000 :daemon-age-ms 250)))
(assert= "a young daemon with an in-flight sweep over budget is still not :stalled - it has not lived one stall window"
         :healthy (handoffd-supervisor/evaluate-health (assoc stale-obs :daemon-age-ms 250
                                                              :in-flight-sweep-age-ms 300000)))

(try (fs/delete-tree fixture-root) (catch Exception _ nil))
(if (empty? @failures)
  (println "handoffd_supervisor startup-grace: ALL TESTS PASS")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
