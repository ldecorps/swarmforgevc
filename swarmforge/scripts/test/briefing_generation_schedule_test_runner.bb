#!/usr/bin/env bb
;; TDD runner for briefing_generation_schedule_lib.bb (BL-258) - pure
;; assertions only (injected now-ms, injected fixture-dir, fake :notify!/
;; :log! adapters). No real timers, no real tmux, no real clock.
(ns briefing-generation-schedule-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_generation_schedule_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn mk-tmp [] (str (fs/create-temp-dir {:prefix "briefing-generation-schedule-test-"})))

(defn ms [iso] (.toEpochMilli (java.time.Instant/parse iso)))

;; ── utc-day-key (pure) ──────────────────────────────────────────────────

(assert= "utc-day-key matches the real docs/briefings/<date>.md naming (YYYY-MM-DD, UTC)"
         "2026-07-10"
         (briefing-generation-schedule-lib/utc-day-key (ms "2026-07-10T08:00:00Z")))

(assert= "utc-day-key uses the UTC calendar day, not a local-offset one"
         "2026-07-10"
         (briefing-generation-schedule-lib/utc-day-key (ms "2026-07-10T23:59:59Z")))

;; ── parse-morning-time (pure) ───────────────────────────────────────────
;; BL-258 configurable-time-04's own two Examples values.

(assert= "parses \"07:00\"" [7 0] (briefing-generation-schedule-lib/parse-morning-time "07:00"))
(assert= "parses \"09:30\"" [9 30] (briefing-generation-schedule-lib/parse-morning-time "09:30"))
(assert= "a blank value falls back to a sane default, never a crash"
         [8 0]
         (briefing-generation-schedule-lib/parse-morning-time ""))
(assert= "a nil value falls back to a sane default, never a crash"
         [8 0]
         (briefing-generation-schedule-lib/parse-morning-time nil))
(assert= "a malformed value falls back to a sane default, never a crash"
         [8 0]
         (briefing-generation-schedule-lib/parse-morning-time "not-a-time"))
(assert= "an out-of-range hour falls back to a sane default"
         [8 0]
         (briefing-generation-schedule-lib/parse-morning-time "24:00"))

;; ── morning-trigger-due? (pure, injected clock + fixture dir) ───────────
;; BL-258 morning-trigger-01 / headless-independent-02 / configurable-time-04

(let [dir (mk-tmp)]
  (assert= "before the configured morning time, not yet due"
           false
           (briefing-generation-schedule-lib/morning-trigger-due?
            (ms "2026-07-10T06:59:00Z") 7 0 dir))
  (assert= "at/after the configured morning time, with no briefing yet, due"
           true
           (briefing-generation-schedule-lib/morning-trigger-due?
            (ms "2026-07-10T07:00:00Z") 7 0 dir))
  (assert= "well after the configured morning time, with no briefing yet, still due"
           true
           (briefing-generation-schedule-lib/morning-trigger-due?
            (ms "2026-07-10T14:00:00Z") 7 0 dir)))

;; configurable-time-04: a different configured time changes WHEN it's due,
;; not whether - proving the time is actually read, not hardcoded.
(let [dir (mk-tmp)]
  (assert= "09:30 configured: not yet due at 09:00"
           false
           (briefing-generation-schedule-lib/morning-trigger-due?
            (ms "2026-07-10T09:00:00Z") 9 30 dir))
  (assert= "09:30 configured: due at 09:30"
           true
           (briefing-generation-schedule-lib/morning-trigger-due?
            (ms "2026-07-10T09:30:00Z") 9 30 dir)))

;; idempotent-once-per-day-03: today's file already exists -> never due,
;; regardless of how far past the configured time now-ms is.
(let [dir (mk-tmp)]
  (spit (str (fs/path dir "2026-07-10.md")) "Headline\n")
  (assert= "today's briefing already generated -> not due, even well past the configured time"
           false
           (briefing-generation-schedule-lib/morning-trigger-due?
            (ms "2026-07-10T20:00:00Z") 7 0 dir)))

