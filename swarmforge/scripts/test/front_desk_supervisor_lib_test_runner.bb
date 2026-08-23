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

;; ── BL-1088: the declared cooldown is the delivered cooldown ─────────────
;; RETIRED, not reworded: the three assertions that stood here demanded a
;; gave-up child with a dead recorded pid re-arm IMMEDIATELY, "without waiting
;; for cooldown". That is the defect. A child reaches gave-up by crash-looping
;; until it exhausts its budget, so its process is ALWAYS dead - the dead-pid
;; disjunct short-circuited true on the very next tick and the cooldown every
;; one of six supervisors declares (900000ms) never applied to the one case it
;; was written for. Delivered bound: front_desk_supervisor.bb's 2000ms tick.
;;
;; The contract they encoded also contradicted
;; test_front_desk_supervisor_tick.sh's own "[not elapsed]: still gave-up, not
;; restarted", which has been failing on main ever since - two executable
;; assertions demanding opposite results from one function. Whichever way that
;; is resolved, one had to be retired; the cooldown is the declared design, so
;; these are the ones that go.

(let [gave-up-entry {:pid 1881442 :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! gave-up-entry 1005000 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "bl1088-01: gave-up with a DEAD pid stays given up inside the cooldown" "gave-up" (:status entry))
  (assert= "bl1088-01: no re-arm event inside the cooldown" nil event)
  (assert= "bl1088-01: the exhausted budget is not reset inside the cooldown" 5 (:attempts entry)))

(let [gave-up-entry {:pid 1881442 :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! gave-up-entry 1005000 alive? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "bl1088-01: gave-up with a LIVE pid also stays given up inside the cooldown" "gave-up" (:status entry))
  (assert= "bl1088-01: no re-arm event for a live pid either" nil event))

;; BL-303's timed-state guarantee, unchanged: restoring the bound must not
;; restore the sticky give-up BL-303 removed.
(let [gave-up-entry {:pid 1881442 :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one! gave-up-entry 1900000 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "bl1088-02: once the cooldown HAS elapsed the child re-arms" "running" (:status entry))
  (assert= "bl1088-02: and with a fresh budget" 1 (:attempts entry))
  (assert= "bl1088-02: emitting :re-armed" :re-armed event))

;; The boundary itself: exactly AT the cooldown counts as elapsed, matching
;; cooldown-elapsed?'s own >= and every other window in this file.
(let [gave-up-entry {:pid 1881442 :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      at (front-desk-supervisor-lib/check-one! gave-up-entry 1900000 dead? fixed-pid! healthy-cfg giveup-cfg)
      just-before (front-desk-supervisor-lib/check-one! gave-up-entry 1899999 dead? fixed-pid! healthy-cfg giveup-cfg)]
  (assert= "bl1088-02: exactly at the cooldown boundary re-arms" :re-armed (:event at))
  (assert= "bl1088-02: one millisecond before it does not" nil (:event just-before)))

;; ── BL-370: poll-heartbeat-stale? (pure) ─────────────────────────────────

(assert= "front-desk-liveness-01: a heartbeat older than the stall window is stale"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 92000 90000 nil 90000))

(assert= "front-desk-liveness-01: exactly AT the stall window boundary is stale (inclusive)"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 91000 90000 nil 90000))

(assert= "front-desk-liveness-02: a heartbeat just inside the stall window is NOT stale"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 90999 90000 nil 90000))

(assert= "a bot that never wrote a heartbeat at all is stale (nil counts as stale)"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? nil 90000 90000 nil 90000))

(assert= "a freshly spawned bot with no heartbeat yet is NOT stale during startup grace"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? nil 50000 90000 1000 90000))


;; ── BL-1035: a respawned bot is judged on ITS OWN heartbeat ──────────────
;; The grace was nil-guarded, but the heartbeat is a FILE that outlives the
;; process that wrote it and nothing resets it at spawn. So a replacement was
;; judged against the DEAD instance's timestamp - non-nil and already stale -
;; and declared stalled on the first tick. Live 2026-08-22: started 06:13:56,
;; "stalled" 06:13:58, respawned 06:14:02, against a 90000ms grace.
;;
;; The rule: a heartbeat written BEFORE this child spawned was written by a
;; different process and carries no information about this one.

