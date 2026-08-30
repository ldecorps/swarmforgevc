#!/usr/bin/env bb
;; BL-670: TDD runner for the stage QUALIFIER and the health dot in
;; pipeline_stage_lib.bb. Pure assertions; the CLI's own scan of the three
;; mailbox states is covered by the acceptance, which drives it over a real
;; fixture tree.
(ns pipeline-stage-qualifier-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "pipeline_stage_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def role-order ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(defn reconcile [observations]
  (pipeline-stage-lib/reconcile-stage-entries observations role-order))

;; ── the three statuses ────────────────────────────────────────────────────

(assert= "a claimed parcel derives claimed at its role"
         {"A" {:stage "cleaner" :status "claimed" :asOf "t"}}
         (reconcile [{:role "cleaner" :ticket-id "A" :status "claimed" :as-of "t"}]))

(assert= "a delivered parcel derives in-transit-to its recipient"
         {"A" {:stage "cleaner" :status "in-transit-to" :asOf "t"}}
         (reconcile [{:role "cleaner" :ticket-id "A" :status "in-transit-to" :as-of "t"}]))

(assert= "a trail-only ticket derives last-known"
         {"A" {:stage "documenter" :status "last-known" :asOf "t"}}
         (reconcile [{:role "documenter" :ticket-id "A" :status "last-known" :as-of "t"}]))

;; ── BL-1048's landed rule survives: most-downstream LIVE wins ─────────────

(assert= "a downstream delivery beats an upstream claim (BL-1048's own scenario)"
         {"A" {:stage "architect" :status "in-transit-to" :asOf "t1"}}
         (reconcile [{:role "cleaner" :ticket-id "A" :status "claimed" :as-of "t0"}
                     {:role "architect" :ticket-id "A" :status "in-transit-to" :as-of "t1"}]))

(assert= "at the SAME role, opened beats merely delivered"
         {"A" {:stage "cleaner" :status "claimed" :asOf "t1"}}
         (reconcile [{:role "cleaner" :ticket-id "A" :status "in-transit-to" :as-of "t0"}
                     {:role "cleaner" :ticket-id "A" :status "claimed" :as-of "t1"}]))

(assert= "...whichever order the two arrive in"
         {"A" {:stage "cleaner" :status "claimed" :asOf "t1"}}
         (reconcile [{:role "cleaner" :ticket-id "A" :status "claimed" :as-of "t1"}
                     {:role "cleaner" :ticket-id "A" :status "in-transit-to" :as-of "t0"}]))

;; ── the trail is a FALLBACK, never a competitor ───────────────────────────

(assert= "a trail entry never displaces a live one, even further downstream"
         {"A" {:stage "coder" :status "claimed" :asOf "t0"}}
         (reconcile [{:role "coder" :ticket-id "A" :status "claimed" :as-of "t0"}
                     {:role "QA" :ticket-id "A" :status "last-known" :as-of "t9"}]))

(assert= "...and is used when nothing live mentions the ticket at all"
         {"A" {:stage "QA" :status "last-known" :asOf "t9"}}
         (reconcile [{:role "QA" :ticket-id "A" :status "last-known" :as-of "t9"}]))

(assert= "two tickets, one live and one trail-only, both derive"
         {"A" {:stage "coder" :status "claimed" :asOf "t0"}
          "B" {:stage "documenter" :status "last-known" :asOf "t1"}}
         (reconcile [{:role "coder" :ticket-id "A" :status "claimed" :as-of "t0"}
                     {:role "documenter" :ticket-id "B" :status "last-known" :as-of "t1"}]))

(assert= "an unrecognised role never wins over a recognised one"
         {"A" {:stage "coder" :status "claimed" :asOf "t0"}}
         (reconcile [{:role "coder" :ticket-id "A" :status "claimed" :as-of "t0"}
                     {:role "nobody" :ticket-id "A" :status "claimed" :as-of "t1"}]))

(assert= "no observations derive nothing" {} (reconcile []))

;; ── the health dot ────────────────────────────────────────────────────────

(assert= "no bounces is green" "green" (pipeline-stage-lib/health-dot-for-bounces 0))
(assert= "one bounce is yellow" "yellow" (pipeline-stage-lib/health-dot-for-bounces 1))
(assert= "two bounces is yellow" "yellow" (pipeline-stage-lib/health-dot-for-bounces 2))
(assert= "three bounces is red - the human's own bound" "red" (pipeline-stage-lib/health-dot-for-bounces 3))
(assert= "eight bounces is red" "red" (pipeline-stage-lib/health-dot-for-bounces 8))
(assert= "an unrecorded count is green, not a crash" "green" (pipeline-stage-lib/health-dot-for-bounces nil))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
