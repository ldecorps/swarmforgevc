#!/usr/bin/env bb
;; TDD runner for mutation_cooldown_lib.bb (BL-149) - no git, no real host
;; load average, pure assertions against injected values.
(ns mutation-cooldown-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mutation_cooldown_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def day-ms (* 24 60 60 1000))
(def NOW 1783728000000) ; arbitrary fixed instant

;; ── parse-conf ────────────────────────────────────────────────────────────────
(assert= "parse-conf reads a config line"
         {"mutation_cooldown_days" "7"}
         (mutation-cooldown-lib/parse-conf "# comment\nconfig mutation_cooldown_days 7\n"))

(assert= "parse-conf ignores blank/comment/unrelated lines"
         {"mutation_cooldown_days" "7"}
         (mutation-cooldown-lib/parse-conf "\n# nope\nwindow coder claude coder\nconfig mutation_cooldown_days 7\n"))

;; ── cooldown-days / busy-load-multiplier (config, fresh, with defaults) ───────
(assert= "cooldown-days reads the configured value" 7 (mutation-cooldown-lib/cooldown-days {"mutation_cooldown_days" "7"}))
(assert= "cooldown-days defaults to 3 when absent" 3 (mutation-cooldown-lib/cooldown-days {}))
(assert= "cooldown-days defaults to 3 when unparsable" 3 (mutation-cooldown-lib/cooldown-days {"mutation_cooldown_days" "nope"}))

(assert= "busy-load-multiplier reads the configured value" 1.5 (mutation-cooldown-lib/busy-load-multiplier {"mutation_busy_load_multiplier" "1.5"}))
(assert= "busy-load-multiplier defaults to 2 when absent" 2 (mutation-cooldown-lib/busy-load-multiplier {}))

;; ── host-busy? ─────────────────────────────────────────────────────────────────
(assert= "host-busy? true once load avg exceeds multiplier x cores" true (mutation-cooldown-lib/host-busy? 9.0 4 2))
(assert= "host-busy? false at or under multiplier x cores" false (mutation-cooldown-lib/host-busy? 8.0 4 2))

;; ── decide-mutation-gate: BL-149 cooldown-gate-01..03 ─────────────────────────
;; 01: within cooldown -> skip regardless of host business.
(assert= "cooldown-gate-01: within cooldown, host quiet -> skip-cooldown"
         :skip-cooldown
         (mutation-cooldown-lib/decide-mutation-gate (- NOW (* 1 day-ms)) NOW 3 false))
(assert= "cooldown-gate-01: within cooldown, host busy -> still skip-cooldown"
         :skip-cooldown
         (mutation-cooldown-lib/decide-mutation-gate (- NOW (* 1 day-ms)) NOW 3 true))

;; 02: past cooldown, host busy -> skip-busy (deferred, still due).
(assert= "cooldown-gate-02: past cooldown, host busy -> skip-busy"
         :skip-busy
         (mutation-cooldown-lib/decide-mutation-gate (- NOW (* 4 day-ms)) NOW 3 true))

;; 03: past cooldown, host quiet -> run.
(assert= "cooldown-gate-03: past cooldown, host quiet -> run"
         :run
         (mutation-cooldown-lib/decide-mutation-gate (- NOW (* 4 day-ms)) NOW 3 false))

;; ── cooldown-gate-04: configurable cooldown period (Scenario Outline) ─────────
(doseq [[days age-days outcome] [[3 2 :skip-cooldown]
                                 [3 4 :run]
                                 [7 5 :skip-cooldown]
                                 [7 8 :run]]]
  (assert= (str "cooldown-gate-04: " days "-day cooldown, " age-days "-day-old file, quiet host -> " outcome)
           outcome
           (mutation-cooldown-lib/decide-mutation-gate (- NOW (* age-days day-ms)) NOW days false)))

;; ── boundary: exactly at the cooldown edge is treated as past it ──────────────
(assert= "exactly at the cooldown boundary counts as past cooldown"
         :run
         (mutation-cooldown-lib/decide-mutation-gate (- NOW (* 3 day-ms)) NOW 3 false))

;; ── report ─────────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: mutation_cooldown_lib.bb"))