(assert= "bl1035-01: a predecessor's stale heartbeat does NOT condemn the replacement inside its grace"
         false
         ;; heartbeat at 1000 (the dead instance), this child spawned at 500000,
         ;; now 502000 - two seconds in, exactly the live shape.
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 502000 90000 500000 90000))

(assert= "bl1035-02: the grace still EXPIRES - a replacement that never polls is caught"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 590001 90000 500000 90000))

(assert= "bl1035-02: exactly AT the end of the grace it is stale (boundary is inclusive, like the stall window)"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 590000 90000 500000 90000))

(assert= "bl1035-03: a heartbeat the replacement itself wrote clears the grace"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 500100 502000 90000 500000 90000))

(assert= "bl1035-03: a heartbeat written exactly AT spawn counts as the child's own"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 500000 502000 90000 500000 90000))

(assert= "bl1035-03: but the child's OWN heartbeat going stale is still stale after the grace"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 500100 590200 90000 500000 90000))

(assert= "bl1035-04: the case that already worked keeps working - no heartbeat ever recorded"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? nil 502000 90000 500000 90000))

;; The six supervisors sharing this predicate include callers that pass no
;; spawn time at all. Their behaviour must be byte-for-byte unchanged: with no
;; started-at-ms there is no "before this child" to speak of.
;; BL-1043 retired the grace-less 3-arity these two named. What they were
;; really pinning is the no-spawn-time SEMANTICS, which the explicit 5-arity
;; still carries verbatim - so they follow it there rather than being deleted.
(assert= "bl1035: no spawn time is unchanged - a stale heartbeat is still stale"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 92000 90000 nil 90000))

(assert= "bl1035: no spawn time is unchanged - a fresh heartbeat is still fresh"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 90999 90000 nil 90000))

(assert= "bl1035: a pre-spawn heartbeat AFTER the grace is stale, not silently waived forever"
         true
         ;; The waiver is scoped to the grace. Once it ends, an absent own
         ;; heartbeat is stale exactly as a nil one always was - otherwise the
         ;; fix would reintroduce BL-370's original fault.
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 999999 90000 500000 90000))

;; bl1035-03's "exactly AT spawn" case above (500000/502000/90000/500000/90000)
;; cannot actually discriminate `>=` from a strict `>` in
;; `(>= last-heartbeat-ms started-at-ms)`: with grace-ms == stall-ms in every
;; existing fixture (unit AND property runner alike), a mutant that treats an
;; at-spawn heartbeat as "not the child's own" (own-heartbeat-ms => nil) still
;; answers "not stale" there via the STILL-IN-GRACE branch, coincidentally
;; matching the correct answer. Hand-verified: with `>` in place of `>=`, this
;; whole test runner and the property runner BOTH still report all-green.
;; Discriminating case: grace SHORTER than stall, so the grace ends while the
;; at-spawn heartbeat is still well within the stall window - only there does
;; treating it as "not the child's own" (falling to the nil branch, stale
;; unconditionally past grace) diverge from treating it as the child's own
;; fresh heartbeat (not stale).
(assert= "bl1035-03: at-spawn heartbeat is the child's own even once the (shorter) grace has ended"
         false
         ;; last-heartbeat=started-at=500000 (exactly at spawn); grace is only
         ;; 1000ms (already over by now=501500) but stall is 90000ms (heartbeat
         ;; is only 1500ms old) - if `>=` were `>`, this would wrongly be stale.
         (front-desk-supervisor-lib/poll-heartbeat-stale? 500000 501500 90000 500000 1000))

;; ── BL-1043: a call site that does not ask for a grace still GETS one ────
;; BL-1035 fixed the 5-arity, but the convenience arity below it passed
;; started-at-ms as nil - and the grace clause opens with (and started-at-ms
;; ...), so it could never fire. It even passed stall-ms in the grace slot,
;; which read to a reviewer like a deliberate, generous grace and was dead
;; code. Two supervisors called exactly that arity and had NO startup grace
;; at all: onboarder-supervisor.log has a child declared stalled 2.00s after
;; spawn against a declared 120000ms window.
;;
;; So the no-grace arity is retired. A caller now names the spawn time and
;; may omit only the grace LENGTH, which defaults; omitting the spawn time is
;; an arity error rather than a silent loss of protection.

