#!/usr/bin/env bb
;; TDD runner for disk_space_lib.bb (BL-412) - pure assertions against
;; injected readings/state, no real df, no real clock.
(ns disk-space-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "disk_space_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def th (disk-space-lib/thresholds))

;; ── level-for-mnt-c: absolute free-GB thresholds ───────────────────────────
(assert= "level-for-mnt-c: plenty free -> healthy" :healthy
         (disk-space-lib/level-for-mnt-c {:free-gb 100 :used-pct 10} (:mnt-c th)))
(assert= "level-for-mnt-c: below warn -> warn" :warn
         (disk-space-lib/level-for-mnt-c {:free-gb 30 :used-pct 90} (:mnt-c th)))
(assert= "level-for-mnt-c: below critical -> critical" :critical
         (disk-space-lib/level-for-mnt-c {:free-gb 10 :used-pct 98} (:mnt-c th)))
(assert= "level-for-mnt-c: exactly at the warn boundary is still healthy (< not <=)" :healthy
         (disk-space-lib/level-for-mnt-c {:free-gb 40 :used-pct 50} (:mnt-c th)))
(assert= "level-for-mnt-c: exactly at the critical boundary is still warn" :warn
         (disk-space-lib/level-for-mnt-c {:free-gb 15 :used-pct 50} (:mnt-c th)))

;; ── level-for-wsl-root: percent-used thresholds ────────────────────────────
(assert= "level-for-wsl-root: low usage -> healthy" :healthy
         (disk-space-lib/level-for-wsl-root {:free-gb 100 :used-pct 50} (:wsl-root th)))
(assert= "level-for-wsl-root: at warn threshold -> warn (>=)" :warn
         (disk-space-lib/level-for-wsl-root {:free-gb 5 :used-pct 90} (:wsl-root th)))
(assert= "level-for-wsl-root: at critical threshold -> critical (>=)" :critical
         (disk-space-lib/level-for-wsl-root {:free-gb 1 :used-pct 95} (:wsl-root th)))

;; ── thresholds: env override with defaults (KNOWN_VALUES-style, no bare passthrough) ──
(assert= "thresholds: defaults when no env set" 40.0 (get-in (disk-space-lib/thresholds {}) [:mnt-c :warn-free-gb]))
(assert= "thresholds: reads an env override" 20.0
         (get-in (disk-space-lib/thresholds {"DISK_ALERT_MNT_C_WARN_GB" "20"}) [:mnt-c :warn-free-gb]))
(assert= "thresholds: an unparsable env override falls back to the default" 40.0
         (get-in (disk-space-lib/thresholds {"DISK_ALERT_MNT_C_WARN_GB" "not-a-number"}) [:mnt-c :warn-free-gb]))

;; ── disk-space-alert-01 (Scenario Outline): a downward transition announces once ──
(doseq [[prev now] [[:healthy :warn] [:warn :critical] [:healthy :critical]]]
  (let [reading (case now :warn {:free-gb 30 :used-pct 92} :critical {:free-gb 10 :used-pct 97})
        result (disk-space-lib/disk-space-decision {:mnt-c reading} {"mnt-c" (name prev)} th)]
    (assert= (str "disk-space-alert-01: " prev " -> " now " announces exactly one message")
             1 (count (:messages result)))
    (assert= (str "disk-space-alert-01: " prev " -> " now " message names the new level")
             now (:level (first (:messages result))))
    (assert= (str "disk-space-alert-01: " prev " -> " now " persists the new level")
             (name now) (get (:next-state result) "mnt-c"))))

;; ── disk-space-alert-02: an unchanged level is not re-announced ───────────
(let [result (disk-space-lib/disk-space-decision {:mnt-c {:free-gb 5 :used-pct 99}} {"mnt-c" "critical"} th)]
  (assert= "disk-space-alert-02: unchanged critical -> no message" 0 (count (:messages result)))
  (assert= "disk-space-alert-02: unchanged critical -> state stays critical" "critical" (get (:next-state result) "mnt-c")))

;; ── disk-space-alert-03: recovery announces a return to healthy ───────────
(let [result (disk-space-lib/disk-space-decision {:mnt-c {:free-gb 100 :used-pct 20}} {"mnt-c" "critical"} th)]
  (assert= "disk-space-alert-03: recovery announces exactly one message" 1 (count (:messages result)))
  (assert= "disk-space-alert-03: recovery message names healthy" :healthy (:level (first (:messages result))))
  (assert= "disk-space-alert-03: recovery persists healthy" "healthy" (get (:next-state result) "mnt-c")))

;; ── disk-space-alert-04: each filesystem is evaluated independently ───────
(let [result (disk-space-lib/disk-space-decision
              {:wsl-root {:free-gb 50 :used-pct 40} :mnt-c {:free-gb 5 :used-pct 99}}
              {"wsl-root" "healthy" "mnt-c" "healthy"}
              th)]
  (assert= "disk-space-alert-04: exactly one message (mnt-c only)" 1 (count (:messages result)))
  (assert= "disk-space-alert-04: the message is for mnt-c" :mnt-c (:mount (first (:messages result))))
  (assert= "disk-space-alert-04: mnt-c's new level is critical" :critical (:level (first (:messages result))))
  (assert= "disk-space-alert-04: wsl-root stays healthy in state" "healthy" (get (:next-state result) "wsl-root")))

;; ── a mount never seen before defaults its prior level to healthy ─────────
(let [result (disk-space-lib/disk-space-decision {:mnt-c {:free-gb 100 :used-pct 10}} {} th)]
  (assert= "a brand-new mount at a healthy reading announces nothing (default prior = healthy)"
           0 (count (:messages result))))

;; ── message content names the mount, free amount, and free percent ───────
(let [result (disk-space-lib/disk-space-decision {:mnt-c {:free-gb 10.0 :used-pct 97.0}} {"mnt-c" "healthy"} th)
      text (:text (first (:messages result)))]
  (assert= "message names the mount" true (boolean (re-find #"/mnt/c" text)))
  (assert= "message names the free amount" true (boolean (re-find #"10" text)))
  (assert= "message names the free/used percent" true (boolean (re-find #"97" text))))

;; ── report ─────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: disk_space_lib.bb"))
