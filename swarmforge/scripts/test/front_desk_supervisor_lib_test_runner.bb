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

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: front_desk_supervisor_lib.bb"))