(assert= "bl1043-05: the grace-less arity is GONE - omitting the spawn time no longer resolves"
         true
         (try (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 92000 90000)
              false
              ;; babashka reports this as a plain java.lang.Exception, so the
              ;; message is pinned too - otherwise any unrelated throw here
              ;; would read as the arity being gone.
              (catch Exception e
                (boolean (re-find #"with 3 arguments" (.getMessage e))))))

(assert= "bl1043-01: a caller that names no grace still gets the default one"
         false
         ;; No heartbeat at all, 2s into the default grace - the live shape.
         (front-desk-supervisor-lib/poll-heartbeat-stale? nil 502000 120000 500000))

(assert= "bl1043-02: the defaulted grace still EXPIRES - the guard stays armed"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale?
           nil (+ 500000 front-desk-supervisor-lib/default-startup-grace-ms) 120000 500000))

(assert= "bl1043-03: a predecessor's stale heartbeat does not condemn a replacement under the defaulted grace"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 502000 120000 500000))

(assert= "bl1043-04: the child's own heartbeat inside the defaulted grace clears the concern"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 500100 502000 120000 500000))

(assert= "bl1043: past the defaulted grace, the child's own stale heartbeat is still stale"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 500100 700000 120000 500000))

;; The remaining accidental door: (:started-at-ms entry) on an entry that has
;; not started yet reads nil. Under the old 3-arity that meant "no grace, so a
;; missing heartbeat is stale immediately" - the defect. The defaulting arity
;; cannot measure a grace from a spawn time it does not have, so it refuses to
;; call the child stalled rather than degrading back to that.
(assert= "bl1043: a nil spawn time under the defaulting arity is never stalled, never the old immediate stall"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? nil 502000 120000 nil))

(assert= "bl1043: a nil spawn time is not stalled even with a long-stale heartbeat present"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 999999 120000 nil))

;; The explicit 5-arity keeps its BL-370 meaning: a caller that passes nil
;; spawn time AND names a grace has said, in as many words, that it has no
;; spawn time to measure from. That is a statement, not an accident.
(assert= "bl1043: the explicit 5-arity with a nil spawn time is unchanged - a stale heartbeat is still stale"
         true
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 92000 90000 nil 90000))

(assert= "bl1043: the explicit 5-arity with a nil spawn time is unchanged - a fresh heartbeat is still fresh"
         false
         (front-desk-supervisor-lib/poll-heartbeat-stale? 1000 90999 90000 nil 90000))

(assert= "bl1043: the default grace is the same 90s the reference supervisor already used"
         90000
         front-desk-supervisor-lib/default-startup-grace-ms)

;; ── BL-1037 (hardener): build-served-fact? directly, not only through
;; check-one!'s already-resolved boolean ────────────────────────────────
;; The same >= boundary as bl1035-03 above, extracted to its own function so
;; it is exercised directly rather than only reachable as an already-computed
;; true/false handed to build-freshness-transition/check-one!. Unlike
;; poll-heartbeat-stale?, there is no grace/stall dual-window here to hide the
;; boundary behind a coincidentally-matching branch - a direct >= vs >
;; mutation is immediately observable.

(assert= "bl1037: a heartbeat written exactly AT spawn counts as this child having served"
         true
         (front-desk-supervisor-lib/build-served-fact? 500000 500000))

(assert= "bl1037: a heartbeat one tick BEFORE spawn is the predecessor's, not this child's"
         false
         (front-desk-supervisor-lib/build-served-fact? 499999 500000))

(assert= "bl1037: a heartbeat after spawn is unambiguously this child's own"
         true
         (front-desk-supervisor-lib/build-served-fact? 500100 500000))

(assert= "bl1037: no heartbeat at all is never read as served"
         false
         (front-desk-supervisor-lib/build-served-fact? nil 500000))

(assert= "bl1037: no spawn time at all is never read as served"
         false
         (front-desk-supervisor-lib/build-served-fact? 500000 nil))

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

