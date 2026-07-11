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

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: front_desk_supervisor_lib.bb"))
