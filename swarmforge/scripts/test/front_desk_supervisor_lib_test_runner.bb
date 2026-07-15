#!/usr/bin/env bb
;; TDD runner for front_desk_supervisor_lib.bb (BL-292) - pure assertions
;; only, no real clock/process (de0991e) - mirrors
;; extension/src/notify/telegramRetry.ts's own
;; computeTelegramRetryBackoffMs/decideTelegramRetryAction shape, this
;; project's established "bounded-retry-then-escalate" convention,
;; translated for the front-desk bridge/bot supervisor.
(ns front-desk-supervisor-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def cfg {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000})

;; ── decide-restart-action (pure) — headless-frontdesk-03 ─────────────────

(assert= "headless-frontdesk-03: below the bound, the decision is to restart"
         :restart
         (front-desk-supervisor-lib/decide-restart-action 1 cfg))

(assert= "headless-frontdesk-03: at the bound, the decision is to give up"
         :escalate
         (front-desk-supervisor-lib/decide-restart-action 5 cfg))

(assert= "headless-frontdesk-03: past the bound, still gives up (never resumes restarting)"
         :escalate
         (front-desk-supervisor-lib/decide-restart-action 6 cfg))

(assert= "the attempt just short of the bound still restarts"
         :restart
         (front-desk-supervisor-lib/decide-restart-action 4 cfg))

;; ── compute-backoff-ms (pure) — exponential, capped ──────────────────────

(assert= "the first attempt's backoff is the base interval"
         1000
         (front-desk-supervisor-lib/compute-backoff-ms 1 cfg))

(assert= "backoff doubles each subsequent attempt"
         2000
         (front-desk-supervisor-lib/compute-backoff-ms 2 cfg))

(assert= "backoff keeps doubling"
         4000
         (front-desk-supervisor-lib/compute-backoff-ms 3 cfg))

(assert= "backoff never exceeds the configured cap"
         60000
         (front-desk-supervisor-lib/compute-backoff-ms 10 cfg))

;; ── BL-303: healthy-long-enough? / cooldown-elapsed? (pure) ──────────────

(def healthy-cfg {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000 :healthy-reset-ms 300000})
(def giveup-cfg {:giveup-cooldown-ms 900000})

(assert= "supervisor-recovery-01: a child alive continuously past the healthy window is healthy-long-enough"
         true
         (front-desk-supervisor-lib/healthy-long-enough? 1000 301000 healthy-cfg))

(assert= "a child alive but not yet past the healthy window is NOT healthy-long-enough"
         false
         (front-desk-supervisor-lib/healthy-long-enough? 1000 300999 healthy-cfg))

(assert= "a child with no started-at-ms at all is never healthy-long-enough (never a crash)"
         false
         (front-desk-supervisor-lib/healthy-long-enough? nil 999999999 healthy-cfg))

(assert= "supervisor-recovery-02: a gave-up child whose cooldown has elapsed is cooldown-elapsed?"
         true
         (front-desk-supervisor-lib/cooldown-elapsed? 1000 901000 giveup-cfg))

(assert= "supervisor-recovery-02: a gave-up child whose cooldown has NOT elapsed is not cooldown-elapsed?"
         false
         (front-desk-supervisor-lib/cooldown-elapsed? 1000 900999 giveup-cfg))

(assert= "a child with no gave-up-at-ms is never cooldown-elapsed (never a crash)"
         false
         (front-desk-supervisor-lib/cooldown-elapsed? nil 999999999 giveup-cfg))

;; ── BL-303: check-one! full state machine (pure, adapter-injected) ───────

(def fixed-pid! (constantly 4242))
(def alive? (constantly true))
(def dead? (constantly false))