;; supervisor-kills-superseded-child-04 [BOUNCE, BL-403]: "gave-up" is reached
;; ONLY from "waiting"/"stalled" when decide-restart-action is NOT :restart -
;; the "stalled" arm of that case is entered from "running" via
;; heartbeat-stale?, which never touches pid-alive?, so a gave-up entry's
;; :pid can be a process that is STILL ALIVE (a hung/unresponsive bot, never
;; a crashed one). check-one!'s existing "gave-up -> re-armed" fixtures
;; (supervisor-recovery-02 above) all use :pid nil, which trivially satisfies
;; "no live pid to kill" without ever exercising this branch - see the
;; hardener's own "check the fixture hasn't already satisfied the condition"
;; rule. A non-nil, still-alive pid here reproduces the exact production
;; incident this ticket exists to prevent (BL-403 source: supervisor left
;; orphan attempt-1 alive after judging it unhealthy and spawning attempt-2),
;; just via the gave-up/re-arm path rather than the waiting/stalled restart
;; path the coder's fix covers.
(let [kill-calls (atom [])
      kill-pid-tracking! (fn [pid] (swap! kill-calls conj pid))
      gave-up-entry {:pid 1881442 :attempts 5 :status "gave-up" :crashed-at-ms 5000 :started-at-ms 1000 :gave-up-at-ms 1000000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              gave-up-entry 1900000 dead? fixed-pid! healthy-cfg giveup-cfg false kill-pid-tracking!)]
  (assert= "supervisor-kills-superseded-child-04: re-arms to running" "running" (:status entry))
  (assert= "supervisor-kills-superseded-child-04: a fresh pid is recorded" 4242 (:pid entry))
  (assert= "supervisor-kills-superseded-child-04: the still-alive gave-up pid is killed before re-arm spawns its replacement"
           [1881442] @kill-calls))

;; ── decide-bridge-port-action (pure) — BL-789 mac-host-switch-freshness-bridge-adopt-04/05 ─
;; Orphan EADDRINUSE crash loop: something already holds the bridge port
;; when the supervisor decides it needs to (re)spawn. Adoption must verify
;; HEALTH, never just a listening socket (BL-789 approval_context scope
;; note 2) - healthy? is a precomputed boolean, same "no I/O inside the pure
;; decision" convention as check-one!'s own heartbeat-stale?.

(def repo-root "/repo")

(assert= "bl789-04: nothing on the port -> spawn as normal"
         :spawn
         (front-desk-supervisor-lib/decide-bridge-port-action nil false repo-root))

(assert= "bl789-04: our own healthy bridge already on the port -> adopt, no second spawn"
         :adopt
         (front-desk-supervisor-lib/decide-bridge-port-action
          {:pid 4242 :cmdline "node /repo/extension/out/tools/start-bridge-headless.js /repo 8765"} true repo-root))

(assert= "bl789-05: an unrelated process on the port -> free it, then spawn"
         :free
         (front-desk-supervisor-lib/decide-bridge-port-action
          {:pid 9999 :cmdline "python3 -m http.server 8765"} false repo-root))

(assert= "bl789: our own entrypoint holds the port but fails the health probe (hung/dead) -> free, never adopt on cmdline match alone"
         :free
         (front-desk-supervisor-lib/decide-bridge-port-action
          {:pid 4242 :cmdline "node /repo/extension/out/tools/start-bridge-headless.js /repo 8765"} false repo-root))

(assert= "bl789: an unrelated process that happens to answer health probes is never adopted (cmdline match required too)"
         :free
         (front-desk-supervisor-lib/decide-bridge-port-action
          {:pid 9999 :cmdline "python3 -m http.server 8765"} true repo-root))

(assert= "bl789: a DIFFERENT swarm's own healthy bridge on a port collision is never adopted (project-root must match too)"
         :free
         (front-desk-supervisor-lib/decide-bridge-port-action
          {:pid 5555 :cmdline "node /other-repo/extension/out/tools/start-bridge-headless.js /other-repo 8765"} true repo-root))

;; ── onboarder-reconcile-poll-loop-holder? / decide-onboarder-orphan-reap
;;    (pure) — BL-928 supervisor-startup orphan sweep ────────────────────────

(def onb-root "/repo")

(assert= "bl928: our own poll-loop cmdline for this root -> holder"
         true
         (front-desk-supervisor-lib/onboarder-reconcile-poll-loop-holder?
          "node /repo/extension/out/tools/onboarder-reconcile.js /repo poll-loop" onb-root))

