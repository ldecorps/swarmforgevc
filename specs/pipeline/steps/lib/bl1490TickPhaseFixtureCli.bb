#!/usr/bin/env bb
;; BL-1490 acceptance driver: drives the REAL handoffd_supervisor.bb check!
;; (with halt-swarm! stubbed - never a real tmux kill/email) against a
;; fixture daemon cycle that publishes through the REAL
;; daemon_cycle_guard_lib.bb mark-tick-phase!/mark-tick-idle! - never a
;; reimplementation of either. Mirrors bl1454ActivityFeedSweepCli.bb's
;; stdin-JSON-in/stdout-JSON-out shape. Per the ticket's own "how": never
;; load-file's handoffd.bb (that starts the daemon) - the fixture stands in
;; for its three per-tick phases with a background "unit of work" thread of
;; its own.
;;
;; Input JSON: {phase, units, unit-cost-ms, freeze-after-first-unit,
;;              poll-interval-ms, poll-duration-ms, outbox-age-ms,
;;              heartbeat-stale-ms, marker-idle}
;; Output JSON: {haltCount, finalState, unitsCompleted, pollsRun}
;;
;; Env (set by the caller, mirroring every other tunable-via-env script in
;; this codebase): SUPERVISOR_STALL_MS, SUPERVISOR_TICK_BUDGET_MS.

(ns bl1490-tick-phase-fixture-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [cheshire.core :as json])
  (:import [java.nio.file Files]
           [java.nio.file.attribute FileTime]))

(def repo-root (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." )))
(def scripts-dir (str (fs/path repo-root "swarmforge" "scripts")))

(def fixture-root (str (fs/create-temp-dir {:prefix "bl1490-tick-"})))
(def daemon-dir (fs/path fixture-root ".swarmforge" "daemon"))
(fs/create-dirs daemon-dir)
(def stop-file (fs/path daemon-dir "stop"))
(spit (str stop-file) "")

;; BL-459 temp-dir trap: reclaim the root on every exit path.
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? fixture-root) (fs/delete-tree fixture-root)))))

(binding [*command-line-args* [fixture-root]]
  (load-file (str (fs/path scripts-dir "handoffd_supervisor.bb"))))
(load-file (str (fs/path scripts-dir "daemon_cycle_guard_lib.bb")))

;; The pre-created stop-file above kept -main's while loop a no-op at load
;; (same trick bl977's runner relies on). Remove it now so our own manual
;; check! calls below actually run instead of hitting the "skip" branch.
(fs/delete-if-exists stop-file)

(defn- set-mtime-ms-ago! [path ms-ago]
  (Files/setLastModifiedTime (fs/path path) (FileTime/fromMillis (- (System/currentTimeMillis) ms-ago))))

;; halt-swarm! stubbed: never touches a real process, tmux socket, or the
;; cleanup script. alarm-and-halt! resolves this var at CALL time (sci has
;; no direct-linking), so redefining it after load takes effect for every
;; check! call this fixture makes.
(def halt-count (atom 0))
(alter-var-root #'handoffd-supervisor/halt-swarm! (fn [_] (fn [] (swap! halt-count inc))))

;; An alive daemon pid, backdated well past the stall window so the
;; startup-grace hotfix never masks the verdict under test. Never a
;; dangerous pid to signal: halt-swarm! is fully stubbed above, so
;; kill-and-confirm! (which would TERM it) is simply never reached.
(spit (str handoffd-supervisor/pid-file) (str (.pid (java.lang.ProcessHandle/current)) "\n"))
(set-mtime-ms-ago! handoffd-supervisor/pid-file 10000)

;; The marker writer, publishing to the SAME path handoffd_supervisor.bb
;; reads (handoffd-supervisor/sweep-marker-file).
(daemon-cycle-guard-lib/install-sweep-marker-writer! (str handoffd-supervisor/sweep-marker-file))

(defn- setup-outbox! [age-ms]
  (spit (str (fs/path fixture-root ".swarmforge" "roles.tsv"))
        (str (str/join "\t" ["coder" "coder" fixture-root "sess" "Coder" "claude" "task"]) "\n"))
  (let [outbox-dir (fs/path fixture-root ".swarmforge" "handoffs" "outbox")]
    (fs/create-dirs outbox-dir)
    (let [f (fs/path outbox-dir "10_fixture.handoff")]
      (spit (str f) "type: note\nto: coder\npriority: 50\nmessage: fixture\n")
      (set-mtime-ms-ago! f age-ms))))

(def input (json/parse-string (slurp *in*) true))
(def phase (:phase input))
(def units (or (:units input) 0))
(def unit-cost-ms (or (:unit-cost-ms input) 0))
(def freeze-after-first-unit? (boolean (:freeze-after-first-unit input)))
(def poll-interval-ms (or (:poll-interval-ms input) 500))
(def poll-duration-ms (or (:poll-duration-ms input) 0))
(def outbox-age-ms (:outbox-age-ms input))
(def heartbeat-stale-ms (:heartbeat-stale-ms input))
(def marker-idle? (boolean (:marker-idle input)))

(when outbox-age-ms
  (setup-outbox! outbox-age-ms))

(when heartbeat-stale-ms
  (spit (str handoffd-supervisor/heartbeat-file) "\n")
  (set-mtime-ms-ago! handoffd-supervisor/heartbeat-file heartbeat-stale-ms))

(when marker-idle?
  (daemon-cycle-guard-lib/mark-tick-idle!))

(def units-completed (atom 0))

;; The phase-start mark is published SYNCHRONOUSLY, before any polling
;; begins - closing the startup race between this fixture and the
;; supervisor's very first check! (a poll that ran before the marker
;; existed would see it as absent, exactly the pre-BL-1490 shape).
(when phase
  (daemon-cycle-guard-lib/mark-tick-phase! phase))

(def phase-future
  (when phase
    (future
      (if freeze-after-first-unit?
        (do (Thread/sleep unit-cost-ms)
            (daemon-cycle-guard-lib/mark-tick-phase! phase)
            (swap! units-completed inc)
            ;; the frozen unit: never returns, never re-stamps again -
            ;; process survival alone must never advance the marker.
            (deref (promise)))
        (dotimes [_ units]
          (Thread/sleep unit-cost-ms)
          (daemon-cycle-guard-lib/mark-tick-phase! phase)
          (swap! units-completed inc))))))

(def polls (atom 0))
(def num-polls (max 1 (long (Math/ceil (/ (double poll-duration-ms) (double (max 1 poll-interval-ms)))))))
(dotimes [_ num-polls]
  (handoffd-supervisor/check!)
  (swap! polls inc)
  (Thread/sleep poll-interval-ms))

;; Ensure a non-frozen phase actually finished (so unitsCompleted is exact)
;; regardless of how the polling window above happened to line up with it.
(when (and phase-future (not freeze-after-first-unit?))
  (deref phase-future (+ (* units unit-cost-ms) 5000) ::timeout))

(let [status (handoffd-supervisor/read-status)]
  (println (json/generate-string {:haltCount @halt-count
                                   :finalState (:state status)
                                   :unitsCompleted @units-completed
                                   :pollsRun @polls})))

(fs/delete-tree fixture-root)