;; A stale prior day's file must never suppress TODAY's trigger.
(let [dir (mk-tmp)]
  (spit (str (fs/path dir "2026-07-09.md")) "Yesterday's headline\n")
  (assert= "yesterday's file does not suppress today's trigger"
           true
           (briefing-generation-schedule-lib/morning-trigger-due?
            (ms "2026-07-10T07:00:00Z") 7 0 dir)))

;; ── briefing-due-instruction (pure) ──────────────────────────────────────
;; Reuses BL-099's own literal wording
;; (extension/src/extension.ts's startOrRestartDailyBriefing) verbatim, so
;; the coordinator sees the identical nudge from either trigger.

(assert= "the instruction names the exact target file, matching BL-099's own wording"
         "Daily briefing due: compose today's briefing per your role and commit it to docs/briefings/2026-07-10.md."
         (briefing-generation-schedule-lib/briefing-due-instruction "2026-07-10"))

;; ── generate-briefing-if-due! (adapter-injected, mirrors briefing_email_lib.bb's send-unsent-briefings! shape) ──

(let [dir (mk-tmp)
      notified (atom [])
      logs (atom [])
      emitted (atom 0)
      fired? (briefing-generation-schedule-lib/generate-briefing-if-due!
              (ms "2026-07-10T07:00:00Z") 7 0 dir
              {:notify! (fn [text] (swap! notified conj text))
               :emit-sidecar! (fn [] (swap! emitted inc))
               :log! (fn [& parts] (swap! logs conj (vec parts)))})]
  (assert= "morning-trigger-01: due -> fires and returns true" true fired?)
  (assert= "morning-trigger-01: the notify adapter is called exactly once with the built instruction"
           ["Daily briefing due: compose today's briefing per your role and commit it to docs/briefings/2026-07-10.md."]
           @notified)
  (assert= "morning-trigger-01: a nudge-sent event is logged"
           true
           (some #(= (first %) "briefing-generation-nudge-sent") @logs))
  ;; BL-272 headless-cost-health-sidecar-01: the sidecar emit adapter fires
  ;; exactly once alongside the nudge.
  (assert= "BL-272: the emit-sidecar adapter is called exactly once when due" 1 @emitted))

;; idempotent-once-per-day-03: firing again the same day, with the file now
;; present, does nothing - no second notify, no second log.
(let [dir (mk-tmp)
      notified (atom [])
      emitted (atom 0)]
  (spit (str (fs/path dir "2026-07-10.md")) "Headline\n")
  (let [fired? (briefing-generation-schedule-lib/generate-briefing-if-due!
                (ms "2026-07-10T20:00:00Z") 7 0 dir
                {:notify! (fn [text] (swap! notified conj text))
                 :emit-sidecar! (fn [] (swap! emitted inc))
                 :log! (fn [& _] nil)})]
    (assert= "idempotent-once-per-day-03: already generated -> does not fire, returns false" false fired?)
    (assert= "idempotent-once-per-day-03: the notify adapter is never called" [] @notified)
    (assert= "BL-272: not due -> the emit-sidecar adapter is never called" 0 @emitted)))

;; before the configured time, no adapter call at all.
(let [dir (mk-tmp)
      notified (atom [])
      emitted (atom 0)]
  (let [fired? (briefing-generation-schedule-lib/generate-briefing-if-due!
                (ms "2026-07-10T06:00:00Z") 7 0 dir
                {:notify! (fn [text] (swap! notified conj text))
                 :emit-sidecar! (fn [] (swap! emitted inc))
                 :log! (fn [& _] nil)})]
    (assert= "not yet time -> does not fire, returns false" false fired?)
    (assert= "not yet time -> the notify adapter is never called" [] @notified)
    (assert= "BL-272: not yet time -> the emit-sidecar adapter is never called" 0 @emitted)))

;; ── BL-272: sidecar emission is best-effort ──────────────────────────────
;; headless-cost-health-sidecar-02: an emit-sidecar! that throws must never
;; block or suppress the notify nudge - mirrors extension.ts's own
;; try/catch-then-nudge ordering around the host's compute/write/commit
;; calls (onBriefingDue).

(let [dir (mk-tmp)
      notified (atom [])
      fired? (briefing-generation-schedule-lib/generate-briefing-if-due!
              (ms "2026-07-10T07:00:00Z") 7 0 dir
              {:notify! (fn [text] (swap! notified conj text))
               :emit-sidecar! (fn [] (throw (ex-info "simulated sidecar emit failure" {})))
               :log! (fn [& _] nil)})]
  (assert= "BL-272 headless-cost-health-sidecar-02: a throwing emit-sidecar adapter still fires the trigger" true fired?)
  (assert= "BL-272 headless-cost-health-sidecar-02: the notify adapter is still called exactly once despite the emit failure"
           ["Daily briefing due: compose today's briefing per your role and commit it to docs/briefings/2026-07-10.md."]
           @notified))

;; ── BL-308: hibernated? branch calls :compose-headless! instead of :notify! ──
;; banked-composer-fires-01 / full-forge-unaffected-03

(let [dir (mk-tmp)
      notified (atom [])
      composed (atom [])
      logs (atom [])
      fired? (briefing-generation-schedule-lib/generate-briefing-if-due!
              (ms "2026-07-10T07:00:00Z") 7 0 dir true
              {:notify! (fn [text] (swap! notified conj text))
               :compose-headless! (fn [day-key] (swap! composed conj day-key))
               :emit-sidecar! (fn [] nil)
               :log! (fn [& parts] (swap! logs conj (vec parts)))})]
  (assert= "banked-composer-fires-01: due while hibernated -> fires and returns true" true fired?)
  (assert= "banked-composer-fires-01: the headless composer is called exactly once with today's day-key"
           ["2026-07-10"] @composed)
  (assert= "banked-composer-fires-01: the notify (coordinator-nudge) adapter is never called while hibernated"
           [] @notified)
  (assert= "banked-composer-fires-01: a distinct headless-composed event is logged"
           true
           (some #(= (first %) "briefing-generation-headless-composed") @logs)))

;; full-forge-unaffected-03: the explicit false 6-arg form behaves exactly
;; like the 5-arg form (byte-identical to pre-BL-308 behavior).
(let [dir (mk-tmp)
      notified (atom [])
      composed (atom [])
      fired? (briefing-generation-schedule-lib/generate-briefing-if-due!
              (ms "2026-07-10T07:00:00Z") 7 0 dir false
              {:notify! (fn [text] (swap! notified conj text))
               :compose-headless! (fn [day-key] (swap! composed conj day-key))
               :emit-sidecar! (fn [] nil)
               :log! (fn [& _] nil)})]
  (assert= "full-forge-unaffected-03: not hibernated -> fires and returns true" true fired?)
  (assert= "full-forge-unaffected-03: the coordinator-nudge adapter fires, unchanged"
           ["Daily briefing due: compose today's briefing per your role and commit it to docs/briefings/2026-07-10.md."]
           @notified)
  (assert= "full-forge-unaffected-03: the headless composer is never called when not hibernated"
           [] @composed))

;; idempotent-no-double-generate-04: hibernated AND already generated today
;; -> neither adapter fires.
(let [dir (mk-tmp)
      notified (atom [])
      composed (atom [])]
  (spit (str (fs/path dir "2026-07-10.md")) "Swarm parked - lightweight briefing for 2026-07-10\n")
  (let [fired? (briefing-generation-schedule-lib/generate-briefing-if-due!
                (ms "2026-07-10T20:00:00Z") 7 0 dir true
                {:notify! (fn [text] (swap! notified conj text))
                 :compose-headless! (fn [day-key] (swap! composed conj day-key))
                 :emit-sidecar! (fn [] nil)
                 :log! (fn [& _] nil)})]
    (assert= "idempotent-no-double-generate-04: already generated -> does not fire, returns false" false fired?)
    (assert= "idempotent-no-double-generate-04: the headless composer is never called a second time"
             [] @composed)
    (assert= "idempotent-no-double-generate-04: the notify adapter is never called either"
             [] @notified)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: briefing_generation_schedule_lib.bb"))