(assert= "bl928: same entrypoint, DIFFERENT root -> not a holder (invariant 2)"
         false
         (front-desk-supervisor-lib/onboarder-reconcile-poll-loop-holder?
          "node /other-repo/extension/out/tools/onboarder-reconcile.js /other-repo poll-loop" onb-root))

(assert= "bl928: our root, but not the poll-loop subcommand -> not a holder"
         false
         (front-desk-supervisor-lib/onboarder-reconcile-poll-loop-holder?
          "node /repo/extension/out/tools/onboarder-reconcile.js /repo once" onb-root))

(assert= "bl928: an unrelated process that happens to mention our root -> not a holder"
         false
         (front-desk-supervisor-lib/onboarder-reconcile-poll-loop-holder?
          "cat /repo/README.md poll-loop" onb-root))

(assert= "bl928: nil cmdline -> not a holder"
         false
         (front-desk-supervisor-lib/onboarder-reconcile-poll-loop-holder? nil onb-root))

;; decide-onboarder-orphan-reap: processes / project-root / parent-orphaned?
(defn- onb-parent-orphaned-set [orphan-pids]
  (fn [pid] (boolean (contains? (set orphan-pids) pid))))

(assert= "bl928: unreadable process table (nil) -> reaps nothing, flagged unreadable (invariant 3)"
         {:reapable [] :unreadable? true}
         (front-desk-supervisor-lib/decide-onboarder-orphan-reap nil onb-root (onb-parent-orphaned-set [])))

(assert= "bl928: empty process table -> reaps nothing, NOT flagged unreadable (distinguishable from nil)"
         {:reapable [] :unreadable? false}
         (front-desk-supervisor-lib/decide-onboarder-orphan-reap [] onb-root (onb-parent-orphaned-set [])))

(assert= "bl928: a real orphaned poll-loop for our root is reapable"
         {:reapable [111] :unreadable? false}
         (front-desk-supervisor-lib/decide-onboarder-orphan-reap
          [{:pid 111 :cmdline "node /repo/extension/out/tools/onboarder-reconcile.js /repo poll-loop"}]
          onb-root (onb-parent-orphaned-set [111])))

(assert= "bl928: a poll-loop whose parent is alive is NEVER reaped (invariant 1 - decapitation guard)"
         {:reapable [] :unreadable? false}
         (front-desk-supervisor-lib/decide-onboarder-orphan-reap
          [{:pid 222 :cmdline "node /repo/extension/out/tools/onboarder-reconcile.js /repo poll-loop"}]
          onb-root (onb-parent-orphaned-set [])))

(assert= "bl928: an orphaned poll-loop for a DIFFERENT root is never reaped (invariant 2)"
         {:reapable [] :unreadable? false}
         (front-desk-supervisor-lib/decide-onboarder-orphan-reap
          [{:pid 333 :cmdline "node /other-repo/extension/out/tools/onboarder-reconcile.js /other-repo poll-loop"}]
          onb-root (onb-parent-orphaned-set [333])))

(assert= "bl928: an orphaned, unrelated process is never reaped (cmdline match required too)"
         {:reapable [] :unreadable? false}
         (front-desk-supervisor-lib/decide-onboarder-orphan-reap
          [{:pid 444 :cmdline "python3 -m http.server 8765"}]
          onb-root (onb-parent-orphaned-set [444])))

(assert= "bl928: mixed table - only the orphaned, ours, poll-loop candidate is reaped"
         {:reapable [111] :unreadable? false}
         (front-desk-supervisor-lib/decide-onboarder-orphan-reap
          [{:pid 111 :cmdline "node /repo/extension/out/tools/onboarder-reconcile.js /repo poll-loop"}
           {:pid 222 :cmdline "node /repo/extension/out/tools/onboarder-reconcile.js /repo poll-loop"}
           {:pid 333 :cmdline "node /other-repo/extension/out/tools/onboarder-reconcile.js /other-repo poll-loop"}
           {:pid 444 :cmdline "python3 -m http.server 8765"}]
          onb-root (onb-parent-orphaned-set [111 333 444])))

