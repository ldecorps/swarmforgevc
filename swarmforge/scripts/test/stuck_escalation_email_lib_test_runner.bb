#!/usr/bin/env bb
;; TDD runner for stuck_escalation_email_lib.bb (BL-349) - no filesystem
;; beyond a real throwaway fixture dir for the state file, no real clock
;; (every now-ms is explicit), no real network (send-email! is always a
;; fake). Mirrors operator_lib_test_runner.bb's own assert-battery shape.

(ns stuck-escalation-email-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "stuck_escalation_email_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def retry-cfg {:max-attempts 3 :backoff-base-ms 1000 :backoff-max-ms 8000})

;; ── classify-delivery-result ──────────────────────────────────────────────

(assert= "classify-delivery-result: a successful send is :delivered"
         :delivered (stuck-escalation-email-lib/classify-delivery-result {:success true :status 200}))
(assert= "classify-delivery-result: no recipient (:disabled) is :terminal-misconfig"
         :terminal-misconfig (stuck-escalation-email-lib/classify-delivery-result {:success false :reason :disabled}))
(assert= "classify-delivery-result: missing api key is :terminal-misconfig"
         :terminal-misconfig (stuck-escalation-email-lib/classify-delivery-result {:success false :reason :missing-api-key}))
(assert= "classify-delivery-result: test-fixture-suppressed is :terminal-misconfig, never a real failure"
         :terminal-misconfig (stuck-escalation-email-lib/classify-delivery-result {:success false :reason :test-fixture-suppressed}))
(assert= "classify-delivery-result: a failed send with NO reason (HTTP non-2xx) is :transient-failure"
         :transient-failure (stuck-escalation-email-lib/classify-delivery-result {:success false :status 503}))
(assert= "classify-delivery-result: a failed send with NO reason (exception) is :transient-failure"
         :transient-failure (stuck-escalation-email-lib/classify-delivery-result {:success false :error "Connection refused"}))

;; ── should-attempt? ────────────────────────────────────────────────────────

(assert-true "should-attempt?: fresh escalation (never attempted) attempts immediately"
             (stuck-escalation-email-lib/should-attempt?
              {:armed? false :delivery-attempts 0 :last-attempt-at-ms nil :now-ms 100000 :retry-config retry-cfg}))
(assert-false "should-attempt?: already armed - never re-attempt (anti-spam)"
              (stuck-escalation-email-lib/should-attempt?
               {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :now-ms 100000 :retry-config retry-cfg}))
(assert-false "should-attempt?: a retry before its backoff has elapsed waits"
              (stuck-escalation-email-lib/should-attempt?
               {:armed? false :delivery-attempts 1 :last-attempt-at-ms 100000 :now-ms 100500 :retry-config retry-cfg}))
(assert-true "should-attempt?: a retry once its backoff has elapsed is due"
             (stuck-escalation-email-lib/should-attempt?
              {:armed? false :delivery-attempts 1 :last-attempt-at-ms 100000 :now-ms 101000 :retry-config retry-cfg}))

;; ── next-state ─────────────────────────────────────────────────────────────

(assert= "next-state: :delivered arms and resets attempts"
         {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? false}
         (stuck-escalation-email-lib/next-state :delivered {:delivery-attempts 2} retry-cfg 200000))
(assert= "next-state: :terminal-misconfig arms without retrying"
         {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? false}
         (stuck-escalation-email-lib/next-state :terminal-misconfig {:delivery-attempts 0} retry-cfg 200000))
(assert= "next-state: :transient-failure under the cap stays UNARMED and counts the attempt"
         {:armed? false :delivery-attempts 1 :last-attempt-at-ms 200000 :gave-up? false}
         (stuck-escalation-email-lib/next-state :transient-failure {:delivery-attempts 0} retry-cfg 200000))
(assert= "next-state: :transient-failure AT the cap arms anyway and gives up loudly"
         {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? true}
         (stuck-escalation-email-lib/next-state :transient-failure {:delivery-attempts 2} retry-cfg 200000))

;; ── sweep! (adapter-injected orchestration, real state-file fixture,
;;    fake send-email!) - BL-349's own 7 acceptance scenarios ────────────

(defn mk-fixture-dir []
  (str (fs/create-temp-dir {:prefix "sfvc-stuck-escalation-email-"})))

(defn fake-adapters [outcomes-atom calls-atom]
  {:send-email! (fn [subject text]
                  (swap! calls-atom conj {:subject subject :text text})
                  (let [next-outcome (first @outcomes-atom)]
                    (swap! outcomes-atom rest)
                    next-outcome))
   :log! (fn [& parts] (swap! calls-atom (fn [c] (conj c {:log (vec parts)}))))})

;; stuck-escalation-email-headless-01/02: a newly escalated role emails the
;; human, and write-state! records it (the escalation FILE itself is
;; chase_sweep_lib.bb's own write-escalation!, unchanged/untouched - this
;; sweep only owns the email leg).
(let [dir (mk-fixture-dir)
      calls (atom [])
      outcomes (atom [{:success true}])]
  (stuck-escalation-email-lib/sweep! "coder" true 100000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "01: a newly escalated role gets exactly one send attempt" 1
           (count (filter :subject @calls)))
  (assert= "02: the state is armed after a delivered send"
           {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil}
           (get (stuck-escalation-email-lib/read-state dir) :coder)))

;; stuck-escalation-email-headless-03: a role that stays stuck is not
;; emailed about repeatedly.
(let [dir (mk-fixture-dir)
      calls (atom [])
      outcomes (atom [{:success true}])]
  (stuck-escalation-email-lib/sweep! "coder" true 100000 dir retry-cfg (fake-adapters outcomes calls))
  (stuck-escalation-email-lib/sweep! "coder" true 200000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "03: still armed on a later sweep, no second send is attempted" 1
           (count (filter :subject @calls))))

;; stuck-escalation-email-headless-04: a role that recovers and gets stuck
;; again is escalated again.
(let [dir (mk-fixture-dir)
      calls (atom [])
      outcomes (atom [{:success true} {:success true}])]
  (stuck-escalation-email-lib/sweep! "coder" true 100000 dir retry-cfg (fake-adapters outcomes calls))
  (stuck-escalation-email-lib/sweep! "coder" false 150000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "04: recovery clears the per-role state entirely" nil
           (get (stuck-escalation-email-lib/read-state dir) :coder))
  (stuck-escalation-email-lib/sweep! "coder" true 200000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "04: a NEW stuck episode after recovery emails again" 2
           (count (filter :subject @calls))))

;; stuck-escalation-email-headless-05: a send that fails is retried, not
;; treated as delivered.
(let [dir (mk-fixture-dir)
      calls (atom [])
      outcomes (atom [{:success false :status 503}])]
  (stuck-escalation-email-lib/sweep! "coder" true 100000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "05: a transient failure never arms"
           {:armed? false :delivery-attempts 1 :last-attempt-at-ms 100000}
           (get (stuck-escalation-email-lib/read-state dir) :coder))
  ;; Retried once the backoff has elapsed (backoff-base-ms 1000 for attempt 1).
  (swap! outcomes (constantly [{:success true}]))
  (stuck-escalation-email-lib/sweep! "coder" true 101000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "05: the retry attempted a second send" 2
           (count (filter :subject @calls)))
  (assert= "05: the retry, once delivered, arms"
           {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil}
           (get (stuck-escalation-email-lib/read-state dir) :coder)))

;; stuck-escalation-email-headless-06: an undeliverable escalation is
;; surfaced rather than silently forgotten (terminal misconfig warns once
;; and arms; a transient failure that exhausts the retry cap arms and logs
;; GAVE-UP loudly rather than retrying forever).
(let [dir (mk-fixture-dir)
      calls (atom [])
      outcomes (atom [{:success false :reason :missing-api-key}])]
  (stuck-escalation-email-lib/sweep! "coder" true 100000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "06: a terminal misconfiguration arms immediately (warn once, never retry)"
           {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil}
           (get (stuck-escalation-email-lib/read-state dir) :coder))
  (assert-true "06: the terminal-misconfig outcome is logged"
               (some #(and (:log %) (some #{"terminal-misconfig"} (:log %))) @calls)))

(let [dir (mk-fixture-dir)
      calls (atom [])
      outcomes (atom [{:success false :status 503} {:success false :status 503} {:success false :status 503}])]
  (stuck-escalation-email-lib/sweep! "coder" true 100000 dir retry-cfg (fake-adapters outcomes calls))
  (stuck-escalation-email-lib/sweep! "coder" true 101000 dir retry-cfg (fake-adapters outcomes calls))
  (stuck-escalation-email-lib/sweep! "coder" true 103000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "06: exhausting the retry cap (max-attempts 3) arms anyway rather than retrying forever"
           {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil}
           (get (stuck-escalation-email-lib/read-state dir) :coder))
  (assert-true "06: the give-up is logged loudly"
               (some #(and (:log %) (some #{"gave-up=true"} (:log %))) @calls)))

;; stuck-escalation-email-headless-07: no role stuck means no email.
(let [dir (mk-fixture-dir)
      calls (atom [])
      outcomes (atom [])]
  (stuck-escalation-email-lib/sweep! "coder" false 100000 dir retry-cfg (fake-adapters outcomes calls))
  (assert= "07: no escalation, no send attempt at all" 0 (count (filter :subject @calls)))
  (assert= "07: no state entry is ever created for a role that was never stuck" nil
           (get (stuck-escalation-email-lib/read-state dir) :coder)))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "stuck_escalation_email_lib: ALL TESTS PASSED")
  (do (println (str "stuck_escalation_email_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