;; not-started -> running (unchanged from BL-292)
(let [{:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              (front-desk-supervisor-lib/default-entry) 0 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "not-started spawns and transitions to running" "running" (:status entry))
  (assert= "the freshly-started entry's attempts is 1" 1 (:attempts entry))
  (assert= "the freshly-started entry records started-at-ms" 0 (:started-at-ms entry))
  (assert= "not-started -> running emits :started" :started event))

;; running + pid alive + NOT yet past healthy window -> unchanged
(let [running-entry {:pid 4242 :attempts 3 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! running-entry 200000 alive? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "not yet past the healthy window: attempts is untouched" 3 (:attempts entry))
  (assert= "not yet past the healthy window: no event" nil event))

;; supervisor-recovery-01: running + pid alive + PAST healthy window -> attempts reset to 0
(let [running-entry {:pid 4242 :attempts 3 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! running-entry 400000 alive? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "supervisor-recovery-01: attempts reset to 0 once past the healthy-uptime window" 0 (:attempts entry))
  (assert= "supervisor-recovery-01: status stays running" "running" (:status entry))
  (assert= "supervisor-recovery-01: emits :healthy-reset" :healthy-reset event))

;; running + pid dead -> waiting, crashed-at-ms recorded
(let [running-entry {:pid 4242 :attempts 1 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! running-entry 5000 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "a dead pid transitions running -> waiting" "waiting" (:status entry))
  (assert= "the crash is timestamped at detection time" 5000 (:crashed-at-ms entry))
  (assert= "running -> waiting emits :crashed" :crashed event))

;; waiting, backoff not yet due -> unchanged
(let [waiting-entry {:pid nil :attempts 1 :status "waiting" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! waiting-entry 5500 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "backoff not yet due: still waiting" "waiting" (:status entry))
  (assert= "backoff not yet due: no event" nil event))

;; waiting, backoff due, under the cap -> restarts
(let [waiting-entry {:pid nil :attempts 1 :status "waiting" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! waiting-entry 6001 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "backoff due, under the cap: restarts" "running" (:status entry))
  (assert= "the restarted entry's attempts increments" 2 (:attempts entry))
  (assert= "waiting -> running (restart) emits :started" :started event))

;; supervisor-recovery-02 (bound holds): waiting, backoff due, AT the cap -> gives up
(let [waiting-entry {:pid nil :attempts 5 :status "waiting" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! waiting-entry 999999 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "a tight burst at the cap still reaches gave-up (bound holds)" "gave-up" (:status entry))
  (assert= "gave-up-at-ms is timestamped at the give-up moment" 999999 (:gave-up-at-ms entry))
  (assert= "waiting -> gave-up emits :gave-up (escalation preserved)" :gave-up event))

;; supervisor-recovery-02 [has not elapsed yet]: gave-up, cooldown NOT elapsed -> stays down, no spawn
(let [spawn-calls (atom 0)
      gave-up-entry {:pid nil :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              gave-up-entry 1500000 dead? (fn [] (swap! spawn-calls inc) 4242) healthy-cfg giveup-cfg)]
  (assert= "supervisor-recovery-02 [not elapsed]: stays gave-up" "gave-up" (:status entry))
  (assert= "supervisor-recovery-02 [not elapsed]: attempts untouched" 5 (:attempts entry))
  (assert= "supervisor-recovery-02 [not elapsed]: never spawns" 0 @spawn-calls)
  (assert= "supervisor-recovery-02 [not elapsed]: no event" nil event))

;; supervisor-recovery-02 [has elapsed]: gave-up, cooldown elapsed -> re-arms (attempts reset, spawns)
(let [gave-up-entry {:pid nil :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! gave-up-entry 1900000 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "supervisor-recovery-02 [elapsed]: re-arms to running" "running" (:status entry))
  (assert= "supervisor-recovery-02 [elapsed]: attempts reset to a fresh budget (1, not 6)" 1 (:attempts entry))
  (assert= "supervisor-recovery-02 [elapsed]: a fresh pid is recorded" 4242 (:pid entry))
  (assert= "supervisor-recovery-02 [elapsed]: gave-up-at-ms is cleared" nil (:gave-up-at-ms entry))
  (assert= "gave-up -> running (re-arm) emits :re-armed" :re-armed event))

;; ── BL-370: poll-heartbeat-stale? (pure) ─────────────────────────────────

(assert= "front-desk-liveness-01: a heartbeat older than the stall window is stale"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 92000 90000))

(assert= "front-desk-liveness-01: exactly AT the stall window boundary is stale (inclusive)"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 91000 90000))

(assert= "front-desk-liveness-02: a heartbeat just inside the stall window is NOT stale"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 90999 90000))

(assert= "a bot that never wrote a heartbeat at all is stale (nil counts as stale)"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? nil 90000 90000))

;; ── BL-370: check-one! extended with heartbeat-stale? ────────────────────

;; front-desk-liveness-01: running + pid alive + heartbeat stale -> "stalled",
;; never silently folded into an ordinary crash.
(let [running-entry {:pid 4242 :attempts 1 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! running-entry 5000 alive? fixed-pid! healthy-cfg giveup-cfg true)]
  (assert= "a stale heartbeat on a live pid transitions running -> stalled" "stalled" (:status entry))
  (assert= "the stall is timestamped at detection time" 5000 (:crashed-at-ms entry))
  (assert= "running -> stalled emits :stalled (never :crashed)" :stalled event))

;; front-desk-liveness-02: running + pid alive + heartbeat FRESH -> unchanged,
;; even with an otherwise-eligible healthy-reset window - the false-positive
;; guard, proven at the check-one! layer too.
(let [running-entry {:pid 4242 :attempts 1 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! running-entry 5000 alive? fixed-pid! healthy-cfg giveup-cfg false)]
  (assert= "a fresh heartbeat never reads as stalled" "running" (:status entry))
  (assert= "a fresh heartbeat: no event" nil event))

;; front-desk-liveness-03: "stalled" reuses the EXACT SAME bounded-backoff/
;; restart clause "waiting" already has.
(let [stalled-entry {:pid nil :attempts 1 :status "stalled" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! stalled-entry 6001 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "backoff due: a stalled entry restarts just like a crashed one" "running" (:status entry))
  (assert= "the restarted entry's attempts increments" 2 (:attempts entry))
  (assert= "stalled -> running (restart) emits :started" :started event))

;; front-desk-liveness-04: a repeated stall at the cap still gives up (bound holds).
(let [stalled-entry {:pid nil :attempts 5 :status "stalled" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! stalled-entry 999999 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "a repeated stall at the cap reaches gave-up (bound holds)" "gave-up" (:status entry))
  (assert= "stalled -> gave-up emits :gave-up" :gave-up event))

;; pre-existing callers (6-arg form) are unaffected - heartbeat-stale?
;; defaults to false.
(let [running-entry {:pid 4242 :attempts 1 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! running-entry 5000 alive? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "the 6-arg form (no heartbeat-stale? arg) never reports stalled" "running" (:status entry))
  (assert= "the 6-arg form: no event" nil event))

;; hardener (BL-370): heartbeat-stale? and healthy-long-enough? are BOTH
;; eligible at once - a bot healthy well past the reset window (399000ms
;; since started-at-ms, past healthy-cfg's 300000ms) that then goes stale.
;; The two prior tests above only ever exercise one condition at a time
;; (supervisor-recovery-01 with heartbeat-stale? defaulted false; the
;; running-entry stale test at attempts=1/started-at-ms=1000/now=5000,
;; nowhere near the reset window) - a cond-order swap between the
;; heartbeat-stale? and healthy-long-enough? branches would pass both,
;; undetected. heartbeat-stale? must win: :status "stalled", attempts left
;; UNTOUCHED (never silently reset to 0, which would erase the bounded-
;; restart escalation clock for a bot that only *looked* healthy).
(let [running-entry {:pid 4242 :attempts 3 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! running-entry 400000 alive? fixed-pid! healthy-cfg giveup-cfg true)]
  (assert= "stale-while-also-past-the-healthy-window: status is stalled, not silently healthy-reset" "stalled" (:status entry))
  (assert= "stale-while-also-past-the-healthy-window: attempts is untouched, not reset to 0" 3 (:attempts entry))
  (assert= "stale-while-also-past-the-healthy-window: the stall is timestamped at detection time" 400000 (:crashed-at-ms entry))
  (assert= "stale-while-also-past-the-healthy-window emits :stalled, never :healthy-reset" :stalled event))

;; ── BL-403: kill-pid! on restart ──────────────────────────────────────────

;; supervisor-kills-superseded-child-01: restarting an unhealthy bot terminates
;; the prior pid before spawning the replacement.
(let [kill-calls (atom [])
      kill-pid-tracking! (fn [pid] (swap! kill-calls conj pid))
      waiting-entry {:pid 1881442 :attempts 1 :status "waiting" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! waiting-entry 6001 dead? fixed-pid! healthy-cfg giveup-cfg false kill-pid-tracking!)]
  (assert= "supervisor-kills-superseded-child-01: backoff due, under the cap: restarts" "running" (:status entry))
  (assert= "supervisor-kills-superseded-child-01: kill-pid! is called with the old pid" [1881442] @kill-calls)
  (assert= "supervisor-kills-superseded-child-01: waiting -> running (restart) emits :started" :started event))

;; supervisor-kills-superseded-child-02: the replacement is not spawned while the
;; prior pid is confirmed still alive - kill-pid! is the adapter that handles
;; this synchronously (SIGTERM -> wait for grace -> SIGKILL).
(let [kill-calls (atom [])
      kill-pid-tracking! (fn [pid] (swap! kill-calls conj pid))
      spawn-calls (atom 0)
      spawn-after-kill! (fn []
        (swap! spawn-calls inc)
        (if (empty? @kill-calls)
          (swap! failures conj "spawn! called before kill-pid!")
          4242))
      waiting-entry {:pid 1881442 :attempts 1 :status "waiting" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! waiting-entry 6001 dead? spawn-after-kill! healthy-cfg giveup-cfg false kill-pid-tracking!)]
  (assert= "supervisor-kills-superseded-child-02: kill-pid! called before spawn" 1 @spawn-calls)
  (assert= "supervisor-kills-superseded-child-02: the new entry records the replacement pid" 4242 (:pid entry)))

;; supervisor-kills-superseded-child-03: status.json reflects exactly one live bot
;; pid after a forced restart - the old pid is dead, the new one is alive.
(let [kill-calls (atom [])
      kill-pid-tracking! (fn [pid] (swap! kill-calls conj pid))
      waiting-entry {:pid 1881442 :attempts 1 :status "waiting" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! waiting-entry 6001 dead? fixed-pid! healthy-cfg giveup-cfg false kill-pid-tracking!)]
  (assert= "supervisor-kills-superseded-child-03: exactly one pid after restart, the replacement" 4242 (:pid entry))
  (assert= "supervisor-kills-superseded-child-03: old pid was killed" [1881442] @kill-calls))

;; multiple successive restarts each kill the previous pid.
;; Scenario: crash restart (kill old pid) -> spawn new one -> it stalls -> restart again (kill new pid).
(let [kill-calls (atom [])
      kill-pid-tracking! (fn [pid] (swap! kill-calls conj pid))
      ;; First restart: crash with attempts=1, backoff due at 5000 + 1000 = 6000, now=6001
      waiting1 {:pid 1881442 :attempts 1 :status "waiting" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry entry1]} (front-desk-supervisor-lib/check-one! waiting1 6001 dead? fixed-pid! healthy-cfg giveup-cfg false kill-pid-tracking!)
      ;; Second stall restart: attempts=2, backoff due at 7000 + 2000 = 9000, now=9001
      stalled2 {:pid 4242 :attempts 2 :status "stalled" :crashed-at-ms 7000 :started-at-ms 6001 :gave-up-at-ms nil}
      {:keys [entry entry3]} (front-desk-supervisor-lib/check-one! stalled2 9001 dead? fixed-pid! healthy-cfg giveup-cfg false kill-pid-tracking!)]
  (assert= "multiple restarts: first old pid killed" 1881442 (first @kill-calls))
  (assert= "multiple restarts: second old pid killed" 4242 (second @kill-calls))
  (assert= "multiple restarts: both old pids were killed in order" 2 (count @kill-calls)))

;; 7-arg form still works (backward compat) - kill-pid! defaults to no-op.
(let [waiting-entry {:pid 1881442 :attempts 1 :status "waiting" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! waiting-entry 6001 dead? fixed-pid! healthy-cfg giveup-cfg false)]
  (assert= "7-arg form: restart still works with kill-pid! defaulted to no-op" "running" (:status entry))
  (assert= "7-arg form: replacement pid recorded" 4242 (:pid entry)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: front_desk_supervisor_lib.bb"))