;; ── BL-582 scenario 06: a healthy bot on a stale build ──────────────────
;; The 2026-07-23 window ran 12:23 -> 14:46 on an outdated build because the
;; supervisor only ever checked freshness on a CRASH respawn. A healthy
;; process never crashed, so it never got checked, so it served the stale
;; build for two hours and twenty minutes. Freshness is now checked on the
;; healthy tick too - after a grace period, so a merge landing mid-poll does
;; not restart the front desk out from under a human mid-conversation.

(def build-cfg (assoc healthy-cfg :build-grace-ms 300000))

(assert= "bl582: a build sha matching main is not stale"
         false
         (front-desk-supervisor-lib/build-stale? "abc123" "abc123"))

(assert= "bl582: a build sha differing from main is stale"
         true
         (front-desk-supervisor-lib/build-stale? "abc123" "def456"))

(assert= "bl582: an unresolvable running sha never FABRICATES staleness"
         false
         (front-desk-supervisor-lib/build-stale? nil "def456"))

(assert= "bl582: an unresolvable main sha never fabricates staleness either"
         false
         (front-desk-supervisor-lib/build-stale? "abc123" nil))

;; running + build stale + first observation -> grace starts, NO restart
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 10000 alive? fixed-pid! build-cfg giveup-cfg false (fn [_] nil) true)]
  (assert= "bl582: the first stale observation stays running" "running" (:status entry))
  (assert= "bl582: the first stale observation stamps when the grace started" 10000 (:build-stale-since-ms entry))
  (assert= "bl582: the first stale observation is reported, not silent" :build-stale-detected event))

;; running + build stale + WITHIN grace -> unchanged, no restart
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 10000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 100000 alive? fixed-pid! build-cfg giveup-cfg false (fn [_] nil) true)]
  (assert= "bl582: still inside the grace window, still running" "running" (:status entry))
  (assert= "bl582: the grace start is not re-stamped on every tick" 10000 (:build-stale-since-ms entry))
  (assert= "bl582: no event while the grace has not elapsed" nil event))

;; running + build stale + grace ELAPSED -> restarted, no crash required
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 10000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 311000 alive? fixed-pid! build-cfg giveup-cfg false (fn [_] nil) true)]
  (assert= "bl582: past the grace, the healthy process is moved to restart" "stale-build" (:status entry))
  (assert= "bl582: the restart is reported under its own event, distinct from a crash" :build-stale event)
  (assert= "bl582: the restart clock starts now, feeding the shared backoff clause" 311000 (:crashed-at-ms entry)))

;; the stale-build status restarts through the SAME bounded-backoff clause
(let [stale-entry {:pid 4242 :attempts 1 :status "stale-build" :crashed-at-ms 311000 :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              stale-entry 999999 alive? fixed-pid! build-cfg giveup-cfg)]
  (assert= "bl582: a stale-build entry respawns exactly like a crashed one" "running" (:status entry))
  (assert= "bl582: the respawn emits :started" :started event)
  (assert= "bl582: the respawned entry's stale-grace stamp is cleared" nil (:build-stale-since-ms entry)))

;; a build that goes fresh again before the grace elapses forgets the grace
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 10000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 100000 alive? fixed-pid! build-cfg giveup-cfg false (fn [_] nil) false)]
  (assert= "bl582: a build that became fresh again clears the grace stamp" nil (:build-stale-since-ms entry))
  (assert= "bl582: clearing the grace is not itself an event" nil event))

;; a crash still wins over build staleness - never a stale-build report for a dead pid
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 10000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 999999 dead? fixed-pid! build-cfg giveup-cfg false (fn [_] nil) true)]
  (assert= "bl582: a dead pid is still reported as crashed, never as a stale build" :crashed event))

;; every pre-BL-582 caller keeps its exact behaviour (build-stale? defaults false)
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000 :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 999999 alive? fixed-pid! build-cfg giveup-cfg)]
  (assert= "bl582: an 8-arity caller never sees a stale-build transition" "running" (:status entry))
  (assert= "bl582: an 8-arity caller sees no build event" nil event))

