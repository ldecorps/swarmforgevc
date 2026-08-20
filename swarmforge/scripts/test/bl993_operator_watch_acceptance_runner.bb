#!/usr/bin/env bb
;; BL-993 acceptance runner: drives the REAL operator_runtime_watch_lib.bb +
;; front_desk_supervisor_lib.bb/check-one! against a fixture scenario - no
;; real process spawn, no real pidfile, no real clock (mirrors
;; front_desk_giveup_recovery_acceptance_runner.bb's own "print the pure
;; decision as JSON" shape). pid-alive? is a CONSTANT function of the
;; scenario's own pidAliveOs/cmdlineMatches booleans run through the REAL
;; runtime-alive? predicate - exactly front-desk's own constantly-pidAlive
;; convention, extended one step so a "pidfile naming a live but unrelated
;; process" (pid reuse) fixture exercises the SAME cmdline check the real
;; watch uses, not a bypassed shortcut.
;;
;; Usage: bl993_operator_watch_acceptance_runner.bb <mode> <scenario-json>
;;
;; mode "check-one": scenario {
;;   entry: {pid,attempts,status,crashedAtMs,startedAtMs,gaveUpAtMs} | null,
;;   nowMs, pidAliveOs, cmdlineMatches,
;;   restartConfig: {maxAttempts,backoffBaseMs,backoffMaxMs,healthyResetMs},
;;   giveupConfig: {giveupCooldownMs}
;; } -> {entry, event}
;;
;; mode "deliberately-stopped": scenario {skipEnv, parked}
;;   -> {stopped, reason}

(ns bl993-operator-watch-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_runtime_watch_lib.bb")))

(def mode (nth *command-line-args* 0))
(def scenario (json/parse-string (nth *command-line-args* 1) true))

(defn ->entry [e]
  (when e
    {:pid (:pid e)
     :attempts (:attempts e)
     :status (:status e)
     :crashed-at-ms (:crashedAtMs e)
     :started-at-ms (:startedAtMs e)
     :gave-up-at-ms (:gaveUpAtMs e)}))

(defn ->entry-json [e]
  {:pid (:pid e)
   :attempts (:attempts e)
   :status (:status e)
   :crashedAtMs (:crashed-at-ms e)
   :startedAtMs (:started-at-ms e)
   :gaveUpAtMs (:gave-up-at-ms e)})

(defn run-check-one []
  (let [entry (or (->entry (:entry scenario)) (front-desk-supervisor-lib/default-entry))
        now-ms (:nowMs scenario)
        pid-alive? (constantly (operator-runtime-watch-lib/runtime-alive?
                                 (boolean (:pidAliveOs scenario)) (when (:cmdlineMatches scenario) "operator_runtime.bb")))
        next-pid (atom 9000)
        spawn! (fn [] (swap! next-pid inc))
        restart-config
        {:max-attempts (get-in scenario [:restartConfig :maxAttempts])
         :backoff-base-ms (get-in scenario [:restartConfig :backoffBaseMs])
         :backoff-max-ms (get-in scenario [:restartConfig :backoffMaxMs])
         :healthy-reset-ms (get-in scenario [:restartConfig :healthyResetMs])}
        giveup-config {:giveup-cooldown-ms (get-in scenario [:giveupConfig :giveupCooldownMs])}
        result (front-desk-supervisor-lib/check-one! entry now-ms pid-alive? spawn! restart-config giveup-config)]
    {:entry (->entry-json (:entry result)) :event (some-> (:event result) name)}))

(defn run-deliberately-stopped []
  (let [skip-env (boolean (:skipEnv scenario))
        parked (boolean (:parked scenario))]
    {:stopped (operator-runtime-watch-lib/deliberately-stopped? skip-env parked)
     :reason (operator-runtime-watch-lib/stop-reason skip-env parked)}))

(println
 (json/generate-string
  (case mode
    "check-one" (run-check-one)
    "deliberately-stopped" (run-deliberately-stopped)
    (throw (ex-info (str "unknown mode: " mode) {})))))
