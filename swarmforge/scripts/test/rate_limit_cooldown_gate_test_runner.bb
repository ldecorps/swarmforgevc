#!/usr/bin/env bb
;; TDD runner for chase_sweep_lib.bb's BL-209 rate-limit cooldown gate
;; functions - pure assertions, no real mailbox I/O, no real timers.
;; read-rate-limit-cooldown-* / mark-rate-limit-cooldown-woken! get their
;; own fixture-based tests further down (real fs I/O against a temp dir,
;; no live swarm) - end-to-end run-sweep! gating is covered by
;; test_chase_sweep.sh's new scenarios (same harness as the rest of that
;; suite).
(ns rate-limit-cooldown-gate-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── rate-limit-cooling-down? (pure, mirrors cooldownScheduler.ts's
;;    isCoolingDown) ─────────────────────────────────────────────────────

(assert= "suppress-wake-02: still before the recorded expiry is cooling down"
         true
         (chase-sweep-lib/rate-limit-cooling-down? 2000 1000))

(assert= "resume-at-reset-03: at/after the recorded expiry is not cooling down"
         false
         (chase-sweep-lib/rate-limit-cooling-down? 1000 1000))

(assert= "past the recorded expiry is not cooling down"
         false
         (chase-sweep-lib/rate-limit-cooling-down? 1000 2000))

(assert= "no recorded cooldown (nil) is never cooling down"
         false
         (chase-sweep-lib/rate-limit-cooling-down? nil 1000))

;; ── should-wake-on-rate-limit-expiry? (pure, mirrors cooldownScheduler.ts's
;;    shouldWakeOnExpiry) ───────────────────────────────────────────────

(assert= "resume-at-reset-03: past expiry, never woken for this exact until-ms -> wake"
         true
         (chase-sweep-lib/should-wake-on-rate-limit-expiry? 1000 1000 nil))

(assert= "already woken for this exact until-ms -> do not wake again"
         false
         (chase-sweep-lib/should-wake-on-rate-limit-expiry? 1000 1000 1000))

(assert= "a LATER cooldown for the same role (different until-ms) still gets its own wake"
         true
         (chase-sweep-lib/should-wake-on-rate-limit-expiry? 2000 2000 1000))

(assert= "still cooling down (not yet past expiry) -> do not wake"
         false
         (chase-sweep-lib/should-wake-on-rate-limit-expiry? 2000 1000 nil))

(assert= "no recorded cooldown (nil) -> never wake"
         false
         (chase-sweep-lib/should-wake-on-rate-limit-expiry? nil 1000 nil))

;; ── read-rate-limit-cooldown-* / mark-rate-limit-cooldown-woken!
;;    (fixture-based fs I/O, no live swarm) ─────────────────────────────

(defn mk-tmp [] (str (fs/create-temp-dir {:prefix "rate-limit-cooldown-test-"})))

(let [dir (mk-tmp)]
  (spit (str (fs/path dir "rate-limit-cooldown.json")) "{\"coder\":{\"untilMs\":5000}}")
  (assert= "reads an existing role's untilMs from the shared file"
           5000
           (chase-sweep-lib/read-rate-limit-cooldown-until-ms dir "coder"))
  (assert= "a role absent from the file reads as no cooldown (nil)"
           nil
           (chase-sweep-lib/read-rate-limit-cooldown-until-ms dir "cleaner"))
  (assert= "no wokenForUntilMs recorded yet reads as nil"
           nil
           (chase-sweep-lib/read-rate-limit-cooldown-woken-marker dir "coder")))

(assert= "an absent cooldown file reads as no cooldown for any role, never a crash"
         nil
         (chase-sweep-lib/read-rate-limit-cooldown-until-ms (mk-tmp) "coder"))

(let [dir (mk-tmp)]
  (spit (str (fs/path dir "rate-limit-cooldown.json")) "{\"coder\":{\"untilMs\":5000}}")
  (chase-sweep-lib/mark-rate-limit-cooldown-woken! dir "coder" 5000)
  (assert= "mark-rate-limit-cooldown-woken! records the wake marker"
           5000
           (chase-sweep-lib/read-rate-limit-cooldown-woken-marker dir "coder"))
  (assert= "marking woken does not remove the untilMs itself (matches, not clears, cooldownScheduler.ts)"
           5000
           (chase-sweep-lib/read-rate-limit-cooldown-until-ms dir "coder")))

(let [dir (mk-tmp)]
  ;; No entry for this role at all - marking woken must not fabricate one.
  (chase-sweep-lib/mark-rate-limit-cooldown-woken! dir "coder" 5000)
  (assert= "marking woken for a role with no existing entry is a harmless no-op"
           nil
           (chase-sweep-lib/read-rate-limit-cooldown-until-ms dir "coder")))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: chase_sweep_lib.bb rate-limit cooldown gate"))