;; ── BL-1037: the watchdog restarts fewer times than main moves ───────────
;; BL-582 gap (c) restarts a HEALTHY child once its build_sha has trailed main
;; for the grace. Right in principle - before it, a build served 2h23m stale -
;; but this swarm lands commits faster than one grace plus recompile-and-
;; respawn, so staleness re-arms before the previous restart has paid for
;; itself: 24 build-stale-detected events and 12 respawns in 105 minutes on
;; 2026-08-22.
;;
;; The bound: a child restarted onto a fresh build must actually SERVE - one
;; completed poll cycle - before the watchdog may restart it again. The debt is
;; CARRIED while it waits, never cleared, or this reintroduces the 2h23m window.

;; The un-served case: past the grace, but this child has not polled yet on the
;; build it was restarted onto. No restart, and the debt survives.
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 10000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 311000 alive? fixed-pid! build-cfg giveup-cfg
                              false (fn [_] nil) true false)]
  (assert= "bl1037: a child that has not served yet is NOT restarted, even past the grace"
           "running" (:status entry))
  (assert= "bl1037: and the staleness it already saw is CARRIED, never cleared"
           10000 (:build-stale-since-ms entry))
  (assert= "bl1037: the deferral is reported, not silent - the log must still explain itself"
           :build-stale-deferred event))

;; The served case: unchanged from BL-582. A child that has served may be
;; restarted, so this bound never becomes "never restart".
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 10000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 311000 alive? fixed-pid! build-cfg giveup-cfg
                              false (fn [_] nil) true true)]
  (assert= "bl1037: a child that HAS served is still restarted past the grace"
           "stale-build" (:status entry))
  (assert= "bl1037: and that restart is still reported" :build-stale event))

;; Deferral must not swallow the first observation either.
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 10000 alive? fixed-pid! build-cfg giveup-cfg
                              false (fn [_] nil) true false)]
  (assert= "bl1037: the first stale observation is still stamped while un-served"
           10000 (:build-stale-since-ms entry))
  (assert= "bl1037: and still reported" :build-stale-detected event))

;; A build that MATCHES main costs nothing, served or not (scenario 04).
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 10000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 311000 alive? fixed-pid! build-cfg giveup-cfg
                              false (fn [_] nil) false false)]
  (assert= "bl1037: a fresh build is never restarted" "running" (:status entry))
  (assert= "bl1037: and its carried staleness is cleared once the build matches"
           nil (:build-stale-since-ms entry)))

;; Every existing caller passes no served? at all. Their behaviour must be
;; byte-for-byte what it was, or this bound silently disables the watchdog for
;; the bridge and every other child.
(let [running-entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 10000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 311000 alive? fixed-pid! build-cfg giveup-cfg
                              false (fn [_] nil) true)]
  (assert= "bl1037: the 9-arity form is unchanged - a stale build past the grace still restarts"
           "stale-build" (:status entry))
  (assert= "bl1037: and still reports the same event" :build-stale event))


;; healthy-reset wins over an equally-eligible build-stale restart - same
;; "two conditions eligible at once, cond order must not swap" shape as the
;; BL-370 heartbeat-stale?/healthy-long-enough? test above, one clause over.
;; check-one! tests build-freshness LAST specifically so a healthy-reset
;; (bookkeeping, fires at most once per process) is never starved by a
;; stale-build report on the same tick; the deferred report catches up next
;; tick since the grace is measured in minutes. Without this test, a cond-
;; order swap promoting the freshness clause ahead of healthy-reset would
;; pass every other bl582/BL-370 assertion above undetected.
(let [running-entry {:pid 4242 :attempts 1 :status "running" :crashed-at-ms nil :started-at-ms 1000
                     :gave-up-at-ms nil :build-stale-since-ms 100000}
      {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                              running-entry 650000 alive? fixed-pid! build-cfg giveup-cfg false (fn [_] nil) true)]
  (assert= "healthy-reset-vs-build-stale: healthy-reset wins, status stays running" "running" (:status entry))
  (assert= "healthy-reset-vs-build-stale: attempts is reset to 0, not left untouched by a stale-build branch" 0 (:attempts entry))
  (assert= "healthy-reset-vs-build-stale: the grace stamp is untouched - the freshness clause never ran this tick" 100000 (:build-stale-since-ms entry))
  (assert= "healthy-reset-vs-build-stale emits :healthy-reset, never :build-stale" :healthy-reset event))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: front_desk_supervisor_lib.bb"))
